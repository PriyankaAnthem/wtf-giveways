import { describe, it, expect } from 'vitest'
import {
  PERFORMANCE_RANGES,
  DEFAULT_PERFORMANCE_RANGE,
  parsePerformanceRange,
  normalizeAffiliatePerformance,
  describeCommission,
  buildAffiliateDrilldown,
  buildAffiliatePerformanceQuery,
  affiliatePerformanceSwrKey,
  isEmptyAffiliatePeriod,
  linkRowLabel,
  type AffiliatePerformancePayload,
  type CommissionFields,
} from '@/lib/admin/marketing/affiliate-performance'

const AFFILIATE_A = '11111111-1111-4111-8111-111111111111'
const AFFILIATE_B = '22222222-2222-4222-8222-222222222222'

// A representative LEADERBOARD payload (camelCase, discountGivenPence as SQL emits).
const RAW_LEADERBOARD = {
  period: { start: '2026-08-01T00:00:00Z', end: '2026-08-29T00:00:00Z', timezone: 'Europe/London' },
  mode: 'leaderboard',
  summary: {
    affiliates: 2,
    orders: 30,
    netRevenuePence: 150_000,
    aovPence: 5_000,
    voucherOrders: 6,
    voucherKnownOrders: 28,
    voucherUnknownOrders: 2,
    voucherUsagePct: 21.4,
    discountGivenPence: 4_500,
    // 25 orders have a rate, 5 do not; the RPC sums only configured orders.
    commissionPence: 12_000,
    commissionConfiguredOrders: 25,
    commissionUnconfiguredOrders: 5,
  },
  byAffiliate: [
    {
      affiliateId: AFFILIATE_A,
      affiliateName: 'Tester',
      orders: 20,
      netRevenuePence: 100_000,
      aovPence: 5_000,
      voucherOrders: 4,
      voucherKnownOrders: 20,
      voucherUnknownOrders: 0,
      voucherPct: 20,
      discountGivenPence: 3_000,
      commissionPence: 10_000,
      commissionConfiguredOrders: 20,
      commissionUnconfiguredOrders: 0,
    },
    {
      affiliateId: AFFILIATE_B,
      affiliateName: 'Partner Two',
      orders: 10,
      netRevenuePence: 50_000,
      aovPence: 5_000,
      voucherOrders: 2,
      voucherKnownOrders: 8,
      voucherUnknownOrders: 2,
      voucherPct: 25,
      discountGivenPence: 1_500,
      // No rate configured for any of this affiliate's orders.
      commissionPence: null,
      commissionConfiguredOrders: 0,
      commissionUnconfiguredOrders: 10,
    },
  ],
  affiliate: null,
  generatedAt: '2026-08-29T10:00:00Z',
}

// A representative DETAIL payload for AFFILIATE_A.
const RAW_DETAIL = {
  period: RAW_LEADERBOARD.period,
  mode: 'detail',
  summary: RAW_LEADERBOARD.byAffiliate[0],
  byAffiliate: [RAW_LEADERBOARD.byAffiliate[0]],
  affiliate: {
    affiliateId: AFFILIATE_A,
    affiliateName: 'Tester',
    byChannel: [
      {
        channel: 'email',
        orders: 20,
        netRevenuePence: 100_000,
        aovPence: 5_000,
        voucherOrders: 4,
        voucherKnownOrders: 20,
        voucherUnknownOrders: 0,
        voucherPct: 20,
        discountGivenPence: 3_000,
        revenueSharePct: 100,
        commissionPence: 10_000,
        commissionConfiguredOrders: 20,
        commissionUnconfiguredOrders: 0,
      },
    ],
    bySource: [
      {
        channel: 'email',
        source: 'brevo',
        orders: 20,
        netRevenuePence: 100_000,
        aovPence: 5_000,
        voucherPct: 20,
        mostUsedVoucher: 'SAVE10',
        discountGivenPence: 3_000,
        revenueSharePct: 100,
        commissionPence: 10_000,
        commissionConfiguredOrders: 20,
        commissionUnconfiguredOrders: 0,
      },
    ],
    byCampaign: [
      {
        channel: 'email',
        source: 'brevo',
        campaign: 'tester3',
        orders: 20,
        netRevenuePence: 100_000,
        aovPence: 5_000,
        voucherPct: 20,
        discountGivenPence: 3_000,
        revenueSharePct: 100,
        commissionPence: 10_000,
        commissionConfiguredOrders: 20,
        commissionUnconfiguredOrders: 0,
      },
    ],
    byLink: [
      {
        channel: 'email',
        source: 'brevo',
        campaign: 'tester3',
        trackingLinkId: '33333333-3333-4333-8333-333333333333',
        linkLabel: 'tester3',
        linkCode: 'ZT5Rm8LW',
        orders: 12,
        netRevenuePence: 60_000,
        aovPence: 5_000,
        voucherPct: 25,
        discountGivenPence: 2_000,
        revenueSharePct: 60,
        commissionPence: 6_000,
        commissionConfiguredOrders: 12,
        commissionUnconfiguredOrders: 0,
      },
      {
        channel: 'email',
        source: 'brevo',
        campaign: 'tester3',
        trackingLinkId: '44444444-4444-4444-8444-444444444444',
        linkLabel: 'tester3 alt',
        linkCode: 'AB12cd34',
        orders: 8,
        netRevenuePence: 40_000,
        aovPence: 5_000,
        voucherPct: 12.5,
        discountGivenPence: 1_000,
        revenueSharePct: 40,
        commissionPence: 4_000,
        commissionConfiguredOrders: 8,
        commissionUnconfiguredOrders: 0,
      },
    ],
  },
  generatedAt: '2026-08-29T10:00:00Z',
}

