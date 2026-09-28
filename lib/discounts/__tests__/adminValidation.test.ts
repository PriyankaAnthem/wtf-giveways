import { describe, it, expect } from 'vitest'
import {
  validateCode,
  validateDescription,
  validateDiscountType,
  validateScope,
  parseFixedAmountToPence,
  validatePercentage,
  validateDiscountValue,
  resolveScopeAndCampaign,
  validateSchedule,
  validateIsActive,
  validateDiscountInput,
} from '@/lib/discounts/adminValidation'

const CAMPAIGN_UUID = '11111111-1111-4111-8111-111111111111'

describe('validateCode (normalize + format)', () => {
  it('uppercases and trims a valid code', () => {
    const r = validateCode('  save10 ')
    expect(r.ok && r.value).toBe('SAVE10')
  })

  it('allows underscores and hyphens', () => {
    expect(validateCode('BLACK_FRIDAY-2026').ok).toBe(true)
  })

  it('rejects invalid characters', () => {
    const r = validateCode('SAVE 10')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('discount_code_invalid_format')
  })

  it('rejects codes shorter than 3 chars', () => {
    expect(validateCode('AB').ok).toBe(false)
  })

  it('rejects codes longer than 40 chars', () => {
    expect(validateCode('A'.repeat(41)).ok).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(validateCode(123).ok).toBe(false)
    expect(validateCode(null).ok).toBe(false)
  })
})

describe('validateDescription', () => {
  it('trims and returns null for blank', () => {
    expect(validateDescription('   ')).toEqual({ ok: true, value: null })
    expect(validateDescription(null)).toEqual({ ok: true, value: null })
  })
  it('trims a real description', () => {
    const r = validateDescription('  internal note ')
    expect(r.ok && r.value).toBe('internal note')
  })
  it('rejects over-long descriptions', () => {
    expect(validateDescription('x'.repeat(501)).ok).toBe(false)
  })
})

describe('validateDiscountType / validateScope', () => {
  it('accepts allowed enums', () => {
    expect(validateDiscountType('fixed').ok).toBe(true)
    expect(validateDiscountType('percentage').ok).toBe(true)
    expect(validateScope('site_wide').ok).toBe(true)
    expect(validateScope('campaign').ok).toBe(true)
  })
  it('rejects unknown enums', () => {
    expect(validateDiscountType('free').ok).toBe(false)
    expect(validateScope('global').ok).toBe(false)
  })
})

describe('parseFixedAmountToPence (GBP -> integer pence)', () => {
  it('converts 5.00 to 500 pence', () => {
    const r = parseFixedAmountToPence('5.00')
    expect(r.ok && r.value).toBe(500)
  })
  it('converts 5 to 500 pence', () => {
    const r = parseFixedAmountToPence('5')
    expect(r.ok && r.value).toBe(500)
  })
  it('converts 0.99 to 99 pence', () => {
    const r = parseFixedAmountToPence('0.99')
    expect(r.ok && r.value).toBe(99)
  })
  it('rejects zero', () => {
    expect(parseFixedAmountToPence('0').ok).toBe(false)
    expect(parseFixedAmountToPence('0.00').ok).toBe(false)
  })
  it('rejects negatives', () => {
    expect(parseFixedAmountToPence('-5.00').ok).toBe(false)
  })
  it('rejects more than two decimals', () => {
    expect(parseFixedAmountToPence('5.001').ok).toBe(false)
  })
  it('rejects non-numeric / currency symbols / commas', () => {
    expect(parseFixedAmountToPence('£5').ok).toBe(false)
    expect(parseFixedAmountToPence('1,000').ok).toBe(false)
    expect(parseFixedAmountToPence('abc').ok).toBe(false)
    expect(parseFixedAmountToPence('').ok).toBe(false)
  })
})

describe('validatePercentage', () => {
  it('accepts a whole number 1–99', () => {
    expect(validatePercentage('10').ok).toBe(true)
    expect(validatePercentage(1).ok).toBe(true)
    expect(validatePercentage(99).ok).toBe(true)
  })
  it('rejects decimals', () => {
    expect(validatePercentage('10.5').ok).toBe(false)
    expect(validatePercentage(10.5).ok).toBe(false)
  })
  it('rejects 0 and 100', () => {
    expect(validatePercentage('0').ok).toBe(false)
    expect(validatePercentage('100').ok).toBe(false)
  })
})

