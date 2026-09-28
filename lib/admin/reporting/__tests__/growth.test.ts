import { describe, it, expect } from 'vitest'
import {
  ABANDON_THRESHOLD_MS,
  averageCreditPerWalletOrderPence,
  buildGrowthQuery,
  classifyPending,
  clampPercent,
  completedAttempts,
  externalCashPerCreditPound,
  externalPenceFallback,
  findIdentityFields,
  formatRate,
  formatRatio,
  growthSwrKey,
  parseDashboardView,
  soldPercentage,
  successRate,
  ticketsRemaining,
  toCampaignViewModels,
  walletUsageRate,
  type GrowthLiveCampaign,
} from '../growth'

describe('externalPenceFallback', () => {
  it('uses the explicit external payment when present', () => {
    expect(externalPenceFallback(500, 800, 300)).toBe(500)
  })
  it('falls back to total minus wallet credit when external is null', () => {
    expect(externalPenceFallback(null, 800, 300)).toBe(500)
  })
  it('treats missing wallet credit as zero in the fallback', () => {
    expect(externalPenceFallback(undefined, 800, null)).toBe(800)
  })
  it('mirrors the SQL: external can be 0 explicitly (fully credit-paid)', () => {
    expect(externalPenceFallback(0, 800, 800)).toBe(0)
  })
})

describe('classifyPending (30-minute abandonment boundary)', () => {
  const now = 10_000_000
  it('is in_progress just under 30 minutes old', () => {
    expect(classifyPending(now - (ABANDON_THRESHOLD_MS - 1), now)).toBe('in_progress')
  })
  it('flips to abandoned at exactly 30 minutes old (>= threshold)', () => {
    expect(classifyPending(now - ABANDON_THRESHOLD_MS, now)).toBe('abandoned')
  })
  it('is abandoned when older than 30 minutes', () => {
    expect(classifyPending(now - (ABANDON_THRESHOLD_MS + 1), now)).toBe('abandoned')
  })
})

describe('checkout health math', () => {
  const h = { confirmed: 65, failed: 20, abandoned: 15 }
  it('completed attempts exclude in-progress (confirmed+failed+abandoned)', () => {
    expect(completedAttempts(h)).toBe(100)
  })
  it('success rate = confirmed / completed attempts', () => {
    expect(successRate(h)).toBeCloseTo(0.65, 10)
  })
  it('success rate is null with zero completed attempts (no divide-by-zero)', () => {
    expect(successRate({ confirmed: 0, failed: 0, abandoned: 0 })).toBeNull()
  })
})

describe('wallet impact math', () => {
  it('wallet usage rate = wallet orders / confirmed orders', () => {
    expect(walletUsageRate(30, 120)).toBeCloseTo(0.25, 10)
  })
  it('wallet usage rate is null when there are no confirmed orders', () => {
    expect(walletUsageRate(0, 0)).toBeNull()
  })
  it('external cash per £1 credit is a pure pence/pence ratio', () => {
    expect(externalCashPerCreditPound(2500, 1000)).toBeCloseTo(2.5, 10)
  })
  it('external cash per £1 credit is null when no credit redeemed', () => {
    expect(externalCashPerCreditPound(2500, 0)).toBeNull()
  })
  it('average credit per wallet order rounds to whole pence', () => {
    expect(averageCreditPerWalletOrderPence(1000, 3)).toBe(333)
  })
  it('average credit per wallet order is null when no wallet orders', () => {
    expect(averageCreditPerWalletOrderPence(1000, 0)).toBeNull()
  })
})

describe('campaign momentum math', () => {
  it('tickets remaining never goes below zero (oversold clamps to 0)', () => {
    expect(ticketsRemaining(100, 130)).toBe(0)
    expect(ticketsRemaining(100, 40)).toBe(60)
  })
  it('sold percentage is raw/unclamped and null without capacity', () => {
    expect(soldPercentage(40, 100)).toBeCloseTo(40, 10)
    expect(soldPercentage(130, 100)).toBeCloseTo(130, 10)
    expect(soldPercentage(10, 0)).toBeNull()
  })
  it('clampPercent bounds the VISUAL percentage to 0..100', () => {
    expect(clampPercent(130)).toBe(100)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(null)).toBe(0)
    expect(clampPercent(42)).toBe(42)
  })
})

