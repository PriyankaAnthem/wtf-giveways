'use client'

import { cn } from '@/lib/utils'
import {
  EVENT_TYPES,
  EVENT_TYPE_PLURAL,
  EVENT_TYPE_STYLES,
  type ScheduleEventType,
} from '@/lib/types/schedule'

export type TypeFilter = 'all' | ScheduleEventType

interface FilterChipsProps {
  value: TypeFilter
  onChange: (value: TypeFilter) => void
  /** Per-type counts for the visible month, used to dim empty categories. */
  counts: Record<ScheduleEventType, number>
  total: number
}

/**
 * Horizontally scrollable category filters (spec s10).
 *
 * The row scrolls rather than wrapping so it stays one-handed on a 320px phone.
 * A coloured dot carries the category identity instead of an emoji.
 */
export function FilterChips({ value, onChange, counts, total }: FilterChipsProps) {
  return (
    <div
      // -mx-1/px-1 lets the focus ring of the first and last chip breathe without
      // introducing page-level horizontal scroll.
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Filter schedule by event type"
    >
      <Chip
        label="All"
        count={total}
        active={value === 'all'}
        onClick={() => onChange('all')}
      />

      {EVENT_TYPES.map((type) => (
        <Chip
          key={type}
          label={EVENT_TYPE_PLURAL[type]}
          count={counts[type] ?? 0}
          active={value === type}
          dot={EVENT_TYPE_STYLES[type].dot}
          onClick={() => onChange(type)}
        />
      ))}
    </div>
  )
}

interface ChipProps {
  label: string
  count: number
  active: boolean
  dot?: string
  onClick: () => void
}

function Chip({ label, count, active, dot, onClick }: ChipProps) {
  const empty = count === 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // min-h-9 keeps the touch target comfortable without making the row tall.
      className={cn(
        'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
        // Empty categories stay selectable but recede, so gaps are obvious.
        !active && empty && 'text-muted-foreground',
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            dot,
            !active && empty && 'opacity-40',
          )}
        />
      ) : null}
      <span>{label}</span>
      <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  )
}
