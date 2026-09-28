"use client"

import { useState, useMemo } from "react"
import Image from "next/image"
import { Zap, ChevronDown, ChevronUp, Gift, Crown } from "lucide-react"
import { cn } from "@/lib/utils"

// How many prize groups to show before the "View all instant prizes" toggle.
const INITIAL_DISPLAY_COUNT = 6

interface InstantWin {
  id: string
  title: string
  image_url?: string | null
  quantity?: number
  awarded_count?: number
  remaining_count?: number
  is_won: boolean
}

interface InstantWinListProps {
  instantWins: InstantWin[]
  /**
   * Section heading. Retained for backwards compatibility with existing
   * callers, but the value-led headline is now derived from the data.
   */
  heading?: string
  /** When true, the list is collapsed by default on mobile (desktop unaffected). */
  collapsibleOnMobile?: boolean
}

/**
 * Extract numeric cash value from prize title for display.
 * Examples: "£2,000" → 2000, "£500 Cash" → 500, "£10.50" → 10.5
 * Returns null if no cash value can be extracted (non-cash prizes).
 * This is display-only and does not affect database or slot ordering.
 */
function extractCashValue(title: string): number | null {
  const match = title.match(/£([\d,]+(?:\.\d{1,2})?)/)
  if (!match) return null
  const value = parseFloat(match[1].replace(/,/g, ""))
  return Number.isFinite(value) ? value : null
}

/** Format a numeric pounds value as GBP, hiding decimals when whole. */
function formatCurrency(value: number): string {
  const hasDecimals = !Number.isInteger(value)
  return (
    "£" +
    value.toLocaleString("en-GB", {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    })
  )
}

/**
 * Derive a short "type" label from the prize title by removing the leading
 * cash token (e.g. "£1,000 VIP Balloon" → "VIP Balloon"). Falls back to the
 * raw title, then to "Cash Prize" if nothing is left.
 */
