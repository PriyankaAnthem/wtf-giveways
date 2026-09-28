/**
 * Pure, server-safe helpers for the Instant Winners staff search.
 *
 * These functions contain NO database access and NO Next.js request handling,
 * so they can be unit-tested in isolation and shared as the single source of
 * truth for query validation/normalisation. The API route is the authoritative
 * validation layer; the client only mirrors labels/behaviour, never rules.
 */

/** Canonical UUID matcher (v0-agnostic: any RFC-4122-shaped id). */
export const IW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Minimum length for a free-text search (names, refs, display names, email). */
export const IW_MIN_QUERY_LEN = 3
/** Hard cap to keep queries bounded. */
export const IW_MAX_QUERY_LEN = 200

// Reject ASCII control characters (incl. NUL, tab, newline) from every query.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/

/** True when the value is a well-formed UUID. */
export function isValidUuid(input: string): boolean {
  return IW_UUID_RE.test(input.trim())
}

/**
 * Escape the LIKE/ILIKE wildcards so a user-supplied term is treated literally.
 * Escapes backslash first-class (single pass) plus `%` and `_`.
 */
export function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, '\\$1')
}

/**
 * Parse a winning-ticket number from the query. Strips a single leading `#`
 * (so "#333" -> 333) and only accepts a pure run of digits. Returns null when
 * the value is not a safe, non-negative integer ticket number.
 */
export function parseTicketNumber(input: string): number | null {
  let s = input.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}

/** Deduplicate an iterable of ids, preserving first-seen order. */
export function dedupe<T>(items: Iterable<T>): T[] {
  return [...new Set(items)]
}

export type NormalizedQuery =
  | { kind: 'blank' }
  | { kind: 'error'; error: 'query_too_long' | 'invalid_query' | 'query_too_short' }
  | {
      kind: 'search'
      /** Trimmed original term (passed verbatim to the identity RPC). */
      raw: string
      /** True when the term is a bare UUID. */
      isUuid: boolean
      /** Exact winning-ticket number, when the term is ticket-shaped. */
      ticketNumber: number | null
      /**
       * Whether to run the identity/text sources (wallet RPC, display-name and
       * checkout-ref ILIKE). False for explicit `#`-prefixed ticket queries and
       * for terms below the minimum length.
       */
      runIdentitySearch: boolean
      /** Ready-to-use, wildcard-escaped ILIKE pattern (`%term%`). */
      likePattern: string
    }

/**
 * Normalise and validate a raw search term (the `q` param, or the legacy
 * `search` param when `q` is absent).
 *
 * Rules:
 * - null/blank            -> { blank }  (caller returns recent winners)
 * - control chars         -> 400 invalid_query
 * - length > MAX          -> 400 query_too_long
 * - UUID                  -> always valid
 * - ticket-shaped (digits, optional leading `#`) -> valid at 1+ digits
 * - other text            -> requires >= MIN_QUERY_LEN, else 400 query_too_short
 */
export function normalizeSearchQuery(raw: string | null | undefined): NormalizedQuery {
  if (raw == null) return { kind: 'blank' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { kind: 'blank' }

  if (CONTROL_CHAR_RE.test(trimmed)) return { kind: 'error', error: 'invalid_query' }
  if (trimmed.length > IW_MAX_QUERY_LEN) return { kind: 'error', error: 'query_too_long' }

  const isUuid = IW_UUID_RE.test(trimmed)
  const hasHashPrefix = trimmed.startsWith('#')
  const ticketNumber = parseTicketNumber(trimmed)

  // A short, non-UUID, non-ticket term is rejected rather than silently run
  // as an unfiltered (or too-broad) search.
  if (!isUuid && ticketNumber === null && trimmed.length < IW_MIN_QUERY_LEN) {
    return { kind: 'error', error: 'query_too_short' }
  }

  // Explicit `#`-prefixed ticket queries are ticket-only (never sent to the
  // identity RPC, which would treat `#...` as an invalid term).
  const runIdentitySearch = !hasHashPrefix && (isUuid || trimmed.length >= IW_MIN_QUERY_LEN)

  return {
    kind: 'search',
    raw: trimmed,
    isUuid,
    ticketNumber,
    runIdentitySearch,
    likePattern: `%${escapeLike(trimmed)}%`,
  }
}
