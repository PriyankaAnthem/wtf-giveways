import { describe, it, expect } from 'vitest'
import {
  buildGrowthRecommendations,
  selectTopRecommendations,
  MAX_RECOMMENDATIONS,
  THRESHOLDS,
} from '../recommendations'
import type {
  GrowthDashboardPayload,
  GrowthLiveCampaign,
  MetricComparison,
} from '../growth'
import { findIdentityFields } from '../growth'

// ---------------------------------------------------------------------------
// Builders — a fully "healthy/steady" payload that fires NOTHING, so each test
// can flip exactly one dimension and assert the single rule it targets.
// ---------------------------------------------------------------------------
function metric(current: number, previous: number, changePct: number | null): MetricComparison {
  return { current, previous, changePct }
}

function campaign(over: Partial<GrowthLiveCampaign> = {}): GrowthLiveCampaign {
  return {
    campaignId: 'c1',
    title: 'Pie Face',
    slug: 'pie-face',
    status: 'live',
    maxTickets: 1000,
    lifetimeTicketsSold: 400,
    ticketsRemaining: 600,
    soldPercentage: 40,
    externalRevenuePeriodPence: 100_00,
    grossSalesPeriodPence: 100_00,
    creditPeriodPence: 0,
    confirmedOrdersPeriod: 10,
    ticketsPeriod: 40,
    averageOrderValuePence: 1000,
    ticketsLast24Hours: 0,
    externalRevenueLast24HoursPence: 0,
    uniqueBuyersLast24Hours: 0,
    lastConfirmedAt: null,
    ...over,
  }
}

function steadyPayload(over: Partial<GrowthDashboardPayload> = {}): GrowthDashboardPayload {
  return {
    period: {
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-08T00:00:00Z',
      comparisonStart: '2025-12-25T00:00:00Z',
      comparisonEnd: '2026-01-01T00:00:00Z',
      timezone: 'Europe/London',
    },
    customers: {
      uniqueBuyers: metric(100, 100, 0),
      ordersPerBuyer: metric(1.2, 1.2, 0),
      externalRevenuePerBuyerPence: metric(2000, 2000, 0),
      averageOrderValuePence: metric(1500, 1500, 0),
    },
    checkoutHealth: {
      created: 120,
      confirmed: 95,
      failed: 3,
      abandoned: 2,
      inProgress: 20,
      completedAttempts: 100,
      successRate: 0.95,
    },
    walletImpact: {
      confirmedOrders: 95,
      walletOrders: 10,
      walletUsageRate: 0.105,
      walletCreditRedeemedPence: 0,
      externalCashFromWalletOrdersPence: 0,
      fullyWalletFundedOrders: 0,
      averageCreditPerWalletOrderPence: null,
      externalCashPerCreditPound: null,
    },
    // No live campaigns: with healthy funnel/customer metrics there is nothing
    // to surface. (A live campaign with sales always yields a status read —
    // positive or attention — which is covered by the campaign-specific tests.)
    liveCampaigns: [],
    available: { campaigns: [], providers: [] },
    generatedAt: '2026-01-08T00:00:00Z',
    ...over,
  }
}

describe('steady state fires nothing', () => {
  it('produces zero recommendations when every metric is healthy and flat', () => {
    expect(buildGrowthRecommendations(steadyPayload())).toEqual([])
  })
  it('is null/undefined safe', () => {
    expect(buildGrowthRecommendations(null)).toEqual([])
    expect(buildGrowthRecommendations(undefined)).toEqual([])
    expect(selectTopRecommendations(null)).toEqual([])
  })
})

describe('checkout health rule', () => {
  it('fires when success rate is below the floor with enough volume', () => {
    const p = steadyPayload({
      checkoutHealth: {
        created: 200,
        confirmed: 60,
        failed: 30,
        abandoned: 10,
        inProgress: 5,
        completedAttempts: 100,
        successRate: 0.6,
      },
    })
    const recs = buildGrowthRecommendations(p)
    const hit = recs.find((r) => r.id === 'checkout_health')
    expect(hit).toBeTruthy()
    expect(hit!.kind).toBe('attention')
    expect(hit!.detail).toContain('60.0%')
  })

  it('does NOT fire below the minimum completed-attempts volume', () => {
    const p = steadyPayload({
      checkoutHealth: {
        created: 10,
        confirmed: 3,
        failed: 4,
        abandoned: 3,
        inProgress: 0,
        completedAttempts: THRESHOLDS.minCompletedAttempts - 1,
        successRate: 0.3,
      },
    })
    expect(buildGrowthRecommendations(p).some((r) => r.id === 'checkout_health')).toBe(false)
  })

  it('does NOT fire when success rate meets the floor', () => {
    const p = steadyPayload({
      checkoutHealth: {
        created: 120,
        confirmed: 90,
        failed: 5,
        abandoned: 5,
        inProgress: 0,
        completedAttempts: 100,
        successRate: THRESHOLDS.checkoutSuccessFloor,
      },
    })
    expect(buildGrowthRecommendations(p).some((r) => r.id === 'checkout_health')).toBe(false)
  })
})

