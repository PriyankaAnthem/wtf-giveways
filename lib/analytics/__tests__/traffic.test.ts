import { describe, it, expect } from 'vitest'
import {
  isUuid,
  resolveTrafficIdentity,
  readTrafficColumnsFromCookies,
  normalizeTrackPath,
  isTrackablePath,
  parseGiveawaySlug,
  isBotUserAgent,
  referrerHost,
  parseSessionCookie,
  serializeSessionCookie,
  WTF_VID_COOKIE,
  WTF_SID_COOKIE,
  TRACK_PATH_MAX,
  SID_INACTIVITY_MS,
} from '@/lib/analytics/traffic'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const NOW = 1_700_000_000_000
/** A `wtf_sid` cookie value that is "active as of `NOW`". */
const activeSid = (id: string, ms: number = NOW) => serializeSessionCookie(id, ms)

describe('isUuid', () => {
  it('accepts a valid v4-shaped uuid and rejects junk', () => {
    expect(isUuid(UUID_A)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(123 as unknown)).toBe(false)
  })
})

describe('resolveTrafficIdentity', () => {
  it('preserves both IDs when the visitor is valid and the session is active', () => {
    const r = resolveTrafficIdentity(UUID_A, activeSid(UUID_B), NOW)
    expect(r.visitorId).toBe(UUID_A)
    expect(r.sessionId).toBe(UUID_B)
    expect(r.isNewVisitor).toBe(false)
    expect(r.isNewSession).toBe(false)
    // Cookie is re-stamped with the current time (sliding window).
    expect(r.sessionCookieValue).toBe(serializeSessionCookie(UUID_B, NOW))
  })

  it('keeps a returning visitor but mints a new session when session is missing', () => {
    const r = resolveTrafficIdentity(UUID_A, undefined, NOW)
    expect(r.visitorId).toBe(UUID_A)
    expect(r.isNewVisitor).toBe(false)
    expect(isUuid(r.sessionId)).toBe(true)
    expect(r.sessionId).not.toBe(UUID_A)
    expect(r.isNewSession).toBe(true)
  })

  it('mints both when both are absent', () => {
    const r = resolveTrafficIdentity(null, null, NOW)
    expect(isUuid(r.visitorId)).toBe(true)
    expect(isUuid(r.sessionId)).toBe(true)
    expect(r.visitorId).not.toBe(r.sessionId)
    expect(r.isNewVisitor).toBe(true)
    expect(r.isNewSession).toBe(true)
  })

  it('treats a malformed value exactly like an absent one (no poisoning, no throw)', () => {
    const r = resolveTrafficIdentity('garbage', 'also-bad', NOW)
    expect(isUuid(r.visitorId)).toBe(true)
    expect(isUuid(r.sessionId)).toBe(true)
    expect(r.isNewVisitor).toBe(true)
    expect(r.isNewSession).toBe(true)
  })

  it('reuses the session within the 30-min inactivity window (sliding)', () => {
    // Last activity 29 minutes ago -> still active, same session id, re-stamped.
    const last = NOW - (SID_INACTIVITY_MS - 60_000)
    const r = resolveTrafficIdentity(UUID_A, activeSid(UUID_B, last), NOW)
    expect(r.sessionId).toBe(UUID_B)
    expect(r.isNewSession).toBe(false)
    expect(parseSessionCookie(r.sessionCookieValue)?.lastActivityMs).toBe(NOW)
  })

  it('mints a NEW session after 30 min of inactivity but KEEPS the visitor id', () => {
    // Last activity just over the window -> expired; new session, stable visitor.
    const last = NOW - (SID_INACTIVITY_MS + 1)
    const r = resolveTrafficIdentity(UUID_A, activeSid(UUID_B, last), NOW)
    expect(r.visitorId).toBe(UUID_A) // visitor unchanged
    expect(r.isNewVisitor).toBe(false)
    expect(r.sessionId).not.toBe(UUID_B) // fresh session id
    expect(isUuid(r.sessionId)).toBe(true)
    expect(r.isNewSession).toBe(true)
  })

  it('rejects a future-timestamped session (clock skew) and mints a fresh one', () => {
    const r = resolveTrafficIdentity(UUID_A, activeSid(UUID_B, NOW + 60_000), NOW)
    expect(r.sessionId).not.toBe(UUID_B)
    expect(r.isNewSession).toBe(true)
  })
})

describe('parseSessionCookie / serializeSessionCookie', () => {
  it('round-trips a session id + timestamp', () => {
    const raw = serializeSessionCookie(UUID_B, NOW)
    expect(raw).toBe(`${UUID_B}.${NOW}`)
    expect(parseSessionCookie(raw)).toEqual({ sessionId: UUID_B, lastActivityMs: NOW })
  })

  it('returns null for a bare uuid (no timestamp), garbage, or bad timestamp', () => {
    expect(parseSessionCookie(UUID_B)).toBeNull()
    expect(parseSessionCookie('nope')).toBeNull()
    expect(parseSessionCookie(`${UUID_B}.notanumber`)).toBeNull()
    expect(parseSessionCookie(`${UUID_B}.0`)).toBeNull()
    expect(parseSessionCookie(undefined)).toBeNull()
    expect(parseSessionCookie(null)).toBeNull()
  })
})

