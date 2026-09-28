'use client'

import { Check, Copy, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_STYLES,
  formatEventTime,
  type ScheduleEvent,
} from '@/lib/types/schedule'

interface PlannedEventCardProps {
  event: ScheduleEvent
  canManage: boolean
  onEdit: (event: ScheduleEvent) => void
  onDuplicate: (event: ScheduleEvent) => void
  onDelete: (event: ScheduleEvent) => void
}

/**
 * A single manual Schedule event (Layer A), shared by the Day detail and Week
 * view so both render identically. Unlike a competition deadline card, this
 * keeps the full Edit / Duplicate / Delete controls.
 */
export function PlannedEventCard({
  event,
  canManage,
  onEdit,
  onDuplicate,
  onDelete,
}: PlannedEventCardProps) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        {/* Category stripe: the primary visual cue for manual events. */}
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 h-9 w-1 shrink-0 rounded-full',
            EVENT_TYPE_STYLES[event.eventType].dot,
          )}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {formatEventTime(event.scheduledTime, event.allDay)}
          </span>
          <span className="text-sm font-semibold break-words text-foreground">{event.title}</span>

          <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span
              className={cn(
                'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-medium',
                EVENT_TYPE_STYLES[event.eventType].chip,
              )}
            >
              {EVENT_TYPE_LABELS[event.eventType]}
            </span>
            <StatusBadge status={event.status} />
          </span>

          {event.notes ? (
            <p className="pt-1 text-xs leading-relaxed break-words text-muted-foreground">
              {event.notes}
            </p>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <div className="flex flex-wrap justify-end gap-1 border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => onEdit(event)} className="gap-1.5">
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDuplicate(event)} className="gap-1.5">
            <Copy className="size-3.5" aria-hidden="true" />
            Duplicate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(event)}
            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Status is deliberately quieter than the event type: Idea is dotted and muted,
 * Planned is a plain badge, Confirmed adds a tick.
 */
export function StatusBadge({ status }: { status: ScheduleEvent['status'] }) {
  if (status === 'idea') {
    return (
      <span className="inline-flex items-center rounded-md border border-dashed border-border px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
        {EVENT_STATUS_LABELS.idea}
      </span>
    )
  }
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-foreground">
        <Check className="size-3" aria-hidden="true" />
        {EVENT_STATUS_LABELS.confirmed}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
      {EVENT_STATUS_LABELS.planned}
    </span>
  )
}
