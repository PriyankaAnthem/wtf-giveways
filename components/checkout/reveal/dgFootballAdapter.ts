/**
 * dgFootballAdapter — the SINGLE explicit adapter from the production
 * AwardPayload to the DG'S BIG BALLERS presentation model (RevealPlan).
 *
 * SAFETY: this file is PRESENTATION ONLY. It never decides whether a ticket
 * won, how many awards exist, which prizes were awarded, or any wallet/manual
 * fulfilment — all of that is already final in the AwardPayload produced
 * server-side by confirm_payment_and_award. The adapter only maps that decided
 * result into display data (quantity, ticket range, and per-award presentation
 * category / title / value / image). It introduces NO randomness and NO
 * win/loss decision.
 *
 * `prizes[]` IS THE SOURCE OF TRUTH (spec §8): the number of awards animated and
 * itemised is exactly `award.prizes.length`, with no cap. The legacy singular
 * `prize` is used only as a fallback when `prizes` is absent (older payloads).
 */

import type { Award, HoleId, Outcome, RevealPlan } from "@/components/reveal/dg-football/types"
import type { InstantWinFulfilmentType } from "@/lib/types/instantWins"

/**
 * Minimal prize shape this adapter reads. The first four fields match the
 * current `InstantWinResult` carried in `AwardPayload.prizes[]`.
 *
 * `fulfilment_type` / `prize_value_pence` are the CANONICAL, admin-chosen prize
 * classification (instant_win_prizes.fulfilment_type / prize_value_pence — the
 * money value is "never parsed from the title"). The live
 * confirm_payment_and_award RPC returns them on every prize and coercePrize
 * preserves them, so they are populated in production. They stay OPTIONAL only
 * so legacy payloads without them still type-check and fall back safely.
 */
export type DgFootballPrize = {
  award_id?: string | null
  title: string
  value_text?: string | null
  image_url?: string | null
  /** CANONICAL fulfilment method. When present it OVERRIDES title/value parsing. */
  fulfilment_type?: InstantWinFulfilmentType | null
  /** CANONICAL value in integer pence. Authoritative; never parsed from title. */
  prize_value_pence?: number | null
}

/** The subset of AwardPayload this presentation adapter reads. */
export type DgFootballAward = {
  qty: number
  won: boolean
  prize: DgFootballPrize | null
  prizes?: DgFootballPrize[]
  ticket_start?: number | null
  ticket_end?: number | null
}

/**
 * Cosmetic hole rotation. The five holes are PRESENTATION objects (spec §18) —
 * they never represent odds or a winner count. This order simply gives chained
 * wins visibly different holes; the orchestrator additionally prevents any two
 * consecutive shots sharing a hole and reuses/reloads holes past five.
 */
const HOLE_ROTATION: HoleId[] = [5, 1, 3, 4, 2]

/** Parse a strictly money-formatted GBP amount ("£100", "£5,000", "£12.50") to
 *  integer pence, or null when there is no such amount. */
function parseGbpPence(text: string): number | null {
  const gbp = text.toLowerCase().match(/£\s*([\d,]+(?:\.\d{1,2})?)/)
  return gbp ? Math.round(Number.parseFloat(gbp[1].replace(/,/g, "")) * 100) : null
}

/**
 * Classify an already-decided prize into a presentation Outcome.
 *
 * CLASSIFICATION PRIORITY (spec §2):
 *   1. CANONICAL `fulfilment_type` (admin-chosen) wins when present — a 'manual'
 *      prize is presented by its title even if its value text says "£500", and
 *      the money amount comes from the authoritative `prize_value_pence`, never
 *      the title. This is the safe path.
 *   2. FALLBACK title/value parsing (same convention as the other reveals:
 *      "credit" keyword → site credit; else a "£" amount → cash; else manual).
 *
 * The live confirm_payment_and_award RPC returns fulfilment_type +
 * prize_value_pence on every prize, and coercePrize now preserves them, so
 * production ALWAYS takes the canonical path. The fallback exists only for
 * legacy payloads that genuinely lack these fields (where a money-titled manual
 * prize like "£500 TV Bundle" cannot be distinguished from cash by text alone).
 *
 * NB: never fabricates a value. Manual prizes carry amountPence = 0 and are
 * presented by title (+ optional image), never a money figure (spec §15).
 */
