"use client"

import { useState } from "react"
import { RefreshCw, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { HostDashboardPayload } from "@/lib/admin/host-dashboard-types"
import { HostCampaignCard } from "./HostCampaignCard"
import { useHostDashboard } from "./useHostDashboard"
import { RefreshMeta } from "./RefreshMeta"

type Tab = "active" | "ended"

/**
 * My Comps — the host's full competition list, split into Active and Ended.
 * Uses the SAME host-scoped payload as Home (no extra requests): active = live
 * or paused, ended = ended. Figures are this-month cash + the host's own
 * estimated earnings.
 */
export function HostComps({ initialData }: { initialData: HostDashboardPayload }) {
  const { data, isRefreshing, hasError, refresh } = useHostDashboard(initialData)
  const [tab, setTab] = useState<Tab>("active")

  const active = data.campaigns.filter((c) => c.isActive)
  const ended = data.campaigns.filter((c) => c.isEnded)
  const shown = tab === "active" ? active : ended

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My comps</h1>
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

      {/* Tabs */}
      <div role="tablist" aria-label="Competition status" className="flex gap-1 rounded-lg bg-muted p-1">
        <TabButton active={tab === "active"} onClick={() => setTab("active")} count={active.length}>
          Active
        </TabButton>
        <TabButton active={tab === "ended"} onClick={() => setTab("ended")} count={ended.length}>
          Ended
        </TabButton>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Cash sales and earnings shown are for {data.month.label.toLowerCase()}.
      </p>

      {shown.length > 0 ? (
        <div className="flex flex-col gap-3">
          {shown.map((c) => (
            <HostCampaignCard key={c.campaignId} campaign={c} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <Trophy aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {tab === "active" ? "No active competitions" : "No ended competitions"}
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {data.campaigns.length === 0
              ? "You haven't been assigned to any competitions yet."
              : tab === "active"
                ? "None of your competitions are currently live."
                : "None of your competitions have ended yet."}
          </p>
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "bg-primary/10 text-primary" : "bg-muted-foreground/10 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  )
}
