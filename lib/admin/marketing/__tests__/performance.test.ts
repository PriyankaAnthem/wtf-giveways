import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PERFORMANCE_RANGE,
  PERFORMANCE_RANGES,
  buildDrilldown,
  buildPerformanceQuery,
  channelLabel,
  formatPct,
  isEmptyPeriod,
  normalizePerformance,
  normalizeVoucherStatus,
  parsePerformanceRange,
  performanceSwrKey,
  prettifySlug,
  sourceLabel,
  voucherStatusLabel,
  type PerformancePayload,
} from '@/lib/admin/marketing/performance'
import { formatPence } from '@/lib/admin/reporting/format'

// A representative raw RPC payload (camelCase, discountGivenPence as emitted by SQL).
const RAW = {
  period: { start: '2026-08-01T00:00:00Z', end: '2026-08-29T00:00:00Z', timezone: 'Europe/London' },
  summary: {
    netRevenuePence: 10_832_524,
    orders: 22_746,
    aovPence: 476,
    trackedRevenuePence: 69,
    attributionRatePct: 0,
    voucherOrders: 677,
    voucherKnownOrders: 19_372,
    voucherUnknownOrders: 3_374,
    voucherUsagePct: 3.5,
    discountGivenPence: 506_968,
  },
  byChannel: [
    {
      channel: 'email',
      orders: 100,
      netRevenuePence: 50_000,
      aovPence: 500,
      voucherOrders: 10,
      voucherKnownOrders: 90,
      voucherUnknownOrders: 10,
      voucherPct: 11.1,
      discountGivenPence: 1_000,
      revenueSharePct: 40,
    },
    {
      channel: 'direct_unknown',
      orders: 60,
      netRevenuePence: 30_000,
      aovPence: 500,
      voucherOrders: 0,
      voucherKnownOrders: 0,
      voucherUnknownOrders: 60,
      voucherPct: null,
      discountGivenPence: 0,
      revenueSharePct: 24,
    },
  ],
  bySource: [
    {
      channel: 'email',
      source: 'brevo',
      orders: 100,
      netRevenuePence: 50_000,
      aovPence: 500,
      voucherOrders: 10,
      voucherPct: 11.1,
      mostUsedVoucher: 'SAVE10',
      discountGivenPence: 1_000,
      revenueSharePct: 40,
    },
    {
      channel: 'direct_unknown',
      source: null,
      orders: 60,
      netRevenuePence: 30_000,
      aovPence: 500,
      voucherOrders: 0,
      voucherPct: null,
      mostUsedVoucher: null,
      discountGivenPence: 0,
      revenueSharePct: 24,
    },
  ],
  byCampaign: [
    {
      channel: 'email',
      source: 'brevo',
      campaign: 'saturday-15k-push',
      orders: 70,
      netRevenuePence: 35_000,
      aovPence: 500,
      voucherOrders: 7,
      voucherPct: 10,
      mostUsedVoucher: 'SAVE10',
      discountGivenPence: 700,
      revenueSharePct: 28,
    },
    {
      channel: 'email',
      source: 'brevo',
      campaign: 'test2',
      orders: 30,
      netRevenuePence: 15_000,
      aovPence: 500,
      voucherOrders: 3,
      voucherPct: 10,
      mostUsedVoucher: null,
      discountGivenPence: 300,
      revenueSharePct: 12,
    },
  ],
  byVoucher: [
    { voucher: 'SAVE10', voucherStatus: 'code', orders: 677, netRevenuePence: 40_000, discountGivenPence: 506_968, aovPence: 59 },
    { voucher: 'No voucher', voucherStatus: 'no_voucher', orders: 18_695, netRevenuePence: 9_000_000, discountGivenPence: 0, aovPence: 481 },
    { voucher: 'Unknown', voucherStatus: 'unknown', orders: 3_374, netRevenuePence: 1_792_524, discountGivenPence: 0, aovPence: 531 },
  ],
  generatedAt: '2026-08-29T10:00:00Z',
}

describe('range vocabulary', () => {
  it('exposes exactly the RPC-supported ranges', () => {
    expect(PERFORMANCE_RANGES).toEqual(['today', 'yesterday', 'last_7_days', 'last_30_days', 'custom'])
  })

  it('parses untrusted range values, falling back to the default', () => {
    expect(parsePerformanceRange('last_30_days')).toBe('last_30_days')
    expect(parsePerformanceRange('this_month')).toBe(DEFAULT_PERFORMANCE_RANGE)
    expect(parsePerformanceRange(null)).toBe(DEFAULT_PERFORMANCE_RANGE)
    expect(parsePerformanceRange(42)).toBe(DEFAULT_PERFORMANCE_RANGE)
    expect(DEFAULT_PERFORMANCE_RANGE).toBe('today')
  })
})

