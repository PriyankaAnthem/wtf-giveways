import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Chainable service-client mock that records every filter/update call and
// resolves at `.select()` (the terminal step for an UPDATE ... RETURNING).
const calls: { method: string; args: unknown[] }[] = []
let selectResult: { data: unknown; error: unknown } = { data: [], error: null }

function makeBuilder() {
  const builder: Record<string, (...a: unknown[]) => unknown> = {}
  for (const m of ['from', 'update', 'eq', 'lt', 'or']) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args })
      return builder
    }
  }
  builder.select = (...args: unknown[]) => {
    calls.push({ method: 'select', args })
    return Promise.resolve(selectResult)
  }
  return builder
}

const getInboxServiceClient = vi.fn()
vi.mock('@/lib/admin/inbox/service', () => ({
  getInboxServiceClient: () => getInboxServiceClient(),
}))

import { POST } from '../route'

function req() {
  return new Request('http://x/api/admin/inbox/bulk-mark-old-replied', {
    method: 'POST',
  }) as unknown as Parameters<typeof POST>[0]
}

function findCall(method: string) {
  return calls.find((c) => c.method === method)
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  selectResult = { data: [], error: null }
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin', error: null })
  getInboxServiceClient.mockReturnValue(makeBuilder())
})

describe('POST /api/admin/inbox/bulk-mark-old-replied', () => {
  it('rejects unauthenticated with 401 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(getInboxServiceClient).not.toHaveBeenCalled()
    expect(calls.length).toBe(0)
  })

  it('rejects a non-allowed role (read_only) with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'read_only', error: 'Not authorized' })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(calls.length).toBe(0)
  })

  it('rejects a Host (ops) with 403 and never queries', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: 'ops', error: 'Not authorized' })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(calls.length).toBe(0)
  })

  it('authorizes admin + operations_admin only (allow-list passed to guard)', async () => {
    await POST(req())
    expect(authorizeAdminApi).toHaveBeenCalledWith(expect.anything(), {
      roles: ['admin', 'operations_admin'],
    })
  })

  it('updates only OPEN, older-than-48h, non-payout rows to Waiting', async () => {
    const before = Date.now()
    await POST(req())
    const after = Date.now()

    // Transition matches the reply route.
    const update = findCall('update')
    expect(update?.args[0]).toMatchObject({
      inbox_status: 'waiting',
      inbox_status_updated_by: 'admin-1',
      inbox_resolved_at: null,
    })
    expect(typeof (update?.args[0] as Record<string, unknown>).inbox_status_updated_at).toBe('string')

    // WHERE: inbox_status = 'open'
    expect(findCall('eq')?.args).toEqual(['inbox_status', 'open'])

    // WHERE: created_at < (now - 48h), within the request window.
    const lt = findCall('lt')
    expect(lt?.args[0]).toBe('created_at')
    const cutoffMs = Date.parse(lt?.args[1] as string)
    expect(after - 48 * 60 * 60 * 1000).toBeGreaterThanOrEqual(cutoffMs)
    expect(before - 48 * 60 * 60 * 1000).toBeLessThanOrEqual(cutoffMs)

    // WHERE: NULL-safe payout exclusion (keeps null/legacy, drops winner_payout).
    expect(findCall('or')?.args).toEqual(['enquiry_type.is.null,enquiry_type.neq.winner_payout'])

    // Only affected ids are returned.
    expect(findCall('select')?.args).toEqual(['id'])
  })

  it('returns the number of updated rows', async () => {
    selectResult = { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null }
    const res = await POST(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, updated: 3 })
  })

  it('returns 0 when nothing was eligible', async () => {
    selectResult = { data: [], error: null }
    const res = await POST(req())
    expect((await res.json())).toMatchObject({ ok: true, updated: 0 })
  })

  it('maps a DB error to 500', async () => {
    selectResult = { data: null, error: { message: 'boom' } }
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('bulk_failed')
  })

  it('returns 500 when the service client is unavailable', async () => {
    getInboxServiceClient.mockReturnValue(null)
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('server_config')
  })

  it('sets Cache-Control: private, no-store', async () => {
    const res = await POST(req())
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
