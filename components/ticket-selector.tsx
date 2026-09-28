"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, CalendarClock, Flame, Zap, Crown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { FreeEntryInfo } from "@/components/free-entry-info"
import { getSoldState } from "@/lib/giveaway-progress"
import { JustLaunchedFrame } from "@/components/giveaway/just-launched-frame"

function formatGBP(amount: number | null | undefined) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return "\u2014"
  if (n < 1) return `${Math.round(n * 100)}p`
  return `£${n.toFixed(2)}`
}

interface BundleOption {
  quantity: number
  price_pence: number
  label?: string
}

interface LegacyBundle {
  qty: number
  price: number
  label?: string
}

interface TicketSelectorProps {
  basePrice: number
  bundles?: LegacyBundle[]
  campaignId: string
  soldCount?: number | null
  capTotal?: number | null
  startsAt?: string | null
  endsAt?: string | null
  ticketsSold?: number | null
  hardCapTotalTickets?: number | null
  isFreeEntry?: boolean
  freeEntryLimitPerUser?: number
  wasPricePence?: number | null
}

/**
 * Normalise bundles from either legacy format ({qty, price}) or
 * backend format ({quantity, price_pence}) into a consistent shape.
 */
function normaliseBundles(raw: any[] | undefined | null, basePricePence: number): BundleOption[] {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return []
  return raw.map((b: any) => {
    if (typeof b.quantity === "number" && typeof b.price_pence === "number") {
      return { quantity: b.quantity, price_pence: b.price_pence, label: b.label }
    }
    // Legacy format: { qty, price (in GBP) }
    return {
      quantity: Number(b.qty ?? b.quantity ?? 1),
      price_pence: Math.round(Number(b.price ?? 0) * 100) || (Number(b.qty ?? 1) * basePricePence),
      label: b.label,
    }
  }).sort((a, b) => a.quantity - b.quantity)
}

