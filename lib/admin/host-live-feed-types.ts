/**
 * Client-safe types for the Host Live Feed (Phase 4).
 *
 * Standalone module (NO `server-only` import) so the server data layer
 * (lib/admin/host-live-feed.ts), the API route and the client stream component
 * all share one payload shape.
 *
 * PRIVACY: this Host/Admin-only feed carries the winner's name and mobile
 * number (hosts need to call winners during TikTok lives), the prize, the
 * competition and the time — and nothing else private (no checkout/entry/ticket
 * ids, payment data or earnings). Because it includes a mobile number, NOTHING
 * here may ever be exposed to a public or customer-facing surface; it is only
 * served through the secured, host-scoped winner-feed endpoint.
 */

/** One of the authenticated host's assigned campaigns (for the filter menu). */
export interface HostFeedCampaignOption {
  id: string
  title: string
}

/** A single winner event, already resolved + scoped for THIS host. */
export interface HostFeedItem {
  /** Synthetic, stable id — contains NO checkout/entry/customer identifiers. */
  id: string
  /** ISO timestamp the prize was awarded. */
  createdAt: string
  /** Readable winner name (real name if available, else public display name). */
  winnerName: string
  /**
   * Winner's mobile number, or null when none is on file. PRIVATE — for the
   * host to call the winner during a live. Never rendered on public surfaces.
   */
  mobile: string | null
  /** Prize title, e.g. "£250 Cash". */
  prizeTitle: string
  /** Which assigned competition this win belongs to. */
  campaignId: string
  campaignTitle: string
}

/** The complete host live-feed payload returned to the browser. */
export interface HostLiveFeedPayload {
  /** All campaigns assigned to the authenticated host (for the filter menu). */
  campaigns: HostFeedCampaignOption[]
  /** Latest winner events (bounded), newest first. */
  items: HostFeedItem[]
  /** When this payload was generated (ISO). */
  generatedAt: string
}

/**
 * Compact live-performance summary shown ABOVE the winner feed while a host
 * runs a TikTok live. All money is external cash (external_pence) in integer
 * pence — site/wallet credit is NEVER included. Scoped server-side to the
 * authenticated host's assigned campaigns; when `campaignId` is null the figures
 * aggregate across ONLY those assigned campaigns (each counted once).
 *
 * Refreshed on its own ~30s cadence (NOT the 10s winner poll), because these
 * come from the ~1-minute reporting rollup and a true daily award count, so
 * polling them every 10s would add load without adding freshness.
 */
export interface HostLiveSummary {
  /** The selection this summary is for: a specific assigned id, or null = all. */
  campaignId: string | null
  /** External cash ticket sales TODAY (pence, Europe/London day). */
  revenueTodayPence: number
  /** True COUNT of instant prizes won TODAY (Europe/London day) — not feed rows. */
  instantsToday: number
  /** Lifetime external cash ticket revenue for the selection (pence). */
  compTotalPence: number
  /** When this summary was generated (ISO). */
  generatedAt: string
}
