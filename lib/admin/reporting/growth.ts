/**
 * Growth Analytics v1 — shared types + PURE helpers.
 *
 * This module is intentionally free of server-only / React imports so it can be
 * used by the API route, the client components, AND the node test environment.
 * The payload shape mirrors get_admin_growth_dashboard() in
 * scripts/reporting/008-growth-dashboard-rpc.sql (camelCase, no identity fields).
 */

/** Safety cap on the number of live-campaign aggregates returned/rendered. */
export const MAX_LIVE_CAMPAIGNS = 50

export interface MetricComparison {
  current: number | null
  previous: number | null
  changePct: number | null
}

export interface GrowthCustomers {
  uniqueBuyers: MetricComparison
  ordersPerBuyer: MetricComparison
  externalRevenuePerBuyerPence: MetricComparison
  averageOrderValuePence: MetricComparison
}

export interface GrowthCheckoutHealth {
  created: number
  confirmed: number
  failed: number
  abandoned: number
  inProgress: number
  completedAttempts: number
  successRate: number | null
}

export interface GrowthWalletImpact {
  confirmedOrders: number
  walletOrders: number
  walletUsageRate: number | null
  walletCreditRedeemedPence: number
  externalCashFromWalletOrdersPence: number
  fullyWalletFundedOrders: number
  averageCreditPerWalletOrderPence: number | null
  externalCashPerCreditPound: number | null
}

export interface GrowthLiveCampaign {
  campaignId: string
  title: string
  slug: string
  status: string
  maxTickets: number
  lifetimeTicketsSold: number
  ticketsRemaining: number
  soldPercentage: number | null
  externalRevenuePeriodPence: number
  grossSalesPeriodPence: number
  creditPeriodPence: number
  confirmedOrdersPeriod: number
  ticketsPeriod: number
  averageOrderValuePence: number | null
  ticketsLast24Hours: number
  externalRevenueLast24HoursPence: number
  uniqueBuyersLast24Hours: number
  lastConfirmedAt: string | null
}

