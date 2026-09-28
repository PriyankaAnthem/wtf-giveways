/**
 * Pure, server-safe validators for the admin Discount Codes management surface.
 *
 * This module performs NO database or network access so it can be unit-tested
 * in isolation. It is the single source of truth for how admin-supplied fields
 * are normalized and validated before a service-role write. It deliberately
 * mirrors the DB constraints on `public.discount_codes`:
 *
 *   discount_type IN ('fixed', 'percentage')
 *   scope         IN ('site_wide', 'campaign')
 *   campaign  => scope='campaign'  AND campaign_id IS NOT NULL
 *   site_wide => scope='site_wide' AND campaign_id IS NULL
 *   code = upper(trim(code)), 3–40 chars, [A-Z0-9_-]
 *   fixed:      discount_value = integer pence > 0
 *   percentage: discount_value = whole 1–99
 *
 * All monetary handling is integer pence — no floating-point money storage.
 */
import { normalizeDiscountCode } from '@/lib/discounts/discountCalc'
import type { DiscountType, DiscountScope } from '@/lib/discounts/discountCalc'

export type { DiscountType, DiscountScope } from '@/lib/discounts/discountCalc'

/** Stable, client-safe admin error codes. Mapped to friendly copy in the UI. */
export type AdminDiscountErrorCode =
  | 'discount_code_invalid_format'
  | 'invalid_description'
  | 'invalid_discount_type'
  | 'invalid_fixed_amount'
  | 'invalid_percentage'
  | 'invalid_scope'
  | 'invalid_campaign_id'
  | 'campaign_required'
  | 'campaign_not_allowed_for_site_wide'
  | 'invalid_start_time'
  | 'invalid_expiry_time'
  | 'expiry_not_after_start'
  | 'invalid_is_active'

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: AdminDiscountErrorCode }
export type Result<T> = Ok<T> | Err

const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: AdminDiscountErrorCode): Err => ({ ok: false, error })

export const DISCOUNT_TYPES: DiscountType[] = ['fixed', 'percentage']
export const DISCOUNT_SCOPES: DiscountScope[] = ['site_wide', 'campaign']

const DESCRIPTION_MAX = 500

// Strict GBP syntax: up to 7 integer digits, optional 1–2 decimals. Rejects
// negatives, leading +, commas, currency symbols, exponent notation, and more
// than two decimal places. Mirrors the instant-win-prizes GBP parser.
const GBP_RE = /^\d{1,7}(\.\d{1,2})?$/

// Canonical UUID (any version).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim())
}

/** Normalize + validate a discount code (trim, uppercase, 3–40, [A-Z0-9_-]). */
export function validateCode(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return err('discount_code_invalid_format')
  const normalized = normalizeDiscountCode(raw)
  if (!normalized.ok) return err('discount_code_invalid_format')
  return ok(normalized.code)
}

/** Optional internal description; trimmed, bounded, blank => null. */
export function validateDescription(raw: unknown): Result<string | null> {
  if (raw === null || raw === undefined) return ok(null)
  if (typeof raw !== 'string') return err('invalid_description')
  const t = raw.trim()
  if (t.length === 0) return ok(null)
  if (t.length > DESCRIPTION_MAX) return err('invalid_description')
  return ok(t)
}

export function validateDiscountType(raw: unknown): Result<DiscountType> {
  if (typeof raw === 'string' && (DISCOUNT_TYPES as string[]).includes(raw)) {
    return ok(raw as DiscountType)
  }
  return err('invalid_discount_type')
}

export function validateScope(raw: unknown): Result<DiscountScope> {
  if (typeof raw === 'string' && (DISCOUNT_SCOPES as string[]).includes(raw)) {
    return ok(raw as DiscountScope)
  }
  return err('invalid_scope')
}

/**
 * Convert an admin-supplied GBP string (or number) to positive integer pence.
 * Strict syntax; never trusts a client-calculated pence value.
 */
export function parseFixedAmountToPence(raw: unknown): Result<number> {
  // Accept a plain number ONLY when it is a clean GBP value; stringify so the
  // exact same regex + integer maths applies (no floating-point pence).
  let s: string
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return err('invalid_fixed_amount')
    s = String(raw)
  } else if (typeof raw === 'string') {
    s = raw.trim()
  } else {
    return err('invalid_fixed_amount')
  }

  if (s.length === 0 || !GBP_RE.test(s)) return err('invalid_fixed_amount')

  const [intPart, fracRaw = ''] = s.split('.')
  const frac = (fracRaw + '00').slice(0, 2)
  const pence = Number(intPart) * 100 + Number(frac)

  if (!Number.isSafeInteger(pence) || pence <= 0) return err('invalid_fixed_amount')
  return ok(pence)
}

