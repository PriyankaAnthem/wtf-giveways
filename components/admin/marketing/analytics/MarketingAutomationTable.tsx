'use client'

import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import { formatRatePct, type MarketingAnalyticsAutomation } from '@/lib/admin/marketing/analytics'

/**
 * Automation Performance table.
 *
 * Rows come straight from `byAutomation` in RPC order (the six lifecycle
 * automations always appear, even at zero, because the RPC returns them). No
 * client-side reordering — the RPC's ordering is authoritative. External Cash
 * is the visually prominent column; every other metric is subordinate.
 */
export function MarketingAutomationTable({ rows }: { rows: MarketingAnalyticsAutomation[] }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Automation Performance</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Lifecycle automations ranked by delivery, clicks and 7-day click-attributed cash.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex h-24 items-center justify-center px-4 text-sm text-muted-foreground">
          No automation activity in this period yet.
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul className="divide-y divide-border md:hidden">
            {rows.map((r) => (
              <li key={r.opportunityType || r.name} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-pretty text-sm font-semibold text-foreground">{r.name}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                    {formatPence(r.externalCashPence)}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                  <Stat label="Sent" value={formatCount(r.sent)} />
                  <Stat label="Delivered" value={formatCount(r.delivered)} />
                  <Stat label="Clicks" value={formatCount(r.clicked)} />
                  <Stat label="CTR" value={formatRatePct(r.ctrPct)} />
                  <Stat label="Purchases" value={formatCount(r.attributedOrders)} />
                  <Stat label="Conversion" value={formatRatePct(r.purchaseConversionPct)} />
                  <Stat label="Rev / delivered" value={formatPence(r.revenuePerDeliveredPence)} />
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Automation</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Delivered</th>
                  <th className="px-4 py-2 text-right font-medium">Clicks</th>
                  <th className="px-4 py-2 text-right font-medium">CTR</th>
                  <th className="px-4 py-2 text-right font-medium">Purchases</th>
                  <th className="px-4 py-2 text-right font-medium">Conversion</th>
                  <th className="px-4 py-2 text-right font-medium text-foreground">External Cash</th>
                  <th className="px-4 py-2 text-right font-medium">Rev / Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.opportunityType || r.name} className="hover:bg-muted/40">
                    <td className="max-w-[200px] truncate px-4 py-2 font-medium text-foreground">
                      {r.name}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {formatCount(r.sent)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {formatCount(r.delivered)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {formatCount(r.clicked)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {formatRatePct(r.ctrPct)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {formatCount(r.attributedOrders)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {formatRatePct(r.purchaseConversionPct)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                      {formatPence(r.externalCashPence)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPence(r.revenuePerDeliveredPence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
