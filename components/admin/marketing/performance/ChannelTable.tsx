'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatPence, formatCount } from '@/lib/admin/reporting/format'
import {
  buildDrilldown,
  channelLabel,
  formatPct,
  prettifySlug,
  sourceLabel,
  type ChannelDrilldown,
  type PerformancePayload,
} from '@/lib/admin/marketing/performance'
import { cn } from '@/lib/utils'

/**
 * Channel attribution with a Channel -> Source -> Campaign drilldown.
 *
 * The RPC arrays arrive already sorted by net revenue; `buildDrilldown` only
 * buckets them under the parent they belong to (no client re-aggregation or
 * re-sorting). Desktop renders an expandable table; mobile renders stacked
 * cards with the same expand behaviour so nothing overflows horizontally.
 */
export function ChannelTable({ payload }: { payload: PerformancePayload }) {
  const groups = useMemo(() => buildDrilldown(payload), [payload])

  if (groups.length === 0) {
    return (
      <SectionShell>
        <p className="p-4 text-sm text-muted-foreground">
          No channel activity in this period.
        </p>
      </SectionShell>
    )
  }

  return (
    <SectionShell>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Tracking began recently. Orders without a captured marketing link appear as Direct /
        Unknown.
      </p>
      {/* Desktop table */}
      <div className="hidden md:block">
        <ChannelDesktopTable groups={groups} />
      </div>
      {/* Mobile cards */}
      <div className="flex flex-col gap-3 p-3 md:hidden">
        {groups.map((g) => (
          <ChannelMobileCard key={g.channel.channel} group={g} />
        ))}
      </div>
    </SectionShell>
  )
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Revenue by channel</h3>
      </header>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

function ChannelDesktopTable({ groups }: { groups: ChannelDrilldown[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 text-right font-medium">Orders</th>
            <th className="px-3 py-2 text-right font-medium">Net Revenue</th>
            <th className="px-3 py-2 text-right font-medium">AOV</th>
            <th className="px-3 py-2 text-right font-medium">Voucher Orders</th>
            <th className="px-3 py-2 text-right font-medium">Voucher %</th>
            <th className="px-3 py-2 text-right font-medium">Known Discount</th>
            <th className="px-3 py-2 text-right font-medium">Revenue Share</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const chKey = g.channel.channel
            const chOpen = expanded.has(chKey)
            const canExpand = g.sources.length > 0
            return (
              <FragmentRows key={chKey}>
                <tr
                  className={cn('border-b border-border/60', canExpand && 'cursor-pointer hover:bg-muted/40')}
                  onClick={canExpand ? () => toggle(chKey) : undefined}
                >
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    <span className="flex items-center gap-1.5">
                      {canExpand ? (
                        <ChevronRight
                          className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', chOpen && 'rotate-90')}
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="w-3.5" />
                      )}
                      {channelLabel(g.channel.channel)}
                    </span>
                  </td>
                  <NumCells row={g.channel} />
                </tr>

                {chOpen &&
                  g.sources.map((sNode) => {
                    const sKey = `${chKey}::${sNode.source.source ?? ''}`
                    const sOpen = expanded.has(sKey)
                    const canExpandSrc = sNode.campaigns.length > 0
                    return (
                      <FragmentRows key={sKey}>
                        <tr
                          className={cn('border-b border-border/40 bg-muted/20', canExpandSrc && 'cursor-pointer hover:bg-muted/40')}
                          onClick={canExpandSrc ? () => toggle(sKey) : undefined}
                        >
                          <td className="py-2 pl-9 pr-4 text-foreground">
                            <span className="flex items-center gap-1.5">
                              {canExpandSrc ? (
                                <ChevronRight
                                  className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', sOpen && 'rotate-90')}
                                  aria-hidden="true"
                                />
                              ) : (
                                <span className="w-3" />
                              )}
                              <span className="text-muted-foreground">Source</span>
                              {sourceLabel(sNode.source.source)}
                            </span>
                          </td>
                          <NumCells row={sNode.source} voucher={sNode.source.mostUsedVoucher} />
                        </tr>
                        {sOpen &&
                          sNode.campaigns.map((camp) => (
                            <tr key={`${sKey}::${camp.campaign ?? ''}`} className="border-b border-border/30 bg-muted/30">
                              <td className="py-2 pl-16 pr-4 text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-muted-foreground/70">Campaign</span>
                                  {prettifySlug(camp.campaign)}
                                </span>
                              </td>
                              <NumCells row={camp} voucher={camp.mostUsedVoucher} muted />
                            </tr>
                          ))}
                      </FragmentRows>
                    )
                  })}
              </FragmentRows>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function NumCells({
  row,
  voucher,
  muted = false,
}: {
  row: {
    orders: number
    netRevenuePence: number
    aovPence: number | null
    voucherOrders: number
    voucherPct: number | null
    knownDiscountGivenPence: number
    revenueSharePct: number | null
  }
  voucher?: string | null
  muted?: boolean
}) {
  return (
    <>
      <td className={cn('px-3 py-2 text-right tabular-nums', muted ? 'text-muted-foreground' : 'text-foreground')}>
        {formatCount(row.orders)}
      </td>
      <td className={cn('px-3 py-2 text-right tabular-nums', muted ? 'text-muted-foreground' : 'text-foreground')}>
        {formatPence(row.netRevenuePence)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPence(row.aovPence)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {voucher !== undefined ? (
          <span className="flex flex-col items-end">
            <span>{formatCount(row.voucherOrders)}</span>
            {voucher ? <span className="text-[11px] text-muted-foreground/70">{voucher}</span> : null}
          </span>
        ) : (
          formatCount(row.voucherOrders)
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPct(row.voucherPct)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatPence(row.knownDiscountGivenPence)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPct(row.revenueSharePct)}</td>
    </>
  )
}

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

function ChannelMobileCard({ group }: { group: ChannelDrilldown }) {
  const [open, setOpen] = useState(false)
  const canExpand = group.sources.length > 0
  const ch = group.channel
  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={canExpand ? () => setOpen((v) => !v) : undefined}
        aria-expanded={canExpand ? open : undefined}
        className={cn('flex w-full items-start justify-between gap-3 p-3 text-left', !canExpand && 'cursor-default')}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {canExpand ? (
              <ChevronRight
                className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
                aria-hidden="true"
              />
            ) : null}
            <span className="truncate font-semibold text-foreground">{channelLabel(ch.channel)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatCount(ch.orders)} orders · {formatPct(ch.revenueSharePct)} of revenue
          </p>
        </div>
        <span className="shrink-0 text-right text-base font-bold tabular-nums text-foreground">
          {formatPence(ch.netRevenuePence)}
        </span>
      </button>

      <dl className="grid grid-cols-3 gap-2 border-t border-border/60 px-3 py-2 text-xs">
        <Metric label="AOV" value={formatPence(ch.aovPence)} />
        <Metric label="Vouchers" value={`${formatCount(ch.voucherOrders)} (${formatPct(ch.voucherPct)})`} />
        <Metric label="Known Disc." value={formatPence(ch.knownDiscountGivenPence)} />
      </dl>

      {open && canExpand ? (
        <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 p-3">
          {group.sources.map((sNode) => (
            <SourceMobileBlock key={`${ch.channel}::${sNode.source.source ?? ''}`} node={sNode} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SourceMobileBlock({
  node,
}: {
  node: ChannelDrilldown['sources'][number]
}) {
  const [open, setOpen] = useState(false)
  const canExpand = node.campaigns.length > 0
  const s = node.source
  return (
    <div className="rounded-md border border-border/60 bg-background">
      <button
        type="button"
        onClick={canExpand ? () => setOpen((v) => !v) : undefined}
        aria-expanded={canExpand ? open : undefined}
        className={cn('flex w-full items-center justify-between gap-2 p-2.5 text-left', !canExpand && 'cursor-default')}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {canExpand ? (
            <ChevronRight
              className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
          ) : null}
          <span className="truncate text-sm text-foreground">{sourceLabel(s.source)}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
          {formatPence(s.netRevenuePence)}
        </span>
      </button>
      <dl className="grid grid-cols-3 gap-2 border-t border-border/50 px-2.5 py-2 text-[11px]">
        <Metric label="Orders" value={formatCount(s.orders)} />
        <Metric label="Voucher %" value={formatPct(s.voucherPct)} />
        <Metric label="Top code" value={s.mostUsedVoucher ?? '—'} />
      </dl>
      {open && canExpand ? (
        <div className="flex flex-col gap-1.5 border-t border-border/50 bg-muted/30 p-2.5">
          {node.campaigns.map((camp) => (
            <div
              key={`${camp.channel}::${camp.source ?? ''}::${camp.campaign ?? ''}`}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate text-muted-foreground">{prettifySlug(camp.campaign)}</span>
              <span className="shrink-0 tabular-nums text-foreground">
                {formatCount(camp.orders)} · {formatPence(camp.netRevenuePence)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
