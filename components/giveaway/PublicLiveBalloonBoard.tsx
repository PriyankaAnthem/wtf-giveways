"use client"

import { useEffect, useRef, useState } from "react"
import { Crown } from "lucide-react"

/**
 * PUBLIC, customer-facing Live Balloon Board.
 *
 * Extremely lightweight: it polls a CDN-cached public endpoint
 * (`/api/giveaways/[campaignId]/live-board`) every 30s (production hotfix
 * rate), pauses while the tab is hidden, and shows only grouped prize values
 * still left to pop. No Supabase client, no Realtime, no admin APIs. It NEVER
 * permanently stops polling — a disabled board renders nothing but keeps
 * polling so it can appear the moment the host enables it mid-stream.
 *
 * Startup is staggered by 10s so this board's requests do not fire at the same
 * instant as the ticket-selector's live-count poll (both now on a 30s cycle).
 */

const POLL_MS = 30000
// Delay the first live-board fetch so it interleaves with the live-count poll
// (which fires immediately) rather than firing simultaneously every cycle.
const START_STAGGER_MS = 10000

// On mobile, only the top N rows show by default; the rest are behind a toggle.
// Desktop always shows the full list (md: overrides), so nothing changes there.
const MOBILE_TOP_COUNT = 5

type PublicItem = {
  id: string
  label: string
  type: "vip" | "standard"
  amountPence: number
  starting: number
  remaining: number
  featured: boolean
}

type BoardState = {
  enabled: boolean
  totals: { totalRemaining: number; standardRemaining: number; vipRemaining: number }
  items: PublicItem[]
}

function formatGBP(pence: number): string {
  const pounds = Math.round(pence) / 100
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(pounds) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(pounds)
}

// VIP first, then featured, then highest value to lowest.
function sortItems(items: PublicItem[]): PublicItem[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "vip" ? -1 : 1
    if (a.featured !== b.featured) return a.featured ? -1 : 1
    return b.amountPence - a.amountPence
  })
}

export function PublicLiveBalloonBoard({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<BoardState | null>(null)
  // Mobile-only "view all" toggle for the compact board. Desktop is unaffected.
  const [showAllMobile, setShowAllMobile] = useState(false)

  // Tracks the latest request so out-of-order responses are ignored.
  const requestSeq = useRef(0)

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    let startTimeoutId: ReturnType<typeof setTimeout> | null = null
    let activeController: AbortController | null = null
    let stopped = false
    let inFlight = false

    const fetchBoard = async () => {
      // Don't fetch while hidden — the visibility handler refetches on resume.
      if (typeof document !== "undefined" && document.hidden) return
      // Never overlap requests.
      if (inFlight) return
      inFlight = true

      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      const seq = ++requestSeq.current

      try {
        const res = await fetch(`/api/giveaways/${campaignId}/live-board`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()

        // Ignore stale/superseded responses and post-unmount resolves.
        if (stopped || seq !== requestSeq.current) return

        if (data?.ok && data.enabled === true) {
          setState({
            enabled: true,
            totals: data.totals ?? { totalRemaining: 0, standardRemaining: 0, vipRemaining: 0 },
            items: Array.isArray(data.items) ? data.items : [],
          })
        } else {
          // Disabled/ineligible: render nothing, but keep polling.
          setState({ enabled: false, totals: { totalRemaining: 0, standardRemaining: 0, vipRemaining: 0 }, items: [] })
        }
      } catch {
        // Network error / abort: keep last known state, keep polling.
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (!document.hidden) void fetchBoard()
    }

    // Staggered start: first fetch after 10s, then a steady 30s poll. This
    // interleaves with the live-count poll (which fires immediately) so the two
    // 30s timers never fire at the same instant.
    startTimeoutId = setTimeout(() => {
      if (stopped) return
      void fetchBoard()
      intervalId = setInterval(() => void fetchBoard(), POLL_MS)
    }, START_STAGGER_MS)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      stopped = true
      if (startTimeoutId) clearTimeout(startTimeoutId)
      if (intervalId) clearInterval(intervalId)
      activeController?.abort()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [campaignId])

  // Render nothing until enabled (but polling continues in the background).
  if (!state || !state.enabled) return null

  const visibleItems = sortItems(state.items.filter((it) => it.remaining > 0))

  // Top prize = highest remaining amountPence across items still left to pop.
  const topPrizePence = visibleItems.reduce((max, it) => (it.amountPence > max ? it.amountPence : max), 0)
  const hasVip = state.totals.vipRemaining > 0

  // Compact summary line, e.g. "30 balloons to be won · Top prize £1,000 · 3 VIP to be won".
  const summaryParts = [
    `${state.totals.totalRemaining} balloon${state.totals.totalRemaining === 1 ? "" : "s"} to be won`,
    topPrizePence > 0 ? `Top prize ${formatGBP(topPrizePence)}` : null,
    hasVip ? `${state.totals.vipRemaining} VIP to be won` : null,
  ].filter(Boolean) as string[]

  return (
    <section
      aria-label="Remaining Balloon Board"
      className="rounded-xl border border-purple-500/20 bg-white/5 p-4 backdrop-blur-sm"
    >
      {/* Neutral heading — no live dot or "live" wording. Hosts are not live
          24/7, so this board only communicates what balloons are still hidden,
          never that the host is currently streaming. */}
      <h2 className="text-lg font-semibold">Remaining Balloon Board</h2>
      <p className="mt-0.5 text-sm text-purple-200">Cash balloons still hidden</p>

      {/* Compact horizontal summary line (wraps on mobile, no large cards). */}
      <p className="mt-3 text-sm font-medium text-purple-100">
        {summaryParts.join(" · ")}
      </p>

      {/* Grouped prize values (tight list; never individual balloons).
          On mobile only the top rows show until "View all" is tapped; desktop
          (md:) always renders every row. */}
      {visibleItems.length > 0 ? (
        <ul className="mt-3 divide-y divide-purple-500/10 text-sm">
          {visibleItems.map((it, idx) => {
            const hiddenOnMobile = idx >= MOBILE_TOP_COUNT && !showAllMobile
            return (
              <li
                key={it.id}
                className={
                  (hiddenOnMobile ? "hidden md:flex" : "flex") +
                  " items-center justify-between gap-3 py-1.5"
                }
              >
                <span className="flex items-center gap-2 font-medium">
                  {it.type === "vip" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-300">
                      <Crown className="size-3" aria-hidden="true" />
                      VIP
                    </span>
                  )}
                  <span>{formatGBP(it.amountPence)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-purple-200">
                  {it.remaining === 1 ? "To be won" : `${it.remaining} to be won`}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 text-center text-sm text-purple-200">All prizes have been popped!</p>
      )}

      {/* Mobile-only expand/collapse; hidden on desktop where all rows show. */}
      {visibleItems.length > MOBILE_TOP_COUNT && (
        <button
          type="button"
          onClick={() => setShowAllMobile((prev) => !prev)}
          aria-expanded={showAllMobile}
          className="mt-3 flex w-full items-center justify-center rounded-lg border border-purple-500/30 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 md:hidden"
        >
          {showAllMobile ? "Show less" : "View all remaining prizes"}
        </button>
      )}

      <p className="mt-3 text-center text-xs text-purple-300/70">Updates automatically</p>
    </section>
  )
}
