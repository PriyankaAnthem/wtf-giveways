import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role stub: from().select().eq().maybeSingle() to load the row, plus rpc().
const maybeSingle = vi.fn()
const rpc = vi.fn()
function makeBuilder() {
  const b: any = {}
  b.select = () => b
  b.eq = () => b
  b.maybeSingle = maybeSingle
  return b
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => makeBuilder(),
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}))

import { POST } from '../route'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '99999999-9999-4999-8999-999999999999'
const RESTRICTION_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADMIN_ID = '22222222-2222-4222-8222-222222222222'

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request(`http://x/api/admin/customers/${USER_ID}/restrictions/${RESTRICTION_ID}/revoke`, {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
  }) as any
}
function ctx(userId = USER_ID, restrictionId = RESTRICTION_ID) {
  return { params: Promise.resolve({ userId, restrictionId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  authorizeAdminApi.mockResolvedValue({ user: { id: ADMIN_ID }, role: 'admin', error: null })
  // Default loaded row: an admin-originated, active restriction for USER_ID.
  maybeSingle.mockResolvedValue({
    data: { id: RESTRICTION_ID, user_id: USER_ID, source: 'admin', revoked_at: null },
    error: null,
  })
  rpc.mockResolvedValue({ data: null, error: null })
})

describe('POST revoke — authorization (admin-only)', () => {
  it('requests SUPER-ADMIN-ONLY authorization (roles: ["admin"])', async () => {
    await POST(req({ reason: 'ok' }), ctx())
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin'] })
  })

  it('rejects unauthenticated with 401 and never calls the RPC', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects operations_admin with 403 and never calls the RPC', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'operations_admin', error: 'Not authorized' })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('POST revoke — validation', () => {
  it('rejects an invalid restrictionId UUID with 400', async () => {
    const res = await POST(req({ reason: 'ok' }), ctx(USER_ID, 'not-a-uuid'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_identifier' })
  })

  it('rejects a blank reason with 400 and no RPC', async () => {
    const res = await POST(req({ reason: '   ' }), ctx())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_reason' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects when the restriction does not belong to the route userId (400)', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: RESTRICTION_ID, user_id: OTHER_USER, source: 'admin', revoked_at: null },
      error: null,
    })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'restriction_mismatch' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('404 when the restriction row is not found', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'restriction_not_found' })
  })
})

describe('POST revoke — source gating (only admin-originated may be revoked)', () => {
  it('cannot revoke a support-originated exclusion (409 not_admin_originated)', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: RESTRICTION_ID, user_id: USER_ID, source: 'support', revoked_at: null },
      error: null,
    })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'not_admin_originated' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('cannot revoke a customer-originated exclusion (409 not_admin_originated)', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: RESTRICTION_ID, user_id: USER_ID, source: 'customer', revoked_at: null },
      error: null,
    })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'not_admin_originated' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('handles an already-revoked restriction cleanly (409 already_revoked)', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: RESTRICTION_ID, user_id: USER_ID, source: 'admin', revoked_at: '2026-02-01T00:00:00Z' },
      error: null,
    })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'already_revoked' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('POST revoke — RPC invocation & actor identity', () => {
  it('admin revokes an admin-originated exclusion; server supplies p_revoked_by (never the browser)', async () => {
    // The body deliberately tries to spoof a different revoker id.
    const res = await POST(req({ reason: '  genuine reason  ', revoked_by: 'spoofed', p_revoked_by: 'spoofed' }), ctx())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, revoked: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('admin_revoke_restriction')
    expect(rpc.mock.calls[0][1]).toEqual({
      p_restriction_id: RESTRICTION_ID,
      p_revoked_by: ADMIN_ID, // the authenticated admin, NOT anything from the body
      p_revocation_reason: 'genuine reason', // trimmed
    })
  })

  it('maps a NOT_ADMIN_ORIGINATED RPC error to 409 (defence in depth)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_ADMIN_ORIGINATED' } })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'not_admin_originated' })
  })

  it('maps an unexpected RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await POST(req({ reason: 'ok' }), ctx())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'revoke_failed' })
  })
})
