import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The route transitively imports `server-only` (via the auth + query-lib
// chain). Neutralise it so the module imports in vitest's node environment.
vi.mock('server-only', () => ({}))

// Auth is mocked so we can drive role/error without a database. The route calls
// authorizeAdminApi({ roles: ['admin', 'operations_admin'] }); a rejected role
// must never reach the service-role client / RPC.
const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

// The user-scoped server client is only used to pass into authorizeAdminApi.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role client factory — its rpc is the affiliate-performance RPC.
// Mocking it (not the query lib) lets the REAL query lib + validation run.
const rpc = vi.fn()
vi.mock('@/lib/admin/live-board', () => ({
  getServiceSupabase: () => ({ rpc }),
}))

import { GET } from '../route'

const AFFILIATE = '11111111-1111-4111-8111-111111111111'

const PAYLOAD = {
  period: { start: '2026-08-01T00:00:00Z', end: '2026-08-29T00:00:00Z', timezone: 'Europe/London' },
  mode: 'leaderboard',
  summary: { affiliates: 1, orders: 5, netRevenuePence: 1000 },
  byAffiliate: [],
  affiliate: null,
  generatedAt: '2026-08-29T10:00:00Z',
}

function req(qs = '') {
  return new NextRequest(`http://x/api/admin/marketing/affiliate-performance${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ data: PAYLOAD, error: null })
})

describe('GET /api/admin/marketing/affiliate-performance — authorization', () => {
  it('rejects an unauthenticated request with 401 and never calls the RPC', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req('?range=today'))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an ops / read_only role with 401 and never calls the RPC', async () => {
    // authorizeAdminApi is invoked with roles ['admin','operations_admin']; a
    // read-only ops role comes back as an error and must not reach the RPC.
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'ops', error: 'Not authorized' })
    const res = await GET(req('?range=today'))
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('authorizes both admin and operations_admin', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'a1' }, role: 'admin', error: null })
    const admin = await GET(req('?range=today'))
    expect(admin.status).toBe(200)

    authorizeAdminApi.mockResolvedValue({ user: { id: 'o1' }, role: 'operations_admin', error: null })
    const ops = await GET(req('?range=today'))
    expect(ops.status).toBe(200)

    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin', 'operations_admin'] })
  })
})

describe('GET /api/admin/marketing/affiliate-performance — success + validation', () => {
  beforeEach(() => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'a1' }, role: 'admin', error: null })
  })

  it('leaderboard mode: passes p_affiliate = null', async () => {
    const res = await GET(req('?range=last_7_days'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('get_affiliate_performance')
    expect(rpc.mock.calls[0][1]).toEqual({ p_range: 'last_7_days', p_from: null, p_to: null, p_affiliate: null })
  })

  it('detail mode: passes the validated affiliate uuid as p_affiliate', async () => {
    const res = await GET(req(`?range=today&affiliate=${AFFILIATE}`))
    expect(res.status).toBe(200)
    expect(rpc.mock.calls[0][1]).toEqual({ p_range: 'today', p_from: null, p_to: null, p_affiliate: AFFILIATE })
  })

  it('rejects a malformed affiliate uuid with 400 and never calls the RPC', async () => {
    const res = await GET(req('?range=today&affiliate=not-a-uuid'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('invalid affiliate id')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a custom range missing dates with 400', async () => {
    const res = await GET(req('?range=custom'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a custom range wider than 366 days with 400', async () => {
    const res = await GET(req('?range=custom&from=2024-01-01&to=2026-01-01'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts a valid custom range and forwards both bounds', async () => {
    const res = await GET(req('?range=custom&from=2026-08-01&to=2026-08-29'))
    expect(res.status).toBe(200)
    expect(rpc.mock.calls[0][1]).toEqual({
      p_range: 'custom',
      p_from: '2026-08-01',
      p_to: '2026-08-29',
      p_affiliate: null,
    })
  })

  it('maps any RPC error to a stable public code (never the raw SQL message)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "secret" does not exist' } })
    const res = await GET(req('?range=today'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'query_failed' })
    expect(JSON.stringify(body)).not.toContain('relation')
  })

  it('returns 500 when the RPC yields no data', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    const res = await GET(req('?range=today'))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'no_data' })
  })

  it('sets Cache-Control: no-store', async () => {
    const res = await GET(req('?range=today'))
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('never leaks identity fields on the success path', async () => {
    const res = await GET(req('?range=today'))
    const serialized = JSON.stringify(await res.json())
    expect(serialized).not.toMatch(/"email"|"user_id"|"full_name"|"mobile"/)
  })
})
