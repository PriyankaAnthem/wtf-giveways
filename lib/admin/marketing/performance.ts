/**
 * Marketing Performance — client-safe types, normalisation and pure helpers.
 *
 * Single source of truth for the shape of `get_marketing_performance(...)`
 * (scripts/marketing/026-marketing-performance-rpc.sql) and the small amount of
 * display-only logic the UI needs (range parsing, friendly labels, campaign
 * slug prettifying, request-shape helpers).
 *
 * It is deliberately client-safe: NO server-only imports, so it can be used by
 * the API route AND the client components, and unit-tested in the Node env.
 *
 * MONEY: every *Pence field is an integer number of pence (GBP). All currency
 * formatting happens at the display boundary via
 * `lib/admin/reporting/format` (`formatPence`). We never do float maths here.
 *
 * VOUCHER TRUTH: the RPC classifies every order into exactly one of three
 * states — 'code' (a voucher was used), 'no_voucher' (proven no voucher), and
 * 'unknown' (historic/ambiguous; voucher status was never captured). The usage
 * percentage denominator is KNOWN orders only (code + no_voucher); unknown
 * orders are surfaced separately and NEVER folded into "no voucher".
 *
 * DISCOUNT TRUTH: the RPC sums `discount_pence` (historic rows are 0), so the
 * figure is "Known Discount Given" — it may exclude discounts on orders that
 * predate voucher tracking. The UI must never present it as a complete
 * lifetime/period discount cost when unknown voucher orders exist.
 */

// ---------------------------------------------------------------------------
// Range vocabulary (mirrors the RPC's p_range arg).
// ---------------------------------------------------------------------------

export const PERFORMANCE_RANGES = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'custom',
] as const

export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number]

export const PERFORMANCE_RANGE_LABELS: Record<PerformanceRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: '7 days',
  last_30_days: '30 days',
  custom: 'Custom',
}

export const DEFAULT_PERFORMANCE_RANGE: PerformanceRange = 'today'

/** Parse an untrusted `range` value into a supported range, else the default. */
export function parsePerformanceRange(value: unknown): PerformanceRange {
  return PERFORMANCE_RANGES.includes(value as PerformanceRange)
    ? (value as PerformanceRange)
    : DEFAULT_PERFORMANCE_RANGE
}

// ---------------------------------------------------------------------------
// Coercion primitives.
// ---------------------------------------------------------------------------

/** Coerce an unknown JSON value into a finite number, defaulting to 0. */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Coerce into a finite number OR null (used for percentages / AOV that the RPC
 * legitimately returns as null — e.g. no orders, no known denominator). */
export function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Voucher status.
// ---------------------------------------------------------------------------

export type VoucherStatus = 'code' | 'no_voucher' | 'unknown'

export function normalizeVoucherStatus(value: unknown): VoucherStatus {
  return value === 'code' || value === 'no_voucher' ? value : 'unknown'
}

/** Human display label for a voucher row's status. */
export function voucherStatusLabel(status: VoucherStatus, code: string): string {
  if (status === 'code') return code || 'Voucher'
  if (status === 'no_voucher') return 'No voucher'
  return 'Unknown / Historic'
}

// ---------------------------------------------------------------------------
// Friendly channel labels.
// ---------------------------------------------------------------------------

export const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  tiktok_live: 'TikTok Live',
  organic_social: 'Organic Social',
  paid_social: 'Paid Social',
  influencer: 'Influencer',
  referral: 'Referral',
  direct_unknown: 'Direct / Unknown',
}

/**
 * Friendly label for a canonical channel slug. Unknown slugs are title-cased
 * from their underscores rather than shown raw, so a newly-added channel never
 * appears as a bare identifier.
 */
export function channelLabel(channel: string | null | undefined): string {
  const key = (channel ?? '').trim()
  if (!key) return 'Direct / Unknown'
  return CHANNEL_LABELS[key] ?? titleizeSlug(key)
}

/**
 * Friendly labels for known canonical SOURCE slugs (display only — never mutate
 * the stored value). Keeps the picker's platform names in sync with what the
 * Performance tables show, so `facebook` reads "Facebook" and `tiktok_ads`
 * reads "TikTok Ads" (correctly cased) instead of `prettifySlug` output like
 * "Tiktok Ads". Unknown sources fall through to `prettifySlug`.
 */
export const SOURCE_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  tiktok_ads: 'TikTok Ads',
  meta: 'Meta',
  brevo: 'Brevo',
  resend: 'Resend',
  sms: 'SMS',
  influencer: 'Influencer',
  referral: 'Referral',
}