describe('formatting helpers', () => {
  it('formatRatio shows fixed precision and dash for null', () => {
    expect(formatRatio(1.234, 2)).toBe('1.23')
    expect(formatRatio(null)).toBe('—')
    expect(formatRatio(Number.NaN)).toBe('—')
  })
  it('formatRate renders 0..1 as a percentage and dash for null', () => {
    expect(formatRate(0.834)).toBe('83.4%')
    expect(formatRate(null)).toBe('—')
  })
})

describe('toCampaignViewModels', () => {
  const rows: GrowthLiveCampaign[] = [
    {
      id: 'a',
      title: 'Alpha',
      soldPercentage: 130, // oversold — real value preserved, visual clamped
      lifetimeSold: 130,
      maxTickets: 100,
    } as GrowthLiveCampaign,
    {
      id: 'b',
      title: 'Beta',
      soldPercentage: 25,
      lifetimeSold: 25,
      maxTickets: 100,
    } as GrowthLiveCampaign,
  ]
  it('preserves every campaign (no filtering/truncation)', () => {
    expect(toCampaignViewModels(rows)).toHaveLength(2)
  })
  it('adds a clamped visual percentage without mutating the real value', () => {
    const vms = toCampaignViewModels(rows)
    expect(vms[0].soldPercentage).toBe(130) // untouched
    expect(vms[0].soldPercentageClamped).toBe(100) // visual clamp
    expect(vms[1].soldPercentageClamped).toBe(25)
  })
})

describe('buildGrowthQuery (one request per filter state)', () => {
  it('includes range and omits from/to unless custom', () => {
    expect(buildGrowthQuery({ range: 'today' })).toBe('range=today')
  })
  it('includes from/to only for the custom range', () => {
    expect(buildGrowthQuery({ range: 'custom', from: '2026-01-01', to: '2026-01-31' })).toBe(
      'range=custom&from=2026-01-01&to=2026-01-31',
    )
  })
  it('drops empty campaign/provider and includes non-empty ones', () => {
    expect(buildGrowthQuery({ range: 'today', campaign: '', provider: 'sumup' })).toBe(
      'range=today&provider=sumup',
    )
  })
  it('is stable/deterministic for identical inputs', () => {
    const a = buildGrowthQuery({ range: 'last_7_days', campaign: 'c1' })
    const b = buildGrowthQuery({ range: 'last_7_days', campaign: 'c1' })
    expect(a).toBe(b)
  })
})

describe('growthSwrKey (lazy: no request while inactive)', () => {
  it('returns null when Growth is NOT the active view', () => {
    expect(growthSwrKey(false, 'range=today')).toBeNull()
  })
  it('returns the endpoint key when active', () => {
    expect(growthSwrKey(true, 'range=today')).toBe('/api/admin/growth?range=today')
  })
})

describe('parseDashboardView (untrusted ?view)', () => {
  it('accepts growth', () => {
    expect(parseDashboardView('growth')).toBe('growth')
  })
  it('falls back to overview for anything else', () => {
    expect(parseDashboardView('overview')).toBe('overview')
    expect(parseDashboardView('nonsense')).toBe('overview')
    expect(parseDashboardView(null)).toBe('overview')
    expect(parseDashboardView(undefined)).toBe('overview')
  })
})

describe('findIdentityFields (privacy guard)', () => {
  it('returns empty for a clean aggregate payload', () => {
    const clean = {
      customers: { uniqueBuyers: 42, newBuyers: 10 },
      liveCampaigns: [{ id: 'x', title: 'X', lifetimeSold: 5 }],
      available: { campaigns: [{ id: 'c', title: 'C' }], providers: ['sumup'] },
    }
    expect(findIdentityFields(clean)).toEqual([])
  })
  it('detects a leaked user_id deep in the payload', () => {
    const leaky = { liveCampaigns: [{ id: 'x', buyers: [{ user_id: 'u1' }] }] }
    const hits = findIdentityFields(leaky)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((p) => p.includes('user_id'))).toBe(true)
  })
  it('detects email/name identity keys', () => {
    expect(findIdentityFields({ email: 'a@b.com' }).length).toBe(1)
    expect(findIdentityFields({ full_name: 'Jane' }).length).toBe(1)
  })
})
