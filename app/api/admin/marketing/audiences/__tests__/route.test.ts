import { describe, it, expect, beforeEach, vi } from 'vitest'

// The route transitively imports `server-only` (via the auth chain). Neutralise
// it so the module can be imported in vitest's node environment. Matches the
// established pattern used by other route tests in this repo.
vi.mock('server-only', () => ({}))

// ---- Mocks -----------------------------------------------------------------
// Auth is mocked so we can drive role/error without a database. The route calls
// authorizeAdminApi({ roles: ['admin'] }); anything other than an admin returns
// an error and must never reach the service-role client / RPC.
const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

// The user-scoped server client is only used to pass into authorizeAdminApi.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role client factory — its rpc is the single audience RPC. Mocking it
// (rather than the query lib) lets the REAL query lib + identity guard run.
const rpc = vi.fn()
vi.mock('@/lib/admin/live-board', () => ({
  getServiceSupabase: () => ({ rpc }),
}))

import { GET } from '../route'

const OVERVIEW = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  freshness: {
    profileCount: 10,
    backfillComplete: true,
    backfillStartedAt: '2025-12-31T00:00:00.000Z',
    lastSuccessAt: '2026-01-01T00:00:00.000Z',
    lastIncrementalAt: '2026-01-01T00:00:00.000Z',
    lastProcessedUsers: 3,
    stale: false,
  },
  health: {
    totalProfiles: 10,
    currentlyEligible: 4,
    marketingEnabled: 5,
    activelySuppressed: 1,
    emailUnconfirmed: 2,
    inactiveAccounts: 0,
    customersWithOrders: 6,
    customersWithoutOrders: 4,
  },
  audiences: {
    oneTimeBuyers: { key: 'one_time_buyers', matchedCount: 3, eligibleCount: 2 },
    customersWithCredit: {
      key: 'customers_with_credit',
      matchedCount: 2,
      eligibleCount: 1,
      totalAvailableCreditPence: 900,
      eligibleAvailableCreditPence: 400,
    },
  },
}

beforeEach(() => {
  authorizeAdminApi.mockReset()
  rpc.mockReset()
  rpc.mockResolvedValue({ data: OVERVIEW, error: null })
})

describe('GET /api/admin/marketing/audiences — authorization', () => {
  it('rejects an unauthenticated request with 401 and never calls the RPC', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a non-admin role with 401 and never calls the RPC', async () => {
    // authorizeAdminApi is invoked with roles: ['admin'], so operations_admin
    // comes back as an error — the route must not reach the service client.
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'operations_admin', error: 'Not authorized' })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requests admin-only authorization', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
    await GET()
    expect(authorizeAdminApi).toHaveBeenCalledTimes(1)
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin'] })
  })
})

describe('GET /api/admin/marketing/audiences — admin success path', () => {
  beforeEach(() => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
  })

  it('returns the overview and calls the audience RPC exactly once', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.health.totalProfiles).toBe(10)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('get_admin_marketing_audience_overview')
    // No per-audience arguments — it is one aggregate RPC.
    expect(rpc.mock.calls[0][1]).toBeUndefined()
  })

  it('maps any RPC error to a stable public code (never the raw SQL message)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "secret" does not exist' } })
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'query_failed' })
    expect(JSON.stringify(body)).not.toContain('relation')
  })

  it('fails closed with query_failed if the payload ever contains an identity field', async () => {
    rpc.mockResolvedValueOnce({
      data: { ...OVERVIEW, audiences: { leak: { email: 'person@example.com', matchedCount: 1 } } },
      error: null,
    })
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'query_failed' })
    expect(JSON.stringify(body)).not.toContain('person@example.com')
  })

  it('never leaks email addresses, user ids or customer arrays on the success path', async () => {
    const res = await GET()
    const body = await res.json()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/"email"|"user_id"|"userId"|"userIds"|"full_name"/)
    // Aggregate only: no array of customer rows anywhere in the payload.
    for (const audience of Object.values(body.data.audiences as Record<string, unknown>)) {
      expect(Array.isArray(audience)).toBe(false)
    }
  })
})
