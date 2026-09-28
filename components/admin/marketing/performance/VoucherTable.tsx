'use client'

import { formatPence, formatCount } from '@/lib/admin/reporting/format'
import {
  voucherStatusLabel,
  type PerformanceVoucherRow,
} from '@/lib/admin/marketing/performance'
import { cn } from '@/lib/utils'

/**
 * Voucher Performance.
 *
 * Genuine codes ('code') each get their own row with the code shown prominently.
 * The two null-code states are shown as distinct, honestly-labelled rows —
 * "No voucher" (proven) and "Unknown / Historic" (never captured) — and are
 * NEVER merged. A helper line explains the unknown/historic bucket. Rows arrive
 * pre-sorted by the RPC; no client re-sorting.
 */
export function VoucherTable({ rows }: { rows: PerformanceVoucherRow[] }) {
  const hasUnknown = rows.some((r) => r.voucherStatus === 'unknown')

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Voucher Performance</h3>
      </header>

      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No voucher data in this period.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Voucher</th>
                  <th className="px-3 py-2 text-right font-medium">Orders</th>
                  <th className="px-3 py-2 text-right font-medium">Net Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Known Discount Given</th>
                  <th className="px-3 py-2 text-right font-medium">AOV</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.voucherStatus}-${r.voucher}-${i}`} className="border-b border-border/60">
                    <td className="px-4 py-2.5">
                      <VoucherLabel row={r} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCount(r.orders)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatPence(r.netRevenuePence)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPence(r.knownDiscountGivenPence)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPence(r.aovPence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-2 p-3 md:hidden">
            {rows.map((r, i) => (
              <div
                key={`${r.voucherStatus}-${r.voucher}-${i}`}
                className="rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <VoucherLabel row={r} />
                  <span className="shrink-0 text-base font-bold tabular-nums text-foreground">
                    {formatPence(r.netRevenuePence)}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-border/60 pt-2 text-xs">
                  <Metric label="Orders" value={formatCount(r.orders)} />
                  <Metric label="Known Disc." value={formatPence(r.knownDiscountGivenPence)} />
                  <Metric label="AOV" value={formatPence(r.aovPence)} />
                </dl>
              </div>
            ))}
          </div>

          {hasUnknown ? (
            <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
              Voucher data was not captured for these older orders.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

function VoucherLabel({ row }: { row: PerformanceVoucherRow }) {
  const label = voucherStatusLabel(row.voucherStatus, row.voucher)
  if (row.voucherStatus === 'code') {
    return (
      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-sm font-semibold text-primary">
        {label}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'text-sm',
        row.voucherStatus === 'no_voucher' ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
    </span>
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
