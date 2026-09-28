'use client'

import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  EVENT_TYPE_STYLES,
  monthGridDays,
  toDateKey,
  type ScheduleEvent,
} from '@/lib/types/schedule'
import type { CompetitionDeadline } from '@/lib/types/competition-deadline'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Labels shown per cell before collapsing into "+N more". */
const MAX_VISIBLE_MOBILE = 2
const MAX_VISIBLE_DESKTOP = 3

interface MonthGridProps {
  year: number
  /** 0-indexed, matching Date. */
  month: number
  /** Filtered manual events for the visible month, keyed by YYYY-MM-DD. */
  eventsByDate: Map<string, ScheduleEvent[]>
  /** Read-only competition deadlines, keyed by YYYY-MM-DD (Layer B). */
  deadlinesByDate: Map<string, CompetitionDeadline[]>
  showEvents: boolean
  showDeadlines: boolean
  selectedDate: string
  todayKey: string
  onSelectDate: (date: string) => void
  loading?: boolean
}

/**
 * Monday-Sunday month grid.
 *
 * Stays scannable: competition deadlines render as a single compact amber
 * flag line (never full cards), manual events keep their category dots/labels.
 * The same grid renders at every breakpoint; only label density changes.
 */
export function MonthGrid({
  year,
  month,
  eventsByDate,
  deadlinesByDate,
  showEvents,
  showDeadlines,
  selectedDate,
  todayKey,
  onSelectDate,
  loading = false,
}: MonthGridProps) {
  const days = monthGridDays(year, month)

  return (
    <div className={cn('flex flex-col', loading && 'pointer-events-none opacity-60')}>
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-1 pb-2 text-center text-xs font-medium text-muted-foreground"
          >
            <span className="sm:hidden">{d.charAt(0)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = toDateKey(day)
          const inMonth = day.getUTCMonth() === month
          const events = showEvents ? (eventsByDate.get(key) ?? []) : []
          const deadlines = showDeadlines ? (deadlinesByDate.get(key) ?? []) : []
          return (
            <DayCell
              key={key}
              dateKey={key}
              dayNumber={day.getUTCDate()}
              inMonth={inMonth}
              isToday={key === todayKey}
              isSelected={key === selectedDate}
              events={events}
              deadlines={deadlines}
              onSelect={onSelectDate}
            />
          )
        })}
      </div>
    </div>
  )
}

interface DayCellProps {
  dateKey: string
  dayNumber: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  events: ScheduleEvent[]
  deadlines: CompetitionDeadline[]
  onSelect: (date: string) => void
}

function DayCell({
  dateKey,
  dayNumber,
  inMonth,
  isToday,
  isSelected,
  events,
  deadlines,
  onSelect,
}: DayCellProps) {
  const hiddenMobile = Math.max(0, events.length - MAX_VISIBLE_MOBILE)
  const hiddenDesktop = Math.max(0, events.length - MAX_VISIBLE_DESKTOP)
  const hasDeadlines = deadlines.length > 0
  // One deadline shows its title; multiple collapse to a count so cells stay tidy.
  const deadlineLabel =
    deadlines.length === 1 ? deadlines[0].title : `${deadlines.length} ending`

  return (
    <button
      type="button"
      onClick={() => onSelect(dateKey)}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      aria-label={`${dateKey}, ${deadlines.length} closing, ${events.length} ${events.length === 1 ? 'event' : 'events'}`}
      className={cn(
        'flex min-h-[3.25rem] flex-col items-stretch gap-1 border-b border-r border-border p-1 text-left transition-colors sm:min-h-[5.5rem] sm:p-1.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        '[&:nth-child(7n)]:border-r-0',
        inMonth ? 'bg-background hover:bg-muted/60' : 'bg-muted/30',
        isSelected && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <span className="flex items-center justify-between gap-1">
        <span
          className={cn(
            'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums sm:text-sm',
            inMonth ? 'text-foreground' : 'text-muted-foreground/60',
            isToday && 'ring-2 ring-primary ring-offset-0 font-semibold text-primary',
            isSelected && !isToday && 'font-semibold',
          )}
        >
          {dayNumber}
        </span>
      </span>

      {/* Competition endings first: compact amber flag line, higher priority. */}
      {hasDeadlines ? (
        <>
          {/* Mobile: just a flag + count. */}
          <span className="flex items-center gap-1 sm:hidden">
            <Flag className="size-3 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="text-[0.625rem] font-semibold leading-none text-amber-700 tabular-nums">
              {deadlines.length}
            </span>
          </span>
          {/* Tablet and up: flag + label. */}
          <span className="hidden min-w-0 items-center gap-1 sm:flex">
            <Flag className="size-3 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="min-w-0 truncate text-[0.6875rem] font-semibold leading-tight text-amber-700">
              {deadlineLabel}
            </span>
          </span>
        </>
      ) : null}

      {events.length > 0 ? (
        <>
          {/* Mobile: dots only. */}
          <span className="flex flex-wrap items-center gap-1 sm:hidden">
            {events.slice(0, MAX_VISIBLE_MOBILE).map((e) => (
              <span
                key={e.id}
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', EVENT_TYPE_STYLES[e.eventType].dot)}
              />
            ))}
            {hiddenMobile > 0 ? (
              <span className="text-[0.625rem] leading-none text-muted-foreground tabular-nums">
                +{hiddenMobile}
              </span>
            ) : null}
          </span>

          {/* Tablet and up: compact labels with a category dot. */}
          <span className="hidden flex-col gap-0.5 sm:flex">
            {events.slice(0, MAX_VISIBLE_DESKTOP).map((e) => (
              <span key={e.id} className="flex min-w-0 items-center gap-1">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    EVENT_TYPE_STYLES[e.eventType].dot,
                  )}
                />
                <span className="min-w-0 truncate text-[0.6875rem] leading-tight text-foreground/80">
                  {e.title}
                </span>
              </span>
            ))}
            {hiddenDesktop > 0 ? (
              <span className="text-[0.625rem] leading-tight text-muted-foreground tabular-nums">
                +{hiddenDesktop} more
              </span>
            ) : null}
          </span>
        </>
      ) : null}
    </button>
  )
}
