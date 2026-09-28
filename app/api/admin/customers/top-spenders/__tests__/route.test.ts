import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

const rpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: (...a: unknown[]) => rpc(...a) })),
}))

import { GET } from '../route'

const UID = '11111111-1111-4111-8111-111111111111'
const UID2 = '22222222-2222-4222-8222-222222222222'

function req(qs = '') {
  return new Request(`http://x/api/admin/customers/top-spenders${qs}`) as unknown as Parameters<typeof GET>[0]
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: UID,
    first_name: 'Taiba',
    last_name: 'Bagem',
    display_name: null,
    real_name: null,
    email: 'taiba@x.io',
    mobile: '07472498269',
    is_self_excluded: false,
    confirmed_order_count: 194,
    lifetime_external_pence: 384260,
    last_confirmed_at: '2026-08-08T00:00:00Z',
    wallet_available_pence: 500,
    instant_win_count: 16,
    main_draw_win_count: 1,
    cash_won_pence: 25000,
    site_credit_won_pence: 2000,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'operations_admin', error: null })
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('GET /api/admin/customers/top-spenders', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a non-allowed role (ops) with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'ops', error: 'Not authorized' })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('authorizes admin and operations_admin (allow-list passed to guard)', async () => {
    await GET(req())
    expect(authorizeAdminApi).toHaveBeenCalledWith(expect.anything(), {
      roles: ['admin', 'operations_admin'],
    })
  })

  it('calls admin_list_top_spenders exactly once with default paging', async () => {
    await GET(req())
    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('admin_list_top_spenders')
    expect(args).toMatchObject({ p_limit: 25, p_after_spend_pence: null, p_after_user_id: null })
  })

  it('does not call any other RPC', async () => {
    await GET(req())
    const names = rpc.mock.calls.map((c) => c[0])
    expect(names).toEqual(['admin_list_top_spenders'])
  })

  it('clamps an oversized limit to the maximum of 100', async () => {
    await GET(req('?limit=9999'))
    expect(rpc.mock.calls[0][1].p_limit).toBe(100)
  })

  it('rejects a zero/negative limit with 400', async () => {
    expect((await GET(req('?limit=0'))).status).toBe(400)
    expect((await GET(req('?limit=-3'))).status).toBe(400)
  })

  it('rejects a partial cursor (spend without userId) with 400', async () => {
    const res = await GET(req('?afterSpendPence=1000'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('passes a valid keyset cursor through to the RPC', async () => {
    await GET(req(`?afterSpendPence=5000&afterUserId=${UID}`))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_after_spend_pence: 5000, p_after_user_id: UID })
  })

  it('derives hasNext from the extra (limit + 1) row and emits a spend cursor', async () => {
    rpc.mockResolvedValue({
      data: [
        makeRow({ user_id: UID, lifetime_external_pence: 900000 }),
        makeRow({ user_id: UID2, lifetime_external_pence: 384260 }),
        makeRow({ user_id: '33333333-3333-4333-8333-333333333333', lifetime_external_pence: 100 }),
      ],
      error: null,
    })
    const res = await GET(req('?limit=2'))
    const json = await res.json()
    expect(json.hasNext).toBe(true)
    expect(json.customers).toHaveLength(2)
    // Cursor comes from the LAST displayed row.
    expect(json.nextCursor).toEqual({ afterSpendPence: 384260, afterUserId: UID2 })
  })

  it('keeps self-excluded spenders in the ranking (never filtered out)', async () => {
    rpc.mockResolvedValue({ data: [makeRow({ is_self_excluded: true })], error: null })
    const res = await GET(req())
    const json = await res.json()
    expect(json.customers).toHaveLength(1)
    expect(json.customers[0].is_self_excluded).toBe(true)
  })

  it('sets Cache-Control: private, no-store', async () => {
    const res = await GET(req())
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('maps an RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await GET(req())).status).toBe(500)
  })
})
