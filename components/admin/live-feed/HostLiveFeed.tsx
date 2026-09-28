"use client"

import { useEffect, useRef, useState } from "react"
import { Gift, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  HostFeedCampaignOption,
  HostFeedItem,
  HostLiveFeedPayload,
  HostLiveSummary,
} from "@/lib/admin/host-live-feed-types"
import { HostLiveSummaryStrip } from "./HostLiveSummaryStrip"

const POLL_MS = 10000
const ALL = "all"

/** Compact, restrained relative time: "Just now", "2 mins ago", "3h ago". */
function relativeTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(s) || s < 30) return "Just now"
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function HostLiveFeed({
  initial,
  initialSummary = null,
}: {
  initial: HostLiveFeedPayload
  initialSummary?: HostLiveSummary | null
}) {
  const [campaigns, setCampaigns] = useState<HostFeedCampaignOption[]>(initial.campaigns)
  const [items, setItems] = useState<HostFeedItem[]>(initial.items)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(ALL)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  // Re-render the relative timestamps roughly once a minute without refetching.
  const [, setTick] = useState(0)

  // Ids seen in the previous successful poll (initialised from SSR data so the
  // first-rendered items are never flagged NEW).
  const prevIdsRef = useRef<Set<string>>(new Set(initial.items.map((i) => i.id)))

  const hasCampaigns = campaigns.length > 0

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let mounted = true
    const controller = new AbortController()
    // Local in-flight guard: only ONE request per active filter at a time.
    // A filter change tears down this effect (aborting any in-flight request)
    // and starts a fresh one, so there is never cross-filter overlap.
    let inFlight = false
    // The first poll after a (re)mount or filter change is a baseline: it must
    // not highlight everything as NEW.
    let baseline = true

    const idParam = selectedCampaignId === ALL ? "" : selectedCampaignId

    async function poll() {
      if (inFlight) return
      inFlight = true
      try {
        const url = idParam
          ? `/api/admin/live-feed/host?campaignId=${encodeURIComponent(idParam)}`
          : "/api/admin/live-feed/host"
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
        const data = await res.json()
        if (!mounted) return
        if (data.ok) {
          const incoming: HostFeedItem[] = data.items ?? []
          if (baseline) {
            setNewIds(new Set())
            baseline = false
          } else {
            const fresh = new Set<string>()
            for (const it of incoming) {
              if (!prevIdsRef.current.has(it.id)) fresh.add(it.id)
            }
            setNewIds(fresh)
          }
          prevIdsRef.current = new Set(incoming.map((i) => i.id))
          setItems(incoming)
          if (Array.isArray(data.campaigns)) setCampaigns(data.campaigns)
          setError(null)
          setLastUpdated(new Date())
        } else {
          // Keep last-good items visible; surface only a small note.
          setError(data.error || "Failed to load feed")
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return
        if (mounted) setError("Network error")
      } finally {
        inFlight = false
      }
    }

    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => {
      mounted = false
      clearInterval(interval)
      controller.abort()
    }
  }, [selectedCampaignId])

  return (
    <div className="flex flex-col gap-5">
      {/* Header: live status + freshness */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <span className="text-sm font-semibold uppercase tracking-wide text-foreground">Live</span>
        </div>
        <div className="min-h-[16px] text-xs text-muted-foreground">
          {error ? (
            <span className="text-amber-600 dark:text-amber-400">Reconnecting…</span>
          ) : lastUpdated ? (
            <span>
              Updated{" "}
              {lastUpdated.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          ) : null}
        </div>
      </div>

      {/* Campaign filter (only the host's assigned comps) + compact metrics.
          The metrics strip sits directly under the selector and above the feed
          so winner activity stays high on the screen. */}
      {hasCampaigns && (
        <div className="flex flex-col gap-3">
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="w-full sm:max-w-xs" aria-label="Filter by competition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All my comps</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <HostLiveSummaryStrip selectedCampaignId={selectedCampaignId} initial={initialSummary} />
        </div>
      )}

      {/* Feed */}
      {!hasCampaigns ? (
        <EmptyState title="No competitions assigned yet." />
      ) : items.length === 0 ? (
        <EmptyState
          title="No prize wins yet."
          subtitle="New winners will appear here automatically."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const isNew = newIds.has(item.id)
            return (
              <li
                key={item.id}
                className={cn(
                  "rounded-xl border bg-card p-4 transition-colors",
                  isNew ? "border-primary/50 bg-primary/5" : "border-border",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    <Gift className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-pretty text-base font-bold leading-tight text-foreground">
                        {item.prizeTitle}
                      </p>
                      {isNew && (
                        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium text-foreground">{item.winnerName}</p>
                    {item.mobile && (
                      <a
                        href={`tel:${item.mobile.replace(/\s+/g, "")}`}
                        className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        aria-label={`Call ${item.winnerName} on ${item.mobile}`}
                      >
                        <Phone aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate tabular-nums">{item.mobile}</span>
                      </a>
                    )}
                    <p className="truncate text-xs text-muted-foreground">{item.campaignTitle}</p>
                  </div>
                  <time
                    dateTime={item.createdAt}
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                    title={new Date(item.createdAt).toLocaleString("en-GB")}
                  >
                    {relativeTime(item.createdAt)}
                  </time>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  )
}
