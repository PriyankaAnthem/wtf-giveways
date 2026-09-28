'use client'

import { cn } from '@/lib/utils'

/** Top-level layer selector. Distinct axis from the manual event-type chips. */
export type SourceFilter = 'all' | 'competition' | 'planned'

const OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'competition', label: 'Competition endings' },
  { value: 'planned', label: 'Planned events' },
]

interface SourceFilterControlProps {
  value: SourceFilter
  onChange: (value: SourceFilter) => void
}

/**
 * Segmented control choosing which of the two calendar layers is shown.
 * Campaign deadlines are NOT a manual event_type, so this is a separate top-level
 * control from the FilterChips category row.
 */
export function SourceFilterControl({ value, onChange }: SourceFilterControlProps) {
  return (
    <div
      role="group"
      aria-label="Filter by source"
      className="inline-flex w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:w-auto"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