export function TicketSelector({ basePrice, bundles: rawBundles, campaignId, soldCount, capTotal, startsAt, endsAt, ticketsSold, hardCapTotalTickets, isFreeEntry, freeEntryLimitPerUser, wasPricePence }: TicketSelectorProps) {
  const basePricePence = Math.round(basePrice * 100)
  const normBundles = normaliseBundles(rawBundles, basePricePence)
  const hasBundles = normBundles.length > 0
  const hasSalePrice = wasPricePence != null && wasPricePence > basePricePence

  /* ---- Single source of truth state ---- */
  const [now, setNow] = useState(() => Date.now())
  const [qty, setQty] = useState<number>(1)
  const [selectedBundle, setSelectedBundle] = useState<BundleOption | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Starts pre-accepted so the CTA is active by default. The user can still
  // untick the visible checkbox, and the checkout guard below continues to
  // block entry while unticked.
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(true)
  const [qtyBump, setQtyBump] = useState(false)
  const [mounted, setMounted] = useState(false)

  const router = useRouter()

  // Synchronous navigation latch. Prevents a rapid double-click from pushing the
  // review route twice, while remaining recoverable if navigation fails.
  const navLatch = useRef(false)

  // Ref retained on the fixed mobile purchase bar (used only as an anchor; the
  // previous height-measuring spacer was removed because page-level bottom
  // clearance already keeps the last content clear of the fixed bar).
  const mobileBarRef = useRef<HTMLDivElement>(null)

  // Live sold count from API polling
  const [liveSoldCount, setLiveSoldCount] = useState<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { setMounted(true) }, [])

  // Poll live sold count every 30 seconds (production hotfix rate).
  // Hardened for production load: never overlaps requests, pauses while the
  // tab is hidden, aborts in-flight fetches on unmount, and keeps the last
  // known value on any failure. Fires immediately (initial display is not
  // delayed), then every 30s. No router.refresh, no page reload.
  useEffect(() => {
    if (!campaignId) return

    let stopped = false
    let inFlight = false
    let activeController: AbortController | null = null

    const fetchLiveCount = async () => {
      // Skip if the tab is hidden or a previous request is still running.
      if (typeof document !== 'undefined' && document.hidden) return
      if (inFlight) return
      inFlight = true

      activeController?.abort()
      const controller = new AbortController()
      activeController = controller

      try {
        const res = await fetch(`/api/giveaways/${campaignId}/live-count`, {
          signal: controller.signal,
        })
        if (res.ok) {
          const json = await res.json()
          if (!stopped && json.ok && typeof json.soldCount === 'number') {
            setLiveSoldCount(json.soldCount)
          }
        }
      } catch {
        // Network error / abort: silently keep the last known count.
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (!document.hidden) void fetchLiveCount()
    }

    // Initial fetch immediately (no delay), then steady 30s poll.
    void fetchLiveCount()
    const interval = setInterval(() => void fetchLiveCount(), 30000)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopped = true
      clearInterval(interval)
      activeController?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [campaignId])

  // Auto-select default bundle (smallest quantity) when bundles are available
  useEffect(() => {
    if (hasBundles && selectedBundle === null && normBundles.length > 0) {
      // Select the smallest bundle (normBundles is sorted ascending by quantity)
      const defaultBundle = normBundles[0]
      setSelectedBundle(defaultBundle)
      setQty(defaultBundle.quantity)
    }
  }, [hasBundles, normBundles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Live time gating ---- */
  const endsAtMs = endsAt ? new Date(endsAt).getTime() : null
  const startsAtMs = startsAt ? new Date(startsAt).getTime() : null
  const isEnded = endsAtMs !== null && !isNaN(endsAtMs) && now >= endsAtMs
  const isNotStarted = startsAtMs !== null && !isNaN(startsAtMs) && now < startsAtMs

  /* ---- Countdown values ---- */
  const msRemaining = endsAtMs ? Math.max(0, endsAtMs - now) : 0
  const totalSeconds = Math.floor(msRemaining / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  /* ---- Ended state ---- */
  if (isEnded) {
    return (
      <Card className="border border-purple-500/20 bg-[#160a26] p-6 text-center shadow-[0_0_40px_rgba(168,85,247,0.15)]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/50">
            <Clock className="h-6 w-6 text-purple-300" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">This draw has ended</h3>
            <p className="mt-1 text-sm leading-relaxed text-purple-200">
              Entries are closed. Winner details will appear below.
            </p>
          </div>
          <Badge variant="secondary" className="mt-1 border-purple-500/30 bg-purple-900/50 text-purple-200">Draw closed</Badge>
        </div>
      </Card>
    )
  }

  /* ---- Not started state ---- */
  if (isNotStarted) {
    return (
      <Card className="border border-purple-500/20 bg-[#160a26] p-6 text-center shadow-[0_0_40px_rgba(168,85,247,0.15)]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/50">
            <CalendarClock className="h-6 w-6 text-pink-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">This draw hasn{"'"}t started yet</h3>
            <p className="mt-1 text-sm leading-relaxed text-purple-200">
              Check back soon — entries will open shortly.
            </p>
          </div>
          <Badge variant="outline" className="mt-1 border-purple-500/30 text-purple-200">Coming soon</Badge>
        </div>
      </Card>
    )
  }

  // Prefer live polled count, fall back to snapshot-derived props
  const displaySold = liveSoldCount ?? soldCount ?? ticketsSold ?? 0
  const displayCap = (hardCapTotalTickets && hardCapTotalTickets > 0) ? hardCapTotalTickets : capTotal
  const hasCapInfo = typeof displaySold === 'number' && typeof displayCap === 'number' && displayCap > 0
  const remaining = hasCapInfo ? Math.max(0, displayCap - displaySold) : null
  const maxQty = remaining !== null ? Math.min(500, remaining) : 500

  const soldPct = hasCapInfo ? Math.min(100, (displaySold / displayCap!) * 100) : 0

  // Shared source of truth: floored display %, launch state (< 2% true),
  // sold-out. The draw is already live here (not-started / ended states
  // returned earlier), so ended is false.
  const progress = getSoldState({ sold: displaySold, cap: displayCap, ended: false })
  const displayPct = progress.displayPercent ?? 0
  const showLaunchBanner = progress.isJustLaunched

  /* ---- Correct total calculation ---- */
  const totalPence = selectedBundle ? selectedBundle.price_pence : qty * basePricePence
  const totalGBP = totalPence / 100

  /* ---- Icons for bundle tiles ---- */
  const bundleIcons = [
    { icon: Flame, color: "text-orange-400" },
    { icon: Zap, color: "text-yellow-300" },
    { icon: Crown, color: "text-amber-300" },
  ]

  /* ---- Handlers ---- */
  const handleSelectBundle = (bundle: BundleOption) => {
    setSelectedBundle(bundle)
    setQty(bundle.quantity)
    setQtyBump(true)
    setTimeout(() => setQtyBump(false), 200)
  }

  const handleQuantityChange = (delta: number) => {
    setQty((prev) => Math.max(1, Math.min(maxQty, prev + delta)))
    setSelectedBundle(null)
    setQtyBump(true)
    setTimeout(() => setQtyBump(false), 200)
  }

  // The campaign selector no longer creates a checkout intent or opens the
  // payment provider. It validates locally (terms + quantity) and hands off to
  // the dedicated review route, which is the ONLY place a checkout is created.
  const handleEnter = () => {
    if (!hasAcceptedTerms) {
      setError("Please confirm you are 18+ and agree to the T&Cs before entering.")
      return
    }
    if (!Number.isFinite(qty) || qty < 1 || remaining === 0) {
      setError("Please choose a valid ticket quantity.")
      return
    }

    // Ignore a rapid second click while a navigation is already in flight.
    if (navLatch.current) return
    navLatch.current = true
    setIsProcessing(true)
    setError(null)

    const params = new URLSearchParams()
    params.set("campaignId", campaignId)
    params.set("qty", String(qty))
    if (selectedBundle) {
      params.set("bundlePricePence", String(selectedBundle.price_pence))
    }

    try {
      router.push(`/checkout/review?${params.toString()}`)
    } catch {
      // A synchronous navigation failure is recoverable: reset the latch/state
      // so the customer can retry. Successful navigation unmounts the component
      // and keeps the latch set.
      navLatch.current = false
      setIsProcessing(false)
      setError("Something went wrong. Please try again.")
    }
  }

  /* ---- Compact custom quantity control ----
        A compact slider + / - stepper that shares the same qty state as the
        bundles, restoring fast quantity changes without the old full-height
        slider. Used directly under the bundle cards (and as the primary picker
        when there are no bundles). Respects min (1) and max (maxQty) via
        handleQuantityChange and the range input bounds. Moving the slider or
        +/- deselects any bundle (custom per-ticket pricing). */
  const customQuantity = (
    <div className="space-y-2 rounded-xl border border-purple-500/25 bg-white/[0.04] px-4 py-3">
      <span className="text-sm font-medium text-purple-200">
        {hasBundles ? "Need a different amount?" : "How many tickets?"}
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleQuantityChange(-1)}
          disabled={qty <= 1}
          aria-label="Decrease tickets"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-900/60 text-2xl font-bold leading-none text-purple-200 transition-all hover:bg-purple-800/80 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-purple-900/60 disabled:hover:text-purple-200"
        >
          &minus;
        </button>

        <input
          type="range"
          min={1}
          max={maxQty}
          value={qty}
          onChange={(e) => {
            const newQty = Number(e.target.value)
            setQty(newQty)
            setSelectedBundle(null)
            setQtyBump(true)
            setTimeout(() => setQtyBump(false), 200)
          }}
          aria-label={`Select quantity: ${qty} tickets`}
          className={cn(
            "h-3 flex-1 cursor-pointer appearance-none rounded-full bg-purple-900/50",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:h-8",
            "[&::-webkit-slider-thumb]:w-8",
            "[&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-gradient-to-b",
            "[&::-webkit-slider-thumb]:from-[#FFD46A]",
            "[&::-webkit-slider-thumb]:to-[#F7A600]",
            "[&::-webkit-slider-thumb]:border-2",
            "[&::-webkit-slider-thumb]:border-white/40",
            "[&::-webkit-slider-thumb]:cursor-grab",
            "[&::-webkit-slider-thumb]:shadow-[0_0_14px_rgba(247,166,0,0.55)]",
            "[&::-webkit-slider-thumb]:transition-transform",
            "[&::-webkit-slider-thumb]:active:scale-110",
            "[&::-webkit-slider-thumb]:active:cursor-grabbing",
            "[&::-moz-range-thumb]:h-8",
            "[&::-moz-range-thumb]:w-8",
            "[&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-gradient-to-b",
            "[&::-moz-range-thumb]:from-[#FFD46A]",
            "[&::-moz-range-thumb]:to-[#F7A600]",
            "[&::-moz-range-thumb]:border-2",
            "[&::-moz-range-thumb]:border-white/40",
            "[&::-moz-range-thumb]:cursor-grab",
            "[&::-moz-range-thumb]:shadow-[0_0_14px_rgba(247,166,0,0.55)]",
          )}
        />

        <button
          type="button"
          onClick={() => handleQuantityChange(1)}
          disabled={qty >= maxQty}
          aria-label="Increase tickets"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-900/60 text-2xl font-bold leading-none text-purple-200 transition-all hover:bg-purple-800/80 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-purple-900/60 disabled:hover:text-purple-200"
        >
          +
        </button>
      </div>
      <p
        className={cn(
          "text-center text-sm font-semibold tabular-nums text-purple-100 transition-transform duration-200",
          qtyBump && "scale-105",
        )}
        aria-live="polite"
      >
        {qty} {qty === 1 ? "ticket" : "tickets"} selected
      </p>
    </div>
  )

  return (
    <div className="space-y-4">

      {/* ---- JUST LAUNCHED banner (< 2% sold) ----
          Sits above the normal progress/ticket area. No percentage here — the
          genuine sold % is shown immediately underneath in the countdown /
          progress rows. Flame-led perimeter draws attention; the ticket
          controls below remain visually dominant and fully functional. */}
      {showLaunchBanner && (
        <JustLaunchedFrame radius={16} ringWidth={2} className="block">
          <div className="rounded-2xl bg-[#12061c] px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Zap className="wtf-jl-bolt h-5 w-5 shrink-0 text-orange-400" fill="currentColor" aria-hidden="true" />
              <span className="wtf-jl-headline text-lg font-black uppercase tracking-wide text-white">
                Just Launched
              </span>
            </div>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-orange-200/80">
              Be one of the first
            </p>
          </div>
        </JustLaunchedFrame>
      )}

      {/* ---- Countdown Timer ---- */}
      {endsAtMs && msRemaining > 0 && (
        <>
          {/* Mobile: compact urgency row + thin progress bar (much shorter than
              the four-box grid, so the buying controls surface sooner). */}
          <div className="rounded-xl border border-purple-500/30 bg-[#160a26] px-3 py-2.5 shadow-[0_0_20px_rgba(168,85,247,0.2)] md:hidden" role="timer" aria-label={`Draw ends in ${days} days, ${hours} hours, ${minutes} minutes`}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-purple-100">
                Draw ends in{" "}
                <span className="tabular-nums text-amber-400">{days}d {hours}h</span>
              </span>
              {hasCapInfo && (
                <span className="font-semibold tabular-nums text-amber-400">{displayPct}% sold</span>
              )}
            </div>
            {hasCapInfo && (
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                role="progressbar"
                aria-valuenow={displayPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${displayPct}% sold`}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700 ease-out"
                  style={{ width: mounted ? `${soldPct}%` : "0%" }}
                />
              </div>
            )}
          </div>

          {/* Desktop: 4-block countdown */}
          <div className="hidden rounded-2xl bg-[#160a26] p-5 shadow-[0_0_40px_rgba(168,85,247,0.25)] md:block">
            <div className="mb-2.5 text-center">
              <span className="text-xs font-semibold uppercase tracking-widest text-purple-300">Draw ends in</span>
            </div>
            <div className="flex justify-center gap-2" role="timer" aria-label={`Draw ends in ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`}>
              {[
                { value: days, label: "Days" },
                { value: hours, label: "Hrs" },
                { value: minutes, label: "Min" },
                { value: seconds, label: "Sec" },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center">
                  <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-lg border border-purple-600/30 bg-[#1f1033] shadow-inner">
                    <span className="bg-gradient-to-b from-[#FFD46A] to-[#F7A600] bg-clip-text text-4xl font-bold tabular-nums text-transparent">
                      {String(value).padStart(2, "0")}
                    </span>
                  </div>
                  <span className="mt-1.5 text-[10px] font-medium uppercase tracking-wider text-purple-300">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---- Sale Price Banner ---- */}
      {hasSalePrice && (
        <div className="rounded-xl border-2 border-green-500/50 bg-gradient-to-r from-green-900/30 to-emerald-900/30 p-4 shadow-[0_0_20px_rgba(34,197,94,0.2)]">
          <div className="flex items-center justify-center gap-3">
            <div className="flex flex-col items-center">
              <span className="text-xs font-medium text-white/60 line-through">Was {wasPricePence}p</span>
              <span className="text-2xl font-extrabold text-green-400">{basePricePence}p</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-green-300 animate-pulse">Tonight only</span>
            </div>
          </div>
        </div>
      )}

      {/* ---- Progress Bar (percentage only) — desktop only; mobile shows the
              compact bar inside the urgency row above. ---- */}
      {hasCapInfo && (
        <div className="hidden space-y-2 md:block">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-amber-400">{displayPct}% sold</span>
            {remaining === 0 && (
              <span className="font-bold text-red-400">Sold out</span>
            )}
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            role="progressbar"
            aria-valuenow={displayPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${displayPct}% sold`}
          >
            <div
              className="relative h-full overflow-hidden rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-amber-400 to-orange-500"
              style={{ width: mounted ? `${soldPct}%` : "0%" }}
            >
              <div className="absolute inset-0 animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" style={{ backgroundSize: "200% 100%" }} />
            </div>
          </div>
        </div>
      )}

      {/* ---- Bundle tiles (only when bundles exist) ----
          Count-adaptive layout (presentation only — selection, pricing, totals
          and checkout state are unchanged):
            1  → single centred card
            2  → 2-up cards
            3  → 3-up cards (the original, well-tuned layout)
            4-6 → compact full-width rows on mobile, balanced 2-column grid on
                  desktop (the 5th item is centred across the final row).
          Badges are rendered IN FLOW (no absolute ribbons), so they can never
          overflow a card/row or collide between rows. */}
      {hasBundles && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-purple-200">Choose your tickets</h3>
          {(() => {
            const count = normBundles.length
            // 4+ bundles use the compact row layout to avoid orphan cards,
            // narrow tiles and multi-row ribbon collisions.
            const useRows = count >= 4

            // Display-only: which bundle offers the biggest saving. Used purely
            // to render a "Best Value" badge — does not affect selection,
            // pricing, totals, or checkout state.
            let bestValueIdx = -1
            let bestSavings = 0
            normBundles.forEach((b, idx) => {
              const fp = b.quantity * basePricePence
              const sp = b.quantity > 1 && fp > 0 ? 1 - b.price_pence / fp : 0
              if (sp > bestSavings) {
                bestSavings = sp
                bestValueIdx = idx
              }
            })

            const containerClass = useRows
              ? "grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3"
              : count === 1
                ? "mx-auto w-full max-w-md"
                : count === 2
                  ? "grid grid-cols-2 gap-2 md:gap-3"
                  : "grid grid-cols-3 gap-2 md:gap-3"

            return (
              <div className={containerClass}>
                {normBundles.map((bundle, i) => {
                  const isActive = selectedBundle?.quantity === bundle.quantity && selectedBundle?.price_pence === bundle.price_pence
                  const fullPricePence = bundle.quantity * basePricePence
                  const savingsPercent = bundle.quantity > 1
                    ? Math.round((1 - (bundle.price_pence / fullPricePence)) * 100)
                    : 0
                  const iconDef = bundleIcons[i % bundleIcons.length]
                  const Icon = iconDef.icon
                  const isPopular = bundle.label?.toLowerCase().includes('popular') || (i === 1 && count >= 2)
                  // Single strongest badge (display only): Popular wins over Best Value.
                  const badge: { text: string; className: string } | null = isPopular
                    ? { text: "Most Popular", className: "from-yellow-400 to-yellow-600" }
                    : i === bestValueIdx && savingsPercent > 0
                      ? { text: "Best Value", className: "from-emerald-400 to-emerald-600" }
                      : null
                  const ariaLabel = `${bundle.quantity} ${bundle.quantity === 1 ? "ticket" : "tickets"} for ${formatGBP(bundle.price_pence / 100)}${savingsPercent > 0 ? `, save ${savingsPercent}%` : ""}`

                  /* ---- Compact row (4-6 bundles) ---- */
                  if (useRows) {
                    return (
                      <button
                        key={`${bundle.quantity}-${bundle.price_pence}`}
                        onClick={() => handleSelectBundle(bundle)}
                        aria-pressed={isActive}
                        aria-label={ariaLabel}
                        className={cn(
                          "relative flex min-h-[64px] w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300/70",
                          isActive
                            ? "border-pink-500 bg-pink-500/15 ring-2 ring-pink-400/40 shadow-[0_0_25px_rgba(236,72,153,0.35)]"
                            : "border-purple-500/25 bg-white/[0.04] hover:border-purple-400/50 hover:bg-white/[0.07]",
                          isPopular && !isActive && "border-amber-500/50",
                          // 5th bundle: centre it across the final desktop row so
                          // it never reads as an accidental orphan.
                          count === 5 && i === 4 && "md:col-span-2 md:w-[calc(50%-0.375rem)] md:justify-self-center",
                        )}
                      >
                        {/* LEFT: quantity + Tickets */}
                        <div className="flex shrink-0 flex-col items-center leading-none">
                          <span className="text-2xl font-black text-white">{bundle.quantity}</span>
                          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-purple-200">Tickets</span>
                        </div>

                        {/* CENTRE: badge (if any) + price */}
                        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                          {badge && (
                            <span className={cn("rounded-full bg-gradient-to-r px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black", badge.className)}>
                              {badge.text}
                            </span>
                          )}
                          <div className="flex items-baseline gap-1.5">
                            {savingsPercent > 0 && (
                              <span className="hidden text-xs text-white/40 line-through sm:inline">{formatGBP(fullPricePence / 100)}</span>
                            )}
                            <span className="text-xl font-black text-white">{formatGBP(bundle.price_pence / 100)}</span>
                          </div>
                        </div>

                        {/* RIGHT: saving + selected indicator */}
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {savingsPercent > 0 && (
                            <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                              Save {savingsPercent}%
                            </span>
                          )}
                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-pink-300">
                              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Selected
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  }

                  /* ---- Card (1-3 bundles) ---- */
                  return (
                    <button
                      key={`${bundle.quantity}-${bundle.price_pence}`}
                      onClick={() => handleSelectBundle(bundle)}
                      aria-pressed={isActive}
                      aria-label={ariaLabel}
                      className={cn(
                        "relative flex min-w-0 flex-col items-center justify-start gap-2 rounded-xl border-2 px-2 py-4 transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/70",
                        "md:gap-3 md:px-4 md:py-5",
                        isActive
                          ? "border-yellow-400 bg-yellow-500/15 shadow-[0_0_35px_rgba(255,215,0,0.4)] ring-2 ring-yellow-300/40 md:scale-[1.03]"
                          : "border-purple-500/25 bg-white/[0.04] hover:border-purple-400/50 hover:bg-white/[0.07]",
                        isPopular && !isActive && "border-amber-500/50 animate-[bundle-popular-glow_2.5s_ease-in-out_infinite]"
                      )}
                    >
                      {/* In-flow badge slot (fixed height keeps cards equal). */}
                      <div className="flex min-h-[1.25rem] items-center justify-center">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black md:text-[10px]">
                            <Check className="h-3 w-3" aria-hidden="true" /> Selected
                          </span>
                        ) : badge ? (
                          <span className={cn("rounded-full bg-gradient-to-r px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black md:text-[10px]", badge.className)}>
                            {badge.text}
                          </span>
                        ) : null}
                      </div>

                      {/* Icon - hidden on mobile, visible on desktop */}
                      <div className={cn(
                        "hidden md:flex h-10 w-10 items-center justify-center rounded-lg",
                        isActive ? "bg-yellow-500/20" : "bg-white/5"
                      )}>
                        <Icon className={cn("h-5 w-5", isActive ? "text-yellow-400" : iconDef.color)} aria-hidden="true" />
                      </div>

                      {/* Big ticket count */}
                      <div className="flex flex-col items-center leading-none">
                        <span className="text-2xl font-black text-white md:text-4xl">{bundle.quantity}</span>
                        <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-purple-200 md:text-xs">Tickets</span>
                      </div>

                      {/* Clear price + single save pill (strikethrough desktop-only
                          to keep mobile uncluttered). */}
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-baseline gap-1">
                          {savingsPercent > 0 && (
                            <span className="hidden text-xs text-white/40 line-through md:inline">{formatGBP(fullPricePence / 100)}</span>
                          )}
                          <span className="text-base font-black text-white md:text-2xl">{formatGBP(bundle.price_pence / 100)}</span>
                        </div>
                        {savingsPercent > 0 && (
                          <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 md:text-xs">
                            Save {savingsPercent}%
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })()}

          {/* Compact custom amount, directly under the bundle cards.
              Desktop only — on mobile the slider lives in the sticky bar. */}
          <div className="hidden md:block">{customQuantity}</div>
        </div>
      )}

      {/* When there are NO bundles, the compact stepper is the primary picker
          (desktop only — mobile uses the sticky bar slider). */}
      {!hasBundles && <div className="hidden md:block">{customQuantity}</div>}

      {/* ---- Total and CTA (desktop only) ----
          On mobile the sticky purchase bar below is the single checkout action,
          so this larger card is hidden to avoid duplication. */}
      <div className="hidden space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-lg md:block">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-purple-200">Total</span>
          <div className="text-right">
            <div className="bg-gradient-to-b from-[#FFD46A] to-[#F7A600] bg-clip-text text-3xl font-bold text-transparent">{formatGBP(totalGBP)}</div>
            <div className="text-xs text-purple-300">
              {qty} {qty === 1 ? "entry" : "entries"}
            </div>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-500/20 p-3 text-sm text-red-300">{error}</div>}

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasAcceptedTerms}
            onChange={(e) => setHasAcceptedTerms(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-purple-500/50 bg-white/10 accent-amber-500 focus:ring-2 focus:ring-amber-400 focus:ring-offset-0"
          />
          <span className="text-sm text-purple-200">
            I am 18+ years old and agree to the{" "}
            <a
              href="/terms"
              className="text-amber-400 underline underline-offset-2 hover:text-amber-300"
              onClick={(e) => e.stopPropagation()}
            >
              T&Cs
            </a>
          </span>
        </label>

        <Button
          size="lg"
          className="w-full rounded-xl bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] py-4 text-base font-bold text-black shadow-[0_10px_40px_rgba(255,180,0,0.4)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_15px_60px_rgba(255,180,0,0.6)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={isProcessing || qty < 1 || remaining === 0 || !hasAcceptedTerms}
          onClick={handleEnter}
        >
          {isProcessing ? "Starting checkout..." : "Enter Now"}
        </Button>

        <div className="text-center">
          <FreeEntryInfo />
        </div>
      </div>

      {/* ---- Mobile sticky purchase bar (mobile only) ----
          The single, always-visible checkout surface on giveaway detail pages.
          Mirrors the same qty / selectedBundle / hasAcceptedTerms state as the
          bundles and desktop card, so picking a bundle above instantly updates
          the slider, quantity and total here.           The normal mobile bottom nav is
          suppressed on these pages (see MobileNav).
          Bottom clearance so the last content scrolls clear of this fixed bar is
          provided by the page-level `h-52 md:hidden` spacer near the footer. */}
      <div
        ref={mobileBarRef}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-purple-500/40 bg-[#0e0618]/95 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(10,4,20,0.6)] backdrop-blur-xl md:hidden"
      >
        {/* Quantity + total summary */}
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "text-sm font-semibold tabular-nums text-white transition-transform duration-200",
              qtyBump && "scale-105",
            )}
            aria-live="polite"
          >
            {qty} {qty === 1 ? "ticket" : "tickets"}
          </span>
          <span className="bg-gradient-to-r from-[#FFD46A] to-[#F7A600] bg-clip-text text-xl font-bold text-transparent">
            {formatGBP(totalGBP)}
          </span>
        </div>

        {/* Compact [-] [slider] [+] control */}
        <div className="mt-2 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleQuantityChange(-1)}
            disabled={qty <= 1}
            aria-label="Decrease tickets"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-900/60 text-2xl font-bold leading-none text-purple-200 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            &minus;
          </button>
          <input
            type="range"
            min={1}
            max={maxQty}
            value={qty}
            onChange={(e) => {
              const newQty = Number(e.target.value)
              setQty(newQty)
              setSelectedBundle(null)
              setQtyBump(true)
              setTimeout(() => setQtyBump(false), 200)
            }}
            aria-label={`Select quantity: ${qty} tickets`}
            className={cn(
              "h-2.5 flex-1 cursor-pointer appearance-none rounded-full bg-purple-900/50",
              "[&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:h-7",
              "[&::-webkit-slider-thumb]:w-7",
              "[&::-webkit-slider-thumb]:rounded-full",
              "[&::-webkit-slider-thumb]:bg-gradient-to-b",
              "[&::-webkit-slider-thumb]:from-[#FFD46A]",
              "[&::-webkit-slider-thumb]:to-[#F7A600]",
              "[&::-webkit-slider-thumb]:border-2",
              "[&::-webkit-slider-thumb]:border-white/40",
              "[&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(247,166,0,0.55)]",
              "[&::-moz-range-thumb]:h-7",
              "[&::-moz-range-thumb]:w-7",
              "[&::-moz-range-thumb]:rounded-full",
              "[&::-moz-range-thumb]:bg-gradient-to-b",
              "[&::-moz-range-thumb]:from-[#FFD46A]",
              "[&::-moz-range-thumb]:to-[#F7A600]",
              "[&::-moz-range-thumb]:border-2",
              "[&::-moz-range-thumb]:border-white/40",
              "[&::-moz-range-thumb]:shadow-[0_0_12px_rgba(247,166,0,0.55)]",
            )}
          />
          <button
            type="button"
            onClick={() => handleQuantityChange(1)}
            disabled={qty >= maxQty}
            aria-label="Increase tickets"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-900/60 text-2xl font-bold leading-none text-purple-200 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>

        {error && <div className="mt-2 rounded-md bg-red-500/20 p-2 text-xs text-red-300">{error}</div>}

        {/* Compact 18+ / T&Cs row — explicit, never pre-ticked, blocks checkout */}
        <label className="mt-2 flex cursor-pointer select-none items-center gap-2">
          <input
            type="checkbox"
            checked={hasAcceptedTerms}
            onChange={(e) => setHasAcceptedTerms(e.target.checked)}
            className="h-4 w-4 shrink-0 rounded border-purple-500/50 bg-white/10 accent-amber-500 focus:ring-2 focus:ring-amber-400 focus:ring-offset-0"
          />
          <span className="text-xs text-purple-200">
            I am 18+ and agree to the{" "}
            <a
              href="/terms"
              className="text-amber-400 underline underline-offset-2 hover:text-amber-300"
              onClick={(e) => e.stopPropagation()}
            >
              T&Cs
            </a>
          </span>
        </label>

        <Button
          size="lg"
          className="mt-2 w-full rounded-xl bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] py-3.5 text-sm font-bold text-black shadow-[0_8px_30px_rgba(255,180,0,0.4)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isProcessing || qty < 1 || remaining === 0 || !hasAcceptedTerms}
          onClick={handleEnter}
        >
          {isProcessing
            ? "Starting checkout..."
            : remaining === 0
              ? "Sold out"
              : !hasAcceptedTerms
                ? "Accept T&Cs to enter"
                : "Enter Now"}
        </Button>

        {/* Free postal entry kept accessible right inside the purchase area */}
        <div className="text-center leading-none">
          <FreeEntryInfo />
        </div>
      </div>
    </div>
  )
}
