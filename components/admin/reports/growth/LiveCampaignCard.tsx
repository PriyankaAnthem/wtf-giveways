'use client'

import { useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import { clampPercent, type LiveCampaignViewModel } from '@/lib/admin/reporting/growth'
import { cn } from '@/lib/utils'

function lastSaleLabel(iso: string | null): string {
  if (!iso) return 'No sales yet'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'No sales yet'
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' })
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

export function LiveCampaignCard({ c }: { c: LiveCampaignViewModel }) {
  const [open, setOpen] = useState(false)
  const pct = clampPercent(c.soldPercentage)

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground" title={c.title}>
            {c.title}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Last sale: {lastSaleLabel(c.lastConfirmedAt)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Live
        </span>
      </header>

      {/* Main performance */}
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3">
        <div className="flex flex-col">
          <span className="text-[11px] text-muted-foreground">External (period)</span>
          <span className="text-base font-bold tabular-nums text-foreground">
            {formatPence(c.externalRevenuePeriodPence)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-muted-foreground">Tickets (period)</span>
          <span className="text-base font-bold tabular-nums text-foreground">
            {formatCount(c.ticketsPeriod)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-muted-foreground">Sold</span>
          <span className="text-base font-bold tabular-nums text-foreground">
            {c.soldPercentage == null ? '—' : `${pct.toFixed(1)}%`}
          </span>
        </div>
      </div>

      {/* Sell-through */}
      <div className="flex flex-col gap-1">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Sell-through"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{formatCount(c.lifetimeTicketsSold)} sold</span>
          <span>{formatCount(c.ticketsRemaining)} remaining</span>
          <span>{formatCount(c.maxTickets)} total</span>
        </div>
      </div>

      {/* Supporting metrics — always visible on desktop, disclosure on mobile */}
      <div className="hidden sm:block">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Metric label="Gross sales" value={formatPence(c.grossSalesPeriodPence)} />
          <Metric label="WTF Credit" value={formatPence(c.creditPeriodPence)} />
          <Metric label="Confirmed orders" value={formatCount(c.confirmedOrdersPeriod)} />
          <Metric label="AOV" value={c.averageOrderValuePence == null ? '—' : formatPence(c.averageOrderValuePence)} />
          <Metric label="Tickets (24h)" value={formatCount(c.ticketsLast24Hours)} />
          <Metric label="External (24h)" value={formatPence(c.externalRevenueLast24HoursPence)} />
          <Metric label="Unique buyers (24h)" value={formatCount(c.uniqueBuyersLast24Hours)} />
        </dl>
      </div>

      {/* Mobile: quick 24h glance + disclosure for the rest */}
      <div className="sm:hidden">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Metric label="External (24h)" value={formatPence(c.externalRevenueLast24HoursPence)} />
          <Metric label="Tickets (24h)" value={formatCount(c.ticketsLast24Hours)} />
        </dl>
        {open && (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-2">
            <Metric label="Gross sales" value={formatPence(c.grossSalesPeriodPence)} />
            <Metric label="WTF Credit" value={formatPence(c.creditPeriodPence)} />
            <Metric label="Confirmed orders" value={formatCount(c.confirmedOrdersPeriod)} />
            <Metric label="AOV" value={c.averageOrderValuePence == null ? '—' : formatPence(c.averageOrderValuePence)} />
            <Metric label="Unique buyers (24h)" value={formatCount(c.uniqueBuyersLast24Hours)} />
          </dl>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
        >
          {open ? 'Fewer details' : 'More details'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}
