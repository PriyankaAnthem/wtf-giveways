import { describe, it, expect } from 'vitest'
import {
  AUDIENCE_CATALOGUE,
  MARKETING_AUDIENCES_ENDPOINT,
  STALE_AFTER_MS,
  findIdentityFields,
  formatCount,
  formatCreditPence,
  isCreditAudience,
  isFreshnessStale,
  marketingAudiencesSwrKey,
  type AudienceCount,
  type CreditAudienceCount,
} from '../audiences'

describe('isFreshnessStale (15-minute rule, mirrors SQL)', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z')
  it('is stale when there has never been a successful refresh', () => {
    expect(isFreshnessStale(null, now)).toBe(true)
  })
  it('is stale for an unparseable timestamp', () => {
    expect(isFreshnessStale('not-a-date', now)).toBe(true)
  })
  it('is fresh just under 15 minutes old', () => {
    const last = new Date(now - (STALE_AFTER_MS - 1000)).toISOString()
    expect(isFreshnessStale(last, now)).toBe(false)
  })
  it('is stale more than 15 minutes old', () => {
    const last = new Date(now - (STALE_AFTER_MS + 1000)).toISOString()
    expect(isFreshnessStale(last, now)).toBe(true)
  })
})

describe('formatCreditPence (pence -> GBP)', () => {
  it('formats whole and fractional pounds from integer pence', () => {
    expect(formatCreditPence(12345)).toBe('£123.45')
    expect(formatCreditPence(500)).toBe('£5.00')
    expect(formatCreditPence(0)).toBe('£0.00')
  })
  it('never NaNs on null/undefined/invalid', () => {
    expect(formatCreditPence(null)).toBe('£0.00')
    expect(formatCreditPence(undefined)).toBe('£0.00')
    expect(formatCreditPence(Number.NaN)).toBe('£0.00')
  })
})

describe('formatCount', () => {
  it('adds thousands separators and coerces invalid to 0', () => {
    expect(formatCount(12345)).toBe('12,345')
    expect(formatCount(null)).toBe('0')
    expect(formatCount(Number.NaN)).toBe('0')
  })
})

describe('marketingAudiencesSwrKey (one endpoint, lazy)', () => {
  it('returns the single endpoint when active', () => {
    expect(marketingAudiencesSwrKey(true)).toBe(MARKETING_AUDIENCES_ENDPOINT)
    expect(MARKETING_AUDIENCES_ENDPOINT).toBe('/api/admin/marketing/audiences')
  })
  it('returns null when inactive so no request is ever made', () => {
    expect(marketingAudiencesSwrKey(false)).toBeNull()
  })
})

describe('isCreditAudience', () => {
  it('is true only when both credit sums are present', () => {
    const credit: CreditAudienceCount = {
      key: 'customers_with_credit',
      matchedCount: 1,
      eligibleCount: 1,
      totalAvailableCreditPence: 100,
      eligibleAvailableCreditPence: 100,
    }
    const plain: AudienceCount = { key: 'one_time_buyers', matchedCount: 1, eligibleCount: 1 }
    expect(isCreditAudience(credit)).toBe(true)
    expect(isCreditAudience(plain)).toBe(false)
  })
})

describe('AUDIENCE_CATALOGUE', () => {
  it('lists all 14 required audiences with unique fields and keys', () => {
    expect(AUDIENCE_CATALOGUE).toHaveLength(14)
    const fields = AUDIENCE_CATALOGUE.map((a) => a.field)
    const keys = AUDIENCE_CATALOGUE.map((a) => a.key)
    expect(new Set(fields).size).toBe(14)
    expect(new Set(keys).size).toBe(14)
  })
  it('uses the exact stable snake_case keys from the spec', () => {
    const keys = AUDIENCE_CATALOGUE.map((a) => a.key).sort()
    expect(keys).toEqual(
      [
        'recent_buyers_not_today',
        'one_time_buyers',
        'lapsed_7_days',
        'lapsed_14_days',
        'lapsed_30_days',
        'lapsed_60_days',
        'frequent_buyers',
        'vip_buyers',
        'high_value_buyers',
        'customers_with_credit',
        'customers_with_credit_5_plus',
        'new_accounts_without_purchase',
        'all_eligible_buyers',
        'eligible_non_buyers',
      ].sort(),
    )
  })
  it('labels the overlapping lapsed audiences with 7+, 14+, 30+ and 60+', () => {
    const title = (field: string) =>
      AUDIENCE_CATALOGUE.find((a) => a.field === field)?.title ?? ''
    expect(title('lapsed7Days')).toContain('7+')
    expect(title('lapsed14Days')).toContain('14+')
    expect(title('lapsed30Days')).toContain('30+')
    expect(title('lapsed60Days')).toContain('60+')
  })
  it('describes thresholds in plain English, never as raw SQL/pence', () => {
    for (const a of AUDIENCE_CATALOGUE) {
      expect(a.description.length).toBeGreaterThan(0)
      expect(a.description).not.toMatch(/confirmed_order_count|lifetime_external_pence|wallet_available_pence|>=|marketing_eligible_snapshot/)
    }
    // Money is shown in pounds, not raw pence thresholds.
    const vip = AUDIENCE_CATALOGUE.find((a) => a.field === 'vipBuyers')!
    expect(vip.description).toContain('£250')
    const high = AUDIENCE_CATALOGUE.find((a) => a.field === 'highValueBuyers')!
    expect(high.description).toContain('£100')
  })
})

describe('findIdentityFields (privacy guard)', () => {
  it('returns empty for a clean aggregate payload', () => {
    const clean = {
      generatedAt: '2026-01-01T00:00:00Z',
      freshness: { profileCount: 10, backfillComplete: true, stale: false, lastProcessedUsers: 5 },
      health: { totalProfiles: 10, currentlyEligible: 4 },
      audiences: {
        oneTimeBuyers: { key: 'one_time_buyers', matchedCount: 3, eligibleCount: 2 },
        customersWithCredit: {
          key: 'customers_with_credit',
          matchedCount: 2,
          eligibleCount: 1,
          totalAvailableCreditPence: 500,
          eligibleAvailableCreditPence: 250,
        },
      },
    }
    expect(findIdentityFields(clean)).toEqual([])
  })
  it('detects leaked email / user id / arrays of ids', () => {
    expect(findIdentityFields({ email: 'a@b.com' }).length).toBe(1)
    expect(findIdentityFields({ user_id: 'u1' }).length).toBe(1)
    expect(findIdentityFields({ userIds: ['a', 'b'] }).length).toBe(1)
    expect(findIdentityFields({ nested: [{ full_name: 'Jane' }] }).length).toBe(1)
    expect(findIdentityFields({ email_lc: 'x@y.z' }).length).toBe(1)
  })
})
