import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route transitively imports `server-only` via the auth chain.
vi.mock('server-only', () => ({}))

// --- Mock admin authorization ------------------------------------------------
const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

// User-scoped client (only used for the auth check).
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role client stub exposing `.rpc`.
const rpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: (...a: unknown[]) => rpc(...a) })),
}))

import { GET } from '../route'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'operations_admin', error: null })
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('GET /api/admin/customers', () => {
  it('rejects an unauthenticated caller with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req('http://x/api/admin/customers'))
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a forbidden role with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authorized' })
    const res = await GET(req('http://x/api/admin/customers'))
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls admin_list_customers_v3 with normalized defaults', async () => {
    await GET(req('http://x/api/admin/customers'))
    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, params] = rpc.mock.calls[0]
    expect(name).toBe('admin_list_customers_v3')
    expect(params).toMatchObject({
      p_search: null,
      p_status: 'all',
      p_after_created_at: null,
      p_after_user_id: null,
    })
    // Route forwards the page size directly; the RPC contract returns limit + 1.
    expect(params.p_limit).toBe(50)
  })

  it('passes through a valid status filter', async () => {
    await GET(req('http://x/api/admin/customers?status=self_excluded'))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_status: 'self_excluded' })
  })

  it('rejects an invalid status with 400 and does not query', async () => {
    const res = await GET(req('http://x/api/admin/customers?status=bogus'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('clamps an oversized limit to the maximum (100)', async () => {
    await GET(req('http://x/api/admin/customers?limit=9999'))
    expect(rpc.mock.calls[0][1].p_limit).toBe(100)
  })

  it('rejects an invalid (non-integer) limit with 400', async () => {
    const res = await GET(req('http://x/api/admin/customers?limit=abc'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('treats a too-short search term as no filter (p_search null)', async () => {
    await GET(req('http://x/api/admin/customers?search=ab'))
    expect(rpc.mock.calls[0][1].p_search).toBeNull()
  })

  it('trims and forwards a valid search term', async () => {
    await GET(req('http://x/api/admin/customers?search=%20john%20'))
    expect(rpc.mock.calls[0][1].p_search).toBe('john')
  })

  it('rejects a control-character search with 400', async () => {
    const res = await GET(req('http://x/api/admin/customers?search=jo%00hn'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires BOTH cursor parts together (rejects a partial cursor)', async () => {
    const res = await GET(req('http://x/api/admin/customers?afterCreatedAt=2024-01-01T00:00:00Z'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('forwards a complete keyset cursor', async () => {
    const uid = '11111111-1111-1111-1111-111111111111'
    await GET(req(`http://x/api/admin/customers?afterCreatedAt=2024-01-01T00:00:00Z&afterUserId=${uid}`))
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_after_created_at: '2024-01-01T00:00:00Z',
      p_after_user_id: uid,
    })
  })

  it('rejects a malformed cursor user id with 400', async () => {
    const res = await GET(
      req('http://x/api/admin/customers?afterCreatedAt=2024-01-01T00:00:00Z&afterUserId=not-a-uuid'),
    )
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns rows and reports hasNext=false when fewer than limit+1 returned', async () => {
    const rows = Array.from({ length: 3 }).map((_, i) => ({
      user_id: `1111111${i}-1111-1111-1111-111111111111`,
      real_name: `Cust ${i}`,
      email: `c${i}@x.io`,
      mobile: null,
      is_self_excluded: false,
      account_created_at: '2024-01-01T00:00:00Z',
      confirmed_order_count: i,
      lifetime_external_pence: i * 100,
      last_confirmed_at: null,
      wallet_available_pence: 0,
    }))
    rpc.mockResolvedValue({ data: rows, error: null })
    const res = await GET(req('http://x/api/admin/customers?limit=50'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.customers).toHaveLength(3)
    expect(json.hasNext).toBe(false)
    expect(json.nextCursor).toBeNull()
  })

  it('detects another page (limit+1) and returns a trimmed page + nextCursor', async () => {
    const rows = Array.from({ length: 3 }).map((_, i) => ({
      user_id: `1111111${i}-1111-1111-1111-111111111111`,
      real_name: `Cust ${i}`,
      email: `c${i}@x.io`,
      mobile: null,
      is_self_excluded: false,
      account_created_at: `2024-01-0${i + 1}T00:00:00Z`,
      confirmed_order_count: 0,
      lifetime_external_pence: 0,
      last_confirmed_at: null,
      wallet_available_pence: 0,
    }))
    rpc.mockResolvedValue({ data: rows, error: null })
    // Page size 2 forwarded to the RPC; RPC returns 3 (limit+1) => hasNext.
    const res = await GET(req('http://x/api/admin/customers?limit=2'))
    const json = await res.json()
    expect(rpc.mock.calls[0][1].p_limit).toBe(2)
    expect(json.customers).toHaveLength(2)
    expect(json.hasNext).toBe(true)
    expect(json.nextCursor).toEqual({
      createdAt: '2024-01-02T00:00:00Z',
      userId: '11111111-1111-1111-1111-111111111111',
    })
  })

  it('drops rows with an invalid (non-UUID) user_id', async () => {
    rpc.mockResolvedValue({
      data: [
        { user_id: 'garbage', real_name: 'X', account_created_at: '2024-01-01T00:00:00Z' },
        {
          user_id: '11111111-1111-1111-1111-111111111111',
          real_name: 'Valid',
          account_created_at: '2024-01-01T00:00:00Z',
        },
      ],
      error: null,
    })
    const res = await GET(req('http://x/api/admin/customers'))
    const json = await res.json()
    expect(json.customers).toHaveLength(1)
    expect(json.customers[0].user_id).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('passes through V3 name fields (first/last/display/real) on each row', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          user_id: '11111111-1111-1111-1111-111111111111',
          first_name: 'Ada',
          last_name: 'Lovelace',
          display_name: 'ada_l',
          real_name: 'adalove88',
          email: 'ada@x.io',
          mobile: '07786144708',
          is_self_excluded: false,
          account_created_at: '2024-01-01T00:00:00Z',
          confirmed_order_count: 2,
          lifetime_external_pence: 500,
          last_confirmed_at: null,
          wallet_available_pence: 0,
        },
      ],
      error: null,
    })
    const res = await GET(req('http://x/api/admin/customers'))
    const json = await res.json()
    expect(json.customers[0]).toMatchObject({
      first_name: 'Ada',
      last_name: 'Lovelace',
      display_name: 'ada_l',
      real_name: 'adalove88',
    })
  })

  it('passes through V3 winnings fields with cash and site credit kept separate', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          user_id: '11111111-1111-1111-1111-111111111111',
          real_name: 'Winner',
          account_created_at: '2024-01-01T00:00:00Z',
          confirmed_order_count: 4,
          lifetime_external_pence: 3198,
          wallet_available_pence: 0,
          // Winnings aggregates — bigints may arrive as numeric strings.
          instant_win_count: '2',
          main_draw_win_count: 1,
          total_win_count: 3,
          cash_win_count: 1,
          site_credit_win_count: 1,
          cash_won_pence: 10000,
          site_credit_won_pence: 500,
        },
      ],
      error: null,
    })
    const res = await GET(req('http://x/api/admin/customers'))
    const json = await res.json()
    expect(json.customers[0]).toMatchObject({
      instant_win_count: 2,
      main_draw_win_count: 1,
      total_win_count: 3,
      cash_win_count: 1,
      site_credit_win_count: 1,
      // Kept as distinct fields — never summed into one "total won".
      cash_won_pence: 10000,
      site_credit_won_pence: 500,
    })
  })

  it('defaults winnings fields to zero when the RPC omits them', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          user_id: '11111111-1111-1111-1111-111111111111',
          real_name: 'No Wins',
          account_created_at: '2024-01-01T00:00:00Z',
        },
      ],
      error: null,
    })
    const res = await GET(req('http://x/api/admin/customers'))
    const json = await res.json()
    expect(json.customers[0]).toMatchObject({
      total_win_count: 0,
      cash_won_pence: 0,
      site_credit_won_pence: 0,
      main_draw_win_count: 0,
    })
  })

  it('maps an RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET(req('http://x/api/admin/customers'))
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('sends no-store cache headers', async () => {
    const res = await GET(req('http://x/api/admin/customers'))
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })
})
