/**
 * First-party traffic identity: the single source of truth for the anonymous
 * visitor/session cookies (`wtf_vid` / `wtf_sid`) and the read-only snapshot
 * mapping used by checkout.
 *
 * Design constraints (see the WTF first-party traffic spec):
 *   - IDs are opaque UUIDs ONLY. No emails, names, mobiles or any customer data
 *     ever go in these cookies.
 *   - The visitor ID persists across visits (~400d, the browser cap); the
 *     session ID represents one browsing session and expires after ~30 minutes
 *     of inactivity (sliding — refreshed server-side on every tracked hit).
 *   - Authenticated users keep the SAME anonymous IDs (the IDs are never reset
 *     on login/logout; identity is layered on top via `user_id` at insert).
 *   - This module is pure and dependency-light so it is unit-testable and safe
 *     to import from both the /api/track route and the checkout-create route.
 *
 * Cookie WRITING (Set-Cookie) lives in the route layer; this module only mints,
 * validates and maps values. It performs NO cookie I/O itself.
 */

import { randomUUID } from 'crypto'
import { isSafeInternalPath } from '@/lib/marketing/attribution'

// ---------------------------------------------------------------------------
// Cookie names + lifetimes
// ---------------------------------------------------------------------------

/** Persistent anonymous visitor cookie. */
export const WTF_VID_COOKIE = 'wtf_vid'
/** Current session cookie (sliding 30-minute inactivity window). */
export const WTF_SID_COOKIE = 'wtf_sid'

/**
 * Visitor cookie lifetime. Browsers now cap persistent cookie Max-Age at ~400
 * days (Chrome/Safari), so we request exactly that — the visitor ID is as
 * durable as the platform allows.
 */
export const VID_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
/** Session inactivity window: 30 minutes, refreshed on each tracked hit. */
export const SID_MAX_AGE_SECONDS = 30 * 60
/**
 * Same window in milliseconds. This is the AUTHORITATIVE definition of session
 * activity: the session cookie carries a last-activity timestamp, and a session
 * is only reused if the previous tracked hit was within this window. Cookie
 * Max-Age is merely a client-side backstop — the server never trusts the
 * browser to have expired the cookie on time.
 */
export const SID_INACTIVITY_MS = SID_MAX_AGE_SECONDS * 1000

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True only for a syntactically valid RFC-4122 UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// ---------------------------------------------------------------------------
// Identity resolution (minting)
// ---------------------------------------------------------------------------

export interface ResolvedTrafficIdentity {
  visitorId: string
  sessionId: string
  /** A fresh visitor ID was minted (no valid `wtf_vid` was presented). */
  isNewVisitor: boolean
  /** A fresh session ID was minted (none presented, or the window lapsed). */
  isNewSession: boolean
  /**
   * The value to write back into the `wtf_sid` cookie — the (possibly reused)
   * session id stamped with `nowMs` as the new last-activity time, so the next
   * hit measures inactivity from THIS view.
   */
  sessionCookieValue: string
}

/**
 * Parsed representation of the structured `wtf_sid` cookie: a session UUID plus
 * the epoch-ms timestamp of the last tracked activity in that session.
 */
export interface ParsedSessionCookie {
  sessionId: string
  lastActivityMs: number
}

/**
 * Serialize a session id + last-activity time into the `wtf_sid` cookie value.
 * Format is `"<uuid>.<epochMs>"` — compact, opaque, and non-PII.
 */
export function serializeSessionCookie(sessionId: string, nowMs: number): string {
  return `${sessionId}.${nowMs}`
}

/**
 * Parse a raw `wtf_sid` cookie value, returning `null` for anything malformed.
 * Pure and total — a tampered/garbage value can never throw.
 */
export function parseSessionCookie(raw: string | undefined | null): ParsedSessionCookie | null {
  if (typeof raw !== 'string') return null
  const dot = raw.indexOf('.')
  if (dot === -1) return null
  const sessionId = raw.slice(0, dot)
  const ms = Number(raw.slice(dot + 1))
  if (!isUuid(sessionId)) return null
  if (!Number.isFinite(ms) || ms <= 0) return null
  return { sessionId, lastActivityMs: ms }
}

/**
 * Resolve the visitor/session identity from the raw cookie values presented by
 * the browser, minting fresh UUIDs for anything missing, malformed or expired.
 *
 * Session activity is SERVER-AUTHORITATIVE: the session is reused only when the
 * cookie parses to a valid UUID AND its last-activity timestamp is within
 * `SID_INACTIVITY_MS` of `nowMs`. Otherwise a brand-new session id is minted —
 * even if the browser still holds the old cookie. Either way the returned
 * `sessionCookieValue` re-stamps the session with `nowMs`, so each accepted
 * tracked view extends the active window (a true sliding-inactivity session).
 *
 * A valid visitor ID is ALWAYS preserved across sessions, so a returning
 * visitor keeps their `wtf_vid` and only gets a new `wtf_sid`.
 */