describe('range vocabulary (shared with Marketing Performance)', () => {
  it('exposes exactly the RPC-supported ranges and default', () => {
    expect(PERFORMANCE_RANGES).toEqual(['today', 'yesterday', 'last_7_days', 'last_30_days', 'custom'])
    expect(DEFAULT_PERFORMANCE_RANGE).toBe('today')
  })

  it('parses untrusted range values, falling back to the default', () => {
    expect(parsePerformanceRange('last_7_days')).toBe('last_7_days')
    expect(parsePerformanceRange('this_year')).toBe('today')
    expect(parsePerformanceRange(null)).toBe('today')
  })
})

describe('normalizeAffiliatePerformance — leaderboard mode', () => {
  it('maps summary + byAffiliate and surfaces knownDiscountGivenPence', () => {
    const p = normalizeAffiliatePerformance(RAW_LEADERBOARD)
    expect(p.mode).toBe('leaderboard')
    expect(p.affiliate).toBeNull()
    expect(p.summary.affiliates).toBe(2)
    expect(p.summary.orders).toBe(30)
    expect(p.summary.netRevenuePence).toBe(150_000)
    expect(p.summary.knownDiscountGivenPence).toBe(4_500)
    expect(p.byAffiliate).toHaveLength(2)
    expect(p.byAffiliate[0].affiliateId).toBe(AFFILIATE_A)
    expect(p.byAffiliate[0].knownDiscountGivenPence).toBe(3_000)
  })

  it('preserves the RPC order (never re-sorts)', () => {
    const p = normalizeAffiliatePerformance(RAW_LEADERBOARD)
    expect(p.byAffiliate.map((r) => r.affiliateName)).toEqual(['Tester', 'Partner Two'])
  })

  it('derives leaderboard mode when mode is absent and no affiliate object', () => {
    const { mode, ...rest } = RAW_LEADERBOARD
    void mode
    const p = normalizeAffiliatePerformance(rest)
    expect(p.mode).toBe('leaderboard')
  })
})

