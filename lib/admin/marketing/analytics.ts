/**
 * Marketing analytics — client-safe types, normalisation and pure helpers.
 *
 * This module is the single source of truth for the shape of
 * `get_marketing_admin_analytics(p_days)` and the small amount of derived,
 * display-only maths the UI needs (revenue-per-order, winner gating, period
 * mapping). It is deliberately client-safe: NO server-only imports, so it can
 * be used by both the API route and the client Overview components, and unit
 * tested in the Node environment.
 *
 * MONEY: every *Pence field is an integer number of pence (GBP). We never do
 * floating-point maths on pence beyond integer division for a per-order figure;
 * all currency formatting happens at the display boundary via
 * `lib/admin/reporting/format` (`formatPence`).
 *
 * ATTRIBUTION: this is conservative 7-day last-click attribution. The UI must
 * always label it "7-day click-attributed revenue" and must NEVER describe it
 * as causal, incremental, or "revenue marketing caused".
 */

/** The three supported period selections, mapped to the RPC's `p_days` arg. */
export type MarketingPeriod = 'today' | '7d' | '30d'

export const MARKETING_PERIOD_DAYS: Record<MarketingPeriod, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
}

export const DEFAULT_MARKETING_PERIOD: MarketingPeriod = '7d'

/** Human label used for the attribution model everywhere in the UI. */
export const ATTRIBUTION_LABEL = '7-day click-attributed revenue'

/** The six lifecycle automations that must always be shown, even at zero. */
export const AUTOMATION_DISPLAY_ORDER = [
  'Abandoned Checkout',
  'WTF Credit',
  'VIP Early Access',
  'Regular Buyer',
  'New Account',
  'Lapsed Customer',
] as const

/** Coerce an unknown JSON value into a finite number, defaulting to 0. */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Payload types (camelCase, mirror the RPC JSON exactly).
// ---------------------------------------------------------------------------

export interface MarketingAnalyticsSummary {
  sent: number
  delivered: number
  clicked: number
  ctrPct: number
  convertingRecipients: number
  attributedOrders: number
  purchaseConversionPct: number
  grossSalesPence: number
  externalCashPence: number
  walletCreditPence: number
  revenuePerDeliveredPence: number
}

export interface MarketingAnalyticsAutomation {
  opportunityType: string
  name: string
  sent: number
  delivered: number
  clicked: number
  ctrPct: number
  convertingRecipients: number
  attributedOrders: number
  purchaseConversionPct: number
  grossSalesPence: number
  externalCashPence: number
  walletCreditPence: number
  revenuePerDeliveredPence: number
}

export interface MarketingAnalyticsCampaign {
  campaignId: string
  title: string
  slug: string | null
  directSent: number
  directDelivered: number
  directClicked: number
  directCtrPct: number
  totalAttributedOrders: number
  directAttributedOrders: number
  lifecycleAttributedOrders: number
  grossSalesPence: number
  externalCashPence: number
  walletCreditPence: number
  directExternalCashPence: number
  lifecycleExternalCashPence: number
}

export interface MarketingAutomationWinner {
  opportunityType: string
  name: string
  externalCashPence: number
}

export interface MarketingCampaignWinner {
  campaignId: string
  title: string
  slug: string | null
  externalCashPence: number
}

export interface MarketingAnalyticsPayload {
  generatedAt: string
  periodDays: number
  periodStart: string
  attributionModel: string
  summary: MarketingAnalyticsSummary
  byAutomation: MarketingAnalyticsAutomation[]
  byCampaign: MarketingAnalyticsCampaign[]
  topAutomation: MarketingAutomationWinner | null
  topCampaign: MarketingCampaignWinner | null
}

// ---------------------------------------------------------------------------
// Normalisation — defends the UI against missing keys / nulls from the RPC.
// ---------------------------------------------------------------------------

function normalizeSummary(raw: Record<string, unknown> | null | undefined): MarketingAnalyticsSummary {
  const r = raw ?? {}
  return {
    sent: num(r.sent),
    delivered: num(r.delivered),
    clicked: num(r.clicked),
    ctrPct: num(r.ctrPct),
    convertingRecipients: num(r.convertingRecipients),
    attributedOrders: num(r.attributedOrders),
    purchaseConversionPct: num(r.purchaseConversionPct),
    grossSalesPence: num(r.grossSalesPence),
    externalCashPence: num(r.externalCashPence),
    walletCreditPence: num(r.walletCreditPence),
    revenuePerDeliveredPence: num(r.revenuePerDeliveredPence),
  }
}

function normalizeAutomation(raw: Record<string, unknown>): MarketingAnalyticsAutomation {
  return {
    opportunityType: str(raw.opportunityType),
    name: str(raw.name),
    sent: num(raw.sent),
    delivered: num(raw.delivered),
    clicked: num(raw.clicked),
    ctrPct: num(raw.ctrPct),
    convertingRecipients: num(raw.convertingRecipients),
    attributedOrders: num(raw.attributedOrders),
    purchaseConversionPct: num(raw.purchaseConversionPct),
    grossSalesPence: num(raw.grossSalesPence),
    externalCashPence: num(raw.externalCashPence),
    walletCreditPence: num(raw.walletCreditPence),
    revenuePerDeliveredPence: num(raw.revenuePerDeliveredPence),
  }
}

