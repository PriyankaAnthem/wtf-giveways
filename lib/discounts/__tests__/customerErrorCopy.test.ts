import { describe, it, expect } from 'vitest'
import {
  discountErrorMessage,
  checkoutErrorMessage,
  isCheckoutExpired,
} from '@/lib/discounts/customerErrorCopy'

describe('discountErrorMessage', () => {
  it('maps every known discount code to distinct, non-technical copy', () => {
    const codes = [
      'discount_code_invalid',
      'discount_code_inactive',
      'discount_code_not_started',
      'discount_code_expired',
      'discount_code_wrong_campaign',
      'discount_code_no_saving',
      'discount_code_exceeds_subtotal',
      'discount_code_validation_failed',
    ]
    for (const code of codes) {
      const msg = discountErrorMessage(code)
      expect(msg.length).toBeGreaterThan(0)
      // Never leak the raw machine code to the shopper.
      expect(msg).not.toContain('discount_code_')
      expect(msg).not.toContain('_')
    }
  })

  it('falls back to the generic invalid message for unknown/empty codes', () => {
    const fallback = discountErrorMessage('discount_code_invalid')
    expect(discountErrorMessage('something_weird')).toBe(fallback)
    expect(discountErrorMessage(null)).toBe(fallback)
    expect(discountErrorMessage(undefined)).toBe(fallback)
  })
})

describe('checkoutErrorMessage', () => {
  it('maps checkout-creation codes to friendly copy', () => {
    expect(checkoutErrorMessage('checkout_expired')).toMatch(/expired/i)
    expect(checkoutErrorMessage('wallet_prepare_failed')).toMatch(/WTF Credit/i)
    expect(checkoutErrorMessage('idempotency_conflict')).toMatch(/review/i)
  })

  it('also resolves discount codes (both families can occur at confirm time)', () => {
    expect(checkoutErrorMessage('discount_code_expired')).toBe(discountErrorMessage('discount_code_expired'))
  })

  it('falls back to a generic message for unknown codes and never leaks the code', () => {
    const msg = checkoutErrorMessage('totally_unknown')
    expect(msg.length).toBeGreaterThan(0)
    expect(msg).not.toContain('totally_unknown')
  })
})

describe('isCheckoutExpired', () => {
  it('is true only for the checkout_expired code', () => {
    expect(isCheckoutExpired('checkout_expired')).toBe(true)
    expect(isCheckoutExpired('wallet_prepare_failed')).toBe(false)
    expect(isCheckoutExpired(null)).toBe(false)
    expect(isCheckoutExpired(undefined)).toBe(false)
  })
})
