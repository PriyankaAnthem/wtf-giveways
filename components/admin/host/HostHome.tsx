"use client"

import Link from "next/link"
import { ArrowRight, RefreshCw, Trophy } from "lucide-react"
import { formatPence } from "@/lib/admin/reporting/format"
import type { HostDashboardPayload } from "@/lib/admin/host-dashboard-types"
import { HostCampaignCard } from "./HostCampaignCard"
import { useHostDashboard } from "./useHostDashboard"
import { useSinceOpened } from "./useSinceOpened"
import { RefreshMeta } from "./RefreshMeta"

/**
 * Host Home — mobile-first "how am I doing right now" screen.
 *
 * Seeded by the server (initialData) then softly refreshed via SWR. Shows the
 * greeting, this-month headline numbers (hosted cash + estimated earnings) and
 * the host's active competitions.
 */
export function HostHome({ initialData }: { initialData: HostDashboardPayload }) {
  const { data, isRefreshing, hasError, refresh } = useHostDashboard(initialData)

  // Live-session deltas across ALL campaigns (baseline stays stable across
  // refreshes); we only render them on active comp cards below.
  const sinceOpened = useSinceOpened(data.campaigns)
  const active = data.campaigns.filter((c) => c.isActive)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-pretty text-2xl font-bold tracking-tight text-foreground">
            Hi {data.hostName}
          </h1>
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

      {/* THIS MONTH headline */}
      <section aria-labelledby="month-heading" className="flex flex-col gap-3">
        <h2
          id="month-heading"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {data.month.label}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HeadlineStat
            label="Hosted cash sales"
            value={formatPence(data.month.hostedCashPence)}
            hint="External cash only — excludes wallet & site credit"
          />
          <HeadlineStat
            label="Estimated earnings"
            value={formatPence(data.month.estimatedEarningsPence)}
            hint="Your commission on hosted cash sales"
            accent
          />
        </div>
      </section>

      {/* ACTIVE COMPS */}
      <section aria-labelledby="active-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2
            id="active-heading"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Your active comps
          </h2>
          <Link
            href="/admin/host/comps"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            My comps
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {active.length > 0 ? (
          <div className="flex flex-col gap-3">
            {active.map((c) => (
              <HostCampaignCard key={c.campaignId} campaign={c} sinceOpened={sinceOpened.get(c.campaignId)} />
            ))}
          </div>
        ) : (
          <EmptyActive hasAny={data.campaigns.length > 0} />
        )}
      </section>
    </div>
  )
}

function HeadlineStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint: string
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={
          accent
            ? "text-3xl font-bold tabular-nums tracking-tight text-primary"
            : "text-3xl font-bold tabular-nums tracking-tight text-foreground"
        }
      >
        {value}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>
    </div>
  )
}

function EmptyActive({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <Trophy aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No active competitions right now</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {hasAny
          ? "None of your competitions are currently live. Check My Comps for ended ones."
          : "You haven't been assigned to any competitions yet. They'll appear here once you are."}
      </p>
    </div>
  )
}
