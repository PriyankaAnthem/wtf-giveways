/**
 * Small, shared presentation helpers for the admin Customers area.
 *
 * These are pure formatting utilities (money in pence -> GBP, ISO timestamps ->
 * localised strings). They contain no business logic and never mutate data.
 */

/** £x.xx from an integer number of pence. */
export function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * £x.xx, but drops the pence when the amount is a whole number of pounds
 * (e.g. 10000 -> "£100", 12550 -> "£125.50"). Used for compact winnings
 * headlines where "£100 cash" reads better than "£100.00 cash".
 */
export function formatPenceCompact(pence: number): string {
  const pounds = pence / 100
  const whole = pence % 100 === 0
  return `£${pounds.toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

/** Locale-formatted integer count, e.g. 2000 -> "2,000". Never scientific. */
export function formatCount(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
  return safe.toLocaleString("en-GB")
}

/** Short date, e.g. "8 Aug 2026". Returns "—" for missing/invalid input. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** Date + time, e.g. "8 Aug 2026, 14:30". Returns "—" for missing/invalid input. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Compact day + time for the winners feed, e.g. "8 Aug · 18:04". Returns "—"
 *  for missing/invalid input. Uses 24h time and omits the year for recency. */
export function formatDayTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
  return `${day} · ${time}`
}

/**
 * Human "time ago" for the winners feed, e.g. "just now", "5 mins ago",
 * "3 hours ago", "2 days ago". For anything older than ~6 days it falls back to
 * the absolute day so the label never becomes vague. Computed once at render
 * (no timers/subscriptions — the feed does not auto-tick).
 */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const diffMs = now - d.getTime()
  if (diffMs < 0) return "just now"
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  if (days <= 6) return `${days} day${days === 1 ? "" : "s"} ago`
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/* ============================================================================
 * ACCOUNT RESTRICTIONS
 * ==========================================================================*/

/**
 * The provenance of an account restriction (the `source` column on
 * `public.account_restrictions`). Only these three values exist in the live
 * contract; `admin` exclusions are the only ones an administrator may revoke.
 */
export type RestrictionSource = "admin" | "customer" | "support"

/** Human-friendly labels for a restriction source. */
export const RESTRICTION_SOURCE_LABELS: Record<RestrictionSource, string> = {
  admin: "Admin",
  support: "Support",
  customer: "Customer",
}

/** Safe source label for any (possibly unknown) stored value. */
export function restrictionSourceLabel(source: string | null | undefined): string {
  if (source === "admin" || source === "support" || source === "customer") {
    return RESTRICTION_SOURCE_LABELS[source]
  }
  return "Unknown"
}

/** The fields any customer-shaped record may expose for name resolution. */
export type CustomerNameParts = {
  first_name?: string | null
  last_name?: string | null
  display_name?: string | null
  real_name?: string | null
  email?: string | null
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * THE single source of truth for a customer's primary display name.
 *
 * Priority (per spec):
 *   1. first_name + last_name
 *   2. first_name
 *   3. last_name
 *   4. display_name
 *   5. real_name          (often username-style noise, so it ranks low)
 *   6. email local-part
 *   7. "Unknown customer"
 *
 * Genuine supplied names always win over `display_name` nicknames and
 * `real_name` handles. Used by BOTH the list and the detail view — never
 * duplicate this logic.
 */
export function resolveCustomerName(parts: CustomerNameParts): string {
  const first = clean(parts.first_name)
  const last = clean(parts.last_name)
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last

  const display = clean(parts.display_name)
  if (display) return display

  const real = clean(parts.real_name)
  if (real) return real

  const email = clean(parts.email)
  if (email && email.includes("@")) {
    const local = email.split("@")[0]
    if (local) return local
  }

  return "Unknown customer"
}

/**
 * Presentational initials for an avatar chip, derived from the already-resolved
 * display name. "Ellie Thomas" -> "ET", "Taiba" -> "TA", "Unknown customer" ->
 * "?". Purely visual — no image fetching, no extra requests.
 */
export function getInitials(name: string): string {
  const cleaned = clean(name)
  if (!cleaned || cleaned === "Unknown customer") return "?"
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * A secondary handle (real_name / display_name) is only worth showing beneath
 * the primary name when it adds information and is NOT username-style noise.
 *
 * "Noise" = handles like `elliemaythom2709`, `absfactor`, `kyemakd9`: no
 * whitespace and containing a digit, or an email-local shape. These clutter the
 * list, so we omit them entirely rather than print them under every row.
 */
export function isLikelyHandleNoise(value: string | null | undefined): boolean {
  const v = clean(value)
  if (!v) return true
  if (v.includes("@")) return true // email-ish
  const hasSpace = /\s/.test(v)
  const hasDigit = /\d/.test(v)
  // A single lowercase token with digits (or one long lowercase token) reads as
  // a username, not a person's name.
  if (!hasSpace && hasDigit) return true
  if (!hasSpace && v === v.toLowerCase() && v.length > 3) return true
  return false
}

/**
 * The optional secondary line for a customer row. Returns a non-noise handle
 * that differs from the already-shown primary name, else null (omit the line).
 */
export function resolveSecondaryHandle(parts: CustomerNameParts, primary: string): string | null {
  const candidates = [clean(parts.display_name), clean(parts.real_name)]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate === primary) continue
    if (isLikelyHandleNoise(candidate)) continue
    return candidate
  }
  return null
}

/**
 * DISPLAY-ONLY formatting of a stored UK mobile number for readability.
 * Never mutates or persists anything.
 *   07786144708  -> "07786 144708"
 * Anything that is not a plain 11-digit 07xxxxxxxxx number is returned
 * unchanged (international / unusual formats stay verbatim and safe).
 */
export function formatUkMobile(raw: string | null | undefined): string {
  const v = clean(raw)
  if (!v) return ""
  const digits = v.replace(/\s+/g, "")
  if (/^07\d{9}$/.test(digits)) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`
  }
  return v
}

