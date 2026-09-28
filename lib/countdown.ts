// Pure, framework-agnostic deadline formatting shared by the giveaway cards.
// Produces concise, human-readable wording (never a long live countdown):
//   "Ended", "Ends Today", "Ends Tomorrow", "Ends in 6 days".
// Keeping it deterministic and free of `Date.now()` lets callers pass an
// explicit `nowMs` when they need to.

export interface DeadlineDisplay {
  /** Human label, e.g. "Ends in 6 days", "Ends Tomorrow", or "Ended". */
  label: string
  /** True when the giveaway has finished. */
  ended: boolean
}

// Calendar day (Y-M-D) for a timestamp evaluated in Europe/London.
function londonYMD(ms: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get("year"), m: get("month"), d: get("day") }
}

// Whole-calendar-day difference (end - now) using Europe/London dates.
function londonCalendarDayDiff(nowMs: number, endMs: number): number {
  const a = londonYMD(nowMs)
  const b = londonYMD(endMs)
  const aUTC = Date.UTC(a.y, a.m - 1, a.d)
  const bUTC = Date.UTC(b.y, b.m - 1, b.d)
  return Math.round((bUTC - aUTC) / (1000 * 60 * 60 * 24))
}

/**
 * Concise deadline wording.
 *  - invalid / <= now  -> "Ended"
 *  - same calendar day  -> "Ends Today"
 *  - next calendar day  -> "Ends Tomorrow"
 *  - otherwise          -> "Ends in N days"
 */
export function deadlineLabel(endsAtMs: number, nowMs: number): DeadlineDisplay {
  if (!Number.isFinite(endsAtMs) || endsAtMs - nowMs <= 0) {
    return { label: "Ended", ended: true }
  }
  const days = londonCalendarDayDiff(nowMs, endsAtMs)
  if (days <= 0) return { label: "Ends Today", ended: false }
  if (days === 1) return { label: "Ends Tomorrow", ended: false }
  return { label: `Ends in ${days} days`, ended: false }
}

/* --------------------------- hero urgency (compact) ------------------------ */

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export type HeroUrgencyTier = "days" | "tomorrow" | "today" | "soon" | "ended"

export interface HeroUrgency {
  /** Coarse state, useful for styling/tests. */
  tier: HeroUrgencyTier
  /** Human label, e.g. "Ends in 4 days", "Ends today · 11:59pm", "Ends in 42 minutes". */
  label: string
  /** True once the deadline has passed — callers should hide the urgency row. */
  ended: boolean
  /**
   * Suggested delay (ms) until the label should be recomputed, or null when the
   * label is effectively static and no timer is needed. This keeps the Featured
   * hero from running a permanent one-second interval:
   *   - ended  -> null (stop the timer)
   *   - days   -> ms until the next Europe/London midnight (one update per day)
   *   - today/tomorrow -> coarse (~1 min) so it can step down into the final hour
   *   - soon   -> next whole-minute boundary (the only genuinely ticking state)
   */
  refreshMs: number | null
}

// Europe/London wall-clock time-of-day, e.g. "9:00pm" / "11:59pm" / "12:00am".
function londonTimeOfDay(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms))
  const hour = parts.find((p) => p.type === "hour")?.value ?? ""
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "")
    .toLowerCase()
    .replace(/[\s.]/g, "")
  return `${hour}:${minute}${period}`
}

// ms from `nowMs` until the next Europe/London midnight (DST-safe: derived from
// the London wall-clock, not a fixed GMT/BST offset).
function msUntilNextLondonMidnight(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs))
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  let h = num("hour")
  if (h === 24) h = 0 // some environments emit "24" at midnight
  const elapsed = (h * 3600 + num("minute") * 60 + num("second")) * 1000 + (nowMs % 1000)
  return Math.max(1000, DAY_MS - elapsed)
}

/**
 * Compact, sales-first urgency wording for the Featured hero. Deterministic
 * given `nowMs`, so it is fully testable. Numeric remaining duration uses the
 * absolute `endsAtMs - nowMs`; day/time wording uses Europe/London.
 *
 * It can NEVER render an all-zero countdown: once the deadline is reached it
 * returns the `ended` state (the hero hides the row) rather than "Ends in 0
 * minutes" or "0 DAYS 00 HRS ...".
 */
export function heroUrgency(endsAtMs: number, nowMs: number): HeroUrgency {
  const remaining = endsAtMs - nowMs
  if (!Number.isFinite(endsAtMs) || remaining <= 0) {
    return { tier: "ended", label: "Ended", ended: true, refreshMs: null }
  }

  // Final hour: genuine ticking urgency, whole-minute wording (never "0 minutes").
  if (remaining < HOUR_MS) {
    const minutes = Math.max(1, Math.ceil(remaining / MINUTE_MS))
    const toBoundary = remaining % MINUTE_MS
    return {
      tier: "soon",
      label: `Ends in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
      ended: false,
      // Step down at the next whole-minute boundary; floored so we never spin.
      refreshMs: Math.min(MINUTE_MS, Math.max(1000, toBoundary || MINUTE_MS)),
    }
  }

  const days = londonCalendarDayDiff(nowMs, endsAtMs)
  if (days <= 0) {
    return {
      tier: "today",
      label: `Ends today · ${londonTimeOfDay(endsAtMs)}`,
      ended: false,
      refreshMs: MINUTE_MS,
    }
  }
  if (days === 1) {
    return {
      tier: "tomorrow",
      label: `Ends tomorrow · ${londonTimeOfDay(endsAtMs)}`,
      ended: false,
      refreshMs: MINUTE_MS,
    }
  }
  return {
    tier: "days",
    label: `Ends in ${days} days`,
    ended: false,
    refreshMs: msUntilNextLondonMidnight(nowMs),
  }
}
