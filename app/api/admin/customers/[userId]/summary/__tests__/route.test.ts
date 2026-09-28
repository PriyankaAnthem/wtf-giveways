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
  return new Request(`http://x/api/admin/customers/${USER_ID}/summary`) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'operations_admin', error: null })
  rpc.mockResolvedValue({ data: null, error: null })
})

describe('GET /api/admin/customers/[userId]/summary', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a malformed userId with 400', async () => {
    const res = await GET(req(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls admin_get_customer_purchase_summary once with the user id', async () => {
    await GET(req(), ctx())
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('admin_get_customer_purchase_summary')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: USER_ID })
  })

  it('normalises a one-element array result and keeps money fields distinct', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          confirmed_order_count: '4',
          total_order_value_pence: '5000',
          lifetime_external_pence: '3000',
          total_wallet_credit_pence: '2000',
          total_tickets_purchased: '12',
          first_confirmed_at: '2024-01-01T00:00:00Z',
          last_confirmed_at: '2024-06-01T00:00:00Z',
        },
      ],
      error: null,
    })
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.summary).toEqual({
      confirmed_order_count: 4,
      total_order_value_pence: 5000,
      lifetime_external_pence: 3000,
      total_wallet_credit_pence: 2000,
      total_tickets_purchased: 12,
      first_confirmed_at: '2024-01-01T00:00:00Z',
      last_confirmed_at: '2024-06-01T00:00:00Z',
    })
  })

  it('degrades gracefully to zeros for a customer with no orders', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.summary).toMatchObject({
      confirmed_order_count: 0,
      total_order_value_pence: 0,
      total_tickets_purchased: 0,
      first_confirmed_at: null,
    })
  })

  it('maps an RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(500)
  })
})
