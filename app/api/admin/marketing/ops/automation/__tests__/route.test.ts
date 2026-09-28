import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Chainable stub that records every .eq() filter and .update() payload so we can
// assert the mutation is narrowed to exactly one automation_key.
const eqCalls: Array<[string, unknown]> = []
const updatePayloads: Array<Record<string, unknown>> = []
let readResult: { data: unknown; error: unknown } = { data: { template_id: 't1' }, error: null }
let updateResult: { data: unknown; error: unknown } = {
  data: {
    automation_key: 'vip_early_access',
    name: 'VIP Early Access',
    enabled: true,
    priority: 1,
    first_delay_minutes: 10,
    cooldown_hours: 24,
    maximum_recipients_per_run: 50,
  },
  error: null,
}
let mode: 'read' | 'update' = 'read'

function makeServiceClient() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.update = (payload: Record<string, unknown>) => {
    mode = 'update'
    updatePayloads.push(payload)
    return chain
  }
  chain.eq = (col: string, val: unknown) => {
    eqCalls.push([col, val])
    return chain
  }
  chain.maybeSingle = vi.fn(async () => (mode === 'update' ? updateResult : readResult))
  return chain
}
let serviceClient = makeServiceClient()

vi.mock('@/lib/admin/marketing/ops-queries', () => ({
  getServiceSupabase: () => serviceClient,
  serializeOpsAutomation: (row: Record<string, unknown>) => ({
    automationKey: row.automation_key,
    enabled: row.enabled,
  }),
}))

import { PATCH } from '../route'

function req(body: unknown) {
  return new Request('http://test/api/admin/marketing/ops/automation', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authorizeAdminApi.mockReset()
  eqCalls.length = 0
  updatePayloads.length = 0
  mode = 'read'
  readResult = { data: { template_id: 't1' }, error: null }
  updateResult = {
    data: {
      automation_key: 'vip_early_access',
      name: 'VIP Early Access',
      enabled: true,
      priority: 1,
      first_delay_minutes: 10,
      cooldown_hours: 24,
      maximum_recipients_per_run: 50,
    },
    error: null,
  }
  serviceClient = makeServiceClient()
  authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
})

describe('authorization', () => {
  it('rejects unauthenticated with 401 and never mutates', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await PATCH(req({ automationKey: 'vip_early_access', enabled: false }))
    expect(res.status).toBe(401)
    expect(updatePayloads.length).toBe(0)
  })
  it('rejects a non-admin with 403', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'x' }, role: 'operations_admin', error: 'Not authorized' })
    const res = await PATCH(req({ automationKey: 'vip_early_access', enabled: false }))
    expect(res.status).toBe(403)
    expect(updatePayloads.length).toBe(0)
  })
})

describe('narrow scoping', () => {
  it('rejects an unknown automation key with 400 and no mutation', async () => {
    const res = await PATCH(req({ automationKey: 'not_a_real_key', enabled: false }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_automation_key' })
    expect(updatePayloads.length).toBe(0)
  })

  it('disables immediately, scoped to exactly the requested automation_key', async () => {
    const res = await PATCH(req({ automationKey: 'vip_early_access', enabled: false }))
    expect(res.status).toBe(200)
    // Exactly one update, filtered by the single automation_key.
    expect(updatePayloads.length).toBe(1)
    expect(updatePayloads[0].enabled).toBe(false)
    expect(eqCalls).toContainEqual(['automation_key', 'vip_early_access'])
    // Only enabled/updated fields are written — never priority/template/etc.
    expect(Object.keys(updatePayloads[0]).sort()).toEqual(['enabled', 'updated_at', 'updated_by'])
  })

  it('blocks enabling an automation with no template assigned (409) and never enables a definition', async () => {
    readResult = { data: { template_id: null }, error: null }
    const res = await PATCH(req({ automationKey: 'vip_early_access', enabled: true }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'template_required_to_enable' })
    expect(updatePayloads.length).toBe(0)
    // Only ever touched the automations table (never definitions).
    expect(serviceClient.from).toHaveBeenCalledWith('marketing_automations')
    expect(serviceClient.from).not.toHaveBeenCalledWith('marketing_opportunity_definitions')
  })

  it('enables when a template exists, writing enabled=true for that key only', async () => {
    const res = await PATCH(req({ automationKey: 'vip_early_access', enabled: true }))
    expect(res.status).toBe(200)
    expect(updatePayloads.length).toBe(1)
    expect(updatePayloads[0].enabled).toBe(true)
    expect(eqCalls).toContainEqual(['automation_key', 'vip_early_access'])
  })
})
