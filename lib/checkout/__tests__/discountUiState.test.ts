import { describe, it, expect } from 'vitest'
import {
  initDiscountUiState,
  discountUiReducer,
  selectDiscountPence,
  selectEffectiveTotalPence,
  canApply,
  hasAppliedDiscount,
  buildCreateCheckoutBody,
  isValidWalletSplit,
  type AppliedDiscount,
  type DiscountUiState,
} from '@/lib/checkout/discountUiState'

const APPLIED: AppliedDiscount = {
  code: 'SAVE10',
  discountType: 'fixed',
  discountValue: 500,
  scope: 'site_wide',
  subtotalPence: 2000,
  discountPence: 500,
  totalPence: 1500,
}

function applied(state: DiscountUiState): DiscountUiState {
  return discountUiReducer(state, { type: 'validateSuccess', applied: APPLIED, nextKey: 'key-applied' })
}

describe('discountUiState reducer', () => {
  it('initialises idle with the given idempotency key', () => {
    const s = initDiscountUiState('key-0')
    expect(s.status).toBe('idle')
    expect(s.applied).toBeNull()
    expect(s.idempotencyKey).toBe('key-0')
    expect(s.input).toBe('')
  })

  it('validateStart clears any prior applied discount and shows validating', () => {
    let s = applied(initDiscountUiState('key-0'))
    expect(s.status).toBe('applied')
    s = discountUiReducer(s, { type: 'validateStart' })
    expect(s.status).toBe('validating')
    expect(s.applied).toBeNull() // preview reverts to base while in flight
  })

  it('applies a discount, normalises the shown code and rotates the key', () => {
    const s0 = initDiscountUiState('key-0')
    const s = applied(s0)
    expect(s.status).toBe('applied')
    expect(s.applied).toEqual(APPLIED)
    expect(s.input).toBe('SAVE10')
    expect(s.idempotencyKey).toBe('key-applied') // rotated
    expect(s.idempotencyKey).not.toBe(s0.idempotencyKey)
  })

  it('editing the field invalidates an applied discount and rotates the key', () => {
    const s1 = applied(initDiscountUiState('key-0'))
    const s2 = discountUiReducer(s1, { type: 'inputChanged', value: 'SAVE1', nextKey: 'key-edit' })
    expect(s2.applied).toBeNull()
    expect(s2.status).toBe('idle')
    expect(s2.idempotencyKey).toBe('key-edit') // rotated because a discount was cleared
  })

  it('editing while idle (nothing applied) does NOT rotate the key', () => {
    const s1 = initDiscountUiState('key-0')
    const s2 = discountUiReducer(s1, { type: 'inputChanged', value: 'S', nextKey: 'key-should-not-use' })
    expect(s2.idempotencyKey).toBe('key-0')
    expect(s2.input).toBe('S')
  })

  it('editing after an error clears the error and rotates the key', () => {
    let s = initDiscountUiState('key-0')
    s = discountUiReducer(s, { type: 'inputChanged', value: 'BAD', nextKey: 'k1' })
    s = discountUiReducer(s, { type: 'validateStart' })
    s = discountUiReducer(s, { type: 'validateError', code: 'discount_code_invalid' })
    expect(s.status).toBe('error')
    const s2 = discountUiReducer(s, { type: 'inputChanged', value: 'BADX', nextKey: 'key-after-error' })
    expect(s2.status).toBe('idle')
    expect(s2.errorCode).toBeNull()
    expect(s2.idempotencyKey).toBe('key-after-error')
  })

  it('validateError surfaces the code with no discount applied', () => {
    let s = discountUiReducer(initDiscountUiState('key-0'), { type: 'validateStart' })
    s = discountUiReducer(s, { type: 'validateError', code: 'discount_code_expired' })
    expect(s.status).toBe('error')
    expect(s.errorCode).toBe('discount_code_expired')
    expect(s.applied).toBeNull()
  })

  it('remove reverts to base, clears input and rotates the key', () => {
    const s1 = applied(initDiscountUiState('key-0'))
    const s2 = discountUiReducer(s1, { type: 'remove', nextKey: 'key-removed' })
    expect(s2.applied).toBeNull()
    expect(s2.status).toBe('idle')
    expect(s2.input).toBe('')
    expect(s2.idempotencyKey).toBe('key-removed')
  })
})

