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

function req(qs = '') {
  return new Request(`http://x/api/admin/customers/recent-winners${qs}`) as unknown as Parameters<typeof GET>[0]
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    win_kind: 'instant',
    record_id: '99999999-9999-4999-8999-999999999999',
    occurred_at: '2026-08-08T18:04:00Z',
    user_id: UID,
    first_name: 'Michelle',
    last_name: 'Hurley',
    display_name: null,
    real_name: null,
    email: 'michelle@x.io',
    mobile: '07000000000',
    campaign_id: 'camp-1',
    campaign_title: 'DG DECORS 10K BLAST!',
    prize_title: '£250 CASH',
    prize_value_pence: 25000,
    fulfilment_type: 'cash',
    winning_ticket: 16000,
    is_paid: false,
    fulfilled_at: null,
    placed: null,
    // A field that must NOT be exposed by the response.
    checkout_intent_id: 'ci-secret',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin', error: null })
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('GET /api/admin/customers/recent-winners', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a non-allowed role (read_only) with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'read_only', error: 'Not authorized' })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('allows admin and operations_admin (allow-list passed to guard)', async () => {
    await GET(req())
    expect(authorizeAdminApi).toHaveBeenCalledWith(expect.anything(), {
      roles: ['admin', 'operations_admin'],
    })
  })

  it('calls admin_list_recent_winners exactly once with offset paging defaults', async () => {
    await GET(req())
    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('admin_list_recent_winners')
    expect(args).toMatchObject({ p_limit: 25, p_offset: 0 })
  })

  it('does not call any other RPC', async () => {
    await GET(req())
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['admin_list_recent_winners'])
  })

  it('passes explicit limit + offset through to the RPC', async () => {
    await GET(req('?limit=50&offset=100'))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_limit: 50, p_offset: 100 })
  })

  it('clamps an oversized limit to 100 and rejects a negative offset', async () => {
    await GET(req('?limit=9999'))
    expect(rpc.mock.calls[0][1].p_limit).toBe(100)
    expect((await GET(req('?offset=-1'))).status).toBe(400)
  })

  it('derives hasNext from the extra (limit + 1) row and trims it off', async () => {
    rpc.mockResolvedValue({ data: [makeRow(), makeRow(), makeRow()], error: null })
    const res = await GET(req('?limit=2'))
    const json = await res.json()
    expect(json.hasNext).toBe(true)
    expect(json.winners).toHaveLength(2)
  })

  it('exposes only operational fields and never the checkout intent id', async () => {
    rpc.mockResolvedValue({ data: [makeRow()], error: null })
    const res = await GET(req())
    const json = await res.json()
    const w = json.winners[0]
    expect(w).toMatchObject({
      user_id: UID,
      campaign_title: 'DG DECORS 10K BLAST!',
      prize_title: '£250 CASH',
      winning_ticket: 16000,
    })
    expect(w).not.toHaveProperty('checkout_intent_id')
  })

  it('preserves the raw status fields (credited-not-unpaid case) for the client resolver', async () => {
    rpc.mockResolvedValue({
      data: [makeRow({ fulfilment_type: 'wallet_credit', is_paid: false, fulfilled_at: '2026-08-08T18:12:00Z' })],
      error: null,
    })
    const res = await GET(req())
    const json = await res.json()
    expect(json.winners[0]).toMatchObject({
      fulfilment_type: 'wallet_credit',
      is_paid: false,
      fulfilled_at: '2026-08-08T18:12:00Z',
    })
  })

  it('preserves a null prize value for a main-draw win (never fabricated)', async () => {
    rpc.mockResolvedValue({
      data: [makeRow({ win_kind: 'main_draw', fulfilment_type: null, prize_value_pence: null, prize_title: '£500 END PRIZE' })],
      error: null,
    })
    const res = await GET(req())
    const json = await res.json()
    expect(json.winners[0].prize_value_pence).toBeNull()
    expect(json.winners[0].prize_title).toBe('£500 END PRIZE')
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
