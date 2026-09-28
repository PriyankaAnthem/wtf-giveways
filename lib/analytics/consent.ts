/**
 * Analytics consent: the single source of truth for whether the visitor has
 * agreed to non-essential analytics.
 *
 * Privacy model (see the WTF first-party traffic spec):
 *   - Before a decision is made we store NOTHING except, once the visitor
 *     chooses, a single functional cookie recording the decision itself
 *     (`wtf_consent = granted | denied`). No analytics identifiers (`wtf_vid`,
 *     `wtf_sid`) and no third-party analytics are created until consent is
 *     GRANTED — not even to remember a rejection.
 *   - The consent cookie is deliberately NOT HttpOnly: it carries only the
 *     decision string (never any personal data or identifier) and must be
 *     readable by the client so it can gate script loading and tracking.
 *   - Essential site functionality never depends on this decision.
 *
 * This module is framework-agnostic and dependency-free so it is safe to import
 * from client components, the ingestion route, and unit tests alike. Pure
 * parsing is separated from the browser-only read/write helpers.
 */

/** Functional cookie storing ONLY the analytics-consent decision. */
export const CONSENT_COOKIE = 'wtf_consent'

/** Remember the decision for ~6 months before re-asking. */
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

/** Fired on `window` when the decision changes, so gated UI updates live. */
export const CONSENT_CHANGE_EVENT = 'wtf:consent-change'

export type ConsentDecision = 'granted' | 'denied'

/**
 * Parse a raw cookie value into a decision, or `null` when undecided/garbage.
 * Pure and total — never throws.
 */
export function parseConsent(raw: unknown): ConsentDecision | null {
  if (raw === 'granted') return 'granted'
  if (raw === 'denied') return 'denied'
  return null
}

/**
 * Extract the consent decision from a raw `document.cookie`-style string.
 * Pure and testable; returns `null` when the cookie is absent or invalid.
 */
export function readConsentFromCookieString(
  cookieString: string | null | undefined,
): ConsentDecision | null {
  if (typeof cookieString !== 'string' || cookieString.length === 0) return null
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name !== CONSENT_COOKIE) continue
    return parseConsent(decodeURIComponent(part.slice(eq + 1).trim()))
  }
  return null
}

/** Browser-only: read the current decision from `document.cookie`. */
export function getConsent(): ConsentDecision | null {
  if (typeof document === 'undefined') return null
  return readConsentFromCookieString(document.cookie)
}

/** True once analytics may run. */
export function analyticsAllowed(): boolean {
  return getConsent() === 'granted'
}

/**
 * Browser-only: persist the decision as a first-party, functional cookie and
 * notify listeners (so the gate mounts/unmounts scripts immediately, without a
 * reload). `SameSite=Lax; Secure` matches the rest of the site's cookies.
 */
export function setConsent(decision: ConsentDecision): void {
  if (typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    `${CONSENT_COOKIE}=${decision}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: decision }))
  } catch {
    // dispatch is best-effort; the cookie is already written.
  }
}