describe('buyers trend rule', () => {
  it('flags a material drop in unique buyers', () => {
    const p = steadyPayload({
      customers: {
        ...steadyPayload().customers,
        uniqueBuyers: metric(70, 100, -30),
      },
    })
    const hit = buildGrowthRecommendations(p).find((r) => r.id === 'buyers_down')
    expect(hit?.kind).toBe('attention')
    expect(hit?.detail).toContain('-30.0%')
  })

  it('celebrates a material rise in unique buyers', () => {
    const p = steadyPayload({
      customers: {
        ...steadyPayload().customers,
        uniqueBuyers: metric(130, 100, 30),
      },
    })
    const hit = buildGrowthRecommendations(p).find((r) => r.id === 'buyers_up')
    expect(hit?.kind).toBe('positive')
  })

  it('ignores swings when the previous period is too small to trust', () => {
    const p = steadyPayload({
      customers: {
        ...steadyPayload().customers,
        uniqueBuyers: metric(1, THRESHOLDS.minBuyersForTrend - 1, -80),
      },
    })
    expect(
      buildGrowthRecommendations(p).some((r) => r.id === 'buyers_down' || r.id === 'buyers_up'),
    ).toBe(false)
  })
})

describe('campaign momentum and stalling rules', () => {
  it('flags a strongly performing live campaign (no discount)', () => {
    const p = steadyPayload({
      liveCampaigns: [
        campaign({ ticketsLast24Hours: 40, externalRevenueLast24HoursPence: 50_00, soldPercentage: 55 }),
      ],
    })
    const hit = buildGrowthRecommendations(p).find((r) => r.id.startsWith('campaign_strong'))
    expect(hit?.kind).toBe('positive')
    expect(hit?.action.toLowerCase()).toContain('no discount')
  })

  it('does not call a nearly sold-out campaign "momentum"', () => {
    const p = steadyPayload({
      liveCampaigns: [
        campaign({ ticketsLast24Hours: 40, externalRevenueLast24HoursPence: 50_00, soldPercentage: 96 }),
      ],
    })
    expect(buildGrowthRecommendations(p).some((r) => r.id.startsWith('campaign_strong'))).toBe(false)
  })

  it('flags a stalled campaign with no 24h sales', () => {
    const p = steadyPayload({
      liveCampaigns: [
        campaign({ ticketsLast24Hours: 0, lifetimeTicketsSold: 500, soldPercentage: 50 }),
      ],
    })
    const hit = buildGrowthRecommendations(p).find((r) => r.id.startsWith('campaign_stalled'))
    expect(hit?.kind).toBe('attention')
  })
})

describe('wallet leverage rule', () => {
  it('praises efficient WTF Credit leverage', () => {
    const p = steadyPayload({
      walletImpact: {
        ...steadyPayload().walletImpact,
        walletOrders: 20,
        walletCreditRedeemedPence: 10_00,
        externalCashFromWalletOrdersPence: 30_00,
        externalCashPerCreditPound: 3,
      },
    })
    const hit = buildGrowthRecommendations(p).find((r) => r.id === 'wallet_leverage')
    expect(hit?.kind).toBe('positive')
    expect(hit?.detail).toContain('£3.00')
  })
})

describe('ranking and capping', () => {
  it('returns at most MAX_RECOMMENDATIONS, sorted by severity desc', () => {
    const p = steadyPayload({
      customers: {
        ...steadyPayload().customers,
        uniqueBuyers: metric(70, 100, -30),
        averageOrderValuePence: metric(1000, 1500, -33),
      },
      checkoutHealth: {
        created: 200,
        confirmed: 55,
        failed: 25,
        abandoned: 20,
        inProgress: 0,
        completedAttempts: 100,
        successRate: 0.55,
      },
      liveCampaigns: [
        campaign({ ticketsLast24Hours: 40, externalRevenueLast24HoursPence: 50_00, soldPercentage: 55 }),
      ],
      walletImpact: {
        ...steadyPayload().walletImpact,
        walletOrders: 20,
        walletCreditRedeemedPence: 10_00,
        externalCashFromWalletOrdersPence: 30_00,
        externalCashPerCreditPound: 3,
      },
    })
    const top = selectTopRecommendations(p)
    expect(top.length).toBe(MAX_RECOMMENDATIONS)
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].severity).toBeGreaterThanOrEqual(top[i].severity)
    }
    // The critical checkout failure must outrank the positive wallet note.
    expect(top[0].id).toBe('checkout_health')
  })

  it('never leaks customer identity fields in any recommendation', () => {
    const p = steadyPayload({
      customers: { ...steadyPayload().customers, uniqueBuyers: metric(70, 100, -30) },
    })
    expect(findIdentityFields(buildGrowthRecommendations(p))).toEqual([])
  })
})
