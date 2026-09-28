/**
 * Competition deadline overlay - shared types and pure helpers.
 *
 * This is Layer B of the Sales Calendar (the read-only campaign deadline
 * overlay). It is deliberately kept SEPARATE from lib/types/schedule.ts so the
 * manual Schedule module keeps its "imports nothing from campaigns" isolation
 * guarantee. Nothing here is ever persisted; these markers are generated at
 * read/render time from live campaign data.
 *
 * All calendar helpers here are self-contained (no import from the schedule
 * module) and timezone-aware in Europe/London, because campaign end_at is a
 * real timestamptz, unlike the timezone-naive manual Schedule dates.
 */

/** Only non-TikTok live categories ever appear as automatic deadlines. */
export type DeadlineClassification = 'instant_cash' | 'other'

/**
 * A synthetic, read-only calendar marker for one live competition's closing.
 *
 * Structurally distinct from a manual ScheduleEvent (note `source: 'campaign'`
 * and the absence of any editable id/status/notes shape) so the two layers can
 * never be confused at render time.
 */
export interface CompetitionDeadline {
  source: 'campaign'
  campaignId: string
  slug: string
  title: string
  classification: DeadlineClassification
  /** YYYY-MM-DD in Europe/London (NOT UTC). */
  endDate: string
  /** HH:MM 24h in Europe/London. */
  endTime: string
  /** Original ISO instant, for reference/debugging. */
  endAt: string
  ticketPricePence: number | null
  maxTickets: number | null
  ticketsSold: number | null
  ticketsRemaining: number | null
  /** Integer 0-100, or null when a cap/sold count is unavailable. */
  percentSold: number | null
  /** ticketsRemaining x ticketPricePence, in pence. Face-value opportunity only. */
  potentialRemainingPence: number | null
  /** Deep link into the existing campaign admin editor. */
  adminUrl: string
}

export type DeadlineUrgency = 'today' | 'tomorrow' | 'soon' | 'later'

// ---------------------------------------------------------------------------
// Commercial metric derivation (pure, snapshot-fallback safe)
// ---------------------------------------------------------------------------

export interface DeadlineMetrics {
  ticketsSold: number | null
  ticketsRemaining: number | null
  percentSold: number | null
  potentialRemainingPence: number | null
}

/**
 * Derive the display metrics for a deadline from whatever is safely available.
 *
 * Snapshot data may be absent, missing `tickets_sold`, or uncapped. In every
 * such case we OMIT (null) rather than invent a misleading 0/0/£0:
 *   - no sold count            -> everything null (card still renders)
 *   - no positive cap          -> remaining/percent/potential null
 *   - no ticket price          -> potential null (percent/remaining still shown)
 * potentialRemainingPence is face value only ("Potential remaining"), never
 * treated as revenue.
 */
export function deriveDeadlineMetrics(input: {
  ticketsSold: number | null
  maxTickets: number | null
  ticketPricePence: number | null
}): DeadlineMetrics {
  const sold = input.ticketsSold
  if (sold == null) {
    return {
      ticketsSold: null,
      ticketsRemaining: null,
      percentSold: null,
      potentialRemainingPence: null,
    }
  }

  const metrics: DeadlineMetrics = {
    ticketsSold: sold,
    ticketsRemaining: null,
    percentSold: null,
    potentialRemainingPence: null,
  }

  if (input.maxTickets != null && input.maxTickets > 0) {
    const remaining = Math.max(input.maxTickets - sold, 0)
    metrics.ticketsRemaining = remaining
    metrics.percentSold = Math.min(100, Math.round((sold / input.maxTickets) * 100))
    if (input.ticketPricePence != null) {
      metrics.potentialRemainingPence = remaining * input.ticketPricePence
    }
  }

  return metrics
}

// ---------------------------------------------------------------------------
// Europe/London timezone conversion
// ---------------------------------------------------------------------------

const LONDON_TZ = 'Europe/London'

// hourCycle h23 so midnight is "00", never "24". Reused across calls.
const londonFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Convert a real instant (ISO timestamptz) to its Europe/London calendar date
 * and wall-clock time. This is the single point where BST/GMT is resolved -
 * Intl applies the correct offset for the instant, so a late-evening UK closing
 * lands on the correct UK date without any hard-coded offset.
 *
 * Returns null for an unparseable/empty input.
 */
