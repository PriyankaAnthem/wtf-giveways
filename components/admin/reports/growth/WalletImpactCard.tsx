'use client'

import { Wallet } from 'lucide-react'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import { formatRate, formatRatio, type GrowthWalletImpact } from '@/lib/admin/reporting/growth'

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <div className="min-w-0">
        <p className="text-xs text-foreground">{label}</p>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

export function WalletImpactCard({ w }: { w: GrowthWalletImpact }) {
  const leverage =
    w.externalCashPerCreditPound == null ? '—' : `£${w.externalCashPerCreditPound.toFixed(2)}`

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">WTF Credit impact</h2>
        <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
          {formatRate(w.walletUsageRate)} of orders
        </span>
      </div>

      <div className="flex flex-col">
        <Row label="Confirmed orders" value={formatCount(w.confirmedOrders)} />
        <Row label="Wallet-assisted orders" value={formatCount(w.walletOrders)} />
        <Row label="Fully wallet-funded orders" value={formatCount(w.fullyWalletFundedOrders)} />
        <Row label="Credit redeemed" value={formatPence(w.walletCreditRedeemedPence)} />
        <Row
          label="External cash from wallet orders"
          value={formatPence(w.externalCashFromWalletOrdersPence)}
        />
        <Row
          label="Avg credit per wallet order"
          value={w.averageCreditPerWalletOrderPence == null ? '—' : formatPence(w.averageCreditPerWalletOrderPence)}
        />
        <Row
          label="External cash per £1 credit"
          value={leverage}
          hint="How much external cash wallet-assisted orders bring in per £1 of credit redeemed"
        />
      </div>

      <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
        All figures cover the selected reporting period only (usage rate{' '}
        {formatRatio(w.walletUsageRate == null ? null : w.walletUsageRate * 100, 1)}%). Wallet-assisted
        means an order used any WTF Credit.
      </p>
    </section>
  )
}
