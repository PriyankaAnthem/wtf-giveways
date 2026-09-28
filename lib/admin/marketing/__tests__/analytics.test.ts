import { describe, it, expect } from 'vitest'
import {
  MARKETING_PERIOD_DAYS,
  DEFAULT_MARKETING_PERIOD,
  ATTRIBUTION_LABEL,
  num,
  periodToDays,
  parsePeriodDays,
  revenuePerOrderPence,
  isRevenueWinner,
  formatRatePct,
  ctrFromCounts,
  normalizeAnalytics,
} from '@/lib/admin/marketing/analytics'

describe('marketing analytics — period mapping', () => {
  it('maps the three selectable periods to the exact RPC p_days values', () => {
    expect(MARKETING_PERIOD_DAYS).toEqual({ today: 1, '7d': 7, '30d': 30 })
    expect(periodToDays('today')).toBe(1)
    expect(periodToDays('7d')).toBe(7)
    expect(periodToDays('30d')).toBe(30)
  })

  it('defaults to 7 days', () => {
    expect(DEFAULT_MARKETING_PERIOD).toBe('7d')
    expect(periodToDays(DEFAULT_MARKETING_PERIOD)).toBe(7)
  })

  it('parsePeriodDays only ever admits 1 / 7 / 30, else falls back to 7', () => {
    expect(parsePeriodDays('1')).toBe(1)
    expect(parsePeriodDays('7')).toBe(7)
    expect(parsePeriodDays('30')).toBe(30)
    expect(parsePeriodDays(30)).toBe(30)
    // Anything else — tampering, junk, out-of-range — collapses to the default.
    expect(parsePeriodDays('90')).toBe(7)
    expect(parsePeriodDays('0')).toBe(7)
    expect(parsePeriodDays('-7')).toBe(7)
    expect(parsePeriodDays('abc')).toBe(7)
    expect(parsePeriodDays(null)).toBe(7)
    expect(parsePeriodDays(undefined)).toBe(7)
    expect(parsePeriodDays(2.5)).toBe(7)
  })
})

describe('marketing analytics — num() coercion', () => {
  it('passes finite numbers through and zeroes everything else', () => {
    expect(num(1234)).toBe(1234)
    expect(num(0)).toBe(0)
    expect(num(-50)).toBe(-50)
    expect(num(NaN)).toBe(0)
    expect(num(Infinity)).toBe(0)
    expect(num('100')).toBe(0)
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num({})).toBe(0)
  })
})

describe('marketing analytics — revenuePerOrderPence (money)', () => {
  it('integer-divides external cash by orders, in whole pence', () => {
    expect(revenuePerOrderPence(10000, 4)).toBe(2500) // £100 / 4 = £25.00
    expect(revenuePerOrderPence(999, 1)).toBe(999)
  })

  it('rounds to the nearest whole penny (never a fractional penny)', () => {
    // £100.00 across 3 orders = 3333.33p -> 3333p
    expect(revenuePerOrderPence(10000, 3)).toBe(3333)
    expect(Number.isInteger(revenuePerOrderPence(10000, 3))).toBe(true)
  })

  it('returns 0 (never NaN/Infinity) when there are no orders', () => {
    expect(revenuePerOrderPence(50000, 0)).toBe(0)
    expect(revenuePerOrderPence(50000, -1)).toBe(0)
    expect(revenuePerOrderPence(0, 0)).toBe(0)
    expect(Number.isFinite(revenuePerOrderPence(50000, 0))).toBe(true)
  })

  it('treats non-finite money defensively', () => {
    expect(revenuePerOrderPence(NaN, 5)).toBe(0)
    expect(revenuePerOrderPence(Infinity, 5)).toBe(0)
  })
})

describe('marketing analytics — isRevenueWinner (zero-revenue gating)', () => {
  it('is a winner ONLY with strictly positive external cash', () => {
    expect(isRevenueWinner({ externalCashPence: 1 })).toBe(true)
    expect(isRevenueWinner({ externalCashPence: 250000 })).toBe(true)
  })

  it('is NOT a winner at zero, negative, or absent revenue', () => {
    expect(isRevenueWinner({ externalCashPence: 0 })).toBe(false)
    expect(isRevenueWinner({ externalCashPence: -100 })).toBe(false)
    expect(isRevenueWinner(null)).toBe(false)
    expect(isRevenueWinner(undefined)).toBe(false)
  })
})

describe('marketing analytics — rate formatting', () => {
  it('formats percentages to one decimal place with a % suffix', () => {
    expect(formatRatePct(12.5)).toBe('12.5%')
    expect(formatRatePct(0)).toBe('0.0%')
    expect(formatRatePct(100)).toBe('100.0%')
  })

  it('never emits NaN%/blank for missing or non-finite values', () => {
    expect(formatRatePct(null)).toBe('0.0%')
    expect(formatRatePct(undefined)).toBe('0.0%')
    expect(formatRatePct(NaN)).toBe('0.0%')
    expect(formatRatePct(Infinity)).toBe('0.0%')
  })
})

