import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_MAX_QTY,
  computeAuthoritativeSubtotal,
  normalizeBundlePence,
  normalizeQty,
} from '../pricing'

const campaign = {
  ticket_price_pence: 100,
  bundles: [
    { quantity: 5, price_pence: 400 },
    { quantity: 10, price_pence: 750 },
  ],
}

describe('normalizeQty', () => {
  it('accepts in-range integers (number or numeric string)', () => {
    expect(normalizeQty(1)).toBe(1)
    expect(normalizeQty('5')).toBe(5)
    expect(normalizeQty(CHECKOUT_MAX_QTY)).toBe(CHECKOUT_MAX_QTY)
  })

  it('rejects out-of-range, zero, negative and malformed values', () => {
    expect(normalizeQty(0)).toBeNull()
    expect(normalizeQty(-1)).toBeNull()
    expect(normalizeQty(CHECKOUT_MAX_QTY + 1)).toBeNull()
    expect(normalizeQty('abc')).toBeNull()
    expect(normalizeQty(1.5)).toBeNull()
    expect(normalizeQty(null)).toBeNull()
  })
})

describe('normalizeBundlePence', () => {
  it('accepts only strictly-positive integers', () => {
    expect(normalizeBundlePence(400)).toBe(400)
    expect(normalizeBundlePence('750')).toBe(750)
  })

  it('treats zero/negative/malformed/missing as no bundle', () => {
    expect(normalizeBundlePence(0)).toBeUndefined()
    expect(normalizeBundlePence(-5)).toBeUndefined()
    expect(normalizeBundlePence('x')).toBeUndefined()
    expect(normalizeBundlePence(undefined)).toBeUndefined()
  })
})

describe('computeAuthoritativeSubtotal', () => {
  it('prices a per-ticket order as qty * ticket_price_pence', () => {
    const r = computeAuthoritativeSubtotal(campaign, 3, undefined)
    expect(r).toEqual({ ok: true, subtotalPence: 300, bundlePricePence: null })
  })

  it('accepts a bundle only when quantity AND price match a configured bundle', () => {
    const r = computeAuthoritativeSubtotal(campaign, 5, 400)
    expect(r).toEqual({ ok: true, subtotalPence: 400, bundlePricePence: 400 })
  })

  it('rejects a bundle with a mismatched price', () => {
    const r = computeAuthoritativeSubtotal(campaign, 5, 399)
    expect(r).toEqual({ ok: false, code: 'invalid_bundle' })
  })

  it('rejects a bundle with a mismatched quantity', () => {
    const r = computeAuthoritativeSubtotal(campaign, 6, 400)
    expect(r).toEqual({ ok: false, code: 'invalid_bundle' })
  })

  it('rejects a bundle when the campaign has no bundles array', () => {
    const r = computeAuthoritativeSubtotal({ ticket_price_pence: 100, bundles: null }, 5, 400)
    expect(r).toEqual({ ok: false, code: 'invalid_bundle' })
  })

  it('rejects per-ticket pricing when ticket_price_pence is invalid', () => {
    const r = computeAuthoritativeSubtotal({ ticket_price_pence: null, bundles: [] }, 3, undefined)
    expect(r).toEqual({ ok: false, code: 'invalid_campaign_pricing' })
  })

  it('rejects a zero subtotal (free ticket price, no bundle)', () => {
    const r = computeAuthoritativeSubtotal({ ticket_price_pence: 0, bundles: [] }, 3, undefined)
    expect(r).toEqual({ ok: false, code: 'invalid_subtotal' })
  })
})