export function resolveTrafficIdentity(
  rawVisitorId: string | undefined | null,
  rawSessionId: string | undefined | null,
  nowMs: number = Date.now(),
): ResolvedTrafficIdentity {
  const hasVisitor = isUuid(rawVisitorId)
  const visitorId = hasVisitor ? (rawVisitorId as string) : randomUUID()

  const parsed = parseSessionCookie(rawSessionId)
  const withinWindow = parsed !== null && nowMs - parsed.lastActivityMs <= SID_INACTIVITY_MS
  // Guard against a clock-skew "future" timestamp: treat it as a fresh session.
  const notFuture = parsed !== null && parsed.lastActivityMs <= nowMs
  const reuseSession = withinWindow && notFuture

  const sessionId = reuseSession ? (parsed as ParsedSessionCookie).sessionId : randomUUID()

  return {
    visitorId,
    sessionId,
    isNewVisitor: !hasVisitor,
    isNewSession: !reuseSession,
    sessionCookieValue: serializeSessionCookie(sessionId, nowMs),
  }
}

// ---------------------------------------------------------------------------
// Checkout snapshot mapping (read-only)
// ---------------------------------------------------------------------------

/** The subset of `checkout_intents` columns this system owns. */
export interface CheckoutTrafficColumns {
  visitor_id: string
  session_id: string
}

/**
 * Map the first-party cookies to the `checkout_intents` traffic columns for
 * snapshotting AT checkout-creation time. This is READ-ONLY: it never mints IDs
 * (checkout only records identity the visitor already has) and returns ONLY the
 * `visitor_id`/`session_id` keys — never any `attribution_*` key — so spreading
 * the result into an insert can never disturb the independent attribution
 * snapshot. Missing/malformed cookies yield an empty object, so checkout is
 * completely unaffected when analytics cookies are absent or corrupt.
 *
 * `get` is the cookie accessor (e.g. `(name) => cookieStore.get(name)?.value`),
 * injected so this is trivially unit-testable and framework-agnostic.
 */
export function readTrafficColumnsFromCookies(
  get: (name: string) => string | undefined,
): Partial<CheckoutTrafficColumns> {
  try {
    const vid = get(WTF_VID_COOKIE)
    const out: Partial<CheckoutTrafficColumns> = {}
    if (isUuid(vid)) out.visitor_id = vid
    // The session cookie is the structured `"<uuid>.<epochMs>"` value; store
    // only the bare session UUID in the checkout column.
    const parsedSession = parseSessionCookie(get(WTF_SID_COOKIE))
    if (parsedSession) out.session_id = parsedSession.sessionId
    return out
  } catch {
    // A bad accessor must never break checkout — analytics is non-critical.
    return {}
  }
}

// ---------------------------------------------------------------------------
// Request shaping (pure, unit-testable)
// ---------------------------------------------------------------------------

/** Hard cap on a stored path, matching the DB column guardrail. */
export const TRACK_PATH_MAX = 512

/**
 * Normalise a client-supplied pathname into a safe, query-free internal path,
 * or `null` if it is not a trackable same-origin path. Strips any query string
 * and hash (we never persist query strings), then validates with the shared
 * open-redirect-safe `isSafeInternalPath`.
 */
export function normalizeTrackPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let p = raw.trim()
  if (p.length === 0) return null
  // Drop hash then query — only the bare pathname is ever stored.
  const hash = p.indexOf('#')
  if (hash !== -1) p = p.slice(0, hash)
  const q = p.indexOf('?')
  if (q !== -1) p = p.slice(0, q)
  if (p.length === 0) return null
  if (p.length > TRACK_PATH_MAX) p = p.slice(0, TRACK_PATH_MAX)
  return isSafeInternalPath(p) ? p : null
}

/**
 * Paths we never record: API routes and the entire admin console. Admin is
 * excluded on BOTH the client tracker and here (defense-in-depth).
 */
export function isTrackablePath(path: string): boolean {
  if (path.startsWith('/admin')) return false
  if (path.startsWith('/api')) return false
  return true
}

/**
 * Extract the campaign slug from a canonical giveaway detail path
 * (`/giveaways/[slug]`), or `null` for any other path. Nested paths under a
 * giveaway (e.g. `/giveaways/x/rules`) are intentionally not treated as the
 * campaign page.
 */
export function parseGiveawaySlug(path: string): string | null {
  const m = /^\/giveaways\/([^/]+)\/?$/.exec(path)
  if (!m) return null
  const slug = decodeURIComponent(m[1]).trim().toLowerCase()
  return slug.length > 0 && slug.length <= 200 ? slug : null
}

const BOT_UA_RE =
  /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|embedly|quora link preview|bufferbot|whatsapp|telegrambot|pinterest|redditbot|headless|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|pingdom|uptimerobot|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\//i

/**
 * Sensible, conservative bot/noise detection from the User-Agent. A missing or
 * empty UA is treated as a bot (real browsers always send one). Bots are still
 * INSERTED but flagged `is_bot = true` so reporting can exclude them without
 * losing raw data.
 */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (typeof ua !== 'string') return true
  const t = ua.trim()
  if (t.length === 0) return true
  return BOT_UA_RE.test(t)
}

/**
 * Reduce a referrer to its host only (never the full, potentially sensitive
 * URL). Returns `null` for absent/invalid/same-noise referrers.
 */
export function referrerHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (t.length === 0) return null
  try {
    const host = new URL(t).hostname.toLowerCase()
    return host.length > 0 && host.length <= 255 ? host : null
  } catch {
    return null
  }
}