export function londonParts(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null

  const parts = londonFormatter.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  const year = get('year')
  const month = get('month')
  const day = get('day')
  let hour = get('hour')
  const minute = get('minute')
  if (!year || !month || !day || hour == null || minute == null) return null
  if (hour === '24') hour = '00'

  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` }
}

/** Europe/London "today" as YYYY-MM-DD. Used for urgency + week membership. */
export function londonTodayKey(now: Date = new Date()): string {
  return londonParts(now.toISOString())?.date ?? isoDateKeyUtc(now)
}

// ---------------------------------------------------------------------------
// Pure calendar helpers (self-contained, Monday-first weeks)
// ---------------------------------------------------------------------------

function isoDateKeyUtc(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseKey(dateKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateKey.split('-').map(Number)
  return { y, m, d }
}

/** Whole days from `fromKey` to `toKey` (negative if `toKey` is earlier). */
export function dayDiff(fromKey: string, toKey: string): number {
  const a = parseKey(fromKey)
  const b = parseKey(toKey)
  const au = Date.UTC(a.y, a.m - 1, a.d)
  const bu = Date.UTC(b.y, b.m - 1, b.d)
  return Math.round((bu - au) / 86_400_000)
}

/** Shift a YYYY-MM-DD key by `n` days, returning a new key. */
export function addDaysKey(dateKey: string, n: number): string {
  const { y, m, d } = parseKey(dateKey)
  return isoDateKeyUtc(new Date(Date.UTC(y, m - 1, d + n)))
}

/** Monday (Mon-first) that begins the week containing `dateKey`. */
export function weekStartKey(dateKey: string): string {
  const { y, m, d } = parseKey(dateKey)
  const date = new Date(Date.UTC(y, m - 1, d))
  const mondayOffset = (date.getUTCDay() + 6) % 7 // Sun=0 -> 6, Mon=1 -> 0
  return isoDateKeyUtc(new Date(Date.UTC(y, m - 1, d - mondayOffset)))
}

/** The seven YYYY-MM-DD keys of the week beginning at `weekStart` (a Monday). */
export function weekDayKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i))
}

// ---------------------------------------------------------------------------
// Urgency + display formatting
// ---------------------------------------------------------------------------

/**
 * Prioritisation, not panic: today/tomorrow are emphasised, everything else is
 * comparatively quiet. `todayKey` MUST be the Europe/London today.
 */
export function deadlineUrgency(endDate: string, todayKey: string): DeadlineUrgency {
  const diff = dayDiff(todayKey, endDate)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff <= 3) return 'soon'
  return 'later'
}

/** "11:59 PM" from "23:59". */
export function formatDeadlineClock(time: string): string {
  const [hh, mm] = time.slice(0, 5).split(':').map(Number)
  const period = hh >= 12 ? 'PM' : 'AM'
  const hour = hh % 12 === 0 ? 12 : hh % 12
  return `${hour}:${String(mm).padStart(2, '0')} ${period}`
}

const WEEKDAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** "THU" for a YYYY-MM-DD key (Monday-first index). */
export function weekdayShort(dateKey: string): string {
  const { y, m, d } = parseKey(dateKey)
  const idx = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return WEEKDAY_SHORT[idx]
}

/**
 * The short "ENDS" pill text for Closing This Week / cards:
 *   today    -> "ENDS TODAY"
 *   tomorrow -> "ENDS TOMORROW"
 *   otherwise-> "THU 8:00 PM"
 */
export function deadlinePillLabel(deadline: CompetitionDeadline, todayKey: string): string {
  const urgency = deadlineUrgency(deadline.endDate, todayKey)
  if (urgency === 'today') return 'ENDS TODAY'
  if (urgency === 'tomorrow') return 'ENDS TOMORROW'
  return `${weekdayShort(deadline.endDate)} ${formatDeadlineClock(deadline.endTime)}`
}

/** "£4,250" / "£12.50" - never labelled as revenue by the caller. */
export function formatPounds(pence: number): string {
  const pounds = pence / 100
  const hasFraction = Math.round(pounds * 100) % 100 !== 0
  return `£${pounds.toLocaleString('en-GB', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Sort soonest-closing first: by date, then wall-clock time, then title. */
export function compareDeadlines(a: CompetitionDeadline, b: CompetitionDeadline): number {
  if (a.endDate !== b.endDate) return a.endDate < b.endDate ? -1 : 1
  if (a.endTime !== b.endTime) return a.endTime < b.endTime ? -1 : 1
  return a.title.localeCompare(b.title)
}
