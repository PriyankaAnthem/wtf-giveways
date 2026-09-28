/**
 * Customer-facing copy for discount + checkout error codes.
 *
 * The server (Stage 2/3) only ever returns STABLE machine codes — never raw
 * database or Supabase errors. This module is the single place that turns those
 * codes into friendly, non-technical messages, so the checkout client and its
 * tests agree on exactly what a shopper sees.
 *
 * Deliberately client-safe: no secrets, no server-only imports. Unknown codes
 * fall back to a generic, reassuring message rather than leaking the raw code.
 */

/** Discount validation error codes shared with the Stage 2 evaluator. */
export type DiscountErrorCode =
  | 'discount_code_invalid'
  | 'discount_code_inactive'
  | 'discount_code_not_started'
  | 'discount_code_expired'
  | 'discount_code_wrong_campaign'
  | 'discount_code_no_saving'
  | 'discount_code_exceeds_subtotal'
  | 'discount_code_validation_failed'

/** Checkout-creation error codes the discount UI must react to. */
export type CheckoutErrorCode =
  | 'checkout_expired'
  | 'idempotency_conflict'
  | 'wallet_prepare_failed'
  | 'wallet_split_invalid'

const DISCOUNT_COPY: Record<DiscountErrorCode, string> = {
  // Malformed AND unknown codes both surface here, so we never confirm whether
  // a guessed code exists.
  discount_code_invalid: "That code isn't valid. Please check it and try again.",
  discount_code_inactive: 'That code is no longer available.',
  discount_code_not_started: "That code isn't active yet.",
  discount_code_expired: 'That code has expired.',
  discount_code_wrong_campaign: "That code can't be used on this competition.",
  discount_code_no_saving: "That code doesn't reduce this order.",
  discount_code_exceeds_subtotal: "That code can't be applied to this order.",
  discount_code_validation_failed: "We couldn't check that code just now. Please try again in a moment.",
}

const CHECKOUT_COPY: Record<CheckoutErrorCode, string> = {
  checkout_expired: 'Your checkout session has expired. Please start again to refresh your order.',
  idempotency_conflict: 'Your order details changed. Please review and confirm again.',
  wallet_prepare_failed: "We couldn't apply your WTF Credit just now. Please try again.",
  wallet_split_invalid: "We couldn't confirm your payment amount. Please refresh and try again.",
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

/**
 * Map a discount validation error code to shopper-friendly copy. Unknown or
 * missing codes fall back to the generic invalid-code message so a shopper is
 * never shown a raw machine code.
 */
export function discountErrorMessage(code: string | null | undefined): string {
  if (code && code in DISCOUNT_COPY) {
    return DISCOUNT_COPY[code as DiscountErrorCode]
  }
  return DISCOUNT_COPY.discount_code_invalid
}

/**
 * Map any checkout-flow error code (discount or checkout-creation) to friendly
 * copy. Used when confirming the order, where either family can occur.
 */
export function checkoutErrorMessage(code: string | null | undefined): string {
  if (code && code in CHECKOUT_COPY) {
    return CHECKOUT_COPY[code as CheckoutErrorCode]
  }
  if (code && code in DISCOUNT_COPY) {
    return DISCOUNT_COPY[code as DiscountErrorCode]
  }
  return GENERIC_MESSAGE
}

/** True when the code means the checkout session can no longer be completed. */
export function isCheckoutExpired(code: string | null | undefined): boolean {
  return code === 'checkout_expired'
}
