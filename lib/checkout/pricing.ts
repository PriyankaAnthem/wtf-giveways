/**
 * Pure, server-safe authoritative checkout pricing helpers.
 *
 * Contains NO database access and NO Next.js request handling, so it can be
 * unit-tested in isolation and shared as the SINGLE source of truth for the
 * authoritative subtotal calculation. Both the checkout-create route and the
 * provisional discount-validation endpoint call `computeAuthoritativeSubtotal`
 * with the SAME already-trusted campaign row, so they can never drift.
 *
 * This module intentionally mirrors the exact bundle rule the checkout-create
 * route has always enforced: a supplied bundle price is accepted ONLY when it
 * exactly matches a configured bundle for the requested quantity; otherwise the
 * subtotal is `qty * ticket_price_pence`.
 *
 * IMPORTANT: this file must never trust a client-supplied subtotal/total. It is
 * given the raw campaign row (already read server-side) and re-derives price.
 */

/** Hard quantity bounds shared by every authoritative pricing caller. */
export const CHECKOUT_MIN_QTY = 1
export const CHECKOUT_MAX_QTY = 500

/** Minimal shape of the campaign row required to price an order. */
export interface CampaignPricingInput {
  ticket_price_pence: unknown
  bundles: unknown
}

export type SubtotalResult =
  | { ok: true; subtotalPence: number; bundlePricePence: number | null }
  | {
      ok: false
      code: 'invalid_qty' | 'invalid_bundle' | 'invalid_campaign_pricing' | 'invalid_subtotal'
    }

/** Non-negative SAFE integer guard (also rejects > MAX_SAFE_INTEGER). */
export function isNonNegativeSafeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

/**
 * Validate a requested quantity against the shared checkout bounds.
 * Returns the coerced integer, or null when invalid.
 */
export function normalizeQty(raw: unknown): number | null {
  const qty = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(qty) || !Number.isInteger(qty)) return null
  if (qty < CHECKOUT_MIN_QTY || qty > CHECKOUT_MAX_QTY) return null
  return qty
}

/**
 * Normalize an optional bundle price. Only a strictly-positive integer is a
 * real bundle selection; anything missing/zero/negative/malformed means "no
 * bundle" (per-ticket pricing), matching the existing checkout-create rule.
 */
export function normalizeBundlePence(raw: unknown): number | undefined {
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Compute the AUTHORITATIVE subtotal (in integer pence) for a campaign order.
 *
 * @param campaign        the already-trusted campaign row (server-read)
 * @param qty             a quantity already validated to be within bounds
 * @param bundlePricePence an optional, already-normalized positive bundle price
 *
 * Behaviour (identical to the historical checkout-create logic):
 *  - When a bundle price is supplied it MUST exactly match a configured
 *    `{ quantity, price_pence }` bundle for this qty; otherwise `invalid_bundle`.
 *    The subtotal is then that bundle price.
 *  - Otherwise the subtotal is `qty * ticket_price_pence`.
 */
export function computeAuthoritativeSubtotal(
  campaign: CampaignPricingInput,
  qty: number,
  bundlePricePence: number | undefined,
): SubtotalResult {
  if (!Number.isSafeInteger(qty) || qty < CHECKOUT_MIN_QTY || qty > CHECKOUT_MAX_QTY) {
    return { ok: false, code: 'invalid_qty' }
  }

  let subtotalPence: number
  let resolvedBundlePence: number | null = null

  if (bundlePricePence != null && Number.isFinite(bundlePricePence)) {
    if (!Array.isArray(campaign.bundles)) {
      return { ok: false, code: 'invalid_bundle' }
    }
    const matched = (campaign.bundles as { quantity?: unknown; price_pence?: unknown }[]).find(
      (b) => Number(b.quantity) === qty && Number(b.price_pence) === bundlePricePence,
    )
    if (!matched) {
      return { ok: false, code: 'invalid_bundle' }
    }
    subtotalPence = bundlePricePence
    resolvedBundlePence = bundlePricePence
  } else {
    if (!isNonNegativeSafeInt(campaign.ticket_price_pence)) {
      return { ok: false, code: 'invalid_campaign_pricing' }
    }
    subtotalPence = qty * campaign.ticket_price_pence
  }

  if (!isNonNegativeSafeInt(subtotalPence) || subtotalPence <= 0) {
    return { ok: false, code: 'invalid_subtotal' }
  }

  return { ok: true, subtotalPence, bundlePricePence: resolvedBundlePence }
}
