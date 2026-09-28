/**
 * Admin Schedule module - shared types, vocabularies and validation.
 *
 * This module is deliberately self-contained: it imports nothing from campaigns,
 * hosts, tickets, payments or draws. The Schedule is a manual planning calendar
 * and must never derive its values from a live system (spec s2 / s9 / s19).
 *
 * The vocabularies here MUST stay in step with the CHECK constraints in
 * scripts/009-admin-schedule-events.sql.
 */

export const EVENT_TYPES = [
  'balloon_pop',
  'instant_win',
  'cash',
  'competition_launch',
  'tiktok_live',
  'final_draw',
  'other',
] as const

export type ScheduleEventType = (typeof EVENT_TYPES)[number]

export const EVENT_STATUSES = ['idea', 'planned', 'confirmed'] as const

export type ScheduleEventStatus = (typeof EVENT_STATUSES)[number]

/** Singular label, used in forms and day detail. */
export const EVENT_TYPE_LABELS: Record<ScheduleEventType, string> = {
  balloon_pop: 'Balloon Pop',
  instant_win: 'Instant Win',
  cash: 'Cash',
  competition_launch: 'Competition Launch',
  tiktok_live: 'TikTok Live',
  final_draw: 'Final Draw',
  other: 'Other',
}

/** Plural label, used by filter chips and the month summary (spec s10 / s21). */
export const EVENT_TYPE_PLURAL: Record<ScheduleEventType, string> = {
  balloon_pop: 'Balloon Pops',
  instant_win: 'Instant Wins',
  cash: 'Cash',
  competition_launch: 'Launches',
  tiktok_live: 'TikTok Lives',
  final_draw: 'Final Draws',
  other: 'Other',
}

export const EVENT_STATUS_LABELS: Record<ScheduleEventStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  confirmed: 'Confirmed',
}

/**
 * Category colours (spec s12). Kept as explicit Tailwind class strings rather
 * than interpolated names so Tailwind's scanner can see every one of them.
 *
 * Balloon Pop keeps WTF pink as its category marker; the module chrome itself
 * uses the admin's violet --brand token.
 */
export interface EventTypeStyle {
  /** Small solid dot in calendar cells. */
  dot: string
  /** Tinted chip used in day detail and cell labels. */
  chip: string
}

export const EVENT_TYPE_STYLES: Record<ScheduleEventType, EventTypeStyle> = {
  balloon_pop: {
    dot: 'bg-pink-500',
    chip: 'bg-pink-50 text-pink-700 border-pink-200',
  },
  instant_win: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  cash: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  competition_launch: {
    dot: 'bg-blue-500',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  tiktok_live: {
    dot: 'bg-red-500',
    chip: 'bg-red-50 text-red-700 border-red-200',
  },
  final_draw: {
    dot: 'bg-purple-500',
    chip: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  other: {
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-700 border-slate-200',
  },
}

/** The shape the API returns and the UI consumes. */
export interface ScheduleEvent {
  id: string
  title: string
  eventType: ScheduleEventType
  /** ISO calendar date, YYYY-MM-DD. Never a timestamp. */
  scheduledDate: string
  /** HH:MM, or null when allDay is true. */
  scheduledTime: string | null
  allDay: boolean
  status: ScheduleEventStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isEventType(value: unknown): value is ScheduleEventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value)
}

export function isEventStatus(value: unknown): value is ScheduleEventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Validate a YYYY-MM-DD string AND confirm it is a real calendar date, so
 * 2026-02-31 is rejected rather than silently rolling over into March.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  )
}

/** HH:MM in 24-hour form. Accepts the HH:MM:SS Postgres may hand back. */
export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value.slice(0, 5)) && value.length >= 5
}

// ---------------------------------------------------------------------------
// Input validation (spec s36)
// ---------------------------------------------------------------------------

export const MAX_TITLE_LENGTH = 120
export const MAX_NOTES_LENGTH = 2000

export interface ScheduleEventInput {
  title: string
  event_type: ScheduleEventType
  scheduled_date: string
  scheduled_time: string | null
  all_day: boolean
  status: ScheduleEventStatus
  notes: string | null
}

export type ValidationResult =
  | { ok: true; value: ScheduleEventInput }
  | { ok: false; error: string }

/**
 * Validate and normalise an untrusted event payload.
 *
 * Deliberately strict about the all-day/time pairing so the DB CHECK constraint
 * can never be the first thing to reject a save: an all-day event has its time
 * cleared rather than being rejected for also sending one.
 */
