import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role client stub: chainable, resolving the update().select().maybeSingle().
const controlRow = {
  sending_enabled: true,
  discovery_enabled: false,
  rollout_limit: 5,
  maximum_batch_size: 50,
  maximum_daily_per_contact: 1,
  maximum_weekly_per_contact: 3,
  updated_at: '2026-01-01T00:00:00.000Z',
}
const maybeSingle = vi.fn()
const update = vi.fn()
function makeServiceClient() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.update = (...a: unknown[]) => {
    update(...a)
    return chain
  }
  chain.maybeSingle = maybeSingle
  return chain
}
let serviceClient = makeServiceClient()

// Authoritative arming re-read is mocked so we never touch a DB.
const fetchArmingState = vi.fn()
vi.mock('@/lib/admin/marketing/ops-queries', () => ({
  getServiceSupabase: () => serviceClient,
  fetchArmingState: (...a: unknown[]) => fetchArmingState(...a),
  serializeControl: (row: Record<string, unknown> | null) =>
    row ? { sendingEnabled: row.sending_enabled, rolloutLimit: row.rollout_limit } : null,
}))

import { POST } from '../route'

function req(body: unknown) {
  return new Request('http://test/api/admin/marketing/ops/control', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// A safely-armable authoritative state unless a test overrides it.
const ARMABLE = {
  sendingEnabled: false,
  discoveryEnabled: false,
  rolloutLimit: 5,
  maximumBatchSize: 50,
  enabledAutomationCount: 2,
  enabledDefinitionCount: 3,
  queuedRecipientCount: 4,
}

beforeEach(() => {
  authorizeAdminApi.mockReset()
  maybeSingle.mockReset()
  update.mockReset()
  fetchArmingState.mockReset()
  serviceClient = makeServiceClient()
  maybeSingle.mockResolvedValue({ data: controlRow, error: null })
  fetchArmingState.mockResolvedValue({ ...ARMABLE })
  authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
})

describe('authorization', () => {
  it('rejects unauthenticated with 401 and never writes', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await POST(req({ target: 'sending', enabled: false }))
    expect(res.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
    expect(fetchArmingState).not.toHaveBeenCalled()
  })

  it('rejects a non-admin role with 403 and never writes', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'x' }, role: 'operations_admin', error: 'Not authorized' })
    const res = await POST(req({ target: 'sending', enabled: true }))
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('requests admin-only authorization', async () => {
    await POST(req({ target: 'discovery', enabled: false }))
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin'] })
  })
})

describe('arming safety — enabling sending', () => {
  it('blocks when rollout is 0 (409) and never writes', async () => {
    fetchArmingState.mockResolvedValue({ ...ARMABLE, rolloutLimit: 0 })
    const res = await POST(req({ target: 'sending', enabled: true }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'sending_requires_rollout' })
    expect(update).not.toHaveBeenCalled()
  })

  it('blocks when zero automations enabled (409) and never writes', async () => {
    fetchArmingState.mockResolvedValue({ ...ARMABLE, enabledAutomationCount: 0 })
    const res = await POST(req({ target: 'sending', enabled: true }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'sending_requires_automation' })
    expect(update).not.toHaveBeenCalled()
  })

  it('blocks when zero definitions enabled (409) and never writes', async () => {
    fetchArmingState.mockResolvedValue({ ...ARMABLE, enabledDefinitionCount: 0 })
    const res = await POST(req({ target: 'sending', enabled: true }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'sending_requires_definition' })
    expect(update).not.toHaveBeenCalled()
  })

  it('re-reads authoritative state before enabling, then writes only sending_enabled=true', async () => {
    const res = await POST(req({ target: 'sending', enabled: true }))
    expect(res.status).toBe(200)
    expect(fetchArmingState).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect(written.sending_enabled).toBe(true)
    expect(written.updated_by).toBe('u1')
    // Never flips any other operational flag as a side effect.
    expect('discovery_enabled' in written).toBe(false)
    expect('rollout_limit' in written).toBe(false)
  })
})

describe('disabling sending is immediate', () => {
  it('writes sending_enabled=false without an arming re-read gate', async () => {
    const res = await POST(req({ target: 'sending', enabled: false }))
    expect(res.status).toBe(200)
    // No arming precondition needed to turn OFF.
    expect(fetchArmingState).not.toHaveBeenCalled()
    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect(written.sending_enabled).toBe(false)
  })
})

describe('discovery', () => {
  it('enables discovery via its own explicit mutation path (no send side effect)', async () => {
    const res = await POST(req({ target: 'discovery', enabled: true }))
    expect(res.status).toBe(200)
    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect(written.discovery_enabled).toBe(true)
    expect('sending_enabled' in written).toBe(false)
  })
})

describe('rollout', () => {
  it('rejects an invalid rollout value with 400 and no write', async () => {
    const res = await POST(req({ target: 'rollout', rolloutLimit: 7 }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_rollout_limit' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a rollout above the authoritative maximum_batch_size with 409 and no write', async () => {
    fetchArmingState.mockResolvedValue({ ...ARMABLE, maximumBatchSize: 25 })
    const res = await POST(req({ target: 'rollout', rolloutLimit: 50 }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'rollout_exceeds_batch' })
    expect(update).not.toHaveBeenCalled()
  })

  it('applies a valid rollout within batch size, writing only rollout_limit', async () => {
    const res = await POST(req({ target: 'rollout', rolloutLimit: 25 }))
    expect(res.status).toBe(200)
    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect(written.rollout_limit).toBe(25)
    expect('sending_enabled' in written).toBe(false)
  })
})

describe('input hardening', () => {
  it('rejects malformed JSON with 400', async () => {
    const bad = new Request('http://test/api/admin/marketing/ops/control', {
      method: 'POST',
      body: '{nope',
    })
    const res = await POST(bad)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_json' })
  })

  it('rejects an arbitrary/unknown target with 400 and no write', async () => {
    const res = await POST(req({ target: 'maximum_batch_size', value: 999 }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_target' })
    expect(update).not.toHaveBeenCalled()
  })
})