function deriveTypeLabel(title: string, cashValue: number | null): string {
  if (cashValue === null) return title
  const stripped = title
    .replace(/£[\d,]+(?:\.\d{1,2})?/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  const cleaned = stripped
    .replace(/^[-–—:•|,]+/, "")
    .replace(/[-–—:•|,]+$/, "")
    .trim()
  return cleaned.length > 0 ? cleaned : "Cash Prize"
}

/**
 * Grouped instant win for display purposes only.
 * Aggregates quantity/awarded/remaining from prizes with identical titles.
 */
interface GroupedInstantWin {
  id: string
  title: string
  typeLabel: string
  image_url?: string | null
  totalQuantity: number
  totalAwarded: number
  totalRemaining: number
  count: number
  cashValue: number | null
  isVIP: boolean
  isFullyClaimed: boolean
}

/**
 * Group instant wins by exact title, then compute per-group aggregates used
 * for the value-led display. Display-only: does not alter source data,
 * snapshots, or DB records.
 */
function groupInstantWinsForDisplay(wins: InstantWin[]): GroupedInstantWin[] {
  const groups = new Map<string, GroupedInstantWin>()

  for (const win of wins) {
    const quantity = win.quantity ?? 1
    const remaining = win.remaining_count ?? (win.is_won ? 0 : quantity)
    const awarded = win.awarded_count ?? Math.max(quantity - remaining, 0)

    const existing = groups.get(win.title)
    if (existing) {
      existing.totalQuantity += quantity
      existing.totalAwarded += awarded
      existing.totalRemaining += remaining
      existing.count += 1
      if (!existing.image_url && win.image_url) {
        existing.image_url = win.image_url
      }
    } else {
      const cashValue = extractCashValue(win.title)
      groups.set(win.title, {
        id: win.id,
        title: win.title,
        typeLabel: deriveTypeLabel(win.title, cashValue),
        image_url: win.image_url,
        totalQuantity: quantity,
        totalAwarded: awarded,
        totalRemaining: remaining,
        count: 1,
        cashValue,
        isVIP: /vip/i.test(win.title),
        isFullyClaimed: false,
      })
    }
  }

  const result = Array.from(groups.values())
  for (const g of result) {
    g.isFullyClaimed = g.totalRemaining <= 0
  }
  return result
}

/**
 * Sort order (display-only):
 *   1. Available VIP — highest cash first
 *   2. Available standard — highest cash first
 *   3. Claimed VIP — highest cash first
 *   4. Claimed standard — highest cash first
 * Prizes without a parseable cash value sort last within their tier.
 */
function sortGroupsForDisplay(groups: GroupedInstantWin[]): GroupedInstantWin[] {
  return [...groups].sort((a, b) => {
    const availA = a.isFullyClaimed ? 1 : 0
    const availB = b.isFullyClaimed ? 1 : 0
    if (availA !== availB) return availA - availB

    const vipA = a.isVIP ? 0 : 1
    const vipB = b.isVIP ? 0 : 1
    if (vipA !== vipB) return vipA - vipB

    const cashA = a.cashValue ?? -1
    const cashB = b.cashValue ?? -1
    return cashB - cashA
  })
}

export function InstantWinList({ instantWins, collapsibleOnMobile = false }: InstantWinListProps) {
  const [expanded, setExpanded] = useState(false)
  // Mobile-only collapse toggle. Desktop always shows the list (md: overrides).
  const [mobileOpen, setMobileOpen] = useState(false)

  const groupedInstantWins = useMemo(() => {
    return sortGroupsForDisplay(groupInstantWinsForDisplay(instantWins))
  }, [instantWins])

  // Headline aggregates (deterministic, derived only from the existing prop).
  const { availablePrizeCount, availableCashTotal } = useMemo(() => {
    let count = 0
    let cash = 0
    for (const g of groupedInstantWins) {
      count += Math.max(g.totalRemaining, 0)
      if (g.cashValue !== null && g.totalRemaining > 0) {
        cash += g.cashValue * g.totalRemaining
      }
    }
    return { availablePrizeCount: count, availableCashTotal: cash }
  }, [groupedInstantWins])

  // Emphasis line ("3 VIP prizes + 77 balloon prizes"), derived only from the
  // existing grouped remaining counts. No invented values. The standard noun is
  // taken from the shared non-VIP title when there is exactly one and it is a
  // plain word (never a cash/number token); otherwise falls back to "instant".
  const emphasisLine = useMemo(() => {
    let vip = 0
    let standard = 0
    const standardTitles = new Set<string>()
    for (const g of groupedInstantWins) {
      if (g.totalRemaining <= 0) continue
      if (g.isVIP) {
        vip += g.totalRemaining
      } else {
        standard += g.totalRemaining
        standardTitles.add(g.title.toLowerCase().trim())
      }
    }
    let noun = "instant"
    if (standardTitles.size === 1) {
      const only = Array.from(standardTitles)[0]
      if (only.length > 0 && !/[£\d]/.test(only)) noun = only
    }
    const parts: string[] = []
    if (vip > 0) parts.push(`${vip} VIP ${vip === 1 ? "prize" : "prizes"}`)
    if (standard > 0) parts.push(`${standard} ${noun} ${standard === 1 ? "prize" : "prizes"}`)
    // Only show when both categories are present (matches the intended format).
    return parts.length > 1 ? parts.join(" + ") : ""
  }, [groupedInstantWins])

  if (!groupedInstantWins || groupedInstantWins.length === 0) return null

  const hasMore = groupedInstantWins.length > INITIAL_DISPLAY_COUNT
  const visibleItems = expanded ? groupedInstantWins : groupedInstantWins.slice(0, INITIAL_DISPLAY_COUNT)
  const showCashHeadline = availableCashTotal > 0

  return (
    <section className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-[#170a29] p-4 shadow-[0_8px_40px_rgba(0,0,0,0.35)] sm:p-5">
      {/* Subtle premium ambience — light gold glow near the VIP hero (top) and a
          faint magenta wash. No heavy gradients, no particles. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-fuchsia-600/10 blur-3xl"
      />

      <div className="relative">
        {/* ----- Structured marketing header ----- */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Zap className="size-4 text-amber-400" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Instant Wins</span>
          </div>

          <div className="flex items-center gap-2">
            {availablePrizeCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
                {availablePrizeCount} To Be Won
              </span>
            )}

            {collapsibleOnMobile && (
              <button
                type="button"
                onClick={() => setMobileOpen((prev) => !prev)}
                aria-expanded={mobileOpen}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-purple-500/30 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 md:hidden"
              >
                {mobileOpen ? (
                  <>
                    Hide
                    <ChevronUp className="size-3.5" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    View
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <h2 className="mt-3 text-pretty text-[26px] font-extrabold leading-[1.1] text-white sm:text-3xl">
          {availablePrizeCount > 0 ? (
            <>
              {availablePrizeCount} Instant {availablePrizeCount === 1 ? "Prize" : "Prizes"} To Be Won
            </>
          ) : (
            "All Instant Prizes Won"
          )}
        </h2>

        <p className="mt-1.5 text-sm leading-snug text-purple-200/70">
          Winning tickets reveal a prize instantly after entry.
        </p>

        {showCashHeadline && (
          <p className="mt-1.5 text-sm font-semibold text-amber-300">
            {formatCurrency(availableCashTotal)} instant cash to be won
          </p>
        )}

        {emphasisLine && <p className="mt-2 text-xs font-semibold text-amber-200/90">{emphasisLine}</p>}

        {/* ----- Prize cards ----- */}
        <div className={cn(collapsibleOnMobile && !mobileOpen ? "hidden md:block" : "block")}>
          {/*
            One premium card language across breakpoints: full-width horizontal
            cards (image left ~40%, content right). Mobile = single column;
            desktop = two columns. Never side-by-side on mobile, no carousel.
          */}
          <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {visibleItems.map((prize) => {
              const claimed = prize.isFullyClaimed

              return (
                <div
                  key={prize.id}
                  className={cn(
                    "group relative flex min-h-[116px] items-stretch overflow-hidden rounded-[14px] transition-colors",
                    prize.isVIP
                      ? "border border-amber-400/40 bg-amber-500/[0.07] shadow-[0_0_24px_rgba(245,180,0,0.16)] ring-1 ring-inset ring-amber-300/10"
                      : "border border-purple-500/20 bg-purple-900/25",
                    claimed && "opacity-55 saturate-50",
                  )}
                >
                  {/* Prize image — full-height left panel with edge fade so the
                      artwork reads as part of the card, not a pasted thumbnail. */}
                  <div className="relative w-[40%] shrink-0 self-stretch overflow-hidden bg-purple-950/40">
                    {prize.image_url ? (
                      <Image
                        src={prize.image_url || "/placeholder.svg"}
                        alt={prize.title}
                        fill
                        sizes="(max-width: 768px) 40vw, 20vw"
                        className="object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Gift
                          className={cn("size-9", prize.isVIP ? "text-amber-300/80" : "text-purple-300/70")}
                          aria-hidden="true"
                        />
                      </div>
                    )}
                    {/* Edge fade toward the content side */}
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-gradient-to-r from-transparent to-[#170a29]/80" />
                  </div>

                  {/* Content — category, title, microcopy, availability */}
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 flex-col justify-center gap-1 border-l px-3.5 py-3",
                      prize.isVIP ? "border-amber-400/25" : "border-fuchsia-500/40",
                    )}
                  >
                    {/* 1. Category label */}
                    {prize.isVIP ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300">
                        <Crown className="size-3" aria-hidden="true" />
                        VIP Prize
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-fuchsia-300/90">
                        Instant Prize
                      </span>
                    )}

                    {/* 2. Prize title (cash value leads when genuinely present) */}
                    {prize.cashValue !== null ? (
                      <p
                        className={cn(
                          "truncate text-2xl font-extrabold leading-none",
                          prize.isVIP ? "text-amber-300" : "text-white",
                        )}
                      >
                        {formatCurrency(prize.cashValue)}
                      </p>
                    ) : (
                      <p
                        className={cn(
                          "truncate leading-tight text-white",
                          prize.isVIP ? "text-lg font-extrabold" : "text-base font-bold",
                        )}
                      >
                        {prize.title}
                      </p>
                    )}

                    {/* 3. Supporting microcopy */}
                    <p className="truncate text-[11px] font-medium text-purple-200/70">
                      {prize.cashValue !== null
                        ? prize.typeLabel
                        : prize.isVIP
                          ? "Premium instant prize"
                          : "Instant prize reveal"}
                    </p>

                    {/* 4. Availability status — strong, high-contrast block */}
                    <div className="mt-0.5">
                      {claimed ? (
                        <span className="text-xs font-bold uppercase tracking-wide text-white/45">
                          Won {prize.totalAwarded} / {prize.totalQuantity}
                        </span>
                      ) : (
                        <span className="flex items-baseline gap-1.5">
                          <span
                            className={cn(
                              "text-base font-extrabold leading-none",
                              prize.isVIP ? "text-amber-300" : "text-emerald-300",
                            )}
                          >
                            {prize.totalRemaining} / {prize.totalQuantity}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-bold uppercase tracking-[0.12em]",
                              prize.isVIP ? "text-amber-200/80" : "text-emerald-200/80",
                            )}
                          >
                            To Be Won
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-purple-500/30 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              {expanded ? (
                <>
                  Show less
                  <ChevronUp className="size-4" aria-hidden="true" />
                </>
              ) : (
                <>
                  View all instant prizes
                  <ChevronDown className="size-4" aria-hidden="true" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