/**
 * Friendly label for a canonical source slug. Known sources use SOURCE_LABELS
 * (correct brand casing); everything else falls back to `prettifySlug`.
 */
export function sourceLabel(source: string | null | undefined): string {
  const key = (source ?? '').trim()
  if (!key) return '—'
  return SOURCE_LABELS[key] ?? prettifySlug(key)
}

/**
 * Prettify a source/campaign slug for DISPLAY only (never mutate the stored
 * value). `saturday-15k-push` -> `Saturday 15k Push`; `test2` -> `test2`
 * (single lowercase token with digits is left as-is). Null/empty -> '—'.
 */
export function prettifySlug(slug: string | null | undefined): string {
  const raw = (slug ?? '').trim()
  if (!raw) return '—'
  // A single token with no separators stays verbatim (e.g. "test2", "brevo").
  if (!/[-_\s]/.test(raw)) return raw
  return titleizeSlug(raw)
}

function titleizeSlug(raw: string): string {
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}

// ---------------------------------------------------------------------------
// Payload types (camelCase; mirror the RPC JSON exactly).
// ---------------------------------------------------------------------------

export interface PerformancePeriod {
  start: string
  end: string
  timezone: 'Europe/London'
}

export interface PerformanceSummary {
  netRevenuePence: number
  orders: number
  aovPence: number | null
  trackedRevenuePence: number
  attributionRatePct: number | null
  voucherOrders: number
  voucherKnownOrders: number
  voucherUnknownOrders: number
  voucherUsagePct: number | null
  /** Sourced from the RPC's `discountGivenPence` — this is KNOWN discount only. */
  knownDiscountGivenPence: number
}

export interface PerformanceChannelRow {
  channel: string
  orders: number
  netRevenuePence: number
  aovPence: number | null
  voucherOrders: number
  voucherKnownOrders: number
  voucherUnknownOrders: number
  voucherPct: number | null
  knownDiscountGivenPence: number
  revenueSharePct: number | null
}

export interface PerformanceSourceRow extends PerformanceChannelRow {
  source: string | null
  mostUsedVoucher: string | null
}

export interface PerformanceCampaignRow extends PerformanceSourceRow {
  campaign: string | null
}

export interface PerformanceVoucherRow {
  voucher: string
  voucherStatus: VoucherStatus
  orders: number
  netRevenuePence: number
  knownDiscountGivenPence: number
  aovPence: number | null
}

