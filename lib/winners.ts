import type { WinnerSnapshot } from "@/lib/types"

/**
 * Shared winners feed configuration and prize-classification helpers.
 *
 * IMPORTANT: prize classification is driven ONLY by the `fulfilmentType` field
 * supplied by the existing `winners_feed` response. We never infer the prize
 * type from whether a title contains a "£" symbol, and we never replace a real
 * prize title with a campaign-format label such as "Balloon Pop".
 */

// Bounded page sizes. The initial request loads the featured winners plus one
// grid page; each "Load more" click loads one further bounded grid page.
export const FEATURED_COUNT = 4

export const GRID_PAGE_SIZE = 24

/**
 * THE winners eligibility rule — one line, no allow-lists.
 *
 *   SHOW EVERY GENUINE AWARDED PRIZE EXCEPT SITE CREDIT.
 *
 * The `winners_feed` view already contains only genuine awarded prizes
 * (`winner_records.placed = 1` on the main arm; real `instant_win_awards` rows
 * on the instant arm). The ONLY thing we remove is site credit, which is
 * authoritatively identified by `fulfilment_type = 'wallet_credit'`:
 *
 *   kind = 'main'
 *   OR (kind = 'instant' AND (fulfilment_type IS NULL OR fulfilment_type <> 'wallet_credit'))
 *
 * A NULL fulfilment type is eligible. Eligibility is deliberately NOT based on
 * prize amount, cash/balloon wording, prize title, prize category, campaign
 * slug, campaign status, paid/fulfilled status, manual fulfilment, physical
 * prize, or any "future prize type". A brand-new competition with brand-new
 * prize types appears automatically with NO edit to this rule — the only way a
 * genuine award is hidden is if it is literally site credit.
 *
 * PostgREST NULL-safety: the wallet-credit exclusion is written as
 * `or(fulfilment_type.is.null,fulfilment_type.neq.wallet_credit)` because a
 * bare `.neq` against NULL evaluates to NULL (which would wrongly drop
 * NULL-type winners). The main arm's `fulfilment_type` column is always NULL,
 * so it is matched purely by `kind.eq.main`.
 */
export function winnersEligibilityOrFilter(): string {
  return (
    "kind.eq.main," +
    "and(kind.eq.instant,or(fulfilment_type.is.null,fulfilment_type.neq.wallet_credit))"
  )
}

/**
 * Client-safe mirror of `winnersEligibilityOrFilter()`, used ONLY by the mock
 * fallback (never for live rows, which are filtered at the query layer). Same
 * one rule: everything except site credit (`fulfilment_type = 'wallet_credit'`).
 */
export function isWinnerEligible(w: WinnerSnapshot): boolean {
  if (w.kind === "main") return true
  if (w.kind !== "instant") return false
  return w.fulfilmentType !== "wallet_credit"
}

/**
 * Explicit allow-list of PUBLIC columns selected from `winners_feed`.
 *
 * This is a hard privacy boundary at the QUERY layer: sensitive columns
 * (`winning_ticket`, `user_id`) are never fetched, so they can never appear in
 * the raw Supabase result envelope that Next.js serialises into the RSC/HTML
 * payload, nor in the `/api/winners` JSON. `happened_at` is the ordering /
 * cursor key and is safe. Only columns that actually exist on the view are
 * listed (verified against the live row shape) and every column here is read by
 * `mapWinnerRow` — keep the two in sync. `feed_id` is the stable per-row
 * identity used for deterministic ordering, the cursor, and client dedup.
 */
export const PUBLIC_WINNER_COLUMNS =
  "kind, happened_at, feed_id, display_name, prize_title, campaign_title, campaign_slug, fulfilment_type, prize_value_pence, prize_value_text"
export type FulfilmentType = "cash" | "wallet_credit" | "manual"
export type FulfilmentCategory = "cash" | "wallet_credit" | "other"

/** Public fallback used whenever a usable first name cannot be derived. */
export const WINNER_FALLBACK_NAME = "Verified winner"

/**
 * Reduce any supplied display name to a privacy-safe FIRST NAME ONLY.
 *
 * This is the single guard that stops a winner's surname from ever being
 * serialised to the browser or rendered on the public winners page. It only
 * ever sees the name string — it never derives a name from an email, user id,
 * or any other field.
 *
 * Behaviour:
 *  - non-string / empty / whitespace / invalid  -> "Verified winner"
 *  - "Ben Govier"        -> "Ben"
 *  - "  Grace   Quigley" -> "Grace"
 *  - "Naomi H"           -> "Naomi"
 *  - "Anne-Marie Smith"  -> "Anne-Marie"   (internal punctuation preserved)
 *  - "O’Neil Jones"      -> "O’Neil"       (curly + straight apostrophes kept)
 *  - "Pamela"            -> "Pamela"
 *  - bounded to 24 Unicode code points; Unicode-safe (no ASCII-only assumptions)
 *
 * Private / machine-generated inputs are rejected outright (return the
 * fallback) so they can never be split into a "first name":
 *  - email addresses  ("ben@example.com")
 *  - URLs             ("https://example.com/ben", "www.example.com")
 *  - UUIDs            ("cd40948f-44f5-499e-bdd3-213e11ba07fe")
 * These checks are narrow and explicit; legitimate names containing an
 * apostrophe, hyphen or full stop (e.g. "Anne-Marie", "O’Neil", "Dr. Smith")
 * are NOT rejected.
 */
