'use client'

import { Activity } from 'lucide-react'
import { formatCount } from '@/lib/admin/reporting/format'
import { formatRate, type GrowthCheckoutHealth } from '@/lib/admin/reporting/growth'

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'good' | 'bad' | 'warn' | 'muted'
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-red-600 dark:text-red-400'
        : tone === 'warn'
          ? 'text-amber-600 dark:text-amber-400'
          : tone === 'muted'
            ? 'text-muted-foreground'
            : 'text-foreground'
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-background/50 p-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  )
}

export function CheckoutHealthCard({ health }: { health: GrowthCheckoutHealth }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Checkout health</h2>
        <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
          {formatRate(health.successRate)} success
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Created attempts" value={formatCount(health.created)} />
        <Stat label="Confirmed" value={formatCount(health.confirmed)} tone="good" />
        <Stat label="Failed" value={formatCount(health.failed)} tone="bad" />
        <Stat label="Abandoned" value={formatCount(health.abandoned)} tone="warn" />
        <Stat label="In progress" value={formatCount(health.inProgress)} tone="muted" />
        <Stat label="Completed attempts" value={formatCount(health.completedAttempts)} />
      </div>

      <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
        Success rate is confirmed ÷ completed attempts (confirmed + failed + abandoned); in-progress
        checkouts are excluded from the denominator. A pending checkout counts as{' '}
        <span className="font-medium text-foreground">in progress</span> for its first 30 minutes and is
        treated as <span className="font-medium text-foreground">abandoned</span> after that — abandoned
        does not mean the payment provider declined it.
      </p>
    </section>
  )
}
