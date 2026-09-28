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
function req(qs = '') {
  return new Request(
    `http://x/api/admin/customers/${USER_ID}/winnings${qs}`,
  ) as unknown as Parameters<typeof GET>[0]
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    win_kind: 'instant',
    record_id: 'rec-1',
    occurred_at: '2026-06-01T00:00:00Z',
    campaign_id: 'camp-1',
    campaign_title: 'Summer Draw',
    prize_title: '£100 cash',
    prize_value_pence: 10000,
    fulfilment_type: 'cash',
    winning_ticket: 17996,
    is_paid: true,
    paid_at: '2026-06-02T00:00:00Z',
    fulfilled_at: null,
    payout_amount_pence: 10000,
    checkout_intent_id: 'ci-1',
    placed: 3,
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

describe('GET /api/admin/customers/[userId]/winnings', () => {
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

  it('calls admin_get_customer_winnings once with default paging', async () => {
    await GET(req(), ctx())
    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('admin_get_customer_winnings')
    expect(args).toMatchObject({ p_user_id: USER_ID, p_limit: 25, p_offset: 0 })
  })

  it('rejects a negative offset and a zero limit with 400', async () => {
    expect((await GET(req('?offset=-1'), ctx())).status).toBe(400)
    expect((await GET(req('?limit=0'), ctx())).status).toBe(400)
  })

  it('clamps an oversized limit to the maximum of 100', async () => {
    await GET(req('?limit=9999'), ctx())
    expect(rpc.mock.calls[0][1].p_limit).toBe(100)
  })

  it('derives hasNext from the extra (limit + 1) row and trims it off', async () => {
    // Ask for 2; RPC returns 3 => hasNext true, only 2 returned.
    rpc.mockResolvedValue({ data: [makeRow(), makeRow(), makeRow()], error: null })
    const res = await GET(req('?limit=2'), ctx())
    const json = await res.json()
    expect(json.hasNext).toBe(true)
    expect(json.winnings).toHaveLength(2)
  })

  it('reports hasNext false when fewer than limit + 1 rows return', async () => {
    rpc.mockResolvedValue({ data: [makeRow()], error: null })
    const res = await GET(req('?limit=25'), ctx())
    const json = await res.json()
    expect(json.hasNext).toBe(false)
    expect(json.winnings).toHaveLength(1)
  })

  it('preserves a null prize value for a draw win and never fabricates a number', async () => {
    rpc.mockResolvedValue({
      data: [makeRow({ win_kind: 'main_draw', fulfilment_type: null, prize_value_pence: null, prize_title: '£500 END PRIZE' })],
      error: null,
    })
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.winnings[0].prize_value_pence).toBeNull()
    expect(json.winnings[0].prize_title).toBe('£500 END PRIZE')
  })

  it('surfaces the raw status fields for the client resolver (credited-not-unpaid case)', async () => {
    rpc.mockResolvedValue({
      data: [makeRow({ fulfilment_type: 'wallet_credit', is_paid: false, fulfilled_at: '2026-06-02T00:00:00Z' })],
      error: null,
    })
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.winnings[0]).toMatchObject({
      fulfilment_type: 'wallet_credit',
      is_paid: false,
      fulfilled_at: '2026-06-02T00:00:00Z',
    })
  })

  it('returns 500 when the RPC yields a non-array payload', async () => {
    rpc.mockResolvedValue({ data: { not: 'an array' }, error: null })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(500)
  })

  it('maps an RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(500)
  })
})
