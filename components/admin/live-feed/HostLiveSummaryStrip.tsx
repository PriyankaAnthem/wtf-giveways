"use client"

import { useEffect, useRef, useState } from "react"
import { formatPence, formatPenceCompact, formatCount } from "@/lib/admin/reporting/format"
import type { HostLiveSummary } from "@/lib/admin/host-live-feed-types"

/**
 * Compact live-performance strip shown directly under the competition selector
 * and ABOVE the winner feed. Three columns — Revenue Today, Instants Today,
 * Comp Total — in a SINGLE card so the feed stays high on the screen (no tall
 * dashboard cards pushing winners down).
 *
 * Polls its own endpoint ~every 30s (NOT the 10s winner feed): these figures
 * come from the ~1-minute reporting rollup + a daily award count, so a faster
 * poll would add load without adding freshness. Keeps the last-good values on
 * screen during a refresh or transient error (no flashing/zeroing).
 *
 * `selectedCampaignId` mirrors the feed's filter ("all" or an assigned id); the
 * server clamps it to the host's assigned campaigns, so it can only ever show
 * the host's own figures.
 */
const SUMMARY_POLL_MS = 30000
const ALL = "all"

export function HostLiveSummaryStrip({
  selectedCampaignId,
  initial,
}: {
  selectedCampaignId: string
  initial: HostLiveSummary | null
}) {
  // Seed from SSR only when it matches the initial "all" selection.
  const [summary, setSummary] = useState<HostLiveSummary | null>(
    selectedCampaignId === ALL ? initial : null,
  )
  const inFlightRef = useRef(false)

  useEffect(() => {
    let mounted = true
    const controller = new AbortController()
    inFlightRef.current = false

    const idParam = selectedCampaignId === ALL ? "" : selectedCampaignId

    async function poll() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const url = idParam
          ? `/api/admin/live-feed/host/summary?campaignId=${encodeURIComponent(idParam)}`
          : "/api/admin/live-feed/host/summary"
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
        const data = await res.json()
        if (!mounted) return
        if (data?.ok) {
          setSummary({
            campaignId: data.campaignId ?? null,
            revenueTodayPence: Number(data.revenueTodayPence ?? 0),
            instantsToday: Number(data.instantsToday ?? 0),
            compTotalPence: Number(data.compTotalPence ?? 0),
            generatedAt: data.generatedAt ?? new Date().toISOString(),
          })
        }
        // On !ok / network error: keep last-good values (no zeroing).
      } catch {
        /* keep last-good values */
      } finally {
        inFlightRef.current = false
      }
    }

    poll()
    const interval = setInterval(poll, SUMMARY_POLL_MS)
    return () => {
      mounted = false
      clearInterval(interval)
      controller.abort()
    }
  }, [selectedCampaignId])

  const revenueToday = summary?.revenueTodayPence ?? 0
  const instantsToday = summary?.instantsToday ?? 0
  const compTotal = summary?.compTotalPence ?? 0

  return (
    <section
      aria-label="Live performance summary"
      className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card"
    >
      <Metric label="Today" value={formatPence(revenueToday)} />
      <Metric label="Instants today" value={formatCount(instantsToday)} />
      {/* Comp total can be large — compact (£10.8k) so three columns never wrap
          or scroll at ~430px; full precision lives on the dashboard. */}
      <Metric label="Comp total" value={formatPenceCompact(compTotal)} title={formatPence(compTotal)} />
    </section>
  )
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-2 py-2.5 text-center">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className="w-full truncate text-lg font-bold tabular-nums text-foreground sm:text-xl"
        title={title}
      >
        {value}
      </span>
    </div>
  )
}
