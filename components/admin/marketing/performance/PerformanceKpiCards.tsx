'use client'

import { Banknote, Receipt, Calculator, Radar, TicketPercent, BadgePercent } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatPence, formatCount } from '@/lib/admin/reporting/format'
import { formatPct, type PerformanceSummary } from '@/lib/admin/marketing/performance'
import { cn } from '@/lib/utils'

/**
 * Headline KPI cards for Marketing Performance.
 *
 * Rendered from the RPC `summary` only — no client aggregation. On mobile they
 * form a 2-column grid; on desktop a 3-column grid. Voucher Usage and Known
 * Discount are presented TRUTHFULLY: usage is over KNOWN orders only, and the
 * unknown-order caveats are shown as subtle secondary text (never scary).
 */
export function PerformanceKpiCards({
  summary,
  loading,
}: {
  summary: PerformanceSummary | undefined
  loading: boolean
}) {
  const s = summary
  const hasUnknown = (s?.voucherUnknownOrders ?? 0) > 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <StatCard
        label="Net Revenue"
        value={formatPence(s?.netRevenuePence)}
        icon={Banknote}
        primary
        loading={loading}
      />
      <StatCard
        label="Orders"
        value={formatCount(s?.orders)}
        icon={Receipt}
        loading={loading}
      />
      <StatCard
        label="AOV"
        value={formatPence(s?.aovPence)}
        subtext="Average order value"
        icon={Calculator}
        loading={loading}
      />
      <StatCard
        label="Tracked Revenue"
        value={formatPence(s?.trackedRevenuePence)}
        subtext={
          s?.attributionRatePct != null
            ? `${formatPct(s.attributionRatePct)} of revenue attributed`
            : 'No attribution yet'
        }
        icon={Radar}
        loading={loading}
      />
      <StatCard
        label="Voucher Usage"
        value={formatPct(s?.voucherUsagePct)}
        icon={TicketPercent}
        loading={loading}
      >
        {s ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              {formatCount(s.voucherOrders)} of {formatCount(s.voucherKnownOrders)} known orders
            </span>
            {hasUnknown ? (
              <span className="text-[11px] text-muted-foreground/80">
                {formatCount(s.voucherUnknownOrders)} historic orders have unknown voucher status
              </span>
            ) : null}
          </div>
        ) : null}
      </StatCard>
      <StatCard
        label="Known Discount Given"
        value={formatPence(s?.knownDiscountGivenPence)}
        icon={BadgePercent}
        loading={loading}
      >
        {hasUnknown ? (
          <span className="text-[11px] text-muted-foreground/80">
            Historic discounts before voucher tracking may not be included.
          </span>
        ) : null}
      </StatCard>
    </div>
  )
}

function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  primary = false,
  loading,
  children,
}: {
  label: string
  value: string
  subtext?: string
  icon: LucideIcon
  primary?: boolean
  loading: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        primary ? 'border-primary/30 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <span className="text-2xl font-bold tabular-nums text-foreground">{value}</span>
      )}
      {!loading && subtext ? <span className="text-xs text-muted-foreground">{subtext}</span> : null}
      {!loading ? children : null}
    </div>
  )
}
