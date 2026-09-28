'use client'

import { useState } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPence, formatCount } from '@/lib/admin/reporting/format'
import {
  buildAffiliateDrilldown,
  channelLabel,
  sourceLabel,
  prettifySlug,
  formatPct,
  linkRowLabel,
  describeCommission,
  type AffiliateDetail,
  type CommissionFields,
} from '@/lib/admin/marketing/affiliate-performance'

/**
 * Affiliate detail drilldown: Channel -> Source -> Campaign -> Tracking Link.
 *
 * A bespoke 4-level tree (the shared ChannelTable stops at campaign). Ordering
 * is 100% RPC-driven — `buildAffiliateDrilldown` only buckets, never sorts. All
 * figures (revenue/voucher/commission) are RPC-computed; we only format.
 *
 * Responsive: on lg+ an indented row tree with aligned numeric columns; below
 * lg the same tree with metrics reflowed into compact chips (no horizontal
 * scroll, no giant table). Channels start expanded so the common single-channel
 * affiliate is readable with zero clicks.
 */
export function AffiliateDrilldown({ detail }: { detail: AffiliateDetail | null }) {
  const tree = buildAffiliateDrilldown(detail)
  // Expanded keys across all levels (channels default-open).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.map((n) => `c:${n.channel.channel}`)),
  )

  if (!detail || tree.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">No channel breakdown for this affiliate in this period.</p>
      </div>
    )
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ColumnHeader />
      <ul className="divide-y divide-border/60">
        {tree.map((chNode) => {
          const cKey = `c:${chNode.channel.channel}`
          const cOpen = expanded.has(cKey)
          return (
            <li key={cKey}>
              <Row
                depth={0}
                label={channelLabel(chNode.channel.channel)}
                metrics={chNode.channel}
                expandable={chNode.sources.length > 0}
                open={cOpen}
                onToggle={() => toggle(cKey)}
              />
              {cOpen &&
                chNode.sources.map((sNode) => {
                  const sKey = `${cKey}|s:${sNode.source.source ?? ''}`
                  const sOpen = expanded.has(sKey)
                  return (
                    <div key={sKey}>
                      <Row
                        depth={1}
                        label={sourceLabel(sNode.source.source)}
                        metrics={sNode.source}
                        expandable={sNode.campaigns.length > 0}
                        open={sOpen}
                        onToggle={() => toggle(sKey)}
                      />
                      {sOpen &&
                        sNode.campaigns.map((cmNode) => {
                          const cmKey = `${sKey}|m:${cmNode.campaign.campaign ?? ''}`
                          const cmOpen = expanded.has(cmKey)
                          return (
                            <div key={cmKey}>
                              <Row
                                depth={2}
                                label={prettifySlug(cmNode.campaign.campaign)}
                                metrics={cmNode.campaign}
                                expandable={cmNode.links.length > 0}
                                open={cmOpen}
                                onToggle={() => toggle(cmKey)}
                              />
                              {cmOpen &&
                                cmNode.links.map((link) => (
                                  <Row
                                    key={`${cmKey}|l:${link.trackingLinkId ?? link.linkCode ?? Math.random()}`}
                                    depth={3}
                                    label={linkRowLabel(link)}
                                    sublabel={link.linkCode ?? undefined}
                                    metrics={link}
                                    expandable={false}
                                    open={false}
                                    onToggle={() => {}}
                                  />
                                ))}
                            </div>
                          )
                        })}
                    </div>
                  )
                })}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Metric fields common to every drilldown level. */
interface RowMetrics extends CommissionFields {
  orders: number
  netRevenuePence: number
  revenueSharePct: number | null
  aovPence: number | null
  voucherPct: number | null
  knownDiscountGivenPence: number
}

const NUMERIC_GRID = 'lg:grid lg:grid-cols-[repeat(7,minmax(0,1fr))] lg:items-center lg:gap-2 lg:w-[560px] lg:shrink-0'

function ColumnHeader() {
  return (
    <div className="hidden border-b border-border bg-muted/40 px-3 py-2 lg:flex lg:items-center lg:gap-3">
      <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Channel / Source / Campaign / Link
      </span>
      <div className={NUMERIC_GRID}>
        {['Orders', 'Net Rev', 'Share', 'AOV', 'Voucher', 'Discount', 'Commission'].map((h) => (
          <span key={h} className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {h}
          </span>
        ))}
      </div>
    </div>
  )
}

function Row({
  depth,
  label,
  sublabel,
  metrics,
  expandable,
  open,
  onToggle,
}: {
  depth: 0 | 1 | 2 | 3
  label: string
  sublabel?: string
  metrics: RowMetrics
  expandable: boolean
  open: boolean
  onToggle: () => void
}) {
  const indent = ['pl-3', 'pl-8', 'pl-14', 'pl-20'][depth]
  const isLink = depth === 3

  const nameContent = (
    <span className="flex min-w-0 items-center gap-1.5">
      {expandable ? (
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
      ) : (
        <span className="inline-block w-4 shrink-0" aria-hidden="true" />
      )}
      <span className={cn('truncate', depth === 0 ? 'font-semibold text-foreground' : 'text-foreground')}>
        {label}
      </span>
      {sublabel ? (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {sublabel}
        </span>
      ) : null}
    </span>
  )

  return (
    <div
      className={cn(
        'flex flex-col gap-2 py-2 pr-3 lg:flex-row lg:items-center lg:gap-3',
        indent,
        depth === 0 && 'bg-muted/20',
        isLink && 'bg-background',
      )}
    >
      <div className="min-w-0 flex-1">
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex w-full items-center text-left text-sm"
          >
            {nameContent}
          </button>
        ) : (
          <div className="flex w-full items-center text-sm">{nameContent}</div>
        )}
      </div>

      {/* Desktop: aligned numeric columns. */}
      <div className={cn(NUMERIC_GRID, 'hidden')}>
        <Cell>{formatCount(metrics.orders)}</Cell>
        <Cell strong>{formatPence(metrics.netRevenuePence)}</Cell>
        <Cell>{formatPct(metrics.revenueSharePct)}</Cell>
        <Cell>{formatPence(metrics.aovPence)}</Cell>
        <Cell>{formatPct(metrics.voucherPct)}</Cell>
        <Cell>{formatPence(metrics.knownDiscountGivenPence)}</Cell>
        <CommissionCell metrics={metrics} align="right" />
      </div>

      {/* Mobile: compact chip strip. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground lg:hidden">
        <Chip label="Orders" value={formatCount(metrics.orders)} />
        <Chip label="Net" value={formatPence(metrics.netRevenuePence)} strong />
        <Chip label="Share" value={formatPct(metrics.revenueSharePct)} />
        <Chip label="AOV" value={formatPence(metrics.aovPence)} />
        <Chip label="Voucher" value={formatPct(metrics.voucherPct)} />
        <Chip label="Discount" value={formatPence(metrics.knownDiscountGivenPence)} />
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/70">Commission</span>
          <CommissionCell metrics={metrics} align="left" />
        </span>
      </div>
    </div>
  )
}

function Cell({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={cn('text-right text-sm tabular-nums', strong ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
      {children}
    </span>
  )
}

function Chip({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}</span>
      <span className={cn('tabular-nums', strong ? 'font-semibold text-foreground' : 'text-foreground')}>{value}</span>
    </span>
  )
}

/**
 * Commission cell honouring null-vs-0: "Not configured" when unconfigured, the
 * amount when fully configured, and the amount plus a warning when only some
 * orders in the group have a rate.
 */
export function CommissionCell({
  metrics,
  align,
}: {
  metrics: CommissionFields
  align: 'left' | 'right'
}) {
  const c = describeCommission(metrics)
  if (c.kind === 'not_configured') {
    return (
      <span className={cn('text-sm text-muted-foreground', align === 'right' && 'text-right tabular-nums')}>
        Not configured
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm tabular-nums',
        align === 'right' ? 'justify-end text-right' : '',
      )}
    >
      <span className="font-semibold text-foreground">{formatPence(c.pence)}</span>
      {c.kind === 'partial' ? (
        <span
          className="inline-flex items-center text-amber-600 dark:text-amber-500"
          title={`${c.missingOrders} order${c.missingOrders === 1 ? '' : 's'} missing a commission rate`}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{c.missingOrders} orders missing a commission rate</span>
        </span>
      ) : null}
    </span>
  )
}