describe('readTrafficColumnsFromCookies', () => {
  it('maps valid cookies to snapshot columns (bare session UUID extracted)', () => {
    const cols = readTrafficColumnsFromCookies((name) =>
      name === WTF_VID_COOKIE ? UUID_A : name === WTF_SID_COOKIE ? activeSid(UUID_B) : undefined,
    )
    expect(cols).toEqual({ visitor_id: UUID_A, session_id: UUID_B })
  })

  it('omits invalid/absent cookies and returns {} when nothing valid is present', () => {
    expect(readTrafficColumnsFromCookies(() => undefined)).toEqual({})
    expect(
      readTrafficColumnsFromCookies((name) =>
        name === WTF_VID_COOKIE ? 'bad' : name === WTF_SID_COOKIE ? activeSid(UUID_B) : undefined,
      ),
    ).toEqual({ session_id: UUID_B })
  })

  it('ignores a bare (unstructured) session cookie value', () => {
    // A legacy/garbage bare uuid is not a valid structured session cookie.
    expect(
      readTrafficColumnsFromCookies((name) =>
        name === WTF_VID_COOKIE ? UUID_A : name === WTF_SID_COOKIE ? UUID_B : undefined,
      ),
    ).toEqual({ visitor_id: UUID_A })
  })

  it('NEVER returns any attribution_* key (isolation guarantee)', () => {
    const cols = readTrafficColumnsFromCookies((name) =>
      name === WTF_VID_COOKIE ? UUID_A : name === WTF_SID_COOKIE ? activeSid(UUID_B) : undefined,
    )
    expect(Object.keys(cols).every((k) => k === 'visitor_id' || k === 'session_id')).toBe(true)
  })

  it('never throws when the accessor throws', () => {
    expect(() =>
      readTrafficColumnsFromCookies(() => {
        throw new Error('cookie store exploded')
      }),
    ).not.toThrow()
    expect(
      readTrafficColumnsFromCookies(() => {
        throw new Error('boom')
      }),
    ).toEqual({})
  })
})

describe('normalizeTrackPath', () => {
  it('strips query string and hash, keeping the bare pathname', () => {
    expect(normalizeTrackPath('/giveaways/pieface?utm=x#frag')).toBe('/giveaways/pieface')
    expect(normalizeTrackPath('/?a=1')).toBe('/')
  })

  it('rejects non-internal / absolute / protocol-relative / non-string values', () => {
    expect(normalizeTrackPath('https://evil.com/x')).toBeNull()
    expect(normalizeTrackPath('//evil.com')).toBeNull()
    expect(normalizeTrackPath('relative/no-slash')).toBeNull()
    expect(normalizeTrackPath('')).toBeNull()
    expect(normalizeTrackPath(42 as unknown)).toBeNull()
  })

  it('caps very long paths at the column guardrail', () => {
    const long = '/' + 'a'.repeat(TRACK_PATH_MAX + 50)
    const out = normalizeTrackPath(long)
    expect(out).not.toBeNull()
    expect((out as string).length).toBe(TRACK_PATH_MAX)
  })
})

describe('isTrackablePath', () => {
  it('excludes admin and api, includes public pages', () => {
    expect(isTrackablePath('/admin')).toBe(false)
    expect(isTrackablePath('/admin/marketing/affiliates')).toBe(false)
    expect(isTrackablePath('/api/track')).toBe(false)
    expect(isTrackablePath('/giveaways/pieface')).toBe(true)
    expect(isTrackablePath('/')).toBe(true)
  })
})

describe('parseGiveawaySlug', () => {
  it('extracts the slug from a canonical detail path only', () => {
    expect(parseGiveawaySlug('/giveaways/pieface')).toBe('pieface')
    expect(parseGiveawaySlug('/giveaways/Pie-Face')).toBe('pie-face')
    expect(parseGiveawaySlug('/giveaways/pieface/')).toBe('pieface')
  })

  it('returns null for non-detail or nested paths', () => {
    expect(parseGiveawaySlug('/giveaways')).toBeNull()
    expect(parseGiveawaySlug('/giveaways/pieface/rules')).toBeNull()
    expect(parseGiveawaySlug('/')).toBeNull()
  })
})

describe('isBotUserAgent', () => {
  it('flags common bots and empty/missing UAs', () => {
    expect(isBotUserAgent('Googlebot/2.1')).toBe(true)
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true)
    expect(isBotUserAgent('curl/8.1')).toBe(true)
    expect(isBotUserAgent('')).toBe(true)
    expect(isBotUserAgent(null)).toBe(true)
    expect(isBotUserAgent(undefined)).toBe(true)
  })

  it('treats a normal browser UA as human', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false)
  })
})

describe('referrerHost', () => {
  it('reduces a referrer URL to its host only', () => {
    expect(referrerHost('https://www.tiktok.com/@wtf/video/123?x=1')).toBe('www.tiktok.com')
    expect(referrerHost('http://Facebook.com/somepage')).toBe('facebook.com')
  })

  it('returns null for empty/invalid referrers', () => {
    expect(referrerHost('')).toBeNull()
    expect(referrerHost('not a url')).toBeNull()
    expect(referrerHost(undefined)).toBeNull()
  })
})
