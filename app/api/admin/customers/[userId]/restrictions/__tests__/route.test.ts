import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Configurable per-table results for the service-role client stub.
let tableResults: Record<string, { data: unknown; error: unknown }>
const getUserById = vi.fn()

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.is = () => builder
  builder.in = () => builder
  builder.order = () => builder
  builder.range = () => builder
  builder.maybeSingle = () => Promise.resolve(result)
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => makeBuilder(tableResults[table] ?? { data: [], error: null }),
    auth: { admin: { getUserById: (id: string) => getUserById(id) } },
  })),
}))

import { GET } from '../route'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ADMIN_ID = '22222222-2222-4222-8222-222222222222'

function ctx(userId = USER_ID) {
  return { params: Promise.resolve({ userId }) }
}
function req() {
  return new Request(`http://x/api/admin/customers/${USER_ID}/restrictions`) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: ADMIN_ID }, role: 'admin', error: null })
  getUserById.mockResolvedValue({ data: { user: null } })
  tableResults = {
    account_restrictions: {
      data: [
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          user_id: USER_ID,
          restriction_type: 'self_exclusion',
          source: 'admin',
          reason: 'Requested closure',
          created_at: '2026-09-16T10:00:00Z',
          created_by: ADMIN_ID,
          revoked_at: null,
          revoked_by: null,
          revocation_reason: null,
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
          user_id: USER_ID,
          restriction_type: 'self_exclusion',
          source: 'admin',
          reason: 'Older exclusion',
          created_at: '2026-01-01T10:00:00Z',
          created_by: ADMIN_ID,
          revoked_at: '2026-02-01T10:00:00Z',
          revoked_by: ADMIN_ID,
          revocation_reason: 'Resolved',
        },
      ],
      error: null,
    },
    profiles_private: { data: [], error: null },
  }
})

describe('GET restriction history — authorization', () => {
  it('rejects unauthenticated with 401', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(401)
  })

  it('rejects a forbidden role with 403', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authorized' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(403)
  })

  it('allows admin AND operations_admin (roles: ["admin","operations_admin"])', async () => {
    await GET(req(), ctx())
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin', 'operations_admin'] })
  })

  it('operations_admin can view history (200)', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'ops-1' }, role: 'operations_admin', error: null })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
  })
})

describe('GET restriction history — shaping', () => {
  it('rejects a malformed userId with 400', async () => {
    const res = await GET(req(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('returns records newest-first with active derived from revoked_at', async () => {
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.restrictions).toHaveLength(2)
    expect(json.restrictions[0].active).toBe(true) // revoked_at null
    expect(json.restrictions[1].active).toBe(false) // revoked_at present
    expect(json.restrictions[1].revocation_reason).toBe('Resolved')
  })

  it('sends no-store cache headers', async () => {
    const res = await GET(req(), ctx())
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })
})
