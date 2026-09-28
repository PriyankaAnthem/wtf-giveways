'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MarketingStatCardProps {
  label: string
  value: string
  /** Optional supporting line under the value (e.g. the attribution label). */
  subtext?: string
  icon?: LucideIcon
  /** Emphasise the single most important card (Attributed Cash). */
  primary?: boolean
  loading?: boolean
}

/**
 * A single commercial KPI tile.
 *
 * Deliberately has NO percentage-change / comparison-period affordance: the
 * analytics RPC exposes no baseline period and we must never invent one. This
 * keeps the primary cards honest — a big, unambiguous number plus an optional
 * clarifying subtext (used for the "7-day click-attributed revenue" label).
 */
export function MarketingStatCard({
  label,
  value,
  subtext,
  icon: Icon,
  primary = false,
  loading = false,
}: MarketingStatCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        primary ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>

      {loading ? (
        <div className="h-8 w-28 animate-pulse rounded bg-muted" />
      ) : (
        <p
          className={cn(
            'font-bold tabular-nums text-foreground',
            primary ? 'text-3xl' : 'text-2xl',
          )}
        >
          {value}
        </p>
      )}

      {subtext ? (
        <p className="text-[11px] leading-snug text-muted-foreground text-pretty">{subtext}</p>
      ) : null}
    </div>
  )
}

/**
 * Compact secondary metric row item — visually subordinate to the primary
 * cards so External Cash always reads as the headline number.
 */
export function MarketingSecondaryStat({
  label,
  value,
  loading = false,
}: {
  label: string
  value: string
  loading?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <div className="h-5 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <span className="text-base font-semibold tabular-nums text-foreground">{value}</span>
      )}
    </div>
  )
}