describe('normalizePerformance', () => {
  it('maps discountGivenPence -> knownDiscountGivenPence and preserves every metric', () => {
    const p = normalizePerformance(RAW)
    expect(p.summary.netRevenuePence).toBe(10_832_524)
    expect(p.summary.orders).toBe(22_746)
    expect(p.summary.trackedRevenuePence).toBe(69)
    expect(p.summary.voucherOrders).toBe(677)
    expect(p.summary.voucherKnownOrders).toBe(19_372)
    expect(p.summary.voucherUnknownOrders).toBe(3_374)
    expect(p.summary.voucherUsagePct).toBe(3.5)
    // The RPC's discountGivenPence is surfaced as the honest "known" figure.
    expect(p.summary.knownDiscountGivenPence).toBe(506_968)
    expect(p.byChannel).toHaveLength(2)
    expect(p.bySource).toHaveLength(2)
    expect(p.byCampaign).toHaveLength(2)
    expect(p.byVoucher).toHaveLength(3)
  })

  it('accepts an already-camelCased knownDiscountGivenPence key defensively', () => {
    const p = normalizePerformance({ summary: { knownDiscountGivenPence: 123 } })
    expect(p.summary.knownDiscountGivenPence).toBe(123)
  })

  it('produces safe zeros / empty arrays for a totally empty payload (no NaN, no undefined)', () => {
    const p = normalizePerformance({})
    expect(p.summary.orders).toBe(0)
    expect(p.summary.netRevenuePence).toBe(0)
    expect(p.summary.knownDiscountGivenPence).toBe(0)
    expect(p.byChannel).toEqual([])
    expect(p.byVoucher).toEqual([])
    expect(Number.isNaN(p.summary.orders)).toBe(false)
  })

  it('preserves genuine nulls for percentages / AOV (never coerced to 0)', () => {
    const p = normalizePerformance(RAW)
    const direct = p.byChannel.find((c) => c.channel === 'direct_unknown')!
    expect(direct.voucherPct).toBeNull()
    // A zero-order empty summary must yield null AOV, not "£0.00" masquerading as real.
    const empty = normalizePerformance({ summary: { aovPence: null, attributionRatePct: null } })
    expect(empty.summary.aovPence).toBeNull()
    expect(empty.summary.attributionRatePct).toBeNull()
  })

  it('never drops untracked orders — direct_unknown is retained as its own channel', () => {
    const p = normalizePerformance(RAW)
    expect(p.byChannel.map((c) => c.channel)).toContain('direct_unknown')
  })
})

describe('isEmptyPeriod', () => {
  it('is true when there are no confirmed orders', () => {
    expect(isEmptyPeriod(normalizePerformance({ summary: { orders: 0 } }))).toBe(true)
    expect(isEmptyPeriod(null)).toBe(true)
  })
  it('is false when orders exist even if attribution is zero', () => {
    const p = normalizePerformance({ summary: { orders: 5, trackedRevenuePence: 0, attributionRatePct: 0 } })
    expect(isEmptyPeriod(p)).toBe(false)
  })
})

describe('GBP formatting (shared reporting formatter)', () => {
  it('formats integer pence as GBP and null as £0.00', () => {
    expect(formatPence(10_832_524)).toBe('£108,325.24')
    expect(formatPence(0)).toBe('£0.00')
    expect(formatPence(null)).toBe('£0.00')
  })
})

describe('formatPct', () => {
  it('formats a numeric percentage and renders null as an em dash', () => {
    expect(formatPct(3.5)).toBe('3.5%')
    expect(formatPct(0)).toBe('0.0%')
    expect(formatPct(null)).toBe('—')
    expect(formatPct(undefined)).toBe('—')
  })
})

describe('channelLabel (friendly labels)', () => {
  it('maps every known canonical slug to its friendly label', () => {
    expect(channelLabel('email')).toBe('Email')
    expect(channelLabel('sms')).toBe('SMS')
    expect(channelLabel('tiktok_live')).toBe('TikTok Live')
    expect(channelLabel('organic_social')).toBe('Organic Social')
    expect(channelLabel('paid_social')).toBe('Paid Social')
    expect(channelLabel('influencer')).toBe('Influencer')
    expect(channelLabel('referral')).toBe('Referral')
    expect(channelLabel('direct_unknown')).toBe('Direct / Unknown')
  })

  it('title-cases an unknown slug and treats empty/null as Direct / Unknown', () => {
    expect(channelLabel('brand_new_channel')).toBe('Brand New Channel')
    expect(channelLabel('')).toBe('Direct / Unknown')
    expect(channelLabel(null)).toBe('Direct / Unknown')
  })
})

