'use client'

import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatPct, pctDirection } from '@/lib/admin/reporting/format'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string
  /** Signed pct vs the comparison period, or null when no baseline. */
  pct: number | null
  comparisonLabel: string
  hint: string
  icon: LucideIcon
  /** Emphasise the primary "External payment revenue" card. */
  primary?: boolean
  loading?: boolean
}

export function KpiCard({
  label,
  value,
  pct,
  comparisonLabel,
  hint,
  icon: Icon,
  primary = false,
  loading = false,
}: KpiCardProps) {
  const dir = pctDirection(pct)

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        primary ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-bold text-muted-foreground"
              aria-label={`What is ${label}?`}
            >
              i
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-pretty">{hint}</TooltipContent>
        </Tooltip>
      </div>

      {loading ? (
        <div className="h-8 w-28 animate-pulse rounded bg-muted" />
      ) : (
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
      )}

      <div className="flex items-center gap-1.5 text-xs">
        {loading ? (
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold tabular-nums',
                dir === 'up' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                dir === 'down' && 'bg-red-500/15 text-red-600 dark:text-red-400',
                dir === 'flat' && 'bg-muted text-muted-foreground',
              )}
            >
              {dir === 'up' && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
              {dir === 'down' && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
              {dir === 'flat' && <Minus className="h-3 w-3" aria-hidden="true" />}
              {formatPct(pct)}
            </span>
            <span className="truncate text-muted-foreground">vs {comparisonLabel}</span>
          </>
        )}
      </div>
    </div>
  )
}
