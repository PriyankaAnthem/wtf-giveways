import { describe, expect, it } from 'vitest'
import {
  evaluateDiscount,
  normalizeDiscountCode,
  type DiscountCodeRow,
} from '../discountCalc'

const CAMPAIGN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const OTHER_CAMPAIGN = '11111111-2222-3333-4444-555555555555'
const NOW = new Date('2026-02-01T12:00:00.000Z')

function row(overrides: Partial<DiscountCodeRow>): DiscountCodeRow {
  return {
    id: 'd1',
    code: 'SAVE10',
    discount_type: 'fixed',
    discount_value: 500,
    scope: 'site_wide',
    campaign_id: null,
    is_active: true,
    starts_at: null,
    expires_at: null,
    ...overrides,
  }
}

describe('normalizeDiscountCode', () => {
  it('trims and uppercases valid codes', () => {
    expect(normalizeDiscountCode('  save10  ')).toEqual({ ok: true, code: 'SAVE10' })
    expect(normalizeDiscountCode('Black-Friday_2026')).toEqual({ ok: true, code: 'BLACK-FRIDAY_2026' })
  })

  it('rejects malformed codes before any query', () => {
    expect(normalizeDiscountCode(null).ok).toBe(false)
    expect(normalizeDiscountCode('').ok).toBe(false)
    expect(normalizeDiscountCode('  ').ok).toBe(false)
    expect(normalizeDiscountCode('ab').ok).toBe(false) // too short
    expect(normalizeDiscountCode('x'.repeat(41)).ok).toBe(false) // too long
    expect(normalizeDiscountCode('bad code').ok).toBe(false) // space
    expect(normalizeDiscountCode('bad!').ok).toBe(false) // symbol
  })
})

describe('evaluateDiscount', () => {
  it('rejects an unknown code (null row)', () => {
    const r = evaluateDiscount({ row: null, campaignId: CAMPAIGN, subtotalPence: 1000, now: NOW })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_invalid', status: 400 })
  })

  it('applies a valid site-wide fixed discount', () => {
    const r = evaluateDiscount({ row: row({}), campaignId: CAMPAIGN, subtotalPence: 1000, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.discount).toMatchObject({ discountPence: 500, scope: 'site_wide', discountType: 'fixed' })
    expect(r.totalPence).toBe(500)
  })

  it('applies a valid campaign-scoped fixed discount when the campaign matches', () => {
    const r = evaluateDiscount({
      row: row({ scope: 'campaign', campaign_id: CAMPAIGN, discount_value: 300 }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.discount?.discountPence).toBe(300)
    expect(r.totalPence).toBe(700)
  })

  it('applies a valid site-wide percentage discount', () => {
    const r = evaluateDiscount({
      row: row({ discount_type: 'percentage', discount_value: 20 }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.discount?.discountPence).toBe(200)
    expect(r.totalPence).toBe(800)
  })

  it('applies a valid campaign percentage discount', () => {
    const r = evaluateDiscount({
      row: row({ discount_type: 'percentage', discount_value: 10, scope: 'campaign', campaign_id: CAMPAIGN }),
      campaignId: CAMPAIGN,
      subtotalPence: 999,
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 999 * 10 / 100 = 99.9 -> floor 99
    expect(r.discount?.discountPence).toBe(99)
    expect(r.totalPence).toBe(900)
  })

  it('floors percentage discounts (rounding down)', () => {
    const r = evaluateDiscount({
      row: row({ discount_type: 'percentage', discount_value: 33 }),
      campaignId: CAMPAIGN,
      subtotalPence: 100,
      now: NOW,
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.discount?.discountPence).toBe(33) // floor(33) = 33
  })

  it('rejects a percentage that rounds down to zero saving', () => {
    const r = evaluateDiscount({
      row: row({ discount_type: 'percentage', discount_value: 1 }),
      campaignId: CAMPAIGN,
      subtotalPence: 50, // 50 * 1 / 100 = 0.5 -> floor 0
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_no_saving', status: 422 })
  })

  it('applies a fixed discount exactly one penny below the subtotal', () => {
    const r = evaluateDiscount({
      row: row({ discount_value: 999 }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.discount?.discountPence).toBe(999)
    expect(r.totalPence).toBe(1) // final total stays > 0
  })

  it('rejects a fixed discount equal to the subtotal', () => {
    const r = evaluateDiscount({
      row: row({ discount_value: 1000 }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_exceeds_subtotal', status: 422 })
  })

  it('rejects a fixed discount greater than the subtotal (no silent cap)', () => {
    const r = evaluateDiscount({
      row: row({ discount_value: 1500 }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_exceeds_subtotal' })
  })

  it('allows a final total of exactly 1p', () => {
    const r = evaluateDiscount({
      row: row({ discount_value: 999 }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.totalPence).toBe(1)
  })

  it('rejects an inactive code', () => {
    const r = evaluateDiscount({ row: row({ is_active: false }), campaignId: CAMPAIGN, subtotalPence: 1000, now: NOW })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_inactive', status: 409 })
  })

  it('rejects a future start date', () => {
    const r = evaluateDiscount({
      row: row({ starts_at: '2026-03-01T00:00:00.000Z' }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_not_started', status: 409 })
  })

  it('treats the exact expiry time as expired', () => {
    const expires = '2026-02-01T12:00:00.000Z' // === NOW
    const r = evaluateDiscount({
      row: row({ expires_at: expires }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_expired', status: 410 })
  })

  it('rejects an expired code', () => {
    const r = evaluateDiscount({
      row: row({ expires_at: '2026-01-01T00:00:00.000Z' }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_expired' })
  })

  it('accepts a code exactly at its start time', () => {
    const r = evaluateDiscount({
      row: row({ starts_at: '2026-02-01T12:00:00.000Z' }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a campaign-scoped code for the wrong campaign', () => {
    const r = evaluateDiscount({
      row: row({ scope: 'campaign', campaign_id: OTHER_CAMPAIGN }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_wrong_campaign', status: 409 })
  })

  it('rejects rows with unexpected runtime types despite DB constraints', () => {
    const r = evaluateDiscount({
      row: row({ discount_type: 'weird' as unknown }),
      campaignId: CAMPAIGN,
      subtotalPence: 1000,
      now: NOW,
    })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_invalid' })
  })

  it('rejects an out-of-range percentage value', () => {
    expect(
      evaluateDiscount({
        row: row({ discount_type: 'percentage', discount_value: 100 }),
        campaignId: CAMPAIGN,
        subtotalPence: 1000,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: 'discount_code_invalid' })
    expect(
      evaluateDiscount({
        row: row({ discount_type: 'percentage', discount_value: 0 }),
        campaignId: CAMPAIGN,
        subtotalPence: 1000,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: 'discount_code_invalid' })
  })
})