describe('prettifySlug (display-only, never mutates the stored value)', () => {
  it('title-cases hyphen/underscore slugs but leaves single tokens verbatim', () => {
    expect(prettifySlug('saturday-15k-push')).toBe('Saturday 15k Push')
    expect(prettifySlug('summer_sale')).toBe('Summer Sale')
    expect(prettifySlug('test2')).toBe('test2')
    expect(prettifySlug('brevo')).toBe('brevo')
    expect(prettifySlug(null)).toBe('—')
    expect(prettifySlug('')).toBe('—')
  })
})

describe('sourceLabel (friendly brand casing for known sources)', () => {
  it('renders known sources with correct brand casing', () => {
    expect(sourceLabel('facebook')).toBe('Facebook')
    expect(sourceLabel('instagram')).toBe('Instagram')
    expect(sourceLabel('tiktok')).toBe('TikTok')
    expect(sourceLabel('tiktok_ads')).toBe('TikTok Ads')
    expect(sourceLabel('brevo')).toBe('Brevo')
  })

  it('falls back to prettifySlug for unknown sources and dashes empty/null', () => {
    expect(sourceLabel('some-new-source')).toBe('Some New Source')
    expect(sourceLabel('customtag')).toBe('customtag')
    expect(sourceLabel(null)).toBe('—')
    expect(sourceLabel('')).toBe('—')
  })
})

describe('voucher status', () => {
  it('normalizes unknown/invalid statuses to "unknown"', () => {
    expect(normalizeVoucherStatus('code')).toBe('code')
    expect(normalizeVoucherStatus('no_voucher')).toBe('no_voucher')
    expect(normalizeVoucherStatus('unknown')).toBe('unknown')
    expect(normalizeVoucherStatus('garbage')).toBe('unknown')
    expect(normalizeVoucherStatus(null)).toBe('unknown')
  })

  it('labels each state honestly and never merges Unknown into No voucher', () => {
    expect(voucherStatusLabel('code', 'SAVE10')).toBe('SAVE10')
    expect(voucherStatusLabel('no_voucher', 'No voucher')).toBe('No voucher')
    expect(voucherStatusLabel('unknown', 'Unknown')).toBe('Unknown / Historic')
    // The two null-code states resolve to DISTINCT labels.
    expect(voucherStatusLabel('no_voucher', '')).not.toBe(voucherStatusLabel('unknown', ''))
  })
})

describe('buildDrilldown (channel -> source -> campaign, RPC order preserved)', () => {
  it('nests sources and campaigns under the channel they belong to', () => {
    const p = normalizePerformance(RAW)
    const groups = buildDrilldown(p)
    expect(groups.map((g) => g.channel.channel)).toEqual(['email', 'direct_unknown'])

    const email = groups[0]
    expect(email.sources.map((s) => s.source.source)).toEqual(['brevo'])
    expect(email.sources[0].campaigns.map((c) => c.campaign)).toEqual(['saturday-15k-push', 'test2'])

    const direct = groups[1]
    expect(direct.sources.map((s) => s.source.source)).toEqual([null])
    expect(direct.sources[0].campaigns).toEqual([])
  })

  it('does not reaggregate or reorder — it only buckets pre-sorted rows', () => {
    const p = normalizePerformance(RAW)
    const groups = buildDrilldown(p)
    // Campaign order must match the RPC array order (revenue desc: 35k before 15k).
    expect(groups[0].sources[0].campaigns.map((c) => c.netRevenuePence)).toEqual([35_000, 15_000])
  })
})

describe('request-shape helpers', () => {
  it('builds a query string, omitting custom dates unless the range is custom', () => {
    expect(buildPerformanceQuery({ range: 'today' })).toBe('range=today')
    expect(buildPerformanceQuery({ range: 'last_30_days', channel: 'email' })).toBe(
      'range=last_30_days&channel=email',
    )
    expect(buildPerformanceQuery({ range: 'custom', from: '2026-08-01', to: '2026-08-29' })).toBe(
      'range=custom&from=2026-08-01&to=2026-08-29',
    )
  })

  it('suppresses the SWR request for an incomplete custom range', () => {
    expect(performanceSwrKey({ range: 'custom', from: '', to: '' })).toBeNull()
    expect(performanceSwrKey({ range: 'custom', from: '2026-08-01', to: '' })).toBeNull()
    expect(performanceSwrKey({ range: 'today' })).toBe('/api/admin/marketing/performance?range=today')
    expect(performanceSwrKey({ range: 'custom', from: '2026-08-01', to: '2026-08-29' })).toBe(
      '/api/admin/marketing/performance?range=custom&from=2026-08-01&to=2026-08-29',
    )
  })
})

// Type-only guard: the normalised payload matches the exported type.
const _typecheck: PerformancePayload = normalizePerformance(RAW)
void _typecheck
