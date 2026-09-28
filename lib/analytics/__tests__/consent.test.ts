import { describe, it, expect } from 'vitest'
import {
  parseConsent,
  readConsentFromCookieString,
  CONSENT_COOKIE,
} from '@/lib/analytics/consent'
import { readTrafficColumnsFromCookies } from '@/lib/analytics/traffic'

describe('parseConsent', () => {
  it('accepts only the two known decisions', () => {
    expect(parseConsent('granted')).toBe('granted')
    expect(parseConsent('denied')).toBe('denied')
  })

  it('returns null for anything else (undecided/garbage)', () => {
    expect(parseConsent(undefined)).toBeNull()
    expect(parseConsent(null)).toBeNull()
    expect(parseConsent('')).toBeNull()
    expect(parseConsent('yes')).toBeNull()
    expect(parseConsent(1 as unknown)).toBeNull()
  })
})

describe('readConsentFromCookieString', () => {
  it('extracts the decision from a document.cookie-style string', () => {
    expect(readConsentFromCookieString(`${CONSENT_COOKIE}=granted`)).toBe('granted')
    expect(
      readConsentFromCookieString(`foo=1; ${CONSENT_COOKIE}=denied; bar=2`),
    ).toBe('denied')
  })

  it('returns null when the cookie is absent or empty', () => {
    expect(readConsentFromCookieString('')).toBeNull()
    expect(readConsentFromCookieString(null)).toBeNull()
    expect(readConsentFromCookieString('other=x; another=y')).toBeNull()
  })
})

describe('checkout is unaffected when analytics consent is rejected', () => {
  it('yields an EMPTY traffic snapshot when no wtf_vid/wtf_sid cookies exist', () => {
    // When consent is rejected the route never sets wtf_vid/wtf_sid, so the
    // checkout snapshot reader sees no analytics cookies and returns {}. The
    // checkout insert therefore records visitor_id/session_id = NULL and
    // proceeds exactly as before — analytics can never block a purchase.
    expect(readTrafficColumnsFromCookies(() => undefined)).toEqual({})
  })
})
