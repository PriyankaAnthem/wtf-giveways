import { describe, it, expect } from 'vitest'
import {
  EVENT_TYPES,
  EVENT_STATUSES,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_PLURAL,
  EVENT_STATUS_LABELS,
  EVENT_TYPE_STYLES,
  isEventType,
  isEventStatus,
  isUuid,
  isCalendarDate,
  isClockTime,
  validateScheduleEventInput,
  scheduleErrorCopy,
  SCHEDULE_ERROR_COPY,
  MAX_TITLE_LENGTH,
  MAX_NOTES_LENGTH,
  toDateKey,
  monthRange,
  monthGridDays,
  formatEventTime,
  compareEvents,
  type ScheduleEvent,
} from '@/lib/types/schedule'

/**
 * Pure logic tests for the admin Schedule module.
 *
 * The calendar grid and the validation layer are where a silent bug would be
 * most damaging: a mis-built grid files events on the wrong day, and a gap in
 * validation lets a row reach the DB CHECK constraints and fail with an opaque
 * error. Both are covered exhaustively.
 */

const ev = (over: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: over.id ?? 'e1',
  title: over.title ?? 'Event',
  eventType: over.eventType ?? 'cash',
  scheduledDate: over.scheduledDate ?? '2026-09-12',
  scheduledTime: over.scheduledTime ?? '20:00',
  allDay: over.allDay ?? false,
  status: over.status ?? 'confirmed',
  notes: over.notes ?? null,
  createdAt: over.createdAt ?? '2026-08-01T00:00:00Z',
  updatedAt: over.updatedAt ?? '2026-08-01T00:00:00Z',
})

