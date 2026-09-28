/**
 * Client-safe types for the Host Dashboard (Phase 3).
 *
 * Kept in a standalone module (NO `server-only` import) so both the server data
 * layer (lib/admin/host-dashboard.ts) and the client components can share the
 * exact same payload shape. All monetary values are integer PENCE (GBP) and are
 * only divided by 100 at the display boundary.
 */

/** One of the host's assigned campaigns, scoped + costed for THIS host only. */
export interface HostCampaignSummary {
  campaignId: string
  title: string
  status: string
  /** Convenience flags derived from status server-side. */
  isActive: boolean // live or paused (currently running)
  isEnded: boolean // ended
  /** THIS host's own commission rate, e.g. 7.5 (never another host's). */
  commissionPct: number
  /**
   * External cash collected THIS MONTH so far (pence), UK calendar month.
   * Hybrid: completed previous days (reporting_sales_daily) + today
   * (reporting_sales_minute). Excludes wallet/site credit. No double-count.
   */
  externalPenceMonth: number
  /** External cash collected TODAY so far (pence), UK calendar day. */
  externalPenceToday: number
  /** externalPenceMonth * commissionPct / 100, rounded to whole pence. */
  earningsPenceMonth: number
  /** Tickets sold (lifetime, from the ticket counter: next_ticket - 1). */
  ticketsSold: number
  /** Tickets remaining against the cap, or null when uncapped/unknown. */
  ticketsRemaining: number | null
  /** Lifetime percentage of tickets sold (0–100), or null when uncapped/unknown. */
  pctSold: number | null
  /** Ticket cap (denominator for progress), or null when uncapped. */
  maxTicketsTotal: number | null
}

/**
 * One previous UK calendar month of estimated host earnings (Earnings screen).
 *
 * Derived from reporting_sales_daily for the host's own campaigns; earnings are
 * computed per-campaign (each × that campaign's commission rate) then summed,
 * so a host with different rates on different comps is costed correctly. This is
 * ESTIMATED (there is no payout ledger) and uses each campaign's CURRENT
 * commission rate — see the note in getHostPastEarnings.
 */
export interface HostPastMonth {
  /** 'YYYY-MM' (UK month). */
  monthKey: string
  /** Human label, e.g. "July 2026". */
  label: string
  /** External cash across the host's campaigns that month (pence). */
  hostedCashPence: number
  /** This host's estimated commission that month (pence). */
  estimatedEarningsPence: number
}

/** The complete host dashboard payload returned to the browser. */
export interface HostDashboardPayload {
  /** Friendly first-name/label for the greeting (never another host's data). */
  hostName: string
  month: {
    /** e.g. "This month". */
    label: string
    /** Sum of each assigned campaign's external cash this month (pence). */
    hostedCashPence: number
    /** Sum of this host's estimated earnings across assigned campaigns (pence). */
    estimatedEarningsPence: number
  }
  campaigns: HostCampaignSummary[]
  meta: {
    /** When the underlying reporting aggregates were last refreshed (ISO), or null. */
    lastRefreshAt: string | null
    /** When this payload was generated (ISO). */
    generatedAt: string
  }
}