/**
 * Renders an allocated ticket range as a compact label:
 *  - single ticket:  "17996"
 *  - range:          "14984–14989"
 *  - unknown:        "—"
 * Never expands the range into individual numbers.
 */
export function formatTicketRange(start: number | null, end: number | null): string {
  if (start === null && end === null) return "—"
  if (start !== null && end !== null) {
    return start === end ? `${start}` : `${start}–${end}`
  }
  const only = start ?? end
  return only === null ? "—" : `${only}`
}

/* ============================================================================
 * WINNINGS
 * ==========================================================================*/

/**
 * The winnings totals returned by admin_list_customers_v3 (list) — used to
 * build the compact winnings zone on each customer row without any extra
 * request. Cash and site-credit values are ALWAYS kept separate; they are
 * never summed into a single "total won" figure (§11).
 */
export type CustomerWinningsParts = {
  total_win_count: number
  main_draw_win_count: number
  instant_win_count: number
  cash_win_count: number
  site_credit_win_count: number
  cash_won_pence: number
  site_credit_won_pence: number
}

/**
 * Builds the compact, human winnings summary for a customer LIST row.
 * Returns null when the customer has no wins (caller shows "No wins" / "—").
 *
 * - headline:  e.g. "3 wins" (locale-formatted, handles 2,000+)
 * - money:     e.g. "£100 cash · £5 credit"  (kinds kept separate, never summed)
 * - draws:     e.g. "+ 1 draw"               (count only — draws have NO
 *                                              canonical monetary value, §11)
 */
