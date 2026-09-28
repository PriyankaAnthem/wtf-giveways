"use client"

import Link from "next/link"
import { ArrowRight, Flame } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPence, formatCount } from "@/lib/admin/reporting/format"
import type { HostCampaignSummary } from "@/lib/admin/host-dashboard-types"
import type { SinceOpened } from "./useSinceOpened"

/**
 * Compact, mobile-first card for a single host campaign. Shows only what a host
 * needs at a glance: title, % sold, ticket cap, this-month cash, today's cash
 * and their own estimated earnings. Never renders other hosts' rates or company
 * figures. `sinceOpened` is passed only for active comps (live-session delta).
 */
export function HostCampaignCard({
  campaign,
  sinceOpened,
}: {
  campaign: HostCampaignSummary
  sinceOpened?: SinceOpened
}) {
  const pct = campaign.pctSold != null ? Math.max(0, Math.min(100, campaign.pctSold)) : null

  return (
    <Link
      href={`/admin/host/comps/${campaign.campaignId}`}
      className={cn(
        "group flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors",
        "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-pretty text-base font-semibold leading-snug text-foreground">
          {campaign.title}
        </h3>
        <StatusPill campaign={campaign} />
      </div>

      {/* Ticket progress (lifetime % sold). */}
      {pct != null ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-foreground">{pct.toFixed(0)}% sold</span>
            {campaign.maxTicketsTotal != null && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatCount(campaign.ticketsSold)} / {formatCount(campaign.maxTicketsTotal)}
              </span>
            )}
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tickets sold"
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Ticket progress unavailable</p>
      )}

      {/* Money: this-month cash (with today) + this host's earnings. */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cash sales</p>
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {formatPence(campaign.externalPenceMonth)}
          </p>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatPence(campaign.externalPenceToday)} today
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Est. earnings</p>
          <p className="text-lg font-semibold tabular-nums text-primary">
            {formatPence(campaign.earningsPenceMonth)}
          </p>
        </div>
      </div>

      {/* Live-session delta — only for active comps with real movement. */}
      {sinceOpened?.hasProgress && (
        <div className="flex items-center gap-1.5 rounded-lg bg-primary/5 px-3 py-2 text-sm font-medium text-primary">
          <Flame aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="tabular-nums">
            <span className="sr-only">Since you opened: </span>
            {sinceOpened.cashPence > 0 && <>+{formatPence(sinceOpened.cashPence)}</>}
            {sinceOpened.cashPence > 0 && sinceOpened.tickets > 0 && <span aria-hidden="true"> · </span>}
            {sinceOpened.tickets > 0 && <>+{formatCount(sinceOpened.tickets)} tickets</>}
            <span className="font-normal text-muted-foreground"> since you opened</span>
          </span>
        </div>
      )}

      <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
        View comp
        <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

function StatusPill({ campaign }: { campaign: HostCampaignSummary }) {
  const label = campaign.isEnded
    ? "Ended"
    : campaign.status === "live"
      ? "Live"
      : campaign.status === "paused"
        ? "Paused"
        : campaign.status === "draft"
          ? "Draft"
          : campaign.status
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        campaign.status === "live"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  )
}
