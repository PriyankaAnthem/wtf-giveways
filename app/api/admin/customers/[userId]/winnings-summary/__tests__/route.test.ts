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

const USER_ID = '11111111-1111-4111-8111-111111111111'
function ctx(userId = USER_ID) {
  return { params: Promise.resolve({ userId }) }
}
function req() {
  return new Request(
    `http://x/api/admin/customers/${USER_ID}/winnings-summary`,
  ) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'operations_admin', error: null })
  rpc.mockResolvedValue({ data: null, error: null })
})

describe('GET /api/admin/customers/[userId]/winnings-summary', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a forbidden role with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Forbidden' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a malformed userId with 400', async () => {
    const res = await GET(req(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls admin_get_customer_winnings_summary once with the user id', async () => {
    await GET(req(), ctx())
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('admin_get_customer_winnings_summary')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: USER_ID })
  })

  it('normalises numeric strings and keeps cash vs site credit distinct', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          instant_win_count: '2',
          main_draw_win_count: '1',
          total_win_count: '3',
          cash_win_count: '1',
          site_credit_win_count: '1',
          manual_win_count: '0',
          cash_won_pence: '10000',
          site_credit_won_pence: '500',
          unpaid_cash_win_count: '1',
          last_win_at: '2026-06-01T00:00:00Z',
        },
      ],
      error: null,
    })
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.summary).toEqual({
      instant_win_count: 2,
      main_draw_win_count: 1,
      total_win_count: 3,
      cash_win_count: 1,
      site_credit_win_count: 1,
      manual_win_count: 0,
      cash_won_pence: 10000,
      site_credit_won_pence: 500,
      unpaid_cash_win_count: 1,
      last_win_at: '2026-06-01T00:00:00Z',
    })
    // Never a combined total-won figure.
    expect(json.summary).not.toHaveProperty('total_won_pence')
  })

  it('degrades gracefully to zeros for a customer with no wins', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.summary).toMatchObject({
      total_win_count: 0,
      cash_won_pence: 0,
      site_credit_won_pence: 0,
      unpaid_cash_win_count: 0,
      last_win_at: null,
    })
  })

  it('maps an RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(500)
  })
})
