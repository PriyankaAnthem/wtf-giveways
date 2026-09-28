'use client'

import { ChevronRight } from 'lucide-react'
import { formatPence, formatCount } from '@/lib/admin/reporting/format'
import { formatPct, type AffiliateLeaderboardRow } from '@/lib/admin/marketing/affiliate-performance'
import { CommissionCell } from './AffiliateDrilldown'

/**
 * Affiliate leaderboard. Sort order is authoritative from the RPC — we never
 * re-sort. Clicking a row drills into that affiliate (detail mode) via
 * `onSelect`. Desktop renders an aligned table; mobile uses compact cards so a
 * wide 7-column table is never forced onto a phone.
 */
export function AffiliateLeaderboard({
  rows,
  onSelect,
}: {
  rows: AffiliateLeaderboardRow[]
  onSelect: (affiliateId: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">No affiliate revenue in this period.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Desktop table */}
      <table className="hidden w-full text-sm lg:table">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <Th>Affiliate</Th>
            <Th align="right">Orders</Th>
            <Th align="right">Net Revenue</Th>
            <Th align="right">AOV</Th>
            <Th align="right">Voucher %</Th>
            <Th align="right">Known Discount</Th>
            <Th align="right">Commission</Th>
            <Th align="right"><span className="sr-only">Open</span></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr
              key={r.affiliateId}
              onClick={() => onSelect(r.affiliateId)}
              className="cursor-pointer transition-colors hover:bg-muted/40"
            >
              <td className="px-3 py-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(r.affiliateId)
                  }}
                  className="text-left font-semibold text-foreground hover:underline"
                >
                  {r.affiliateName}
                </button>
              </td>
              <Td>{formatCount(r.orders)}</Td>
              <Td strong>{formatPence(r.netRevenuePence)}</Td>
              <Td>{formatPence(r.aovPence)}</Td>
              <Td>{formatPct(r.voucherPct)}</Td>
              <Td>{formatPence(r.knownDiscountGivenPence)}</Td>
              <td className="px-3 py-3 text-right">
                <CommissionCell metrics={r} align="right" />
              </td>
              <td className="px-3 py-3 text-right">
                <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <ul className="divide-y divide-border/60 lg:hidden">
        {rows.map((r) => (
          <li key={r.affiliateId}>
            <button
              type="button"
              onClick={() => onSelect(r.affiliateId)}
              className="flex w-full flex-col gap-2 p-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{r.affiliateName}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <Stat label="Net Revenue" value={formatPence(r.netRevenuePence)} strong />
                <Stat label="Orders" value={formatCount(r.orders)} />
                <Stat label="AOV" value={formatPence(r.aovPence)} />
                <Stat label="Voucher %" value={formatPct(r.voucherPct)} />
                <Stat label="Known Discount" value={formatPence(r.knownDiscountGivenPence)} />
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground/70">Commission</span>
                  <CommissionCell metrics={r} align="left" />
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <td className={`px-3 py-3 text-right tabular-nums ${strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
      {children}
    </td>
  )
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-foreground' : 'text-foreground'}`}>{value}</span>
    </span>
  )
}
