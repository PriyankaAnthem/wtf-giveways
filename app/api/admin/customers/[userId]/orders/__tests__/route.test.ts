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

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}
function ctx(userId = USER_ID) {
  return { params: Promise.resolve({ userId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'operations_admin', error: null })
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('GET /api/admin/customers/[userId]/orders', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects forbidden role with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authorized' })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a malformed userId with 400', async () => {
    const res = await GET(req('http://x/api/admin/customers/bad/orders'), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls admin_get_customer_orders with defaults (limit+1, offset 0)', async () => {
    await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, params] = rpc.mock.calls[0]
    expect(name).toBe('admin_get_customer_orders')
    expect(params).toMatchObject({ p_user_id: USER_ID, p_limit: 25, p_offset: 0 })
  })

  it('rejects a negative offset with 400', async () => {
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders?offset=-5`), ctx())
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('clamps limit to the maximum', async () => {
    await GET(req(`http://x/api/admin/customers/${USER_ID}/orders?limit=9999`), ctx())
    expect(rpc.mock.calls[0][1].p_limit).toBe(100)
  })

  it('derives cash_paid_pence when external_payment_pence is null', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          checkout_intent_id: 'ci-1',
          checkout_ref: 'ref-1',
          total_pence: 1000,
          wallet_credit_pence: 400,
          external_payment_pence: null,
          qty: 2,
          campaign_title: 'Big Draw',
        },
      ],
      error: null,
    })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    const json = await res.json()
    expect(json.orders[0].cash_paid_pence).toBe(600) // 1000 - 400
    expect(json.orders[0].wallet_credit_pence).toBe(400)
  })

  it('prefers external_payment_pence when present', async () => {
    rpc.mockResolvedValue({
      data: [{ total_pence: 1000, wallet_credit_pence: 400, external_payment_pence: 550 }],
      error: null,
    })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    const json = await res.json()
    expect(json.orders[0].cash_paid_pence).toBe(550)
  })

  it('never exposes raw provider payloads / card data', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          checkout_intent_id: 'ci-1',
          total_pence: 500,
          provider: 'acquired',
          // hostile extra fields that must be dropped by the whitelist
          card_number: '4111111111111111',
          provider_payload: { secret: 'x' },
        },
      ],
      error: null,
    })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    const json = await res.json()
    const order = json.orders[0]
    expect(order).not.toHaveProperty('card_number')
    expect(order).not.toHaveProperty('provider_payload')
    expect(order.provider).toBe('acquired')
  })

  it('derives hasNext from the extra row and trims the page', async () => {
    const rows = Array.from({ length: 3 }).map((_, i) => ({
      checkout_intent_id: `ci-${i}`,
      total_pence: 100,
    }))
    rpc.mockResolvedValue({ data: rows, error: null })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders?limit=2`), ctx())
    const json = await res.json()
    expect(rpc.mock.calls[0][1].p_limit).toBe(2)
    expect(json.orders).toHaveLength(2)
    expect(json.hasNext).toBe(true)
  })

  it('maps an RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    expect(res.status).toBe(500)
  })

  it('sends no-store cache headers', async () => {
    const res = await GET(req(`http://x/api/admin/customers/${USER_ID}/orders`), ctx())
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })
})