describe('discountUiState selectors', () => {
  it('effective total is base when nothing applied, discounted when applied', () => {
    const base = initDiscountUiState('key-0')
    expect(selectEffectiveTotalPence(base, 2000)).toBe(2000)
    expect(selectDiscountPence(base)).toBe(0)

    const s = applied(base)
    expect(selectEffectiveTotalPence(s, 2000)).toBe(1500)
    expect(selectDiscountPence(s)).toBe(500)
    expect(hasAppliedDiscount(s)).toBe(true)
  })

  it('canApply requires a well-formed, non-duplicate code and not validating', () => {
    let s = initDiscountUiState('key-0')
    expect(canApply(s)).toBe(false) // empty
    s = discountUiReducer(s, { type: 'inputChanged', value: 'ab', nextKey: 'k' })
    expect(canApply(s)).toBe(false) // too short
    s = discountUiReducer(s, { type: 'inputChanged', value: 'save10', nextKey: 'k' })
    expect(canApply(s)).toBe(true) // normalises to SAVE10
    s = discountUiReducer(s, { type: 'validateStart' })
    expect(canApply(s)).toBe(false) // validating

    const appliedState = applied(initDiscountUiState('key-0'))
    // Same code already applied -> cannot re-apply.
    const sameInput = discountUiReducer(appliedState, {
      type: 'inputChanged',
      value: 'SAVE10',
      nextKey: 'k',
    })
    // inputChanged cleared applied, so it becomes applicable again — verify the
    // duplicate guard against a still-applied state directly instead.
    expect(canApply({ ...appliedState, input: 'SAVE10' })).toBe(false)
    expect(canApply(sameInput)).toBe(true)
  })
})

describe('buildCreateCheckoutBody', () => {
  it('omits discountCode when none is applied and always includes the idempotency key', () => {
    const s = initDiscountUiState('key-0')
    const body = buildCreateCheckoutBody({ state: s, campaignId: 'c1', qty: 3 })
    expect(body).toEqual({ campaignId: 'c1', qty: 3, idempotencyKey: 'key-0' })
    expect('discountCode' in body).toBe(false)
  })

  it('includes discountCode, bundle and useCredit when present', () => {
    const s = applied(initDiscountUiState('key-0'))
    const body = buildCreateCheckoutBody({
      state: s,
      campaignId: 'c1',
      qty: 5,
      bundlePricePence: 1500,
      useCredit: true,
    })
    expect(body).toEqual({
      campaignId: 'c1',
      qty: 5,
      bundlePricePence: 1500,
      useCredit: true,
      discountCode: 'SAVE10',
      idempotencyKey: 'key-applied',
    })
  })

  it('never sends useCredit:false or a zero/negative bundle', () => {
    const s = initDiscountUiState('key-0')
    const body = buildCreateCheckoutBody({
      state: s,
      campaignId: 'c1',
      qty: 1,
      bundlePricePence: 0,
      useCredit: false,
    })
    expect('useCredit' in body).toBe(false)
    expect('bundlePricePence' in body).toBe(false)
  })
})

describe('isValidWalletSplit (against the authoritative discounted total)', () => {
  it('accepts a split that sums exactly to the discounted total', () => {
    expect(isValidWalletSplit({ walletCreditPence: 500, externalPaymentPence: 1000, totalPence: 1500 })).toBe(
      true,
    )
  })

  it('rejects a split summing to the pre-discount total', () => {
    // 2000 was the subtotal; the discounted total is 1500. A split summing to
    // 2000 must be rejected — this is the core discount+wallet safety check.
    expect(isValidWalletSplit({ walletCreditPence: 500, externalPaymentPence: 1500, totalPence: 1500 })).toBe(
      false,
    )
  })

  it('rejects non-integer, negative or non-number parts', () => {
    expect(isValidWalletSplit({ walletCreditPence: 1.5, externalPaymentPence: 1498.5, totalPence: 1500 })).toBe(
      false,
    )
    expect(isValidWalletSplit({ walletCreditPence: -100, externalPaymentPence: 1600, totalPence: 1500 })).toBe(
      false,
    )
    expect(isValidWalletSplit({ walletCreditPence: '500', externalPaymentPence: 1000, totalPence: 1500 })).toBe(
      false,
    )
  })

  it('accepts a fully wallet-funded split (external 0)', () => {
    expect(isValidWalletSplit({ walletCreditPence: 1500, externalPaymentPence: 0, totalPence: 1500 })).toBe(true)
  })
})