export interface PerformancePayload {
  period: PerformancePeriod
  summary: PerformanceSummary
  byChannel: PerformanceChannelRow[]
  bySource: PerformanceSourceRow[]
  byCampaign: PerformanceCampaignRow[]
  byVoucher: PerformanceVoucherRow[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Normalisation — defends the UI against missing keys / nulls from the RPC.
// The RPC returns `discountGivenPence`; we surface it as `knownDiscountGivenPence`
// (accepting either key defensively) so the UI can label it honestly.
// ---------------------------------------------------------------------------

function knownDiscount(raw: Record<string, unknown>): number {
  return num(raw.discountGivenPence ?? raw.knownDiscountGivenPence)
}

function normalizeSummary(raw: Record<string, unknown> | null | undefined): PerformanceSummary {
  const r = raw ?? {}
  return {
    netRevenuePence: num(r.netRevenuePence),
    orders: num(r.orders),
    aovPence: numOrNull(r.aovPence),
    trackedRevenuePence: num(r.trackedRevenuePence),
    attributionRatePct: numOrNull(r.attributionRatePct),
    voucherOrders: num(r.voucherOrders),
    voucherKnownOrders: num(r.voucherKnownOrders),
    voucherUnknownOrders: num(r.voucherUnknownOrders),
    voucherUsagePct: numOrNull(r.voucherUsagePct),
    knownDiscountGivenPence: knownDiscount(r),
  }
}

function normalizeChannel(raw: Record<string, unknown>): PerformanceChannelRow {
  return {
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

function normalizeSource(raw: Record<string, unknown>): PerformanceSourceRow {
  return {
    ...normalizeChannel(raw),
    source: strOrNull(raw.source),
    mostUsedVoucher: strOrNull(raw.mostUsedVoucher),
  }
}

function normalizeCampaign(raw: Record<string, unknown>): PerformanceCampaignRow {
  return {
    ...normalizeSource(raw),
    campaign: strOrNull(raw.campaign),
  }
}

function normalizeVoucher(raw: Record<string, unknown>): PerformanceVoucherRow {
  return {
    voucher: str(raw.voucher) || 'Unknown',
    voucherStatus: normalizeVoucherStatus(raw.voucherStatus),
    orders: num(raw.orders),
    netRevenuePence: num(raw.netRevenuePence),
    knownDiscountGivenPence: knownDiscount(raw),
    aovPence: numOrNull(raw.aovPence),
  }
}

function normalizePeriod(raw: Record<string, unknown> | null | undefined): PerformancePeriod {
  const r = raw ?? {}
  return {
    start: str(r.start),
    end: str(r.end),
    timezone: 'Europe/London',
  }
}

/**
 * Normalise the raw RPC JSON into a fully-populated, defensively-typed payload.
 * Any missing branch collapses to safe zeros / empty arrays / null so the UI
 * never has to guard against undefined and never renders NaN.
 */
export function normalizePerformance(raw: unknown): PerformancePayload {
  const r = (raw ?? {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  return {
    period: normalizePeriod(r.period as Record<string, unknown> | null | undefined),
    summary: normalizeSummary(r.summary as Record<string, unknown> | null | undefined),
    byChannel: arr(r.byChannel).map(normalizeChannel),
    bySource: arr(r.bySource).map(normalizeSource),
    byCampaign: arr(r.byCampaign).map(normalizeCampaign),
    byVoucher: arr(r.byVoucher).map(normalizeVoucher),
    generatedAt: str(r.generatedAt) || new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Pure display helpers.
// ---------------------------------------------------------------------------

/**
 * Format an already-computed percentage the RPC returns as a number (e.g.
 * `3.5`) as "3.5%". Null renders as "—" so a cell/label is never "NaN%" or a
 * misleading "0%" when the true value is "no known denominator".
 */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** True when the payload has no confirmed orders at all in the period. */
export function isEmptyPeriod(payload: PerformancePayload | null | undefined): boolean {
  return !payload || payload.summary.orders <= 0
}

/**
 * A drilldown grouping of the flat bySource / byCampaign arrays into
 * channel -> sources -> campaigns, PRESERVING the RPC's ordering (the arrays are
 * already sorted by net revenue desc). No re-aggregation or re-sorting occurs
 * client-side — we only bucket rows under the parent they already belong to,
 * following the order in which each parent first appears.
 */
export interface ChannelDrilldown {
  channel: PerformanceChannelRow
  sources: {
    source: PerformanceSourceRow
    campaigns: PerformanceCampaignRow[]
  }[]
}

export function buildDrilldown(payload: PerformancePayload): ChannelDrilldown[] {
  const order: string[] = []
  const byChannelKey = new Map<string, ChannelDrilldown>()

  for (const ch of payload.byChannel) {
    if (!byChannelKey.has(ch.channel)) {
      order.push(ch.channel)
      byChannelKey.set(ch.channel, { channel: ch, sources: [] })
    }
  }

  // Bucket sources under their channel, preserving first-seen order.
  const sourceIndex = new Map<string, number>() // `${channel}::${source}` -> index in sources[]
  for (const src of payload.bySource) {
    const node = byChannelKey.get(src.channel)
    if (!node) continue
    const key = `${src.channel}::${src.source ?? ''}`
    if (!sourceIndex.has(key)) {
      sourceIndex.set(key, node.sources.length)
      node.sources.push({ source: src, campaigns: [] })
    }
  }

  // Bucket campaigns under their channel+source.
  for (const camp of payload.byCampaign) {
    const node = byChannelKey.get(camp.channel)
    if (!node) continue
    const key = `${camp.channel}::${camp.source ?? ''}`
    const idx = sourceIndex.get(key)
    if (idx == null) continue
    node.sources[idx].campaigns.push(camp)
  }

  return order.map((c) => byChannelKey.get(c)!).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Request-shape helpers (shared by client + tests).
// ---------------------------------------------------------------------------

export interface PerformanceQueryInput {
  range: PerformanceRange
  from?: string
  to?: string
  channel?: string
}

/** Build the query string for the Performance endpoint from a filter state. */
export function buildPerformanceQuery(f: PerformanceQueryInput): string {
  const p = new URLSearchParams()
  p.set('range', f.range)
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  }
  if (f.channel) p.set('channel', f.channel)
  return p.toString()
}

/**
 * SWR key for the Performance endpoint. Returns null when the filter state is
 * incomplete (a custom range missing either bound) so SWR performs no request
 * with an invalid window.
 */
export function performanceSwrKey(f: PerformanceQueryInput): string | null {
  if (f.range === 'custom' && (!f.from || !f.to)) return null
  return `/api/admin/marketing/performance?${buildPerformanceQuery(f)}`
}
