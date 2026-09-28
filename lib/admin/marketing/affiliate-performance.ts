/**
 * Affiliate Performance — client-safe types, normalisation and pure helpers.
 *
 * Single source of truth for the shape of
 * `get_affiliate_performance(p_range, p_from, p_to, p_affiliate)` and the
 * display-only logic the UI needs. Deliberately client-safe (NO server-only
 * imports) so the API route, the client components, and Node unit tests can all
 * use it.
 *
 * It reuses the proven primitives from the Marketing Performance layer
 * (`./performance`): range vocabulary, numeric coercion, voucher labels, and
 * channel/source/campaign display maps. The RPC is a sibling of
 * `get_marketing_performance` and shares its money/voucher semantics.
 *
 * MONEY: every *Pence field is an integer number of pence (GBP). We NEVER do
 * financial maths in the browser — commission/revenue/voucher figures come from
 * the RPC already computed. Formatting happens at the display boundary via
 * `lib/admin/reporting/format`.
 *
 * COMMISSION TRUTH (critical):
 *  - `commissionPence === null` means NO configured commission data — render
 *    "Not configured", NEVER "£0.00".
 *  - `commissionPence === 0` means a genuine £0 configured result — render
 *    "£0.00".
 *  - `commissionConfiguredOrders` / `commissionUnconfiguredOrders` let the UI
 *    warn when SOME orders in a group are missing a rate.
 *
 * VOUCHER TRUTH: usage % denominator is KNOWN orders only (code + no_voucher);
 * unknown orders are surfaced separately. Discount is "Known Discount" only.
 */

import {
  PERFORMANCE_RANGES,
  PERFORMANCE_RANGE_LABELS,
  DEFAULT_PERFORMANCE_RANGE,
  parsePerformanceRange,
  num,
  numOrNull,
  channelLabel,
  sourceLabel,
  prettifySlug,
  formatPct,
  type PerformanceRange,
} from './performance'

// Re-export the shared range + display vocabulary so affiliate UI/tests can
// import everything from one module.
export {
  PERFORMANCE_RANGES,
  PERFORMANCE_RANGE_LABELS,
  DEFAULT_PERFORMANCE_RANGE,
  parsePerformanceRange,
  channelLabel,
  sourceLabel,
  prettifySlug,
  formatPct,
  type PerformanceRange,
}

// ---------------------------------------------------------------------------
// Local coercion for strings (performance.ts keeps these private).
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Known-discount is emitted by the RPC as discountGivenPence; accept either. */
function knownDiscount(raw: Record<string, unknown>): number {
  return num(raw.knownDiscountGivenPence ?? raw.discountGivenPence)
}

/**
 * Commission pence coercion that PRESERVES null (unconfigured) as distinct from
 * 0 (genuine £0). `numOrNull` already returns null for any non-finite value, so
 * a JSON `null` stays null and a real `0` stays 0.
 */
function commissionPence(raw: Record<string, unknown>): number | null {
  return numOrNull(raw.commissionPence)
}

// ---------------------------------------------------------------------------
// Payload types (camelCase; mirror the RPC JSON exactly).
// ---------------------------------------------------------------------------

export type AffiliatePerformanceMode = 'leaderboard' | 'detail'

export interface AffiliatePerformancePeriod {
  start: string
  end: string
  timezone: 'Europe/London'
}

/** Commission fields shared by summary, leaderboard rows and drilldown rows. */
export interface CommissionFields {
  /** null = no configured commission data; 0 = genuine £0. Never coerce. */
  commissionPence: number | null
  commissionConfiguredOrders: number
  commissionUnconfiguredOrders: number
}

export interface AffiliateSummary extends CommissionFields {
  /** Distinct affiliates with at least one order in the period. */
  affiliates: number
  orders: number
  netRevenuePence: number
  aovPence: number | null
  voucherOrders: number
  voucherKnownOrders: number
  voucherUnknownOrders: number
  voucherUsagePct: number | null
  knownDiscountGivenPence: number
}

export interface AffiliateLeaderboardRow extends CommissionFields {
  affiliateId: string
  affiliateName: string
  orders: number
  netRevenuePence: number
  aovPence: number | null
  voucherOrders: number
  voucherKnownOrders: number
  voucherUnknownOrders: number
  voucherPct: number | null
  knownDiscountGivenPence: number
}