function normalizeCampaign(raw: Record<string, unknown>): MarketingAnalyticsCampaign {
  return {
    campaignId: str(raw.campaignId),
    title: str(raw.title),
    slug: strOrNull(raw.slug),
    directSent: num(raw.directSent),
    directDelivered: num(raw.directDelivered),
    directClicked: num(raw.directClicked),
    directCtrPct: num(raw.directCtrPct),
    totalAttributedOrders: num(raw.totalAttributedOrders),
    directAttributedOrders: num(raw.directAttributedOrders),
    lifecycleAttributedOrders: num(raw.lifecycleAttributedOrders),
    grossSalesPence: num(raw.grossSalesPence),
    externalCashPence: num(raw.externalCashPence),
    walletCreditPence: num(raw.walletCreditPence),
    directExternalCashPence: num(raw.directExternalCashPence),
    lifecycleExternalCashPence: num(raw.lifecycleExternalCashPence),
  }
}

function normalizeAutomationWinner(
  raw: Record<string, unknown> | null | undefined,
): MarketingAutomationWinner | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    opportunityType: str(raw.opportunityType),
    name: str(raw.name),
    externalCashPence: num(raw.externalCashPence),
  }
}

function normalizeCampaignWinner(
  raw: Record<string, unknown> | null | undefined,
): MarketingCampaignWinner | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    campaignId: str(raw.campaignId),
    title: str(raw.title),
    slug: strOrNull(raw.slug),
    externalCashPence: num(raw.externalCashPence),
  }
}

/**
 * Normalise the raw RPC JSON into a fully-populated, defensively-typed payload.
 * Any missing branch collapses to safe zeros / empty arrays / null so the UI
 * never has to guard against undefined.
 */
export function normalizeAnalytics(raw: unknown): MarketingAnalyticsPayload {
  const r = (raw ?? {}) as Record<string, unknown>
  const byAutomation = Array.isArray(r.byAutomation)
    ? (r.byAutomation as Record<string, unknown>[]).map(normalizeAutomation)
    : []
  const byCampaign = Array.isArray(r.byCampaign)
    ? (r.byCampaign as Record<string, unknown>[]).map(normalizeCampaign)
    : []
  return {
    generatedAt: str(r.generatedAt) || new Date().toISOString(),
    periodDays: num(r.periodDays),
    periodStart: str(r.periodStart),
    attributionModel: str(r.attributionModel) || '7_day_last_click',
    summary: normalizeSummary(r.summary as Record<string, unknown> | null | undefined),
    byAutomation,
    byCampaign,
    topAutomation: normalizeAutomationWinner(r.topAutomation as Record<string, unknown> | null | undefined),
    topCampaign: normalizeCampaignWinner(r.topCampaign as Record<string, unknown> | null | undefined),
  }
}

// ---------------------------------------------------------------------------
// Pure display helpers.
// ---------------------------------------------------------------------------

/**
 * Map a period selection to the RPC's `p_days` integer. Unknown values fall
 * back to the default (7) so a tampered query string can never reach the RPC
 * with an unexpected value.
 */
export function periodToDays(period: MarketingPeriod): number {
  return MARKETING_PERIOD_DAYS[period] ?? MARKETING_PERIOD_DAYS[DEFAULT_MARKETING_PERIOD]
}

/** Parse an untrusted `days` query value into a supported period, else default. */
export function parsePeriodDays(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (n === 1 || n === 7 || n === 30) return n
  return MARKETING_PERIOD_DAYS[DEFAULT_MARKETING_PERIOD]
}

/**
 * External cash generated per attributed order, in integer pence.
 *
 * Returns 0 when there are no attributed orders (so the UI shows "£0.00"),
 * never NaN or Infinity. Uses integer division so the result stays in whole
 * pence and formats cleanly.
 */
export function revenuePerOrderPence(externalCashPence: number, orders: number): number {
  const cash = num(externalCashPence)
  const n = num(orders)
  if (n <= 0) return 0
  return Math.round(cash / n)
}

/**
 * A winner is only a winner when it actually produced external cash. A
 * zero-revenue (or negative/absent) automation/campaign must NEVER be surfaced
 * as "best". Callers render "No attributed revenue yet" when this is false.
 */
export function isRevenueWinner(
  winner: { externalCashPence: number } | null | undefined,
): boolean {
  return !!winner && num(winner.externalCashPence) > 0
}

/**
 * Format an already-computed rate (e.g. a CTR or conversion percentage the RPC
 * returns as `12.5`) as a display string like "12.5%". Non-finite / missing
 * values render as "0.0%" so a table cell is never blank or "NaN%".
 */
export function formatRatePct(value: number | null | undefined): string {
  return `${num(value).toFixed(1)}%`
}

/**
 * Client-derived CTR from delivered/clicked counts, as a percentage number.
 *
 * The campaign rows are keyed on DIRECT delivery, and we compute CTR from the
 * raw counts rather than depending on a separately-rounded RPC field so the
 * ratio can never disagree with the Delivered/Clicks columns shown beside it.
 * Returns 0 when nothing was delivered (avoids divide-by-zero / Infinity).
 */
export function ctrFromCounts(clicked: number, delivered: number): number {
  const c = num(clicked)
  const d = num(delivered)
  if (d <= 0) return 0
  return (c / d) * 100
}
