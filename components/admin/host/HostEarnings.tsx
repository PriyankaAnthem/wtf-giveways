"use client"

import { RefreshCw, Banknote, Info } from "lucide-react"
import { formatPence } from "@/lib/admin/reporting/format"
import type { HostDashboardPayload, HostPastMonth } from "@/lib/admin/host-dashboard-types"
import { useHostDashboard } from "./useHostDashboard"
import { RefreshMeta } from "./RefreshMeta"

/**
 * Host Earnings — mobile-first "what am I earning" screen.
 *
 * The current-month figures come from the SAME canonical Host Dashboard source
 * as Home and My Comps (useHostDashboard → /api/admin/host/dashboard), so there
 * is one current-month sales/commission calculation and no logic drift. Past
 * months are server-rendered once (static, no live refresh needed).
 *
 * Everything shown is ESTIMATED / ACCRUED commission on external cash sales —
 * there is no payout ledger yet, so we never show Paid / Pending / Outstanding.
 */
export function HostEarnings({
  initialDashboard,
  past,
}: {
  initialDashboard: HostDashboardPayload
  past: HostPastMonth[]
}) {
  const { data, isRefreshing, hasError, refresh } = useHostDashboard(initialDashboard)

  // Current UK month label for the headline (display only).
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    month: "long",
    year: "numeric",
  }).format(new Date())

  // Only comps that actually earned this month, biggest first.
  const earningComps = data.campaigns
    .filter((c) => c.externalPenceMonth > 0)
    .sort((a, b) => b.earningsPenceMonth - a.earningsPenceMonth)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-pretty text-2xl font-bold tracking-tight text-foreground">Your earnings</h1>
          <RefreshMeta lastRefreshAt={data.meta.lastRefreshAt} isRefreshing={isRefreshing} />
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw aria-hidden="true" className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </button>
      </header>

      {hasError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t refresh right now. Showing the last figures we loaded.
        </p>
      )}

      {/* Headline: estimated earnings this month */}
      <section className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-6">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Estimated this month
        </span>
        <span className="text-4xl font-bold tabular-nums tracking-tight text-primary">
          {formatPence(data.month.estimatedEarningsPence)}
        </span>
        <span className="text-sm text-muted-foreground">{monthLabel}</span>
        <span className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {formatPence(data.month.hostedCashPence)} hosted cash sales · your commission on external cash only
        </span>
      </section>

      {/* By comp — this month */}
      <section aria-labelledby="bycomp-heading" className="flex flex-col gap-3">
        <h2
          id="bycomp-heading"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          By comp · {monthLabel}
        </h2>

        {earningComps.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {earningComps.map((c) => (
              <li
                key={c.campaignId}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{c.title}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatPence(c.externalPenceMonth)} cash · {c.commissionPct}%
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-semibold tabular-nums text-primary">
                    {formatPence(c.earningsPenceMonth)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">est.</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center">
            <Banknote aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No cash sales yet this month</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Your estimated commission will appear here as your competitions take external cash.
            </p>
          </div>
        )}
      </section>

      {/* Past competitions — previous months */}
      {past.length > 0 && (
        <section aria-labelledby="past-heading" className="flex flex-col gap-3">
          <h2
            id="past-heading"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Past months
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((m) => (
              <li
                key={m.monthKey}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{m.label}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatPence(m.hostedCashPence)} hosted cash
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-semibold tabular-nums text-foreground">
                    {formatPence(m.estimatedEarningsPence)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">est.</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Estimate disclaimer — never implies a payment has been made */}
      <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-4 py-3 text-[11px] leading-snug text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Figures are estimated commission accrued on external cash sales (wallet &amp; site credit earn no
          commission). They are not a payment record and do not confirm any amount has been paid.
        </span>
      </p>
    </div>
  )
}