describe('validateDiscountValue dispatch', () => {
  it('routes fixed to pence', () => {
    const r = validateDiscountValue('fixed', '5.00')
    expect(r.ok && r.value).toBe(500)
  })
  it('routes percentage to whole percent', () => {
    const r = validateDiscountValue('percentage', '25')
    expect(r.ok && r.value).toBe(25)
  })
})

describe('resolveScopeAndCampaign (coupling)', () => {
  it('site_wide clears campaign to null', () => {
    const r = resolveScopeAndCampaign('site_wide', null)
    expect(r.ok && r.value.campaignId).toBeNull()
  })
  it('site_wide with a campaign id is rejected', () => {
    const r = resolveScopeAndCampaign('site_wide', CAMPAIGN_UUID)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('campaign_not_allowed_for_site_wide')
  })
  it('campaign requires a campaign id', () => {
    const r = resolveScopeAndCampaign('campaign', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('campaign_required')
  })
  it('campaign rejects a non-uuid id', () => {
    const r = resolveScopeAndCampaign('campaign', 'not-a-uuid')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_campaign_id')
  })
  it('campaign accepts a valid uuid', () => {
    const r = resolveScopeAndCampaign('campaign', CAMPAIGN_UUID)
    expect(r.ok && r.value.campaignId).toBe(CAMPAIGN_UUID)
  })
})

describe('validateSchedule', () => {
  it('allows both null', () => {
    expect(validateSchedule(null, null)).toEqual({ ok: true, value: { startsAt: null, expiresAt: null } })
  })
  it('rejects an invalid start', () => {
    const r = validateSchedule('not-a-date', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_start_time')
  })
  it('rejects an invalid expiry', () => {
    const r = validateSchedule(null, 'nope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_expiry_time')
  })
  it('rejects expiry equal to start', () => {
    const t = '2026-01-01T00:00:00.000Z'
    const r = validateSchedule(t, t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('expiry_not_after_start')
  })
  it('rejects expiry before start', () => {
    const r = validateSchedule('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    expect(r.ok).toBe(false)
  })
  it('accepts a valid window and normalizes to ISO', () => {
    const r = validateSchedule('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.startsAt).toBe('2026-01-01T00:00:00.000Z')
      expect(r.value.expiresAt).toBe('2026-02-01T00:00:00.000Z')
    }
  })
})

describe('validateIsActive', () => {
  it('accepts booleans only', () => {
    expect(validateIsActive(true).ok).toBe(true)
    expect(validateIsActive(false).ok).toBe(true)
    expect(validateIsActive('true').ok).toBe(false)
    expect(validateIsActive(1).ok).toBe(false)
  })
})

describe('validateDiscountInput (end-to-end)', () => {
  const base = {
    code: ' save10 ',
    description: '  new year ',
    discountType: 'fixed',
    discountValue: '5.00',
    scope: 'site_wide',
    campaignId: null,
    isActive: true,
    startsAt: null,
    expiresAt: null,
  }

  it('produces a DB-shaped fixed site-wide payload', () => {
    const r = validateDiscountInput({ ...base })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toMatchObject({
        code: 'SAVE10',
        description: 'new year',
        discount_type: 'fixed',
        discount_value: 500,
        scope: 'site_wide',
        campaign_id: null,
        is_active: true,
        starts_at: null,
        expires_at: null,
      })
    }
  })

  it('produces a percentage campaign payload', () => {
    const r = validateDiscountInput({
      ...base,
      discountType: 'percentage',
      discountValue: '15',
      scope: 'campaign',
      campaignId: CAMPAIGN_UUID,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.discount_type).toBe('percentage')
      expect(r.value.discount_value).toBe(15)
      expect(r.value.scope).toBe('campaign')
      expect(r.value.campaign_id).toBe(CAMPAIGN_UUID)
    }
  })

  it('fails when a campaign scope has no campaign', () => {
    const r = validateDiscountInput({ ...base, scope: 'campaign', campaignId: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('campaign_required')
  })

  it('fails a zero fixed amount', () => {
    const r = validateDiscountInput({ ...base, discountValue: '0' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_fixed_amount')
  })

  it('never trusts client audit fields (they are simply absent from output)', () => {
    const r = validateDiscountInput({
      ...base,
      created_by: 'attacker',
      updated_by: 'attacker',
      created_at: '1999-01-01',
    } as Record<string, unknown>)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('created_by' in r.value).toBe(false)
      expect('updated_by' in r.value).toBe(false)
      expect('created_at' in r.value).toBe(false)
    }
  })
})