export function classifyPrize(prize: DgFootballPrize): Outcome {
  const valueText = prize.value_text?.trim() ?? ""
  const title = prize.title?.trim() ?? ""

  // 1) CANONICAL fulfilment type is authoritative when present.
  const canonical = prize.fulfilment_type
  if (canonical === "manual") {
    return manualOutcome(prize, title, valueText)
  }
  if (canonical === "cash" || canonical === "wallet_credit") {
    const authoritativePence =
      typeof prize.prize_value_pence === "number" &&
      Number.isFinite(prize.prize_value_pence) &&
      prize.prize_value_pence > 0
        ? Math.round(prize.prize_value_pence)
        : parseGbpPence(`${valueText} ${title}`)
    if (authoritativePence != null && authoritativePence > 0) {
      return canonical === "wallet_credit"
        ? { kind: "credit", amountPence: authoritativePence, valueText: valueText || undefined }
        : { kind: "cash", amountPence: authoritativePence, valueText: valueText || undefined }
    }
    // Declared cash/credit but no positive amount anywhere → present as a named
    // award rather than a fabricated £0 money win.
    return manualOutcome(prize, title, valueText)
  }

  // 2) FALLBACK: no canonical type available (current AwardPayload shape).
  const text = `${valueText} ${title}`.toLowerCase()
  const amountPence = parseGbpPence(text)

  if (text.includes("credit")) {
    if (amountPence != null && amountPence > 0) {
      return { kind: "credit", amountPence, valueText: valueText || undefined }
    }
    // "credit" with no parseable value → treat as a manual/named award.
    return manualOutcome(prize, title, valueText)
  }

  if (amountPence != null && amountPence > 0) {
    return { kind: "cash", amountPence, valueText: valueText || undefined }
  }

  return manualOutcome(prize, title, valueText)
}

function manualOutcome(prize: DgFootballPrize, title: string, valueText: string): Outcome {
  return {
    kind: "manual",
    amountPence: 0,
    title: title || valueText || "A PRIZE",
    imageUrl: prize.image_url?.trim() || undefined,
    valueText: valueText || undefined,
  }
}

/** Compact ticket-range label for header parity (spec §19). Omitted when the
 *  start/end are absent or nonsensical. Uses an en-dash to match a "#a–#b" range. */
export function ticketRangeText(start?: number | null, end?: number | null): string | undefined {
  if (typeof start !== "number" || typeof end !== "number") return undefined
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  if (end < start) return undefined
  const fmt = (n: number) => n.toLocaleString("en-GB")
  if (start === end) return `TICKET #${fmt(start)}`
  return `TICKETS #${fmt(start)}\u2013#${fmt(end)}`
}

/**
 * Adapt an already-decided AwardPayload into the DG Football RevealPlan.
 *
 *  - ticketCount comes ONLY from qty (never from the 5 balls / 5 holes / award
 *    count — spec §17/§18).
 *  - awards is EXACTLY the prizes array (prizes[] is the source of truth), with
 *    a cosmetic hole assigned per award. No cap: 7 prizes → 7 awards.
 *  - 0 prizes → the zero-win experience (spec §16).
 */
export function awardToRevealPlan(award: DgFootballAward): RevealPlan {
  const qty = typeof award.qty === "number" && Number.isFinite(award.qty) && award.qty > 0 ? award.qty : 1

  const rawList =
    Array.isArray(award.prizes) && award.prizes.length > 0
      ? award.prizes
      : award.prize
        ? [award.prize]
        : []

  // Defensive: drop any prize without a usable title (mirrors the server-side
  // coercePrize) so a malformed row can never render as a blank award.
  const prizes = rawList.filter((p): p is DgFootballPrize => !!p && typeof p.title === "string" && p.title.trim().length > 0)

  const awards: Award[] = prizes.map((prize, i) => ({
    outcome: classifyPrize(prize),
    destinationHole: HOLE_ROTATION[i % HOLE_ROTATION.length],
  }))

  return {
    ticketCount: qty,
    awards,
    ticketRangeText: ticketRangeText(award.ticket_start, award.ticket_end),
  }
}
