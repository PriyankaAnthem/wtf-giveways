import { describe, it, expect, beforeEach, vi } from 'vitest'

// The route transitively imports `server-only` via the auth chain.
vi.mock('server-only', () => ({}))

// ---- Mocks -----------------------------------------------------------------
const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Service-role client stub exposing `.rpc`.
const rpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: (...a: unknown[]) => rpc(...a) })),
}))

// The verified restriction helper — mocked so we control pre-check / post-check.
const isUserPurchaseRestricted = vi.fn()
vi.mock('@/lib/account-restrictions', () => ({
  isUserPurchaseRestricted: (...a: unknown[]) => isUserPurchaseRestricted(...a),
}))

import { POST } from '../route'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ADMIN_ID = '22222222-2222-4222-8222-222222222222'

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request(`http://test/api/admin/wallets/${USER_ID}/self-exclude`, {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
  })
}
function ctx(userId = USER_ID) {
  return { params: Promise.resolve({ userId }) }
}

beforeEach(() => {
  authorizeAdminApi.mockReset()
  rpc.mockReset()
  isUserPurchaseRestricted.mockReset()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  // Defaults: authorized super admin, not currently restricted, RPC ok.
  authorizeAdminApi.mockResolvedValue({ user: { id: ADMIN_ID }, role: 'admin', error: null })
  isUserPurchaseRestricted.mockResolvedValue(false)
  rpc.mockResolvedValue({ data: null, error: null })
})

describe('POST self-exclude — authorization', () => {
  it('rejects an unauthenticated request with 401 and never calls the RPC', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await POST(req({ reason: 'x' }) as any, ctx())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an insufficient role (operations_admin) with 403 and no RPC', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'operations_admin', error: 'Not authorized' })
    const res = await POST(req({ reason: 'x' }) as any, ctx())
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requests SUPER-ADMIN-ONLY authorization (roles: ["admin"])', async () => {
    await POST(req({ reason: 'Customer requested closure' }) as any, ctx())
    expect(authorizeAdminApi.mock.calls[0][1]).toEqual({ roles: ['admin'] })
  })
})

describe('POST self-exclude — validation', () => {
  it('rejects an invalid userId UUID with 400', async () => {
    const res = await POST(req({ reason: 'x' }) as any, ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_identifier' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with 400', async () => {
    const res = await POST(req('{not json', { raw: true }) as any, ctx())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_request' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a blank reason with 400 and no RPC', async () => {
    const res = await POST(req({ reason: '' }) as any, ctx())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_reason' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only reason with 400 and no RPC', async () => {
    const res = await POST(req({ reason: '   \n\t  ' }) as any, ctx())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_reason' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('POST self-exclude — RPC invocation', () => {
  it('calls admin_self_exclude_user with trimmed reason, target user_id and admin UUID', async () => {
    const res = await POST(req({ reason: '  Customer requested self-exclusion  ' }) as any, ctx())
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('admin_self_exclude_user')
    expect(rpc.mock.calls[0][1]).toEqual({
      p_user_id: USER_ID,
      p_reason: 'Customer requested self-exclusion', // trimmed
      p_created_by: ADMIN_ID, // genuine admin auth UUID, not cast/invented
    })
  })

  it('returns { ok, restricted:true, alreadyExcluded:false } on success', async () => {
    isUserPurchaseRestricted.mockResolvedValueOnce(false) // pre-check
    isUserPurchaseRestricted.mockResolvedValueOnce(true) // post-check
    const res = await POST(req({ reason: 'closure' }) as any, ctx())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, restricted: true, alreadyExcluded: false })
  })

  it('maps a not-found RPC error to 404', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin_self_exclude_user_user_not_found' } })
    const res = await POST(req({ reason: 'closure' }) as any, ctx())
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'customer_not_found' })
  })

  it('maps an unexpected RPC error to 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'some other failure' } })
    const res = await POST(req({ reason: 'closure' }) as any, ctx())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'self_exclude_failed' })
  })
})

describe('POST self-exclude — idempotency', () => {
  it('treats an already-restricted customer as success WITHOUT calling the RPC again', async () => {
    isUserPurchaseRestricted.mockResolvedValue(true) // pre-check: already restricted
    const res = await POST(req({ reason: 'closure' }) as any, ctx())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, restricted: true, alreadyExcluded: true })
    // No duplicate restriction / duplicate audit row.
    expect(rpc).not.toHaveBeenCalled()
  })
})