// Contains an "@" between non-space characters -> email address.
const EMAIL_LIKE = /\S@\S/u
// Explicit URL scheme or a leading "www." host -> URL.
const URL_LIKE = /^(?:https?:\/\/|www\.)/iu
// Canonical 8-4-4-4-12 hexadecimal UUID.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
// A human first name: starts with a Unicode letter, followed only by Unicode
// letters, combining marks, internal apostrophes (' or ’) or hyphens. This
// rejects usernames/handles/numbers (e.g. "ben123", "@ben", "user/name",
// "07400123456") while preserving accents and names like "Anne-Marie" or "O’Neil".
const HUMAN_NAME = /^\p{L}[\p{L}\p{M}'’-]*$/u

export function formatWinnerFirstName(displayName: unknown): string {
  if (typeof displayName !== "string") return WINNER_FALLBACK_NAME

  // Trim, then collapse repeated internal whitespace to a single space.
  const normalised = displayName.trim().replace(/\s+/g, " ")
  if (normalised.length === 0) return WINNER_FALLBACK_NAME

  // Reject private / machine-generated values before any token extraction, so
  // an email/URL/UUID can never leak through as a "first name".
  if (EMAIL_LIKE.test(normalised) || URL_LIKE.test(normalised) || UUID_LIKE.test(normalised)) {
    return WINNER_FALLBACK_NAME
  }

  // Take only the first whitespace-separated token (drops the surname).
  const firstToken = normalised.split(" ")[0] ?? ""

  // Remove trailing separator punctuation (comma, full stop, colon, semicolon)
  // while preserving internal punctuation such as hyphens and apostrophes.
  const cleaned = firstToken.replace(/[.,:;]+$/u, "")
  if (cleaned.trim().length === 0) return WINNER_FALLBACK_NAME

  // Final shape check: the cleaned token must look like a human first name.
  // Rejects handles/usernames/numbers/paths that survived earlier steps.
  if (!HUMAN_NAME.test(cleaned)) return WINNER_FALLBACK_NAME

  // Enforce a maximum visible length using Unicode code points, not UTF-16 units.
  const chars = Array.from(cleaned)
  const bounded = chars.length > 24 ? chars.slice(0, 24).join("") : cleaned
  if (bounded.trim().length === 0) return WINNER_FALLBACK_NAME

  return bounded
}

/**
 * Defensively map a raw `winners_feed` row to a WinnerSnapshot.
 * Optional fields are only populated when the response already supplies a
 * recognised value with the correct type; otherwise they are null/undefined.
 * No values are invented.
 */
export function mapWinnerRow(row: any): WinnerSnapshot {
  const fulfilmentRaw = row?.fulfilment_type
  const fulfilmentType: FulfilmentType | null =
    fulfilmentRaw === "cash" || fulfilmentRaw === "wallet_credit" || fulfilmentRaw === "manual"
      ? fulfilmentRaw
      : null

  const prizeValuePence =
    typeof row?.prize_value_pence === "number" && Number.isFinite(row.prize_value_pence)
      ? row.prize_value_pence
      : null

  const prizeValueText =
    typeof row?.prize_value_text === "string" && row.prize_value_text.trim().length > 0
      ? row.prize_value_text.trim()
      : null

  const campaignFormat =
    typeof row?.campaign_format === "string" && row.campaign_format.trim().length > 0
      ? row.campaign_format.trim()
      : null

  const avatarUrl =
    typeof row?.avatar_url === "string" && row.avatar_url.trim().length > 0 ? row.avatar_url.trim() : undefined

  const feedId =
    typeof row?.feed_id === "string" && row.feed_id.trim().length > 0 ? row.feed_id.trim() : null

  return {
    name: formatWinnerFirstName(row?.display_name),
    prizeTitle: row?.prize_title || "Prize",
    giveawayTitle: row?.campaign_title || "",
    giveawaySlug: row?.campaign_slug || undefined,
    announcedAt: row?.happened_at || new Date().toISOString(),
    kind: row?.kind === "main" ? "main" : "instant",
    feedId,
    fulfilmentType,
    prizeValuePence,
    prizeValueText,
    campaignFormat,
    avatarUrl,
  }
}

/** Format a pence amount as GBP with thousands grouping, trimming ".00". */
export function formatGBP(pence: number): string {
  const value = pence / 100
  const formatted = value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `£${formatted.replace(/\.00$/, "")}`
}

/**
 * A valid formatted prize amount when one is supplied, otherwise null.
 * Prefers a numeric pence value; falls back to a supplied text value.
 */
export function formatPrizeAmount(w: WinnerSnapshot): string | null {
  if (typeof w.prizeValuePence === "number" && Number.isFinite(w.prizeValuePence) && w.prizeValuePence > 0) {
    return formatGBP(w.prizeValuePence)
  }
  if (w.prizeValueText && w.prizeValueText.trim().length > 0) {
    return w.prizeValueText.trim()
  }
  return null
}

/** Broad category used for filtering and styling. Unknown/manual → "other". */
export function classifyFulfilment(w: WinnerSnapshot): FulfilmentCategory {
  if (w.fulfilmentType === "cash") return "cash"
  if (w.fulfilmentType === "wallet_credit") return "wallet_credit"
  return "other"
}

/**
 * The main (largest) prize label.
 * Fallback order: valid formatted amount → real prizeTitle → "Prize".
 */
export function getPrizeDisplayTitle(w: WinnerSnapshot): string {
  const amount = formatPrizeAmount(w)

  if (w.fulfilmentType === "wallet_credit") {
    return amount ? `${amount} WTF Credit` : realTitleOrFallback(w)
  }
  if (w.fulfilmentType === "cash") {
    return amount ?? realTitleOrFallback(w)
  }
  // manual / unknown / missing → never guess; show the real title.
  return realTitleOrFallback(w)
}

function realTitleOrFallback(w: WinnerSnapshot): string {
  return w.prizeTitle && w.prizeTitle.trim().length > 0 ? w.prizeTitle.trim() : "Prize"
}

/** The neutral, human-readable fulfilment badge. */
export function getFulfilmentBadge(w: WinnerSnapshot): { label: string; category: FulfilmentCategory } {
  const category = classifyFulfilment(w)
  if (category === "wallet_credit") return { label: "WTF Credit", category }
  if (category === "cash") return { label: "Cash Prize", category }
  return { label: "Prize", category }
}

/**
 * A stable, deterministic key used to de-duplicate rows across pages.
 *
 * Prefers the real per-row identity `feedId` ('main:<uuid>' / 'instant:<uuid>'),
 * so two genuinely separate awards that happen to share the same timestamp,
 * first name AND prize title are NEVER collapsed into one — the old
 * `announcedAt|name|prizeTitle` key silently dropped such rows. `feedId` is
 * unique per award/winner-record and present on every live row; the composite
 * is only a fallback for mock rows that carry no feed id.
 */
export function winnerKey(w: WinnerSnapshot): string {
  if (typeof w.feedId === "string" && w.feedId.length > 0) return w.feedId
  return `${w.announcedAt}|${w.name}|${w.prizeTitle}`
}

/**
 * Encode a deterministic pagination cursor from the last row of a page.
 * The cursor carries BOTH ordering keys (`happened_at` and the stable
 * `feed_id`) so the next page can resume exactly, even across a run of rows
 * that share the same `happened_at`. Returns null when the row lacks a feedId
 * (mock data) — callers then simply stop paginating.
 */
export function encodeWinnersCursor(w: WinnerSnapshot): string | null {
  if (typeof w.feedId !== "string" || w.feedId.length === 0) return null
  return `${w.announcedAt}~${w.feedId}`
}

/** Decode a cursor produced by `encodeWinnersCursor`. Null when malformed. */
export function decodeWinnersCursor(
  cursor: string | null | undefined,
): { happenedAt: string; feedId: string } | null {
  if (typeof cursor !== "string" || cursor.length === 0) return null
  const sep = cursor.indexOf("~")
  if (sep <= 0 || sep >= cursor.length - 1) return null
  const happenedAt = cursor.slice(0, sep)
  const feedId = cursor.slice(sep + 1)
  if (Number.isNaN(Date.parse(happenedAt))) return null
  return { happenedAt, feedId }
}

/**
 * Apply deterministic keyset pagination to a `winners_feed` PostgREST query:
 * order by `happened_at DESC, feed_id DESC`, and (when a cursor is supplied)
 * return only rows strictly AFTER it, i.e.
 *   happened_at < cursor.happenedAt
 *   OR (happened_at = cursor.happenedAt AND feed_id < cursor.feedId)
 *
 * The tie-breaker on the stable `feed_id` is what makes identical timestamps
 * safe: no winner sharing a timestamp with the page boundary is ever skipped
 * or duplicated. Shared by the initial load and `/api/winners` so ordering can
 * never drift. `query` is a PostgREST builder; typed as `any` because the
 * Supabase filter-builder generic is not worth threading through here.
 */
export function applyWinnersKeyset<T>(query: T, cursor: { happenedAt: string; feedId: string } | null): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any
  q = q.order("happened_at", { ascending: false }).order("feed_id", { ascending: false })
  if (cursor) {
    // PostgREST "or" with a compound AND expresses the keyset predicate. Values
    // are interpolated into the filter string; `happened_at` is a validated ISO
    // timestamp and `feed_id` is a server-issued 'kind:<uuid>' token, so
    // neither can contain the parentheses/commas that would break the grammar.
    q = q.or(
      `happened_at.lt.${cursor.happenedAt},and(happened_at.eq.${cursor.happenedAt},feed_id.lt.${cursor.feedId})`,
    )
  }
  return q as T
}