export function validateScheduleEventInput(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'invalid_payload' }
  }
  const raw = body as Record<string, unknown>

  if (typeof raw.title !== 'string') return { ok: false, error: 'invalid_title' }
  const title = raw.title.trim()
  if (title.length === 0) return { ok: false, error: 'title_required' }
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: 'title_too_long' }

  if (!isEventType(raw.eventType)) return { ok: false, error: 'invalid_event_type' }
  if (!isCalendarDate(raw.scheduledDate)) return { ok: false, error: 'invalid_date' }
  if (!isEventStatus(raw.status)) return { ok: false, error: 'invalid_status' }

  const allDay = raw.allDay === true

  // Time is required unless All Day (spec s36).
  let scheduledTime: string | null = null
  if (!allDay) {
    if (!isClockTime(raw.scheduledTime)) return { ok: false, error: 'time_required' }
    scheduledTime = (raw.scheduledTime as string).slice(0, 5)
  }

  let notes: string | null = null
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== 'string') return { ok: false, error: 'invalid_notes' }
    const trimmed = raw.notes.trim()
    if (trimmed.length > MAX_NOTES_LENGTH) return { ok: false, error: 'notes_too_long' }
    notes = trimmed.length > 0 ? trimmed : null
  }

  return {
    ok: true,
    value: {
      title,
      event_type: raw.eventType,
      scheduled_date: raw.scheduledDate,
      scheduled_time: scheduledTime,
      all_day: allDay,
      status: raw.status,
      notes,
    },
  }
}

/** Human-readable copy for the error codes the API returns (spec s35). */
export const SCHEDULE_ERROR_COPY: Record<string, string> = {
  invalid_payload: 'That event could not be read. Please check the form and try again.',
  invalid_title: 'Please enter a title.',
  title_required: 'Please enter a title.',
  title_too_long: `Titles must be ${MAX_TITLE_LENGTH} characters or fewer.`,
  invalid_event_type: 'Please choose an event type.',
  invalid_date: 'Please choose a valid date.',
  invalid_status: 'Please choose a status.',
  time_required: 'Please set a time, or mark the event as All Day.',
  invalid_notes: 'Those notes could not be saved.',
  notes_too_long: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
  invalid_identifier: 'That event could not be found.',
  invalid_range: 'That date range could not be read.',
  range_too_large: 'Please view a smaller date range.',
  not_found: 'That event no longer exists. It may have been deleted.',
  load_failed: "Couldn't load schedule. Try again.",
  save_failed: "Couldn't save this event.",
  delete_failed: "Couldn't delete this event.",
}

export function scheduleErrorCopy(code: string | null | undefined): string {
  if (!code) return 'Something went wrong. Please try again.'
  return SCHEDULE_ERROR_COPY[code] ?? 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------------------
// Calendar helpers (pure, timezone-safe)
// ---------------------------------------------------------------------------

/**
 * All dates here are handled as plain YYYY-MM-DD strings built from UTC parts.
 * Using local-time Date parsing would shift a date across a day boundary for
 * admins in a negative-offset timezone, which would silently file an event on
 * the wrong day.
 */
export function toDateKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Inclusive first/last date of a month, as YYYY-MM-DD. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))
  return { from: toDateKey(first), to: toDateKey(last) }
}

/**
 * The Monday-Sunday grid covering a month (spec s11). Always returns whole
 * weeks, so leading/trailing days belong to the adjacent months.
 */
export function monthGridDays(year: number, month: number): Date[] {
  const first = new Date(Date.UTC(year, month, 1))
  // getUTCDay(): 0=Sun..6=Sat. Convert so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month, 1 - leading))

  const days: Date[] = []
  const cursor = new Date(start)
  // Six weeks always covers any month/offset combination.
  for (let i = 0; i < 42; i += 1) {
    days.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // Trim any trailing week that belongs entirely to the next month, so a month
  // needing only 4 or 5 rows does not render an empty final week. Guard on
  // length > 7 rather than > 35 so a 28-day month starting on a Monday
  // (e.g. Feb 2021) collapses to exactly 4 rows.
  while (days.length > 7 && days[days.length - 7].getUTCMonth() !== month) {
    days.splice(days.length - 7, 7)
  }
  return days
}

/** 12-hour display used across the calendar, e.g. "8:00 PM". */
export function formatEventTime(time: string | null, allDay: boolean): string {
  if (allDay || !time) return 'All Day'
  const [hh, mm] = time.slice(0, 5).split(':').map(Number)
  const period = hh >= 12 ? 'PM' : 'AM'
  const hour = hh % 12 === 0 ? 12 : hh % 12
  return `${hour}:${String(mm).padStart(2, '0')} ${period}`
}

/** Sort by time, all-day first, then title. Used for in-day ordering (spec s13). */
export function compareEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  const at = a.scheduledTime ?? ''
  const bt = b.scheduledTime ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return a.title.localeCompare(b.title)
}
