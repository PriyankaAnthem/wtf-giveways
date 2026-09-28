'use client'

import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import type { CampaignPerformanceRow } from '@/lib/admin/reporting/types'

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'live' || status === 'active'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'ended' || status === 'closed'
        ? 'bg-muted text-muted-foreground'
        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
      {status}
    </span>
  )
}

export function CampaignTable({ rows }: { rows: CampaignPerformanceRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        No campaigns with confirmed sales in this period
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        Campaign performance
      </h2>

      {/* Mobile: stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.campaign_id} className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-pretty text-sm font-semibold text-foreground">{r.title}</span>
              <StatusBadge status={r.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div className="flex flex-col">
                <dt className="text-muted-foreground">External</dt>
                <dd className="font-semibold tabular-nums text-foreground">{formatPence(r.external_pence)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground">Gross</dt>
                <dd className="tabular-nums text-foreground">{formatPence(r.gross_pence)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground">Credit redeemed</dt>
                <dd className="tabular-nums text-foreground">{formatPence(r.credit_pence)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground">Orders</dt>
                <dd className="tabular-nums text-foreground">{formatCount(r.confirmed_orders)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground">Tickets</dt>
                <dd className="tabular-nums text-foreground">{formatCount(r.tickets_sold)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground">AOV</dt>
                <dd className="tabular-nums text-foreground">{formatPence(r.aov_pence)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2 font-medium">Campaign</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">External</th>
              <th className="px-4 py-2 text-right font-medium">Gross</th>
              <th className="px-4 py-2 text-right font-medium">Credit</th>
              <th className="px-4 py-2 text-right font-medium">Orders</th>
              <th className="px-4 py-2 text-right font-medium">Tickets</th>
              <th className="px-4 py-2 text-right font-medium">AOV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.campaign_id} className="hover:bg-muted/40">
                <td className="max-w-[220px] truncate px-4 py-2 font-medium text-foreground">{r.title}</td>
                <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">{formatPence(r.external_pence)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatPence(r.gross_pence)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatPence(r.credit_pence)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-foreground">{formatCount(r.confirmed_orders)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-foreground">{formatCount(r.tickets_sold)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-foreground">{formatPence(r.aov_pence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
