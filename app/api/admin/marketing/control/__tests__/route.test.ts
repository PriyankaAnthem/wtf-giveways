import { describe, it, expect, beforeEach, vi } from 'vitest'

// The route transitively imports `server-only` via the auth/query chain.
vi.mock('server-only', () => ({}))

// ---- Mocks -----------------------------------------------------------------
const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// A chainable service-role client stub. Every method returns `this` so the
// route's query builder resolves through .from().select().eq().maybeSingle()
// and .update(...).select(...).maybeSingle().
const controlRow = {
  sending_enabled: false,
  discovery_enabled: false,
  rollout_limit: 0,
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

const fetchRecipientCountsByStatus = vi.fn()
const fetchConfigurationSnapshot = vi.fn()
vi.mock('@/lib/admin/marketing/hub-queries', () => ({
  getServiceSupabase: () => serviceClient,
  serializeControl: (row: Record<string, unknown> | null) =>
    row
      ? {
          sendingEnabled: row.sending_enabled,
          discoveryEnabled: row.discovery_enabled,
          rolloutLimit: row.rollout_limit,
          maximumBatchSize: row.maximum_batch_size,
          maximumDailyPerContact: row.maximum_daily_per_contact,
          maximumWeeklyPerContact: row.maximum_weekly_per_contact,
          updatedAt: row.updated_at,
        }
      : null,
  fetchRecipientCountsByStatus: (...a: unknown[]) => fetchRecipientCountsByStatus(...a),
  fetchConfigurationSnapshot: (...a: unknown[]) => fetchConfigurationSnapshot(...a),
}))

import { GET, PUT } from '../route'

function putReq(body: unknown) {
  return new Request('http://test/api/admin/marketing/control', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

const VALID_PUT = {
  sendingEnabled: false,
  discoveryEnabled: false,
  rolloutLimit: 0,
  maximumBatchSize: 50,
  maximumDailyPerContact: 1,
  maximumWeeklyPerContact: 3,
}

beforeEach(() => {
  authorizeAdminApi.mockReset()
  maybeSingle.mockReset()
  update.mockReset()
  fetchRecipientCountsByStatus.mockReset()
  fetchConfigurationSnapshot.mockReset()
  serviceClient = makeServiceClient()
  maybeSingle.mockResolvedValue({ data: controlRow, error: null })
  fetchRecipientCountsByStatus.mockResolvedValue({})
  fetchConfigurationSnapshot.mockResolvedValue({
    activeRunCount: 0,
    externalContactCount: 0,
    externalContactEnabledCount: 0,
    promotionCountsByStatus: {},
  })
})

describe('GET /api/admin/marketing/control — authorization', () => {
  it('rejects an unauthenticated request with 401', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
  })

  it('rejects a non-admin role with 403', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'operations_admin', error: 'Not authorized' })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('requests admin-only authorization', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
    await GET()
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin'] })
  })
})

describe('GET /api/admin/marketing/control — success', () => {
  beforeEach(() => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
  })

  it('returns the (fully paused) control state and aggregate-only counts', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.control.sendingEnabled).toBe(false)
    expect(body.control.discoveryEnabled).toBe(false)
    // Counts are plain numbers/maps, never identity rows.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/"email"|"user_id"|"userId"|"full_name"/)
  })
})

describe('PUT /api/admin/marketing/control — validation & safety', () => {
  beforeEach(() => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
  })

  it('rejects a non-admin before any write', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await PUT(putReq(VALID_PUT))
    expect(res.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a weekly cap below the daily cap with 400 and no write', async () => {
    const res = await PUT(putReq({ ...VALID_PUT, maximumDailyPerContact: 5, maximumWeeklyPerContact: 2 }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'weekly_below_daily' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a batch size over the ceiling with 400 and no write', async () => {
    const res = await PUT(putReq({ ...VALID_PUT, maximumBatchSize: 101 }))
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with 400', async () => {
    const bad = new Request('http://test/api/admin/marketing/control', {
      method: 'PUT',
      body: '{not json',
    })
    const res = await PUT(bad)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_json' })
  })

  it('updates the singleton on a valid payload (UPDATE only, never insert/delete)', async () => {
    const res = await PUT(putReq(VALID_PUT))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    // The write carries updated_by from the session user and never toggles a
    // send system into existence — it only persists the flags/limits.
    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect(written.updated_by).toBe('u1')
    expect(written.sending_enabled).toBe(false)
  })
})
