import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role client stub: chainable table reads + auth admin.
const maybeSingle = vi.fn()
const getUserById = vi.fn()
function makeTableChain() {
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = maybeSingle
  return chain
}
const from = vi.fn(() => makeTableChain())
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (_table: string) => from(),
    auth: { admin: { getUserById: (id: string) => getUserById(id) } },
  })),
}))

const isUserPurchaseRestricted = vi.fn()
vi.mock('@/lib/account-restrictions', () => ({
  isUserPurchaseRestricted: (...a: unknown[]) => isUserPurchaseRestricted(...a),
}))

import { GET } from '../route'

const USER_ID = '11111111-1111-4111-8111-111111111111'
function ctx(userId = USER_ID) {
  return { params: Promise.resolve({ userId }) }
}
function req() {
  return new Request(`http://x/api/admin/customers/${USER_ID}`) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin', error: null })
  // profiles_private then wallet_accounts both use maybeSingle.
  maybeSingle
    .mockResolvedValueOnce({ data: { user_id: USER_ID, real_name: 'Jane Doe', mobile: '07123' }, error: null })
    .mockResolvedValueOnce({ data: { balance_pence: 1000, reserved_pence: 300 }, error: null })
  getUserById.mockResolvedValue({
    data: {
      user: {
        email: 'jane@x.io',
        created_at: '2024-01-01T00:00:00Z',
        user_metadata: { first_name: 'Jane', last_name: 'Doe', display_name: 'jd' },
      },
    },
  })
  isUserPurchaseRestricted.mockResolvedValue(false)
})

describe('GET /api/admin/customers/[userId]', () => {
  it('rejects unauthenticated with 401', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(401)
  })

  it('rejects forbidden role with 403', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authorized' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(403)
  })

  it('rejects a malformed userId with 400', async () => {
    const res = await GET(req(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('returns identity name parts, wallet available (balance - reserved) and restriction', async () => {
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.customer).toMatchObject({
      user_id: USER_ID,
      first_name: 'Jane',
      last_name: 'Doe',
      display_name: 'jd',
      real_name: 'Jane Doe',
      email: 'jane@x.io',
      mobile: '07123',
      joined: '2024-01-01T00:00:00Z',
    })
    expect(json.balances).toMatchObject({ balance_pence: 1000, reserved_pence: 300, available_pence: 700 })
    expect(json.restricted).toBe(false)
  })

  it('reflects a restricted customer via the fail-closed helper', async () => {
    isUserPurchaseRestricted.mockResolvedValue(true)
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(json.restricted).toBe(true)
  })

  it('sends no-store cache headers', async () => {
    const res = await GET(req(), ctx())
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })
})
