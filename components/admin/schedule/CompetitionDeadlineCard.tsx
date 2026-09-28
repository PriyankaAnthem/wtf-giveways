'use client'

import Link from 'next/link'
import { ArrowUpRight, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  deadlinePillLabel,
  deadlineUrgency,
  formatDeadlineClock,
  formatPounds,
  type CompetitionDeadline,
  type DeadlineUrgency,
} from '@/lib/types/competition-deadline'

/**
 * Read-only campaign deadline card (Layer B).
 *
 * Intentionally NOT styled like an editable ScheduleEvent: it carries a finish
 * flag, an "ENDS" urgency pill and a left border keyed to urgency, and its ONLY
 * action is "Open competition". It never renders Edit / Duplicate / Delete -
 * campaign markers are synthetic and cannot be mutated from the calendar.
 */

/** Prioritisation, not panic: only today is loud; the rest step down calmly. */
const URGENCY_ACCENT: Record<DeadlineUrgency, { border: string; pill: string; flag: string }> = {
  today: {
    border: 'border-l-red-500',
    pill: 'bg-red-100 text-red-700 border-red-200',
    flag: 'text-red-600',
  },
  tomorrow: {
    border: 'border-l-orange-500',
    pill: 'bg-orange-100 text-orange-700 border-orange-200',
    flag: 'text-orange-600',
  },
  soon: {
    border: 'border-l-amber-400',
    pill: 'bg-amber-100 text-amber-800 border-amber-200',
    flag: 'text-amber-600',
  },
  later: {
    border: 'border-l-slate-300',
    pill: 'bg-slate-100 text-slate-600 border-slate-200',
    flag: 'text-slate-500',
  },
}

interface CompetitionDeadlineCardProps {
  deadline: CompetitionDeadline
  /** Europe/London today key, for urgency. */
  todayKey: string
  /** Show the weekday/time pill (Closing This Week). Within a known day, hide it. */
  showPill?: boolean
}

export function CompetitionDeadlineCard({
  deadline,
  todayKey,
  showPill = true,
}: CompetitionDeadlineCardProps) {
  const urgency = deadlineUrgency(deadline.endDate, todayKey)
  const accent = URGENCY_ACCENT[urgency]

  const metrics: string[] = []
  if (deadline.percentSold != null) metrics.push(`${deadline.percentSold}% sold`)
  if (deadline.ticketsRemaining != null) {
    metrics.push(`${deadline.ticketsRemaining.toLocaleString('en-GB')} tickets remaining`)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-l-4 bg-card p-3 shadow-sm',
        accent.border,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Flag className={cn('mt-0.5 size-4 shrink-0', accent.flag)} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-bold break-words text-foreground">{deadline.title}</p>
            <p className="text-xs font-medium text-muted-foreground tabular-nums">
              Ends {formatDeadlineClock(deadline.endTime)}
            </p>
          </div>
        </div>
        {showPill ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide whitespace-nowrap',
              accent.pill,
            )}
          >
            {deadlinePillLabel(deadline, todayKey)}
          </span>
        ) : null}
      </div>

      {metrics.length > 0 ? (
        <p className="text-xs text-muted-foreground tabular-nums">{metrics.join(' · ')}</p>
      ) : null}

      {deadline.potentialRemainingPence != null ? (
        <p className="text-xs font-semibold text-foreground tabular-nums">
          Potential remaining: {formatPounds(deadline.potentialRemainingPence)}
        </p>
      ) : null}

      <Link
        href={deadline.adminUrl}
        className="inline-flex items-center gap-1 self-start text-xs font-semibold text-primary hover:underline"
      >
        Open competition
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  )
}