export interface GrowthDashboardPayload {
  period: {
    start: string
    end: string
    comparisonStart: string
    comparisonEnd: string
    timezone: 'Europe/London'
  }
  customers: GrowthCustomers
  checkoutHealth: GrowthCheckoutHealth
  walletImpact: GrowthWalletImpact
  liveCampaigns: GrowthLiveCampaign[]
  available: {
    campaigns: { id: string; title: string }[]
    providers: string[]
  }
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Pure helpers (node-testable). All monetary values are integer PENCE.
// ---------------------------------------------------------------------------

/**
 * Authoritative external-cash fallback for a single confirmed row. Mirrors the
 * SQL COALESCE(external_payment_pence, total_pence - COALESCE(wallet_credit_pence,0)).
 * Some historical rows have no saved external_payment_pence.
 */
export function externalPenceFallback(
  externalPaymentPence: number | null | undefined,
  totalPence: number,
  walletCreditPence: number | null | undefined,
): number {
  if (typeof externalPaymentPence === 'number' && Number.isFinite(externalPaymentPence)) {
    return externalPaymentPence
  }
  return totalPence - (walletCreditPence ?? 0)
}

/** A pending intent older than 30 minutes is "abandoned", otherwise "in progress". */
export const ABANDON_THRESHOLD_MS = 30 * 60 * 1000

export function classifyPending(
  createdAtMs: number,
  nowMs: number,
): 'in_progress' | 'abandoned' {
  return nowMs - createdAtMs >= ABANDON_THRESHOLD_MS ? 'abandoned' : 'in_progress'
}

/** Completed attempts exclude in-progress checkouts (confirmed + failed + abandoned). */
export function completedAttempts(h: {
  confirmed: number
  failed: number
  abandoned: number
}): number {
  return h.confirmed + h.failed + h.abandoned
}

/** Success rate = confirmed / completed attempts (0..1). Null when no completed attempts. */
export function successRate(h: {
  confirmed: number
  failed: number
  abandoned: number
}): number | null {
  const denom = completedAttempts(h)
  return denom > 0 ? h.confirmed / denom : null
}

/** Wallet usage rate = wallet-assisted orders / confirmed orders (0..1). Null when no orders. */
export function walletUsageRate(
  walletOrders: number,
  confirmedOrders: number,
): number | null {
  return confirmedOrders > 0 ? walletOrders / confirmedOrders : null
}

/**
 * External cash generated per £1 of credit redeemed. Pence/pence is a pure ratio
 * (e.g. 2.5 => £2.50 external per £1 credit). Null when no credit redeemed.
 */
export function externalCashPerCreditPound(
  externalCashFromWalletPence: number,
  creditRedeemedPence: number,
): number | null {
  return creditRedeemedPence > 0 ? externalCashFromWalletPence / creditRedeemedPence : null
}

/** Average credit used per wallet-assisted order, in pence. Null when none. */
export function averageCreditPerWalletOrderPence(
  creditRedeemedPence: number,
  walletOrders: number,
): number | null {
  return walletOrders > 0 ? Math.round(creditRedeemedPence / walletOrders) : null
}

/** Tickets remaining, clamped so it never displays below zero. */
export function ticketsRemaining(maxTickets: number, lifetimeSold: number): number {
  return Math.max(0, (maxTickets ?? 0) - (lifetimeSold ?? 0))
}

/** Sold percentage = lifetime sold / capacity * 100 (raw, unclamped). Null when no capacity. */
export function soldPercentage(
  lifetimeSold: number,
  maxTickets: number,
): number | null {
  if (!maxTickets || maxTickets <= 0) return null
  return (lifetimeSold / maxTickets) * 100
}

/** Clamp a percentage to a safe 0..100 visual range (preserve real values elsewhere). */
export function clampPercent(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

/** Format a ratio (e.g. orders/buyer) with fixed precision; "—" when null. */
export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

/** Format a 0..1 rate as a percentage string, e.g. 0.834 -> "83.4%". "—" when null. */
export function formatRate(rate: number | null | undefined, digits = 1): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(digits)}%`
}

/**
 * Build the mobile/desktop-agnostic view-model list for live campaigns.
 * MUST preserve every campaign (no filtering / truncation beyond the server cap)
 * and clamp derived visual percentages without mutating the real numbers.
 */
export interface LiveCampaignViewModel extends GrowthLiveCampaign {
  soldPercentageClamped: number
}

export function toCampaignViewModels(
  campaigns: GrowthLiveCampaign[],
): LiveCampaignViewModel[] {
  return campaigns.map((c) => ({
    ...c,
    soldPercentageClamped: clampPercent(c.soldPercentage),
  }))
}

// ---------------------------------------------------------------------------
// Request-shape helpers (shared by client + tests). Keep Growth to exactly one
// browser request per filter state, and NO request while Overview is active.
// ---------------------------------------------------------------------------

export interface GrowthQueryInput {
  range: string
  from?: string
  to?: string
  campaign?: string
  provider?: string
}

/** Build the query string for the Growth endpoint from a filter state. */
export function buildGrowthQuery(f: GrowthQueryInput): string {
  const p = new URLSearchParams()
  p.set('range', f.range)
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  }
  if (f.campaign) p.set('campaign', f.campaign)
  if (f.provider) p.set('provider', f.provider)
  return p.toString()
}

/**
 * SWR key for the Growth endpoint. Returns null when Growth is NOT the active
 * view (or the custom range is incomplete) so SWR performs no request at all —
 * this is what keeps Growth from fetching while Overview is selected.
 */
export function growthSwrKey(active: boolean, query: string): string | null {
  return active ? `/api/admin/growth?${query}` : null
}

/** Normalize an untrusted ?view value; anything unknown falls back to Overview. */
export type DashboardView = 'overview' | 'growth'
export function parseDashboardView(raw: string | null | undefined): DashboardView {
  return raw === 'growth' ? 'growth' : 'overview'
}

/** Keys that must NEVER appear anywhere in the Growth payload (privacy guard). */
const FORBIDDEN_IDENTITY_KEYS = [
  'user_id',
  'userId',
  'email',
  'name',
  'full_name',
  'fullName',
  'first_name',
  'last_name',
  'phone',
]

/**
 * Deep-scan an arbitrary payload for forbidden identity keys. Returns the list
 * of offending key paths (empty when clean). Used by tests + as a defensive
 * check before the API responds.
 */
export function findIdentityFields(value: unknown, path = ''): string[] {
  const hits: string[] = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findIdentityFields(v, `${path}[${i}]`)))
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_IDENTITY_KEYS.includes(key)) {
        hits.push(path ? `${path}.${key}` : key)
      }
      hits.push(...findIdentityFields(v, path ? `${path}.${key}` : key))
    }
  }
  return hits
}