describe('normalizeAffiliatePerformance — detail mode', () => {
  it('populates the affiliate object with all four breakdowns', () => {
    const p = normalizeAffiliatePerformance(RAW_DETAIL)
    expect(p.mode).toBe('detail')
    expect(p.affiliate).not.toBeNull()
    expect(p.affiliate!.affiliateId).toBe(AFFILIATE_A)
    expect(p.affiliate!.byChannel).toHaveLength(1)
    expect(p.affiliate!.bySource).toHaveLength(1)
    expect(p.affiliate!.byCampaign).toHaveLength(1)
    expect(p.affiliate!.byLink).toHaveLength(2)
  })

  it('keeps RPC-supplied linkLabel / linkCode as display fields (never recomputed)', () => {
    const p = normalizeAffiliatePerformance(RAW_DETAIL)
    const link = p.affiliate!.byLink[0]
    expect(link.linkLabel).toBe('tester3')
    expect(link.linkCode).toBe('ZT5Rm8LW')
    expect(link.trackingLinkId).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('derives detail mode from a present affiliate object when mode is absent', () => {
    const { mode, ...rest } = RAW_DETAIL
    void mode
    const p = normalizeAffiliatePerformance(rest)
    expect(p.mode).toBe('detail')
  })

  it('treats an affiliate object with no id as absent (leaderboard fallback)', () => {
    const p = normalizeAffiliatePerformance({ affiliate: { affiliateName: 'x', byChannel: [] } })
    expect(p.affiliate).toBeNull()
    expect(p.mode).toBe('leaderboard')
  })
})

describe('normalizeAffiliatePerformance — defensive defaults', () => {
  it('produces safe zeros / empty arrays / null for an empty payload (no NaN)', () => {
    const p = normalizeAffiliatePerformance({})
    expect(p.summary.orders).toBe(0)
    expect(p.summary.netRevenuePence).toBe(0)
    expect(p.summary.commissionPence).toBeNull()
    expect(p.byAffiliate).toEqual([])
    expect(p.affiliate).toBeNull()
    expect(Number.isNaN(p.summary.orders)).toBe(false)
  })

  it('preserves genuine nulls for percentages / AOV (never coerced to 0)', () => {
    const p = normalizeAffiliatePerformance({ summary: { aovPence: null, voucherUsagePct: null } })
    expect(p.summary.aovPence).toBeNull()
    expect(p.summary.voucherUsagePct).toBeNull()
  })
})

describe('commission — null (unconfigured) vs 0 (genuine £0) is never conflated', () => {
  it('keeps null commissionPence as null after normalisation', () => {
    const p = normalizeAffiliatePerformance(RAW_LEADERBOARD)
    const partner = p.byAffiliate.find((r) => r.affiliateId === AFFILIATE_B)!
    expect(partner.commissionPence).toBeNull()
    expect(partner.commissionConfiguredOrders).toBe(0)
    expect(partner.commissionUnconfiguredOrders).toBe(10)
  })

  it('keeps a genuine 0 commissionPence as 0 (distinct from null)', () => {
    const p = normalizeAffiliatePerformance({
      byAffiliate: [
        { affiliateId: AFFILIATE_A, affiliateName: 'Zero', commissionPence: 0, commissionConfiguredOrders: 3, commissionUnconfiguredOrders: 0 },
      ],
    })
    expect(p.byAffiliate[0].commissionPence).toBe(0)
  })
})

describe('describeCommission — display state machine', () => {
  const base: CommissionFields = {
    commissionPence: 0,
    commissionConfiguredOrders: 0,
    commissionUnconfiguredOrders: 0,
  }

  it('is "not_configured" when commissionPence is null', () => {
    const c = describeCommission({ ...base, commissionPence: null, commissionUnconfiguredOrders: 5 })
    expect(c.kind).toBe('not_configured')
    expect(c.pence).toBeNull()
    expect(c.missingOrders).toBe(5)
  })

  it('is "not_configured" when there are zero configured orders (even with a numeric 0)', () => {
    const c = describeCommission({ ...base, commissionPence: 0, commissionConfiguredOrders: 0, commissionUnconfiguredOrders: 3 })
    expect(c.kind).toBe('not_configured')
  })

  it('is "ok" when every order is configured', () => {
    const c = describeCommission({ commissionPence: 10_000, commissionConfiguredOrders: 20, commissionUnconfiguredOrders: 0 })
    expect(c.kind).toBe('ok')
    expect(c.pence).toBe(10_000)
    expect(c.missingOrders).toBe(0)
  })

  it('is "partial" (amount + warning) when some orders are configured and some are not', () => {
    const c = describeCommission({ commissionPence: 12_000, commissionConfiguredOrders: 25, commissionUnconfiguredOrders: 5 })
    expect(c.kind).toBe('partial')
    expect(c.pence).toBe(12_000)
    expect(c.missingOrders).toBe(5)
  })

  it('treats a genuine £0 with configured orders as "ok", never "not configured"', () => {
    const c = describeCommission({ commissionPence: 0, commissionConfiguredOrders: 4, commissionUnconfiguredOrders: 0 })
    expect(c.kind).toBe('ok')
    expect(c.pence).toBe(0)
  })
})

describe('buildAffiliateDrilldown — Channel -> Source -> Campaign -> Link', () => {
  it('nests all four levels preserving RPC order', () => {
    const p = normalizeAffiliatePerformance(RAW_DETAIL)
    const tree = buildAffiliateDrilldown(p.affiliate)
    expect(tree).toHaveLength(1)
    const email = tree[0]
    expect(email.channel.channel).toBe('email')
    expect(email.sources).toHaveLength(1)
    const brevo = email.sources[0]
    expect(brevo.source.source).toBe('brevo')
    expect(brevo.campaigns).toHaveLength(1)
    const tester3 = brevo.campaigns[0]
    expect(tester3.campaign.campaign).toBe('tester3')
    expect(tester3.links.map((l) => l.linkCode)).toEqual(['ZT5Rm8LW', 'AB12cd34'])
  })

  it('returns an empty tree for a null affiliate', () => {
    expect(buildAffiliateDrilldown(null)).toEqual([])
  })

  it('does not reorder links (RPC net-revenue-desc order is retained)', () => {
    const p = normalizeAffiliatePerformance(RAW_DETAIL)
    const tree = buildAffiliateDrilldown(p.affiliate)
    const links = tree[0].sources[0].campaigns[0].links
    expect(links.map((l) => l.netRevenuePence)).toEqual([60_000, 40_000])
  })
})

describe('linkRowLabel', () => {
  it('prefers the label, then the code, then Unknown link', () => {
    expect(linkRowLabel({ linkLabel: 'Promo', linkCode: 'X', trackingLinkId: null } as never)).toBe('Promo')
    expect(linkRowLabel({ linkLabel: null, linkCode: 'X', trackingLinkId: null } as never)).toBe('X')
    expect(linkRowLabel({ linkLabel: null, linkCode: null, trackingLinkId: null } as never)).toBe('Unknown link')
  })
})

describe('isEmptyAffiliatePeriod', () => {
  it('is true when there are no affiliate orders', () => {
    expect(isEmptyAffiliatePeriod(normalizeAffiliatePerformance({ summary: { orders: 0 } }))).toBe(true)
    expect(isEmptyAffiliatePeriod(null)).toBe(true)
  })
  it('is false when orders exist', () => {
    expect(isEmptyAffiliatePeriod(normalizeAffiliatePerformance({ summary: { orders: 3 } }))).toBe(false)
  })
})

describe('request-shape helpers — leaderboard <-> detail query-param flow', () => {
  it('omits affiliate for leaderboard and includes it for detail', () => {
    // Leaderboard (no affiliate param).
    expect(buildAffiliatePerformanceQuery({ range: 'today' })).toBe('range=today')
    // Drill into an affiliate -> detail query param present.
    expect(buildAffiliatePerformanceQuery({ range: 'today', affiliate: AFFILIATE_A })).toBe(
      `range=today&affiliate=${AFFILIATE_A}`,
    )
    // Back to leaderboard -> affiliate cleared (null).
    expect(buildAffiliatePerformanceQuery({ range: 'today', affiliate: null })).toBe('range=today')
  })

  it('keeps the date range across a drill-in (range is retained alongside affiliate)', () => {
    expect(
      buildAffiliatePerformanceQuery({ range: 'custom', from: '2026-08-01', to: '2026-08-29', affiliate: AFFILIATE_A }),
    ).toBe(`range=custom&from=2026-08-01&to=2026-08-29&affiliate=${AFFILIATE_A}`)
  })

  it('suppresses the SWR request for an incomplete custom range (both modes)', () => {
    expect(affiliatePerformanceSwrKey({ range: 'custom', from: '', to: '' })).toBeNull()
    expect(affiliatePerformanceSwrKey({ range: 'custom', from: '2026-08-01', to: '', affiliate: AFFILIATE_A })).toBeNull()
  })

  it('builds the endpoint SWR key for leaderboard and detail', () => {
    expect(affiliatePerformanceSwrKey({ range: 'today' })).toBe(
      '/api/admin/marketing/affiliate-performance?range=today',
    )
    expect(affiliatePerformanceSwrKey({ range: 'last_7_days', affiliate: AFFILIATE_A })).toBe(
      `/api/admin/marketing/affiliate-performance?range=last_7_days&affiliate=${AFFILIATE_A}`,
    )
  })
})

// Type-only guard: the normalised payload matches the exported type.
const _typecheck: AffiliatePerformancePayload = normalizeAffiliatePerformance(RAW_LEADERBOARD)
void _typecheck
