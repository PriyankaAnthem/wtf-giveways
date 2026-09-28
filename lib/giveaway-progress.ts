/**
 * Single source of truth for public giveaway sold-progress + status state.
 *
 * Used by the homepage cards, the /giveaways catalogue cards and the
 * individual giveaway TicketSelector so every surface agrees on the number
 * shown and on WHEN the "Just Launched" treatment appears.
 *
 * FRONTEND ONLY. This derives entirely from values already loaded
 * (tickets_sold / hard_cap_total_tickets, or the detail page's live sold
 * count). It performs no I/O and changes no counts.
 */

export type SoldStateKind =
  | "soldout"
  | "ended"
  | "almost"
  | "fast"
  | "launched"
  | "normal"
  | "none"

export interface SoldStateInput {
  sold: number | null | undefined
  cap: number | null | undefined
  /** True when the draw has closed/ended — suppresses the launch treatment. */
  ended?: boolean
}

export interface SoldState {
  /** Whether we have a valid positive capacity to compute against. */
  hasCap: boolean
  /** Unrounded 0..100 percentage, or null when there is no valid capacity. */
  rawPercent: number | null
  /** Displayed percentage — ALWAYS Math.floor(rawPercent). Null when no cap. */
  displayPercent: number | null
  /** Tickets remaining (never negative), or null when there is no valid cap. */
  remaining: number | null
  soldOut: boolean
  /**
   * True only when the TRUE unrounded percentage is strictly below 2% AND the
   * draw is neither sold out nor ended. At exactly 2.00% this is false.
   */
  isJustLaunched: boolean
  /** Highest-priority status for this giveaway (see SoldStateKind order). */
  state: SoldStateKind
}

/** Launch treatment shows while rawPercent is strictly below this value. */
export const JUST_LAUNCHED_MAX_PERCENT = 2

export function getSoldState({ sold, cap, ended = false }: SoldStateInput): SoldState {
  const s = Number(sold ?? 0)
  const c = Number(cap ?? 0)
  const hasCap = Number.isFinite(c) && c > 0 && Number.isFinite(s)

  if (!hasCap) {
    return {
      hasCap: false,
      rawPercent: null,
      displayPercent: null,
      remaining: null,
      soldOut: false,
      isJustLaunched: false,
      state: "none",
    }
  }

  const safeSold = Math.max(0, s)
  const rawPercent = Math.min(100, (safeSold / c) * 100)
  const displayPercent = Math.floor(rawPercent)
  const remaining = Math.max(0, c - safeSold)
  const soldOut = remaining === 0 || rawPercent >= 100
  const isJustLaunched = !ended && !soldOut && rawPercent < JUST_LAUNCHED_MAX_PERCENT

  let state: SoldStateKind
  if (soldOut) state = "soldout"
  else if (ended) state = "ended"
  else if (rawPercent >= 90) state = "almost"
  else if (rawPercent >= 70) state = "fast"
  else if (isJustLaunched) state = "launched"
  else state = "normal"

  return { hasCap, rawPercent, displayPercent, remaining, soldOut, isJustLaunched, state }
}
