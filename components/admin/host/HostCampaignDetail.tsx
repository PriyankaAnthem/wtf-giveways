import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { formatPence, formatCount } from "@/lib/admin/reporting/format"
import type { HostCampaignSummary } from "@/lib/admin/host-dashboard-types"

/**
 * Read-only detail for a single host campaign. Server-rendered from the same
 * host-scoped payload (no extra queries). Shows only this host's own figures —
 * never other hosts' rates, company profit, fees, prize cost or customer PII.
 */
export function HostCampaignDetail({
  campaign,
  monthLabel,
}: {
  campaign: HostCampaignSummary
  monthLabel: string
}) {
  const pct = campaign.pctSold != null ? Math.max(0, Math.min(100, campaign.pctSold)) : null
  const statusLabel = campaign.isEnded
    ? "Ended"
    : campaign.status === "live"
      ? "Live"
      : campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        href="/admin/host/comps"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        My comps
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {statusLabel}
        </span>
        <h1 className="text-pretty text-2xl font-bold tracking-tight text-foreground">{campaign.title}</h1>
      </header>

      {/* Ticket progress */}
      {pct != null && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold tabular-nums text-foreground">{pct.toFixed(0)}% sold</span>
            {campaign.maxTicketsTotal != null && (
              <span className="text-sm text-muted-foreground">
                of {formatCount(campaign.maxTicketsTotal)} tickets
              </span>
            )}
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tickets sold"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </section>
      )}

      {/* Money */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label={`Hosted cash sales (${monthLabel.toLowerCase()})`} value={formatPence(campaign.externalPenceMonth)} />
        <Stat label="Cash sales today" value={formatPence(campaign.externalPenceToday)} />
        <Stat label="Your commission" value={`${campaign.commissionPct}%`} />
        <Stat label="Estimated earnings" value={formatPence(campaign.earningsPenceMonth)} accent />
      </section>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Earnings are estimated from external cash sales only (wallet and site credit are excluded) at your
        commission rate. Figures track {monthLabel.toLowerCase()} and update as reporting refreshes.
      </p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={
          accent
            ? "text-xl font-bold tabular-nums text-primary"
            : "text-xl font-bold tabular-nums text-foreground"
        }
      >
        {value}
      </span>
    </div>
  )
}