/** Drilldown metric block (channel/source/campaign/link share this shape). */
export interface AffiliateChannelRow extends CommissionFields {
  channel: string
  orders: number
  netRevenuePence: number
  aovPence: number | null
  voucherOrders: number
  voucherKnownOrders: number
  voucherUnknownOrders: number
  voucherPct: number | null
  knownDiscountGivenPence: number
  /** Share of the affiliate's own net revenue (RPC-computed). */
  revenueSharePct: number | null
}

export interface AffiliateSourceRow extends AffiliateChannelRow {
  source: string | null
  mostUsedVoucher: string | null
}

export interface AffiliateCampaignRow extends AffiliateSourceRow {
  campaign: string | null
}

export interface AffiliateLinkRow extends AffiliateCampaignRow {
  trackingLinkId: string | null
  /** Friendly display fields supplied BY THE RPC (do not recompute). */
  linkLabel: string | null
  linkCode: string | null
}

export interface AffiliateDetail {
  affiliateId: string
  affiliateName: string
  byChannel: AffiliateChannelRow[]
  bySource: AffiliateSourceRow[]
  byCampaign: AffiliateCampaignRow[]
  byLink: AffiliateLinkRow[]
}

export interface AffiliatePerformancePayload {
  period: AffiliatePerformancePeriod
  mode: AffiliatePerformanceMode
  summary: AffiliateSummary
  byAffiliate: AffiliateLeaderboardRow[]
  affiliate: AffiliateDetail | null
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Normalisation — defends the UI against missing keys / nulls from the RPC.
// ---------------------------------------------------------------------------

function normalizePeriod(raw: Record<string, unknown> | null | undefined): AffiliatePerformancePeriod {
  const r = raw ?? {}
  return { start: str(r.start), end: str(r.end), timezone: 'Europe/London' }
}

function normalizeCommission(raw: Record<string, unknown>): CommissionFields {
  return {
    commissionPence: commissionPence(raw),
    commissionConfiguredOrders: num(raw.commissionConfiguredOrders),
    commissionUnconfiguredOrders: num(raw.commissionUnconfiguredOrders),
  }
}

function normalizeSummary(raw: Record<string, unknown> | null | undefined): AffiliateSummary {
  const r = raw ?? {}
  return {
    ...normalizeCommission(r),
    affiliates: num(r.affiliates),
    orders: num(r.orders),
    netRevenuePence: num(r.netRevenuePence),
    aovPence: numOrNull(r.aovPence),
    voucherOrders: num(r.voucherOrders),
    voucherKnownOrders: num(r.voucherKnownOrders),
    voucherUnknownOrders: num(r.voucherUnknownOrders),
    voucherUsagePct: numOrNull(r.voucherUsagePct),
    knownDiscountGivenPence: knownDiscount(r),
  }
}

function normalizeLeaderboardRow(raw: Record<string, unknown>): AffiliateLeaderboardRow {
  return {
    ...normalizeCommission(raw),
    affiliateId: str(raw.affiliateId),
    affiliateName: str(raw.affiliateName) || 'Unknown affiliate',
    orders: num(raw.orders),
    netRevenuePence: num(raw.netRevenuePence),
    aovPence: numOrNull(raw.aovPence),
    voucherOrders: num(raw.voucherOrders),
    voucherKnownOrders: num(raw.voucherKnownOrders),
    voucherUnknownOrders: num(raw.voucherUnknownOrders),
    voucherPct: numOrNull(raw.voucherPct ?? raw.voucherUsagePct),
    knownDiscountGivenPence: knownDiscount(raw),
  }
}

function normalizeChannelRow(raw: Record<string, unknown>): AffiliateChannelRow {
  return {
    ...normalizeCommission(raw),
    channel: str(raw.channel) || 'direct_unknown',
    orders: num(raw.orders),
    netRevenuePence: num(raw.netRevenuePence),
    aovPence: numOrNull(raw.aovPence),
    voucherOrders: num(raw.voucherOrders),
    voucherKnownOrders: num(raw.voucherKnownOrders),
    voucherUnknownOrders: num(raw.voucherUnknownOrders),
    voucherPct: numOrNull(raw.voucherPct),
    knownDiscountGivenPence: knownDiscount(raw),
    revenueSharePct: numOrNull(raw.revenueSharePct),
  }
}

function normalizeSourceRow(raw: Record<string, unknown>): AffiliateSourceRow {
  return {
    ...normalizeChannelRow(raw),
    source: strOrNull(raw.source),
    mostUsedVoucher: strOrNull(raw.mostUsedVoucher),
  }
}

function normalizeCampaignRow(raw: Record<string, unknown>): AffiliateCampaignRow {
  return {
    ...normalizeSourceRow(raw),
    campaign: strOrNull(raw.campaign),
  }
}

function normalizeLinkRow(raw: Record<string, unknown>): AffiliateLinkRow {
  return {
    ...normalizeCampaignRow(raw),
    trackingLinkId: strOrNull(raw.trackingLinkId),
    linkLabel: strOrNull(raw.linkLabel),
    linkCode: strOrNull(raw.linkCode),
  }
}

function normalizeDetail(raw: Record<string, unknown> | null | undefined): AffiliateDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const affiliateId = str(raw.affiliateId)
  // A detail object with no id is not usable; treat as absent.
  if (!affiliateId) return null
  return {
    affiliateId,
    affiliateName: str(raw.affiliateName) || 'Unknown affiliate',
    byChannel: arr(raw.byChannel).map(normalizeChannelRow),
    bySource: arr(raw.bySource).map(normalizeSourceRow),
    byCampaign: arr(raw.byCampaign).map(normalizeCampaignRow),
    byLink: arr(raw.byLink).map(normalizeLinkRow),
  }
}

