'use client'

import { CalendarPlus, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type ScheduleEvent } from '@/lib/types/schedule'
import { type CompetitionDeadline } from '@/lib/types/competition-deadline'
import { CompetitionDeadlineCard } from '@/components/admin/schedule/CompetitionDeadlineCard'
import { PlannedEventCard } from '@/components/admin/schedule/PlannedEventCard'

interface DayDetailProps {
  /** YYYY-MM-DD of the selected day. */
  dateKey: string
  events: ScheduleEvent[]
  /** Read-only competition deadlines for this day (Layer B). */
  deadlines: CompetitionDeadline[]
  todayKey: string
  canManage: boolean
  onAdd: () => void
  onEdit: (event: ScheduleEvent) => void
  onDuplicate: (event: ScheduleEvent) => void
  onDelete: (event: ScheduleEvent) => void
}

/**
 * Detail for the selected day, shown below the month grid.
 *
 * Two clearly separated layers: COMPETITIONS ENDING (read-only campaign
 * deadlines, higher commercial urgency, shown first) and PLANNED EVENTS (manual,
 * editable). A section with no records renders no heading at all.
 */
export function DayDetail({
  dateKey,
  events,
  deadlines,
  todayKey,
  canManage,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: DayDetailProps) {
  const nothing = events.length === 0 && deadlines.length === 0

  return (
    <section aria-label="Selected day" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight">{formatLongDate(dateKey)}</h3>
        {canManage ? (
          <Button variant="outline" size="sm" onClick={onAdd} className="gap-1.5">
            <CalendarPlus className="size-4" aria-hidden="true" />
            Add to this day
          </Button>
        ) : null}
      </div>

      {nothing ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing planned for this day.
        </p>
      ) : null}

      {deadlines.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Flag className="size-3.5" aria-hidden="true" />
            Competitions ending
          </p>
          <div className="flex flex-col gap-2">
            {deadlines.map((d) => (
              <CompetitionDeadlineCard key={d.campaignId} deadline={d} todayKey={todayKey} />
            ))}
          </div>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
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
    </section>
  )
}

/** "Saturday 12 September" - built from UTC parts to avoid a timezone shift. */
function formatLongDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}