describe('marketing analytics — ctrFromCounts', () => {
  it('computes CTR from raw counts as a percentage', () => {
    expect(ctrFromCounts(25, 100)).toBe(25)
    expect(ctrFromCounts(1, 8)).toBeCloseTo(12.5, 5)
  })

  it('returns 0 (never Infinity/NaN) when nothing was delivered', () => {
    expect(ctrFromCounts(5, 0)).toBe(0)
    expect(ctrFromCounts(0, 0)).toBe(0)
    expect(Number.isFinite(ctrFromCounts(5, 0))).toBe(true)
  })
})

describe('marketing analytics — normalizeAnalytics (defensive shaping)', () => {
  it('collapses a completely empty payload to safe zeros / empties / nulls', () => {
    const p = normalizeAnalytics(null)
    expect(p.summary.externalCashPence).toBe(0)
    expect(p.summary.attributedOrders).toBe(0)
    expect(p.byAutomation).toEqual([])
    expect(p.byCampaign).toEqual([])
    expect(p.topAutomation).toBeNull()
    expect(p.topCampaign).toBeNull()
    expect(p.attributionModel).toBe('7_day_last_click')
  })

  it('maps a realistic RPC payload into the typed shape verbatim', () => {
    const p = normalizeAnalytics({
      generatedAt: '2026-01-02T03:04:05.000Z',
      periodDays: 7,
      periodStart: '2025-12-26',
      attributionModel: '7_day_last_click',
      summary: {
        sent: 500,
        delivered: 480,
        clicked: 60,
        ctrPct: 12.5,
        convertingRecipients: 12,
        attributedOrders: 14,
        purchaseConversionPct: 20,
        grossSalesPence: 250000,
        externalCashPence: 180000,
        walletCreditPence: 70000,
        revenuePerDeliveredPence: 375,
      },
      byAutomation: [
        { opportunityType: 'abandoned_checkout', name: 'Abandoned Checkout', externalCashPence: 120000 },
      ],
      byCampaign: [
        {
          campaignId: 'c1',
          title: 'Win a Supercar',
          slug: 'win-a-supercar',
          directDelivered: 300,
          directClicked: 40,
          totalAttributedOrders: 10,
          directAttributedOrders: 7,
          lifecycleAttributedOrders: 3,
          externalCashPence: 150000,
          grossSalesPence: 200000,
          walletCreditPence: 50000,
          directExternalCashPence: 110000,
          lifecycleExternalCashPence: 40000,
        },
      ],
      topAutomation: { opportunityType: 'abandoned_checkout', name: 'Abandoned Checkout', externalCashPence: 120000 },
      topCampaign: { campaignId: 'c1', title: 'Win a Supercar', slug: 'win-a-supercar', externalCashPence: 150000 },
    })

    expect(p.summary.externalCashPence).toBe(180000)
    expect(p.summary.grossSalesPence).toBe(250000)
    expect(p.summary.walletCreditPence).toBe(70000)
    expect(p.byAutomation).toHaveLength(1)
    expect(p.byAutomation[0].name).toBe('Abandoned Checkout')
    expect(p.byCampaign[0].campaignId).toBe('c1')
    expect(p.byCampaign[0].directExternalCashPence).toBe(110000)
    expect(p.byCampaign[0].lifecycleExternalCashPence).toBe(40000)
    expect(p.topCampaign?.title).toBe('Win a Supercar')
    // External cash and gross sales are DISTINCT and never conflated.
    expect(p.summary.externalCashPence).not.toBe(p.summary.grossSalesPence)
  })

  it('keeps a zero-revenue campaign row (activity present, £0 cash) rather than dropping it', () => {
    const p = normalizeAnalytics({
      byCampaign: [
        {
          campaignId: 'c2',
          title: 'Quiet Draw',
          directDelivered: 100,
          directClicked: 5,
          totalAttributedOrders: 0,
          externalCashPence: 0,
        },
      ],
    })
    expect(p.byCampaign).toHaveLength(1)
    expect(p.byCampaign[0].externalCashPence).toBe(0)
    expect(p.byCampaign[0].directDelivered).toBe(100)
    // A zero-revenue campaign must never be surfaced as a winner.
    expect(isRevenueWinner(p.topCampaign)).toBe(false)
  })
})

describe('marketing analytics — attribution label', () => {
  it('uses the conservative, non-causal label', () => {
    expect(ATTRIBUTION_LABEL).toBe('7-day click-attributed revenue')
  })
})