describe('vocabularies', () => {
  it('exposes the 7 event types with complete metadata', () => {
    expect(EVENT_TYPES).toHaveLength(7)
    for (const t of EVENT_TYPES) {
      expect(EVENT_TYPE_LABELS[t], t).toBeTruthy()
      expect(EVENT_TYPE_PLURAL[t], t).toBeTruthy()
      // Every type must carry the token classes the grid and chips rely on.
      expect(EVENT_TYPE_STYLES[t].dot, t).toMatch(/^bg-/)
      expect(EVENT_TYPE_STYLES[t].chip, t).toContain('bg-')
      expect(EVENT_TYPE_STYLES[t].chip, t).toContain('text-')
    }
  })

  it('keeps WTF pink as the Balloon Pop category marker', () => {
    expect(EVENT_TYPE_STYLES.balloon_pop.dot).toContain('pink')
  })

  it('exposes the 3 statuses with labels', () => {
    expect([...EVENT_STATUSES]).toEqual(['idea', 'planned', 'confirmed'])
    for (const s of EVENT_STATUSES) {
      expect(EVENT_STATUS_LABELS[s], s).toBeTruthy()
    }
  })

  it('guards reject unknown values (the API depends on these)', () => {
    expect(isEventType('cash')).toBe(true)
    expect(isEventType('CASH')).toBe(false)
    expect(isEventType('not_a_type')).toBe(false)
    expect(isEventType(null)).toBe(false)
    expect(isEventStatus('idea')).toBe(true)
    expect(isEventStatus('live')).toBe(false)
    expect(isEventStatus(undefined)).toBe(false)
  })

  it('validates uuids', () => {
    expect(isUuid('3f4a1d2e-1b2c-4d5e-8f90-1a2b3c4d5e6f')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})

describe('isCalendarDate', () => {
  it('accepts real dates including leap days', () => {
    expect(isCalendarDate('2026-09-12')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
  })

  it('rejects impossible and malformed dates', () => {
    // 2026-02-31 would silently roll into March if parsed naively.
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('2023-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-00-10')).toBe(false)
    expect(isCalendarDate('2026-9-12')).toBe(false)
    expect(isCalendarDate('12/09/2026')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
    expect(isCalendarDate(null)).toBe(false)
  })
})

describe('isClockTime', () => {
  it('accepts HH:MM and the HH:MM:SS Postgres may return', () => {
    for (const t of ['00:00', '09:05', '20:00', '23:59', '20:00:00']) {
      expect(isClockTime(t), t).toBe(true)
    }
  })

  it('rejects out-of-range and malformed values', () => {
    for (const t of ['24:00', '20:60', '8:00', '20:0', '', 'noon']) {
      expect(isClockTime(t), t).toBe(false)
    }
  })
})

describe('monthGridDays — Monday-first, whole weeks', () => {
  const cases: Array<[number, number, string]> = [
    [2026, 8, 'Sep 2026'],
    [2026, 9, 'Oct 2026'],
    [2026, 1, 'Feb 2026'],
    [2024, 1, 'Feb 2024 leap'],
    [2021, 1, 'Feb 2021 exactly 4 weeks'],
    [2027, 7, 'Aug 2027 six rows'],
  ]

  it.each(cases)('builds a valid grid for %s/%s (%s)', (year, month) => {
    const days = monthGridDays(year, month)
    expect(days.length % 7).toBe(0)
    // Starts Monday, ends Sunday.
    expect(days[0].getUTCDay()).toBe(1)
    expect(days[days.length - 1].getUTCDay()).toBe(0)
    // Contains every day of the target month exactly once.
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const inMonth = days.filter((d) => d.getUTCMonth() === month)
    expect(inMonth).toHaveLength(daysInMonth)
    expect(new Set(inMonth.map(toDateKey)).size).toBe(daysInMonth)
    // Strictly consecutive days — no gaps, no repeats.
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(86_400_000)
    }
  })

  it('produces 6 rows when a long month starts late in the week', () => {
    expect(monthGridDays(2027, 7).length / 7).toBe(6)
  })

  it('collapses a 28-day February starting on Monday to exactly 4 rows', () => {
    // Regression guard: an over-cautious trim used to leave an empty 5th week.
    expect(monthGridDays(2021, 1).length / 7).toBe(4)
  })

  it('never renders a trailing week with no days of the month', () => {
    for (let y = 2024; y <= 2028; y += 1) {
      for (let m = 0; m < 12; m += 1) {
        const days = monthGridDays(y, m)
        const lastWeek = days.slice(days.length - 7)
        expect(
          lastWeek.some((d) => d.getUTCMonth() === m),
          `${y}-${m + 1}`,
        ).toBe(true)
      }
    }
  })
})

describe('monthRange', () => {
  it('covers the full month inclusive', () => {
    expect(monthRange(2026, 8)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthRange(2026, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange(2024, 1)).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(monthRange(2026, 11)).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
})

describe('toDateKey is timezone-safe', () => {
  it('uses UTC parts so a date never shifts across a day boundary', () => {
    expect(toDateKey(new Date(Date.UTC(2026, 8, 1)))).toBe('2026-09-01')
    // 23:00 UTC would be the previous day in a negative-offset local timezone.
    expect(toDateKey(new Date(Date.UTC(2026, 8, 12, 23, 0)))).toBe('2026-09-12')
  })
})

describe('formatEventTime', () => {
  it('renders All Day regardless of any stored time', () => {
    expect(formatEventTime(null, true)).toBe('All Day')
    expect(formatEventTime('20:00', true)).toBe('All Day')
  })

  it('renders 12-hour time and tolerates seconds from Postgres', () => {
    expect(formatEventTime('20:00', false)).toBe('8:00 PM')
    expect(formatEventTime('20:00:00', false)).toBe('8:00 PM')
    expect(formatEventTime('09:05', false)).toBe('9:05 AM')
    expect(formatEventTime('00:30', false)).toBe('12:30 AM')
    expect(formatEventTime('12:05', false)).toBe('12:05 PM')
  })

  it('falls back to All Day when a timed event has no time', () => {
    expect(formatEventTime(null, false)).toBe('All Day')
  })
})

describe('compareEvents — all-day first, then time, then title', () => {
  it('orders a mixed day deterministically', () => {
    const sorted = [
      ev({ id: 'c', title: 'Zebra', scheduledTime: '20:00' }),
      ev({ id: 'a', title: 'Alpha', scheduledTime: null, allDay: true }),
      ev({ id: 'b', title: 'Beta', scheduledTime: '08:30' }),
      ev({ id: 'd', title: 'Alpha', scheduledTime: '20:00' }),
    ].sort(compareEvents)
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b', 'd', 'c'])
  })
})

describe('validateScheduleEventInput — mirrors the DB CHECK constraints', () => {
  const valid = {
    title: 'Cho Balloon Pop',
    eventType: 'balloon_pop',
    scheduledDate: '2026-09-12',
    scheduledTime: '20:00',
    allDay: false,
    status: 'confirmed',
    notes: 'Late slot',
  }

  it('accepts a valid timed event and maps it to snake_case columns', () => {
    const res = validateScheduleEventInput(valid)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value).toEqual({
      title: 'Cho Balloon Pop',
      event_type: 'balloon_pop',
      scheduled_date: '2026-09-12',
      scheduled_time: '20:00',
      all_day: false,
      status: 'confirmed',
      notes: 'Late slot',
    })
  })

  it('forces an all-day event time to null instead of rejecting it', () => {
    // The DB CHECK forbids all_day WITH a time, so the validator must clear it
    // rather than let the constraint produce an opaque failure.
    const res = validateScheduleEventInput({ ...valid, allDay: true, scheduledTime: '20:00' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.all_day).toBe(true)
    expect(res.value.scheduled_time).toBeNull()
  })

  it('trims the title, strips seconds and blanks empty notes', () => {
    const res = validateScheduleEventInput({
      ...valid,
      title: '  Spaced  ',
      scheduledTime: '20:00:00',
      notes: '   ',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.title).toBe('Spaced')
    expect(res.value.scheduled_time).toBe('20:00')
    expect(res.value.notes).toBeNull()
  })

  it('accepts omitted notes', () => {
    const { notes: _drop, ...rest } = valid
    const res = validateScheduleEventInput(rest)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.notes).toBeNull()
  })

  it.each([
    ['missing title', { ...valid, title: undefined }, 'invalid_title'],
    ['whitespace title', { ...valid, title: '   ' }, 'title_required'],
    ['over-long title', { ...valid, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }, 'title_too_long'],
    ['bad event type', { ...valid, eventType: 'not_a_type' }, 'invalid_event_type'],
    ['missing event type', { ...valid, eventType: undefined }, 'invalid_event_type'],
    ['bad status', { ...valid, status: 'live' }, 'invalid_status'],
    ['missing date', { ...valid, scheduledDate: undefined }, 'invalid_date'],
    ['impossible date', { ...valid, scheduledDate: '2026-02-31' }, 'invalid_date'],
    ['bad date format', { ...valid, scheduledDate: '12/09/2026' }, 'invalid_date'],
    ['timed with no time', { ...valid, allDay: false, scheduledTime: null }, 'time_required'],
    ['bad time', { ...valid, scheduledTime: '25:00' }, 'time_required'],
    ['non-string notes', { ...valid, notes: 42 }, 'invalid_notes'],
    ['over-long notes', { ...valid, notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }, 'notes_too_long'],
  ])('rejects %s', (_label, input, code) => {
    const res = validateScheduleEventInput(input as Record<string, unknown>)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe(code)
  })

  it('rejects a non-object payload', () => {
    for (const bad of [null, undefined, 'string', 42]) {
      const res = validateScheduleEventInput(bad)
      expect(res.ok, String(bad)).toBe(false)
    }
  })
})

describe('scheduleErrorCopy', () => {
  it('maps every validation code to friendly copy with no raw code leaking', () => {
    for (const code of Object.keys(SCHEDULE_ERROR_COPY)) {
      const copy = scheduleErrorCopy(code)
      expect(copy, code).toBeTruthy()
      expect(copy, code).not.toContain('_')
    }
  })

  it('falls back for unknown or missing codes', () => {
    expect(scheduleErrorCopy('something_new')).toBe('Something went wrong. Please try again.')
    expect(scheduleErrorCopy(null)).toBe('Something went wrong. Please try again.')
    expect(scheduleErrorCopy(undefined)).toBe('Something went wrong. Please try again.')
  })
})
