'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import {
  ctrFromCounts,
  formatRatePct,
  revenuePerOrderPence,
  type MarketingAnalyticsCampaign,
} from '@/lib/admin/marketing/analytics'
import { cn } from '@/lib/utils'

/**
 * Campaign Revenue table — the headline "which giveaways make money" view.
 *
 * Rows are sorted by External Cash descending (highest earner first). Campaigns
 * with email activity but zero revenue are STILL listed (never hidden), so the
 * operator can see reach without cash. Each row expands to separate DIRECT
 * (campaign-specific email) revenue from LIFECYCLE-attributed revenue, because
 * lifecycle emails (e.g. WTF Credit) can drive revenue for a campaign whose
 * original email was not campaign-specific.
 */
export function MarketingCampaignTable({ rows }: { rows: MarketingAnalyticsCampaign[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.externalCashPence - a.externalCashPence),
    [rows],
  )

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Campaign Revenue</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Which giveaways are generating revenue from marketing.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="flex h-24 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          No marketing-attributed campaign revenue in this period yet.
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul className="divide-y divide-border md:hidden">
            {sorted.map((r) => {
              const isOpen = expanded.has(r.campaignId)
              return (
                <li key={r.campaignId} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <CampaignTitle campaign={r} />
                    <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                      {formatPence(r.externalCashPence)}
                    </span>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                    <Stat label="Delivered" value={formatCount(r.directDelivered)} />
                    <Stat label="Clicks" value={formatCount(r.directClicked)} />
                    <Stat
                      label="CTR"
                      value={formatRatePct(ctrFromCounts(r.directClicked, r.directDelivered))}
                    />
                    <Stat label="Orders" value={formatCount(r.totalAttributedOrders)} />
                    <Stat label="Gross sales" value={formatPence(r.grossSalesPence)} />
                    <Stat label="WTF Credit" value={formatPence(r.walletCreditPence)} />
                    <Stat
                      label="Rev / order"
                      value={formatPence(
                        revenuePerOrderPence(r.externalCashPence, r.totalAttributedOrders),
                      )}
                    />
                  </dl>
                  <button
                    type="button"
                    onClick={() => toggle(r.campaignId)}
                    aria-expanded={isOpen}
                    className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {isOpen ? 'Hide' : 'Direct vs lifecycle'}
                  </button>
                  {isOpen ? <BreakdownGrid campaign={r} /> : null}
                </li>
              )
            })}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Campaign</th>
                  <th className="px-4 py-2 text-right font-medium">Delivered</th>
                  <th className="px-4 py-2 text-right font-medium">Clicks</th>
                  <th className="px-4 py-2 text-right font-medium">CTR</th>
                  <th className="px-4 py-2 text-right font-medium">Orders</th>
                  <th className="px-4 py-2 text-right font-medium text-foreground">External Cash</th>
                  <th className="px-4 py-2 text-right font-medium">Gross Sales</th>
                  <th className="px-4 py-2 text-right font-medium">WTF Credit</th>
                  <th className="px-4 py-2 text-right font-medium">Rev / Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((r) => {
                  const isOpen = expanded.has(r.campaignId)
                  return (
                    <Fragment key={r.campaignId}>
                      <tr className="hover:bg-muted/40">
                        <td className="max-w-[240px] px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggle(r.campaignId)}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? 'Hide breakdown' : 'Show direct vs lifecycle breakdown'}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </button>
                            <CampaignTitle campaign={r} />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {formatCount(r.directDelivered)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {formatCount(r.directClicked)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {formatRatePct(ctrFromCounts(r.directClicked, r.directDelivered))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {formatCount(r.totalAttributedOrders)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                          {formatPence(r.externalCashPence)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {formatPence(r.grossSalesPence)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {formatPence(r.walletCreditPence)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {formatPence(
                            revenuePerOrderPence(r.externalCashPence, r.totalAttributedOrders),
                          )}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-muted/30">
                          <td colSpan={9} className="px-4 py-3">
                            <BreakdownGrid campaign={r} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function CampaignTitle({ campaign }: { campaign: MarketingAnalyticsCampaign }) {
  const title = campaign.title || 'Untitled campaign'
  if (!campaign.campaignId) {
    return <span className="text-pretty text-sm font-medium text-foreground">{title}</span>
  }
  return (
    <Link
      href={`/admin/campaigns/${campaign.campaignId}`}
      prefetch={false}
      className="text-pretty text-sm font-medium text-foreground underline-offset-2 hover:underline"
    >
      {title}
    </Link>
  )
}

/**
 * The direct-vs-lifecycle attribution breakdown, shown when a row is expanded.
 * Direct = revenue from campaign-specific emails; Lifecycle = revenue credited
 * to this campaign from lifecycle automations that were not campaign-specific.
 */
function BreakdownGrid({ campaign }: { campaign: MarketingAnalyticsCampaign }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
      <Breakdown
        label="Direct campaign revenue"
        value={formatPence(campaign.directExternalCashPence)}
        hint={`${formatCount(campaign.directAttributedOrders)} direct orders`}
      />
      <Breakdown
        label="Lifecycle-attributed revenue"
        value={formatPence(campaign.lifecycleExternalCashPence)}
        hint={`${formatCount(campaign.lifecycleAttributedOrders)} lifecycle orders`}
      />
      <Breakdown label="Direct orders" value={formatCount(campaign.directAttributedOrders)} />
      <Breakdown label="Lifecycle orders" value={formatCount(campaign.lifecycleAttributedOrders)} />
    </div>
  )
}

function Breakdown({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums text-foreground')}>{value}</dd>
    </div>
  )
}
