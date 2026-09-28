"use client"

import type { HostCampaignSummary } from "@/lib/admin/host-dashboard-types"

/**
 * "Since you opened" live-session deltas for the Host Dashboard.
 *
 * A host who leaves the dashboard open during a TikTok Live wants a simple
 * sense of what has happened THIS session: extra cash + extra tickets since they
 * opened the screen — without any "Start Live" workflow or DB writes.
 *
 * BASELINE STABILITY
 *   The baseline is captured from the FIRST values seen for each campaign and
 *   held in a module-level store. That means it:
 *     - does NOT reset on the 30s SWR refresh,
 *     - does NOT reset when a component remounts due to ordinary state changes
 *       (tab switches, navigating Home ↔ My Comps within the SPA),
 *     - DOES reset on a genuine new session (a full page load / hard reload
 *       re-initialises the module).
 *   Nothing is persisted to the database or to storage — session memory only.
 */

export interface SinceOpened {
  /** Extra external cash (pence) since the baseline. Never negative. */
  cashPence: number
  /** Extra tickets sold since the baseline. Never negative. */
  tickets: number
  /** True when there is something meaningful to show (either delta > 0). */
  hasProgress: boolean
}

interface Baseline {
  external: number
  tickets: number
}

// Module-level: survives component remounts + SWR refreshes within the page
// session; a full page load starts a fresh module (new baseline = new session).
const baselineStore = new Map<string, Baseline>()

/**
 * Ensure a baseline exists for each campaign (captured once, from first data)
 * and return the current positive deltas keyed by campaignId.
 *
 * Capture is idempotent (only sets when absent), so calling this during render
 * is safe and deterministic even under React strict-mode double invocation.
 */
export function useSinceOpened(campaigns: HostCampaignSummary[]): Map<string, SinceOpened> {
  const out = new Map<string, SinceOpened>()
  for (const c of campaigns) {
    if (!baselineStore.has(c.campaignId)) {
      baselineStore.set(c.campaignId, {
        external: c.externalPenceMonth,
        tickets: c.ticketsSold,
      })
    }
    const base = baselineStore.get(c.campaignId) as Baseline
    const cashPence = Math.max(0, c.externalPenceMonth - base.external)
    const tickets = Math.max(0, c.ticketsSold - base.tickets)
    out.set(c.campaignId, { cashPence, tickets, hasProgress: cashPence > 0 || tickets > 0 })
  }
  return out
}
