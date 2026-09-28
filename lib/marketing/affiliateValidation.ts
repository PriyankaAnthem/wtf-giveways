/**
 * Pure, server-safe validators for the admin Affiliates surface.
 *
 * NO database / network access, so it is unit-testable in isolation. Mirrors
 * the `linkValidation.ts` conventions (Result<T>, stable client-safe error
 * codes, trim + bound + normalise). It is the single source of truth for how
 * admin-supplied affiliate fields are normalised before a service-role write.
 *
 * Commission is stored in BASIS POINTS (10% => 1000). Staff type a percentage
 * ("10"); this converts to bps. `null` bps means "no rate configured" and is
 * deliberately distinct from `0` (an explicit 0% rate).
 *
 * Slugs are auto-generated from the name (staff never type them). A slug is
 * only required to be derivable on CREATE; edits keep the original slug stable.
 */
import {
  normalizeCampaignSlug,
  percentToCommissionBps,
  clampCommissionBps,
} from '@/lib/marketing/attribution'

/** Stable, client-safe error codes. Mapped to friendly copy in the UI. */
export type AffiliateErrorCode =
  | 'invalid_name'
  | 'invalid_slug'
  | 'invalid_commission'
  | 'invalid_notes'
  | 'invalid_is_active'
  | 'invalid_identifier'

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: AffiliateErrorCode }
export type Result<T> = Ok<T> | Err

const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: AffiliateErrorCode): Err => ({ ok: false, error })

const NAME_MIN = 1
const NAME_MAX = 120
const NOTES_MAX = 2000
const SLUG_MAX = 80

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim())
}

export function validateAffiliateName(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return err('invalid_name')
  const t = raw.trim()
  if (t.length < NAME_MIN || t.length > NAME_MAX) return err('invalid_name')
  return ok(t)
}

/** Optional notes; blank => null; bounded. */
export function validateAffiliateNotes(raw: unknown): Result<string | null> {
  if (raw === null || raw === undefined) return ok(null)
  if (typeof raw !== 'string') return err('invalid_notes')
  const t = raw.trim()
  if (t.length === 0) return ok(null)
  if (t.length > NOTES_MAX) return err('invalid_notes')
  return ok(t)
}

/**
 * Validate a staff-entered commission. Accepts:
 *   - null / undefined / '' -> null ("no rate configured")
 *   - a number or numeric string in [0, 100] percent -> basis points
 * `0` is valid and preserved as `0` (0%), never coerced to null. Out-of-range
 * or non-numeric -> invalid_commission. Up to 2 decimal places of percent.
 */
export function validateCommission(raw: unknown): Result<number | null> {
  if (raw === null || raw === undefined) return ok(null)
  if (typeof raw === 'string' && raw.trim().length === 0) return ok(null)
  if (typeof raw !== 'number' && typeof raw !== 'string') return err('invalid_commission')
  // Reject non-numeric strings up-front so we can distinguish "" (null) from junk.
  if (typeof raw === 'string' && !Number.isFinite(Number(raw.trim()))) {
    return err('invalid_commission')
  }
  const bps = percentToCommissionBps(raw)
  if (bps === null) return err('invalid_commission')
  return ok(bps)
}

/**
 * Derive the stable URL-safe slug from the affiliate name using the same rules
 * as campaign slugs (lowercase, hyphen-separated alphanumerics, <= 80).
 * Returns null when the name has no usable alphanumerics.
 */
export function generateAffiliateSlug(name: string): string | null {
  const slug = normalizeCampaignSlug(name)
  if (!slug) return null
  return slug.slice(0, SLUG_MAX).replace(/-+$/g, '')
}

export function validateIsActive(raw: unknown): Result<boolean> {
  if (typeof raw !== 'boolean') return err('invalid_is_active')
  return ok(raw)
}

/** Fully-validated CREATE payload in DB column shape (minus audit fields). */
export interface ValidatedAffiliateCreate {
  name: string
  slug: string
  commission_bps: number | null
  notes: string | null
  is_active: boolean
}

export function validateAffiliateCreateInput(
  body: Record<string, unknown>,
): Result<ValidatedAffiliateCreate> {
  const name = validateAffiliateName(body.name)
  if (!name.ok) return name

  // Slug is auto-generated from the name — staff never type it.
  const slug = generateAffiliateSlug(name.value)
  if (!slug) return err('invalid_slug')

  const commission = validateCommission(body.commission)
  if (!commission.ok) return commission

  const notes = validateAffiliateNotes(body.notes)
  if (!notes.ok) return notes

  let isActive = true
  if (body.isActive !== undefined) {
    const r = validateIsActive(body.isActive)
    if (!r.ok) return r
    isActive = r.value
  }

  return ok({
    name: name.value,
    slug,
    commission_bps: commission.value,
    notes: notes.value,
    is_active: isActive,
  })
}

/**
 * Fully-validated EDIT payload. Name, commission and notes are editable; the
 * slug is intentionally NOT regenerated on edit so an affiliate's stable
 * identity never changes underneath existing references. Activate/deactivate is
 * handled separately (PATCH).
 */
export interface ValidatedAffiliateEdit {
  name: string
  commission_bps: number | null
  notes: string | null
}

export function validateAffiliateEditInput(
  body: Record<string, unknown>,
): Result<ValidatedAffiliateEdit> {
  const name = validateAffiliateName(body.name)
  if (!name.ok) return name

  const commission = validateCommission(body.commission)
  if (!commission.ok) return commission

  const notes = validateAffiliateNotes(body.notes)
  if (!notes.ok) return notes

  return ok({
    name: name.value,
    commission_bps: commission.value,
    notes: notes.value,
  })
}

// Re-exported so callers/tests have one import site for the bps clamp.
export { clampCommissionBps }
