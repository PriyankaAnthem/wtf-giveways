'use client'

import { Flag } from 'lucide-react'
import {
  EVENT_TYPES,
  EVENT_TYPE_PLURAL,
  EVENT_TYPE_STYLES,
  type ScheduleEventType,
} from '@/lib/types/schedule'
import type { TypeFilter } from '@/components/admin/schedule/FilterChips'

interface MonthSummaryProps {
  monthLabel: string
  counts: Record<ScheduleEventType, number>
  /** Manual planned-event total for the visible range. */
  total: number
  /** Read-only competition-ending total for the visible range (Layer B). */
  endingsTotal: number
  filter: TypeFilter
  /** Whether the manual planned layer is currently shown (source filter). */
  showPlanned: boolean
  /** Whether the competition-ending layer is currently shown (source filter). */
  showEndings: boolean
}

/**
 * Compact planning summary for the visible range.
 *
 * The two layers are kept visually distinct: manual planned events keep their
 * per-category dot counts, while competition endings are summarised separately
 * with a flag - their count is NEVER folded into the manual categories.
 *
 * All counts are derived by the parent from rows already fetched, so this costs
 * no extra database call.
 */
export function MonthSummary({
  monthLabel,
  counts,
  total,
  endingsTotal,
  filter,
  showPlanned,
  showEndings,
}: MonthSummaryProps) {
  // A single active manual-type filter collapses to just that category.
  if (showPlanned && filter !== 'all') {
    const n = counts[filter] ?? 0
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{n}</span>{' '}
        {n === 1 ? singular(filter) : EVENT_TYPE_PLURAL[filter]} planned in {monthLabel}
      </p>
    )
  }

  const plannedTotal = showPlanned ? total : 0
  const endings = showEndings ? endingsTotal : 0
  if (plannedTotal === 0 && endings === 0) return null

  const present = EVENT_TYPES.filter((t) => (counts[t] ?? 0) > 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {showPlanned ? (
          <span>
            <span className="font-semibold text-foreground tabular-nums">{total}</span>{' '}
            <span className="text-muted-foreground">
              planned {total === 1 ? 'event' : 'events'}
            </span>
          </span>
        ) : null}
        {showEndings ? (
          <span className="inline-flex items-center gap-1.5">
            <Flag className="size-3.5 text-amber-600" aria-hidden="true" />
            <span className="font-semibold text-foreground tabular-nums">{endingsTotal}</span>{' '}
            <span className="text-muted-foreground">
              competition {endingsTotal === 1 ? 'ending' : 'endings'}
            </span>
          </span>
        ) : null}
      </div>

      {showPlanned && present.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {present.map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5 text-sm">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${EVENT_TYPE_STYLES[type].dot}`}
              />
              <span className="font-medium tabular-nums">{counts[type]}</span>
              <span className="text-muted-foreground">
                {counts[type] === 1 ? singular(type) : EVENT_TYPE_PLURAL[type]}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * "Cash" and "Other" are already mass nouns, so the plural label reads correctly
 * for a single item too.
 */
function singular(type: ScheduleEventType): string {
  if (type === 'cash' || type === 'other') return EVENT_TYPE_PLURAL[type]
  return EVENT_TYPE_PLURAL[type].replace(/s$/, '')
}
