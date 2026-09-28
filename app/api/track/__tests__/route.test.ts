import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mutable request context the mocks read from (reset per test).
// ---------------------------------------------------------------------------
let cookieMap: Record<string, string> = {}
let headerMap: Record<string, string> = {}

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieMap ? { value: cookieMap[name] } : undefined),
  })),
  headers: vi.fn(async () => ({
    get: (name: string) => headerMap[name.toLowerCase()] ?? null,
  })),
}))

// Logged-out visitor: user id resolves to null and never throws.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}))

// Fake `traffic_events` table that honours INSERT ... ON CONFLICT DO NOTHING.
type Row = Record<string, unknown>
let stored: Row[] = []
const upsertSpy = vi.fn()

function fakeUpsert(row: Row, opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
  upsertSpy(row, opts)
  if (opts?.ignoreDuplicates && opts?.onConflict) {
    const key = row[opts.onConflict]
    if (stored.some((r) => r[opts.onConflict as string] === key)) {
      return Promise.resolve({ error: null }) // conflict -> DO NOTHING
    }
  }
  stored.push(row)
  return Promise.resolve({ error: null })
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'traffic_events') {
        return { upsert: (row: Row, opts: never) => fakeUpsert(row, opts) }
      }
      // campaigns lookup (unused for path '/')
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }
    },
  })),
}))

import { POST } from '../route'
import { WTF_VID_COOKIE, WTF_SID_COOKIE, isUuid, parseSessionCookie } from '@/lib/analytics/traffic'
import { CONSENT_COOKIE } from '@/lib/analytics/consent'

const UA_BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const EV1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EV2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

beforeEach(() => {
  vi.clearAllMocks()
  cookieMap = {}
  headerMap = { 'user-agent': UA_BROWSER, host: 'localhost' }
  stored = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

describe('POST /api/track consent gating', () => {
  it('with consent DENIED: sets no cookies and stores nothing', async () => {
    cookieMap[CONSENT_COOKIE] = 'denied'
    const res = await post({ eventId: EV1, path: '/' })
    expect(res.status).toBe(200)
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(stored).toHaveLength(0)
    expect(res.cookies.get(WTF_VID_COOKIE)).toBeUndefined()
    expect(res.cookies.get(WTF_SID_COOKIE)).toBeUndefined()
  })

  it('with NO decision (undecided): sets no cookies and stores nothing', async () => {
    const res = await post({ eventId: EV1, path: '/' })
    expect(res.status).toBe(200)
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(stored).toHaveLength(0)
    expect(res.cookies.get(WTF_VID_COOKIE)).toBeUndefined()
  })

  it('with consent GRANTED: creates visitor + session IDs and stores one row', async () => {
    cookieMap[CONSENT_COOKIE] = 'granted'
    const res = await post({ eventId: EV1, path: '/' })
    expect(res.status).toBe(200)
    expect(stored).toHaveLength(1)

    const vid = res.cookies.get(WTF_VID_COOKIE)?.value
    const sid = res.cookies.get(WTF_SID_COOKIE)?.value
    expect(isUuid(vid)).toBe(true)
    // Session cookie is the structured "<uuid>.<ms>" value.
    expect(parseSessionCookie(sid)).not.toBeNull()

    // Row carries the same identity that was written to the cookies.
    expect(stored[0].visitor_id).toBe(vid)
    expect(stored[0].session_id).toBe(parseSessionCookie(sid)?.sessionId)
    expect(stored[0].is_bot).toBe(false)
    expect(stored[0].event_type).toBe('page_view')
  })
})

describe('POST /api/track idempotency (ON CONFLICT event_id DO NOTHING)', () => {
  it('passes onConflict:event_id + ignoreDuplicates and stores a duplicate event only once', async () => {
    cookieMap[CONSENT_COOKIE] = 'granted'

    await post({ eventId: EV1, path: '/' })
    // Same event_id replayed (e.g. the client retry) -> no second row.
    await post({ eventId: EV1, path: '/' })

    expect(upsertSpy).toHaveBeenCalledTimes(2)
    expect(upsertSpy.mock.calls[0][1]).toEqual({ onConflict: 'event_id', ignoreDuplicates: true })
    expect(stored).toHaveLength(1)

    // A genuinely new event_id does store.
    await post({ eventId: EV2, path: '/' })
    expect(stored).toHaveLength(2)
  })
})

describe('POST /api/track validation', () => {
  it('rejects a missing/invalid event_id with 400 and stores nothing', async () => {
    cookieMap[CONSENT_COOKIE] = 'granted'
    const res = await post({ path: '/' })
    expect(res.status).toBe(400)
    expect(stored).toHaveLength(0)
  })

  it('acknowledges but ignores a non-trackable (admin) path', async () => {
    cookieMap[CONSENT_COOKIE] = 'granted'
    const res = await post({ eventId: EV1, path: '/admin/secret' })
    expect(res.status).toBe(200)
    expect(stored).toHaveLength(0)
  })
})