export function buildListWinningsSummary(
  w: CustomerWinningsParts,
): { headline: string; money: string | null; draws: string | null } | null {
  if (!w.total_win_count || w.total_win_count <= 0) return null

  const headline = `${formatCount(w.total_win_count)} ${w.total_win_count === 1 ? "win" : "wins"}`

  const moneyParts: string[] = []
  if (w.cash_won_pence > 0) moneyParts.push(`${formatPenceCompact(w.cash_won_pence)} cash`)
  if (w.site_credit_won_pence > 0) moneyParts.push(`${formatPenceCompact(w.site_credit_won_pence)} credit`)
  const money = moneyParts.length > 0 ? moneyParts.join(" · ") : null

  const draws =
    w.main_draw_win_count > 0
      ? `+ ${formatCount(w.main_draw_win_count)} ${w.main_draw_win_count === 1 ? "draw" : "draws"}`
      : null

  return { headline, money, draws }
}

/** A single winnings-history record as returned by admin_get_customer_winnings. */
export type WinRecord = {
  win_kind: string | null
  record_id: string | null
  occurred_at: string | null
  campaign_id: string | null
  campaign_title: string | null
  prize_title: string | null
  prize_value_pence: number | null
  fulfilment_type: string | null
  winning_ticket: number | null
  is_paid: boolean
  paid_at: string | null
  fulfilled_at: string | null
  payout_amount_pence: number | null
  checkout_intent_id: string | null
  placed: number | null
}

export type WinStatusTone = "paid" | "awaiting" | "credited" | "pending" | "fulfilled" | "draw" | "neutral"

/**
 * THE single source of truth for a win's operational status label (§30).
 *
 * CRITICAL: `is_paid` is NOT a universal fulfilment flag. A wallet_credit award
 * is CREDITED once `fulfilled_at` is populated even though `is_paid` is false.
 *
 *   cash          + is_paid true            -> PAID
 *   cash          + is_paid false           -> AWAITING PAYOUT
 *   wallet_credit + fulfilled_at present    -> CREDITED
 *   wallet_credit + fulfilled_at null       -> PENDING
 *   manual        + fulfilled_at present    -> FULFILLED
 *   manual        + fulfilled_at null       -> PENDING
 *   main_draw (win_kind)                    -> DRAW WIN   (never infer payout)
 */
export function resolveWinStatus(win: {
  win_kind?: string | null
  fulfilment_type?: string | null
  is_paid?: boolean
  fulfilled_at?: string | null
}): { label: string; tone: WinStatusTone } {
  if (win.win_kind === "main_draw") return { label: "Draw win", tone: "draw" }

  switch (win.fulfilment_type) {
    case "cash":
      return win.is_paid ? { label: "Paid", tone: "paid" } : { label: "Awaiting payout", tone: "awaiting" }
    case "wallet_credit":
      return win.fulfilled_at ? { label: "Credited", tone: "credited" } : { label: "Pending", tone: "pending" }
    case "manual":
      return win.fulfilled_at ? { label: "Fulfilled", tone: "fulfilled" } : { label: "Pending", tone: "pending" }
    default:
      return { label: "—", tone: "neutral" }
  }
}

/**
 * The prize headline for a winnings-history row.
 * - instant cash / credit: use the numeric prize value ONLY when present,
 *   suffixed with the kind ("£100 cash" / "£5 credit").
 * - main draw: fall back to the prize/campaign title text. We NEVER fabricate a
 *   numeric value for a draw when prize_value_pence is null (§11 / §29).
 */
export function resolveWinPrizeLabel(win: WinRecord): string {
  const hasValue = typeof win.prize_value_pence === "number" && win.prize_value_pence > 0

  if (win.win_kind === "main_draw") {
    // Draw prizes may carry the amount in the title text; use it verbatim.
    return clean(win.prize_title) || clean(win.campaign_title) || "Draw win"
  }

  if (hasValue) {
    const money = formatPenceCompact(win.prize_value_pence as number)
    if (win.fulfilment_type === "cash") return `${money} cash`
    if (win.fulfilment_type === "wallet_credit") return `${money} credit`
    return money
  }

  return clean(win.prize_title) || "Prize"
}