/** Whole percentage 1–99 only. Rejects decimals, 0, and 100. */
export function validatePercentage(raw: unknown): Result<number> {
  let n: number
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string') {
    const t = raw.trim()
    // Reject decimals / non-integer syntax up-front.
    if (!/^\d{1,3}$/.test(t)) return err('invalid_percentage')
    n = Number(t)
  } else {
    return err('invalid_percentage')
  }
  if (!Number.isInteger(n) || n < 1 || n > 99) return err('invalid_percentage')
  return ok(n)
}

/**
 * Resolve the discount value (pence for fixed, whole percent for percentage)
 * from the effective discount type.
 */
export function validateDiscountValue(type: DiscountType, raw: unknown): Result<number> {
  return type === 'fixed' ? parseFixedAmountToPence(raw) : validatePercentage(raw)
}

/**
 * Resolve scope + campaign together. Enforces the DB coupling exactly:
 *  - site_wide => campaign_id is forced to null (a supplied id is rejected).
 *  - campaign  => a valid UUID campaign id is REQUIRED.
 * Campaign EXISTENCE is verified separately, server-side, against the DB.
 */
export function resolveScopeAndCampaign(
  scope: DiscountScope,
  rawCampaignId: unknown,
): Result<{ scope: DiscountScope; campaignId: string | null }> {
  const provided =
    rawCampaignId !== null && rawCampaignId !== undefined && !(typeof rawCampaignId === 'string' && rawCampaignId.trim() === '')

  if (scope === 'site_wide') {
    if (provided) return err('campaign_not_allowed_for_site_wide')
    return ok({ scope, campaignId: null })
  }

  // scope === 'campaign'
  if (!provided) return err('campaign_required')
  if (!isUuid(rawCampaignId)) return err('invalid_campaign_id')
  return ok({ scope, campaignId: (rawCampaignId as string).trim() })
}

/** Parse an optional timestamp to a canonical ISO (UTC) string, or null. */
function parseOptionalTimestamp(raw: unknown, code: AdminDiscountErrorCode): Result<string | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return ok(null)
  }
  if (typeof raw !== 'string' && !(raw instanceof Date)) return err(code)
  const d = new Date(raw as string | Date)
  const t = d.getTime()
  if (!Number.isFinite(t)) return err(code)
  return ok(d.toISOString())
}

/**
 * Validate the optional start/expiry schedule. Both are optional; when both
 * are present, expiry MUST be strictly after start.
 */
export function validateSchedule(
  rawStart: unknown,
  rawExpiry: unknown,
): Result<{ startsAt: string | null; expiresAt: string | null }> {
  const start = parseOptionalTimestamp(rawStart, 'invalid_start_time')
  if (!start.ok) return start
  const expiry = parseOptionalTimestamp(rawExpiry, 'invalid_expiry_time')
  if (!expiry.ok) return expiry

  if (start.value !== null && expiry.value !== null) {
    if (new Date(expiry.value).getTime() <= new Date(start.value).getTime()) {
      return err('expiry_not_after_start')
    }
  }
  return ok({ startsAt: start.value, expiresAt: expiry.value })
}

export function validateIsActive(raw: unknown): Result<boolean> {
  if (typeof raw !== 'boolean') return err('invalid_is_active')
  return ok(raw)
}

/** Fully-validated, DB-column-shaped payload (minus audit + campaign existence). */
export interface ValidatedDiscountInput {
  code: string
  description: string | null
  discount_type: DiscountType
  discount_value: number
  scope: DiscountScope
  campaign_id: string | null
  is_active: boolean
  starts_at: string | null
  expires_at: string | null
}

/**
 * Validate a full create/edit payload into DB column shape. Does NOT check
 * campaign existence or code uniqueness — those require the database and are
 * handled by the route after this passes.
 */
export function validateDiscountInput(body: Record<string, unknown>): Result<ValidatedDiscountInput> {
  const code = validateCode(body.code)
  if (!code.ok) return code

  const description = validateDescription(body.description)
  if (!description.ok) return description

  const discountType = validateDiscountType(body.discountType)
  if (!discountType.ok) return discountType

  const discountValue = validateDiscountValue(discountType.value, body.discountValue)
  if (!discountValue.ok) return discountValue

  const scope = validateScope(body.scope)
  if (!scope.ok) return scope

  const scopeCampaign = resolveScopeAndCampaign(scope.value, body.campaignId)
  if (!scopeCampaign.ok) return scopeCampaign

  const isActive = validateIsActive(body.isActive)
  if (!isActive.ok) return isActive

  const schedule = validateSchedule(body.startsAt, body.expiresAt)
  if (!schedule.ok) return schedule

  return ok({
    code: code.value,
    description: description.value,
    discount_type: discountType.value,
    discount_value: discountValue.value,
    scope: scopeCampaign.value.scope,
    campaign_id: scopeCampaign.value.campaignId,
    is_active: isActive.value,
    starts_at: schedule.value.startsAt,
    expires_at: schedule.value.expiresAt,
  })
}
