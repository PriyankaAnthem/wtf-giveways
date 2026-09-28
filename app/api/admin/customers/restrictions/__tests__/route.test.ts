import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

let tableResults: Record<string, { data: unknown; error: unknown }>
const getUserById = vi.fn()

function makeBuilder(result: { data: unknown; error: unknown }) {
  const b: any = {}
  b.select = () => b
  b.eq = () => b
  b.is = () => b
  b.in = () => b
  b.order = () => b
  b.range = () => b
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return b
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

function req(query = '') {
  return new Request(`http://x/api/admin/customers/restrictions${query}`) as any
}

function makeRows(n: number) {
  return Array.from({ length: n }).map((_, i) => ({
    id: `aaaaaaaa-0000-4000-8000-00000000000${i}`,
    user_id: USER_ID,
    source: 'admin',
    restriction_type: 'self_exclusion',
    reason: `reason ${i}`,
    created_at: '2026-09-16T10:00:00Z',
    created_by: ADMIN_ID,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: ADMIN_ID }, role: 'admin', error: null })
  getUserById.mockResolvedValue({ data: { user: null } })
  tableResults = {
    account_restrictions: { data: makeRows(3), error: null },
    profiles_private: { data: [], error: null },
  }
})

describe('GET active self-exclusions — authorization', () => {
  it('rejects unauthenticated with 401', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('rejects a forbidden role with 403', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authorized' })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('allows both admin and operations_admin to view', async () => {
    await GET(req())
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin', 'operations_admin'] })

    authorizeAdminApi.mockResolvedValue({ user: { id: 'ops-1' }, role: 'operations_admin', error: null })
    const res = await GET(req())
    expect(res.status).toBe(200)
  })
})

describe('GET active self-exclusions — validation & shaping', () => {
  it('rejects an invalid limit with 400', async () => {
    const res = await GET(req('?limit=0'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_limit' })
  })

  it('rejects an invalid page with 400', async () => {
    const res = await GET(req('?page=-1'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_page' })
  })

  it('returns active rows and hasNext=false when page not full', async () => {
    const res = await GET(req('?limit=20'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.restrictions).toHaveLength(3)
    expect(json.restrictions[0].active).toBe(true)
    expect(json.hasNext).toBe(false)
  })

  it('trims to the page size and reports hasNext when an extra row is returned', async () => {
    tableResults.account_restrictions = { data: makeRows(3), error: null } // limit+1 = 3 for limit 2
    const res = await GET(req('?limit=2'))
    const json = await res.json()
    expect(json.restrictions).toHaveLength(2)
    expect(json.hasNext).toBe(true)
  })

  it('sends no-store cache headers', async () => {
    const res = await GET(req())
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })
})