/**
 * Normalise raw RPC JSON into a fully-populated, defensively-typed payload.
 * Missing branches collapse to safe zeros / empty arrays / null so the UI never
 * guards against undefined and never renders NaN. `mode` is derived from the
 * RPC but falls back to detail when an `affiliate` object is present.
 */
export function normalizeAffiliatePerformance(raw: unknown): AffiliatePerformancePayload {
  const r = (raw ?? {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const affiliate = normalizeDetail(r.affiliate as Record<string, unknown> | null | undefined)
  const mode: AffiliatePerformanceMode =
    r.mode === 'detail' || r.mode === 'leaderboard'
      ? (r.mode as AffiliatePerformanceMode)
      : affiliate
        ? 'detail'
        : 'leaderboard'
  return {
    period: normalizePeriod(r.period as Record<string, unknown> | null | undefined),
    mode,
    summary: normalizeSummary(r.summary as Record<string, unknown> | null | undefined),
    byAffiliate: arr(r.byAffiliate).map(normalizeLeaderboardRow),
    affiliate,
    generatedAt: str(r.generatedAt) || new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Commission display — the null-vs-0 distinction lives here so every surface
// renders it identically.
// ---------------------------------------------------------------------------

/**
 * Describe a group's commission state for display, honouring the null-vs-0
 * rule and the partially-configured warning.
 *
 * - unconfigured (commissionPence null OR every order missing a rate) -> kind
 *   'not_configured'.
 * - all configured -> kind 'ok'.
 * - some configured, some missing -> kind 'partial' with the missing count.
 */
export interface CommissionDisplay {
  kind: 'ok' | 'partial' | 'not_configured'
  /** Pence to show when kind is 'ok' or 'partial' (null when not configured). */
  pence: number | null
  missingOrders: number
}

export function describeCommission(row: CommissionFields): CommissionDisplay {
  const configured = row.commissionConfiguredOrders
  const missing = row.commissionUnconfiguredOrders
  // No configured data at all: either the RPC sent null, or zero configured orders.
  if (row.commissionPence == null || configured <= 0) {
    return { kind: 'not_configured', pence: null, missingOrders: missing }
  }
  if (missing > 0) {
    return { kind: 'partial', pence: row.commissionPence, missingOrders: missing }
  }
  return { kind: 'ok', pence: row.commissionPence, missingOrders: 0 }
}

// ---------------------------------------------------------------------------
// Drilldown — group the flat byChannel/bySource/byCampaign/byLink arrays into a
// Channel -> Source -> Campaign -> Link tree, PRESERVING the RPC ordering (the
// arrays are already sorted). No re-aggregation or re-sorting client-side.
// ---------------------------------------------------------------------------

export interface AffiliateCampaignNode {
  campaign: AffiliateCampaignRow
  links: AffiliateLinkRow[]
}

export interface AffiliateSourceNode {
  source: AffiliateSourceRow
  campaigns: AffiliateCampaignNode[]
}

export interface AffiliateChannelNode {
  channel: AffiliateChannelRow
  sources: AffiliateSourceNode[]
}

const CHANNEL_KEY = (channel: string) => channel
const SOURCE_KEY = (channel: string, source: string | null) => `${channel}::${source ?? ''}`
const CAMPAIGN_KEY = (channel: string, source: string | null, campaign: string | null) =>
  `${channel}::${source ?? ''}::${campaign ?? ''}`

export function buildAffiliateDrilldown(detail: AffiliateDetail | null): AffiliateChannelNode[] {
  if (!detail) return []

  const order: string[] = []
  const channelNodes = new Map<string, AffiliateChannelNode>()
  for (const ch of detail.byChannel) {
    const key = CHANNEL_KEY(ch.channel)
    if (!channelNodes.has(key)) {
      order.push(key)
      channelNodes.set(key, { channel: ch, sources: [] })
    }
  }

  // Sources under their channel, preserving first-seen order.
  const sourceIndex = new Map<string, number>()
  for (const src of detail.bySource) {
    const node = channelNodes.get(CHANNEL_KEY(src.channel))
    if (!node) continue
    const key = SOURCE_KEY(src.channel, src.source)
    if (!sourceIndex.has(key)) {
      sourceIndex.set(key, node.sources.length)
      node.sources.push({ source: src, campaigns: [] })
    }
  }

  // Campaigns under their channel+source.
  const campaignIndex = new Map<string, number>()
  for (const camp of detail.byCampaign) {
    const node = channelNodes.get(CHANNEL_KEY(camp.channel))
    if (!node) continue
    const sIdx = sourceIndex.get(SOURCE_KEY(camp.channel, camp.source))
    if (sIdx == null) continue
    const sourceNode = node.sources[sIdx]
    const key = CAMPAIGN_KEY(camp.channel, camp.source, camp.campaign)
    if (!campaignIndex.has(key)) {
      campaignIndex.set(key, sourceNode.campaigns.length)
      sourceNode.campaigns.push({ campaign: camp, links: [] })
    }
  }

  // Links under their channel+source+campaign.
  for (const link of detail.byLink) {
    const node = channelNodes.get(CHANNEL_KEY(link.channel))
    if (!node) continue
    const sIdx = sourceIndex.get(SOURCE_KEY(link.channel, link.source))
    if (sIdx == null) continue
    const sourceNode = node.sources[sIdx]
    const cIdx = campaignIndex.get(CAMPAIGN_KEY(link.channel, link.source, link.campaign))
    if (cIdx == null) continue
    sourceNode.campaigns[cIdx].links.push(link)
  }

  return order.map((k) => channelNodes.get(k)!).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Empty-state + label helpers.
// ---------------------------------------------------------------------------

/** True when the payload has no affiliate orders at all in the period. */
export function isEmptyAffiliatePeriod(payload: AffiliatePerformancePayload | null | undefined): boolean {
  return !payload || payload.summary.orders <= 0
}

/** Friendly label for a tracking-link row: prefer the RPC label, else the code. */
export function linkRowLabel(row: AffiliateLinkRow): string {
  if (row.linkLabel) return row.linkLabel
  if (row.linkCode) return row.linkCode
  return 'Unknown link'
}

// ---------------------------------------------------------------------------
// Request-shape helpers (shared by client + tests).
// ---------------------------------------------------------------------------

export interface AffiliatePerformanceQueryInput {
  range: PerformanceRange
  from?: string
  to?: string
  /** When set, requests detail mode for this affiliate uuid. */
  affiliate?: string | null
}

/** Build the query string for the affiliate performance endpoint. */
export function buildAffiliatePerformanceQuery(f: AffiliatePerformanceQueryInput): string {
  const p = new URLSearchParams()
  p.set('range', f.range)
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  }
  if (f.affiliate) p.set('affiliate', f.affiliate)
  return p.toString()
}

/**
 * SWR key for the affiliate performance endpoint. Returns null when the filter
 * state is incomplete (a custom range missing either bound) so SWR performs no
 * request with an invalid window.
 */
export function affiliatePerformanceSwrKey(f: AffiliatePerformanceQueryInput): string | null {
  if (f.range === 'custom' && (!f.from || !f.to)) return null
  return `/api/admin/marketing/affiliate-performance?${buildAffiliatePerformanceQuery(f)}`
}
