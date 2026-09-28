/**
 * Pure, server-safe discount-code normalization, validation and calculation.
 *
 * Contains NO database access and NO Next.js request handling. It is the SINGLE
 * source of truth for how a discount code is normalized, how a `discount_codes`
 * row is validated against an authoritative order, and how the integer-pence
 * discount is calculated. The server-only `validateDiscountCode` wrapper reads
 * the row from Supabase and delegates every decision to this module, so the
 * checkout-create route and the provisional endpoint behave identically.
 *
 * All money is integer pence. Never trust a client-supplied discount amount,
 * type, scope or id — the caller passes only an authoritative subtotal and the
 * raw DB row.
 */

export type DiscountType = 'fixed' | 'percentage'
export type DiscountScope = 'site_wide' | 'campaign'

/**
 * Stable, client-safe discount error codes with their HTTP status.
 *
 * This is the SINGLE public error vocabulary shared by BOTH the checkout-create
 * route and the provisional validation endpoint. Malformed AND unknown codes
 * both surface as `discount_code_invalid` so the API never reveals whether a
 * guessed promotion code exists. `discount_code_validation_failed` is reserved
 * for an unexpected server/database failure (never a bad code), so a transient
 * outage is not mislabelled as an invalid code.
 */
export type DiscountErrorCode =
  | 'discount_code_invalid'
  | 'discount_code_inactive'
  | 'discount_code_not_started'
  | 'discount_code_expired'
  | 'discount_code_wrong_campaign'
  | 'discount_code_no_saving'
  | 'discount_code_exceeds_subtotal'
  | 'discount_code_validation_failed'

export const DISCOUNT_ERROR_STATUS: Record<DiscountErrorCode, number> = {
  discount_code_invalid: 400,
  discount_code_inactive: 409,
  discount_code_not_started: 409,
  discount_code_expired: 410,
  discount_code_wrong_campaign: 409,
  discount_code_no_saving: 422,
  discount_code_exceeds_subtotal: 422,
  discount_code_validation_failed: 500,
}

export interface AppliedDiscount {
  id: string
  code: string
  discountType: DiscountType
  discountValue: number
  scope: DiscountScope
  discountPence: number
  subtotalPence: number
  totalPence: number
}

export type DiscountResult =
  | {
      ok: true
      discount: AppliedDiscount | null
      subtotalPence: number
      totalPence: number
    }
  | {
      ok: false
      code: DiscountErrorCode
      status: number
    }

/** Raw `public.discount_codes` row shape as read from the database. */
export interface DiscountCodeRow {
  id: unknown
  code: unknown
  discount_type: unknown
  discount_value: unknown
  scope: unknown
  campaign_id: unknown
  is_active: unknown
  starts_at: unknown
  expires_at: unknown
}

/** Normalized code shape used both for querying and for the snapshot. */
export type NormalizedCode =
  | { ok: true; code: string }
  | { ok: false }

const CODE_RE = /^[A-Z0-9_-]+$/
const CODE_MIN_LEN = 3
const CODE_MAX_LEN = 40

/**
 * Normalize a submitted code: trim, uppercase, and reject malformed input
 * BEFORE any database query. Malformed = empty / too short / too long / not
 * matching the allowed character set.
 */
export function normalizeDiscountCode(submittedCode: string | null | undefined): NormalizedCode {
  if (submittedCode == null) return { ok: false }
  const code = submittedCode.trim().toUpperCase()
  if (code.length < CODE_MIN_LEN || code.length > CODE_MAX_LEN) return { ok: false }
  if (!CODE_RE.test(code)) return { ok: false }
  return { ok: true, code }
}

function fail(code: DiscountErrorCode): DiscountResult {
  return { ok: false, code, status: DISCOUNT_ERROR_STATUS[code] }
}

function toEpoch(value: unknown): number | null {
  if (value == null) return null
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const t = new Date(value as string | Date).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Evaluate a discount-code row against an authoritative order and compute the
 * integer-pence discount. `row` is null when no code matched (unknown code).
 *
 * @param params.row           the raw DB row, or null when the code is unknown
 * @param params.campaignId    the authoritative checkout campaign id
 * @param params.subtotalPence the authoritative, already-validated subtotal
 * @param params.now           server time used for start/expiry comparison
 */
export function evaluateDiscount(params: {
  row: DiscountCodeRow | null
  campaignId: string
  subtotalPence: number
  now: Date
}): DiscountResult {
  const { row, campaignId, subtotalPence, now } = params

  // Guard the authoritative subtotal itself.
  if (!Number.isSafeInteger(subtotalPence) || subtotalPence <= 0) {
    return fail('discount_code_invalid')
  }

  // 1) The code must exist.
  if (!row) return fail('discount_code_invalid')

  // 7) Defensive runtime type checks (DB constraints notwithstanding).
  const id = typeof row.id === 'string' ? row.id : null
  const code = typeof row.code === 'string' ? row.code : null
  const discountType = row.discount_type
  const scope = row.scope
  const discountValue = row.discount_value
  if (
    !id ||
    !code ||
    (discountType !== 'fixed' && discountType !== 'percentage') ||
    (scope !== 'site_wide' && scope !== 'campaign') ||
    typeof discountValue !== 'number' ||
    !Number.isInteger(discountValue)
  ) {
    return fail('discount_code_invalid')
  }

  // 2) Must be active.
  if (row.is_active !== true) return fail('discount_code_inactive')

  // 3) starts_at null or not later than now (valid exactly at starts_at).
  const startsAt = toEpoch(row.starts_at)
  if (startsAt != null && startsAt > now.getTime()) {
    return fail('discount_code_not_started')
  }

  // 4) expires_at null or later than now (expired exactly at expires_at).
  const expiresAt = toEpoch(row.expires_at)
  if (expiresAt != null && expiresAt <= now.getTime()) {
    return fail('discount_code_expired')
  }

  // 5/6) Scope: campaign codes must match exactly; site_wide always applies.
  if (scope === 'campaign') {
    if (typeof row.campaign_id !== 'string' || row.campaign_id !== campaignId) {
      return fail('discount_code_wrong_campaign')
    }
  }

  // Calculate the integer-pence discount.
  let discountPence: number
  if (discountType === 'fixed') {
    // Fixed value is integer pence. Reject non-positive or >= subtotal outright
    // (never silently cap it).
    if (discountValue <= 0) return fail('discount_code_invalid')
    if (discountValue >= subtotalPence) return fail('discount_code_exceeds_subtotal')
    discountPence = discountValue
  } else {
    // Percentage: whole number 1..99.
    if (discountValue < 1 || discountValue > 99) return fail('discount_code_invalid')
    discountPence = Math.floor((subtotalPence * discountValue) / 100)
    if (discountPence <= 0) return fail('discount_code_no_saving')
    if (discountPence >= subtotalPence) return fail('discount_code_exceeds_subtotal')
  }

  const totalPence = subtotalPence - discountPence
  if (!Number.isSafeInteger(totalPence) || totalPence <= 0) {
    // Should be unreachable given the guards above, but fail closed.
    return fail('discount_code_exceeds_subtotal')
  }

  return {
    ok: true,
    subtotalPence,
    totalPence,
    discount: {
      id,
      code,
      discountType,
      discountValue,
      scope,
      discountPence,
      subtotalPence,
      totalPence,
    },
  }
}
