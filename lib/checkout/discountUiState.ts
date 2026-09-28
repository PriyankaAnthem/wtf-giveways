/**
 * Pure, framework-agnostic state model for the customer-facing discount-code
 * UI at checkout. All apply / remove / invalidation / idempotency-key rotation
 * / provisional-pricing / wallet-split logic lives here so it can be unit
 * tested without a DOM (the test env is `node` with no jsdom/RTL). The React
 * component is a thin view that dispatches these actions and renders selectors.
 *
 * Money is always integer pence. This module never talks to the network — the
 * component performs the fetch and feeds results back in via actions.
 */

import { normalizeDiscountCode, type DiscountType, type DiscountScope } from '@/lib/discounts/discountCalc'

/** The authoritative, server-validated discount currently applied. */
export interface AppliedDiscount {
  code: string
  discountType: DiscountType
  discountValue: number
  scope: DiscountScope
  subtotalPence: number
  discountPence: number
  totalPence: number
}

export type DiscountUiStatus = 'idle' | 'validating' | 'applied' | 'error'

export interface DiscountUiState {
  /** Raw text in the code input (as typed). */
  input: string
  status: DiscountUiStatus
  /** Stable machine error code (mapped to copy by customerErrorCopy). */
  errorCode: string | null
  applied: AppliedDiscount | null
  /**
   * Idempotency key sent with checkout creation. Rotates whenever the
   * authoritative pricing inputs change (a discount is applied, removed, or an
   * applied discount is invalidated by editing the field) so a retried
   * confirmation can never collide with a materially different prior request.
   */
  idempotencyKey: string
}

export type DiscountUiAction =
  // Editing the field. `nextKey` is only consumed when this edit invalidates an
  // already-applied discount (pricing reverts to the base total).
  | { type: 'inputChanged'; value: string; nextKey: string }
  // A validation request is starting; pricing reverts to base while in flight.
  | { type: 'validateStart' }
  // Server accepted the code — replace pricing and rotate the idempotency key.
  | { type: 'validateSuccess'; applied: AppliedDiscount; nextKey: string }
  // Server rejected the code — surface a stable error code, no discount applied.
  | { type: 'validateError'; code: string }
  // Shopper removed the applied code — revert to base and rotate the key.
  | { type: 'remove'; nextKey: string }

export function initDiscountUiState(idempotencyKey: string): DiscountUiState {
  return {
    input: '',
    status: 'idle',
    errorCode: null,
    applied: null,
    idempotencyKey,
  }
}

export function discountUiReducer(state: DiscountUiState, action: DiscountUiAction): DiscountUiState {
  switch (action.type) {
    case 'inputChanged': {
      // If an applied discount (or a shown error) is in play, editing the field
      // invalidates it: pricing reverts to base and the idempotency key rotates
      // because the authoritative pricing inputs just changed.
      const wasMeaningful = state.applied !== null || state.status === 'error'
      return {
        ...state,
        input: action.value,
        status: 'idle',
        errorCode: null,
        applied: null,
        idempotencyKey: wasMeaningful ? action.nextKey : state.idempotencyKey,
      }
    }

    case 'validateStart': {
      // Drop any prior applied discount so the preview shows the base total
      // while the request is in flight; a stale success must never linger.
      return {
        ...state,
        status: 'validating',
        errorCode: null,
        applied: null,
      }
    }

    case 'validateSuccess': {
      return {
        ...state,
        // Reflect the server's canonical (normalized) code text.
        input: action.applied.code,
        status: 'applied',
        errorCode: null,
        applied: action.applied,
        idempotencyKey: action.nextKey,
      }
    }

    case 'validateError': {
      return {
        ...state,
        status: 'error',
        errorCode: action.code,
        applied: null,
      }
    }

    case 'remove': {
      return {
        ...state,
        input: '',
        status: 'idle',
        errorCode: null,
        applied: null,
        idempotencyKey: action.nextKey,
      }
    }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Selectors (pure derivations over state + the base pricing)
// ---------------------------------------------------------------------------

/** Pence saved by the applied discount (0 when none). */
export function selectDiscountPence(state: DiscountUiState): number {
  return state.applied?.discountPence ?? 0
}

/**
 * The effective total the shopper pays. When a discount is applied we use the
 * server's authoritative `totalPence`; otherwise the base (pre-discount) total.
 */
export function selectEffectiveTotalPence(state: DiscountUiState, baseTotalPence: number): number {
  return state.applied ? state.applied.totalPence : baseTotalPence
}

/** Whether the Apply button should be enabled for the current input/status. */
export function canApply(state: DiscountUiState): boolean {
  if (state.status === 'validating') return false
  const normalized = normalizeDiscountCode(state.input)
  if (!normalized.ok) return false
  // Already applied to this exact code — nothing to do.
  if (state.applied && state.applied.code === normalized.code) return false
  return true
}

/** True when a discount is currently applied. */
export function hasAppliedDiscount(state: DiscountUiState): boolean {
  return state.applied !== null
}

// ---------------------------------------------------------------------------
// Checkout submission helpers
// ---------------------------------------------------------------------------

export interface CreateCheckoutBody {
  campaignId: string
  qty: number
  bundlePricePence?: number
  useCredit?: boolean
  discountCode?: string
  idempotencyKey: string
}

/**
 * Build the exact body sent to POST /api/checkout/create. `discountCode` is
 * ONLY included when a discount is currently applied — we never send stale or
 * unvalidated input, and never send a client-computed amount (the server
 * recomputes everything authoritatively).
 */
export function buildCreateCheckoutBody(params: {
  state: DiscountUiState
  campaignId: string
  qty: number
  bundlePricePence?: number
  useCredit?: boolean
}): CreateCheckoutBody {
  const { state, campaignId, qty, bundlePricePence, useCredit } = params
  const body: CreateCheckoutBody = {
    campaignId,
    qty,
    idempotencyKey: state.idempotencyKey,
  }
  if (typeof bundlePricePence === 'number' && Number.isFinite(bundlePricePence) && bundlePricePence > 0) {
    body.bundlePricePence = bundlePricePence
  }
  if (useCredit === true) {
    body.useCredit = true
  }
  if (state.applied) {
    body.discountCode = state.applied.code
  }
  return body
}

/**
 * Validate a wallet split returned by checkout creation against the
 * AUTHORITATIVE discounted total. Both parts must be non-negative integers and
 * must sum to exactly the total — the same invariant the server enforces.
 */
export function isValidWalletSplit(params: {
  walletCreditPence: unknown
  externalPaymentPence: unknown
  totalPence: number
}): boolean {
  const { walletCreditPence, externalPaymentPence, totalPence } = params
  const isNonNegInt = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0
  return (
    isNonNegInt(walletCreditPence) &&
    isNonNegInt(externalPaymentPence) &&
    walletCreditPence + externalPaymentPence === totalPence
  )
}
