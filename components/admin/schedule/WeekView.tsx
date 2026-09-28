'use client'

import { CalendarPlus, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ScheduleEvent } from '@/lib/types/schedule'
import {
  weekDayKeys,
  type CompetitionDeadline,
} from '@/lib/types/competition-deadline'
import { CompetitionDeadlineCard } from '@/components/admin/schedule/CompetitionDeadlineCard'
import { PlannedEventCard } from '@/components/admin/schedule/PlannedEventCard'

interface WeekViewProps {
  /** Monday key that begins the visible week. */
  weekStart: string
  todayKey: string
  selectedDate: string
  deadlinesByDate: Map<string, CompetitionDeadline[]>
  eventsByDate: Map<string, ScheduleEvent[]>
  /** Layer visibility, driven by the source filter. */
  showDeadlines: boolean
  showEvents: boolean
  canManage: boolean
  onSelectDate: (date: string) => void
  onAdd: (date: string) => void
  onEdit: (event: ScheduleEvent) => void
  onDuplicate: (event: ScheduleEvent) => void
  onDelete: (event: ScheduleEvent) => void
}

/**
 * Seven-day operational view (Mon-Sun), rendered as a vertical sequence of day
 * sections. The same layout serves desktop and mobile - no horizontal scroll of
 * a wide grid - and widens to two columns only on very large screens.
 *
 * Within each day, COMPETITIONS ENDING (read-only, higher commercial urgency)
 * always precede PLANNED EVENTS (manual, editable).
 */
export function WeekView({
  weekStart,
  todayKey,
  selectedDate,
  deadlinesByDate,
  eventsByDate,
  showDeadlines,
  showEvents,
  canManage,
  onSelectDate,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: WeekViewProps) {
  const days = weekDayKeys(weekStart)

  return (
    <div className="grid gap-3 2xl:grid-cols-2">
      {days.map((dayKey) => {
        const deadlines = showDeadlines ? (deadlinesByDate.get(dayKey) ?? []) : []
        const events = showEvents ? (eventsByDate.get(dayKey) ?? []) : []
        const isToday = dayKey === todayKey
        const isSelected = dayKey === selectedDate
        const empty = deadlines.length === 0 && events.length === 0

        return (
          <section
            key={dayKey}
            className={cn(
              'flex flex-col rounded-lg border bg-card',
              isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
            )}
            aria-label={longDate(dayKey)}
          >
            <button
              type="button"
              onClick={() => onSelectDate(dayKey)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-t-lg border-b border-border px-3 py-2 text-left transition-colors hover:bg-muted/50',
                isToday && 'bg-primary/5',
              )}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-xs font-bold uppercase tracking-wide',
                    isToday ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {shortWeekday(dayKey)}
                </span>
                <span className="text-sm font-semibold tabular-nums">{dayNumber(dayKey)}</span>
                {isToday ? (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[0.625rem] font-bold text-primary-foreground">
                    TODAY
                  </span>
                ) : null}
              </span>
              {canManage ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAdd(dayKey)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      onAdd(dayKey)
                    }
                  }}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Add event on ${longDate(dayKey)}`}
                >
                  <CalendarPlus className="size-4" aria-hidden="true" />
                </span>
              ) : null}
            </button>

            <div className="flex flex-col gap-3 p-3">
              {empty ? (
                <p className="py-2 text-center text-xs text-muted-foreground">Nothing scheduled.</p>
              ) : null}

              {deadlines.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                    <Flag className="size-3.5" aria-hidden="true" />
                    Competitions ending
                  </p>
                  {deadlines.map((d) => (
                    <CompetitionDeadlineCard
                      key={d.campaignId}
                      deadline={d}
                      todayKey={todayKey}
                      showPill
                    />
                  ))}
                </div>
              ) : null}

              {events.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                    Planned events
                  </p>
                  <ul className="flex flex-col gap-2">
                    {events.map((event) => (
                      <PlannedEventCard
                        key={event.id}
                        event={event}
                        canManage={canManage}
                        onEdit={onEdit}
                        onDuplicate={onDuplicate}
                        onDelete={onDelete}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// --- Local display helpers (UTC-parts based, like the rest of the module) ----

function parts(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function shortWeekday(dateKey: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
    parts(dateKey),
  )
}

function dayNumber(dateKey: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    parts(dateKey),
  )
}

function longDate(dateKey: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parts(dateKey))
}
