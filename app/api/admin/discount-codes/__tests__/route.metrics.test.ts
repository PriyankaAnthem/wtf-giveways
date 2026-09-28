import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Per-table result registry the fake service client reads from.
let discountCodesResult: { data: unknown; error: unknown }
let campaignsResult: { data: unknown; error: unknown }
const rpc = vi.fn()

/**
 * Minimal chainable, thenable Supabase query builder. select/order/in/eq/
 * maybeSingle/single all return the same builder; awaiting it resolves to the
 * per-table result. Good enough for this route's read paths.
 */
function makeBuilder(result: () => { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.in = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.maybeSingle = vi.fn(chain)
  builder.single = vi.fn(chain)
  builder.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => resolve(result())
  return builder
}

const from = vi.fn((table: string) => {
  if (table === 'discount_codes') return makeBuilder(() => discountCodesResult)
  if (table === 'campaigns') return makeBuilder(() => campaignsResult)
  return makeBuilder(() => ({ data: [], error: null }))
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (...a: unknown[]) => from(...(a as [string])),
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}))

import { GET } from '../route'

const ID_WED50 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_FIND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID_UNUSED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function codeRow(id: string, code: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code,
    description: null,
    discount_type: 'percentage',
    discount_value: 50,
    scope: 'site_wide',
    campaign_id: null,
    is_active: true,
    starts_at: null,
    expires_at: '2020-01-01T00:00:00Z', // expired — metrics must still show
    created_at: '2026-01-01T00:00:00Z',
    created_by: null,
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin', error: null })
  discountCodesResult = {
    data: [
      codeRow(ID_WED50, 'WED50'),
      codeRow(ID_FIND, 'FIND5K25'),
      codeRow(ID_UNUSED, 'NEVERUSED', { is_active: false }), // disabled — metrics must still show
    ],
    error: null,
  }
  campaignsResult = { data: [], error: null }
  // RPC omits codes with no confirmed usage (NEVERUSED absent by design).
  rpc.mockResolvedValue({
    data: [
      { discount_code_id: ID_WED50, uses: 634, net_revenue_pence: 250106 },
      { discount_code_id: ID_FIND, uses: 26, net_revenue_pence: 32902 },
    ],
    error: null,
  })
})

function findItem(items: Array<Record<string, unknown>>, code: string) {
  return items.find((i) => i.code === code) as Record<string, unknown>
}

describe('GET /api/admin/discount-codes — performance metrics', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects read_only with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'read_only', error: 'Not authorized' })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls the performance RPC exactly once, by name, with no arguments', async () => {
    await GET()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('get_discount_code_performance')
    expect(rpc.mock.calls[0][1]).toBeUndefined()
  })

  it('maps WED50 and FIND5K25 metrics onto the right codes', async () => {
    const res = await GET()
    const { items } = await res.json()
    expect(findItem(items, 'WED50')).toMatchObject({ uses: 634, netRevenuePence: 250106 })
    expect(findItem(items, 'FIND5K25')).toMatchObject({ uses: 26, netRevenuePence: 32902 })
  })

  it('defaults a code absent from the RPC result to 0 uses / 0 pence', async () => {
    const res = await GET()
    const { items } = await res.json()
    expect(findItem(items, 'NEVERUSED')).toMatchObject({ uses: 0, netRevenuePence: 0 })
  })

  it('retains metrics for expired AND disabled codes (status is display-only)', async () => {
    const res = await GET()
    const { items } = await res.json()
    // WED50 is expired (expires_at in the past) but still carries its metrics.
    expect(findItem(items, 'WED50').uses).toBe(634)
    // NEVERUSED is disabled; it is still present with zeroed metrics.
    expect(findItem(items, 'NEVERUSED')).toBeTruthy()
  })

  it('surfaces an RPC failure as a 500 error instead of silent zeroes', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe('metrics_failed')
  })

  it('returns 500 (load_failed) if the codes query itself fails, before touching metrics', async () => {
    discountCodesResult = { data: null, error: { message: 'db down' } }
    const res = await GET()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('load_failed')
  })
})
