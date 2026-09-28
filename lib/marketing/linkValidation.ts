/**
 * Pure, server-safe validators for the admin Tracking Links surface.
 *
 * NO database / network access, so it is unit-testable in isolation. It is the
 * single source of truth for how admin-supplied tracking-link fields are
 * normalised and validated before a service-role write, and it deliberately
 * mirrors the DB CHECK constraints on `public.tracking_links` while enforcing
 * the tighter controlled taxonomy in `attribution.ts`.
 *
 * Two entry points:
 *   - validateCreateInput : full create payload -> DB column shape (minus the
 *                           short code, which the route generates, and audit
 *                           fields).
 *   - validateEditInput   : ONLY the safely-editable fields (label,
 *                           destination_path). Channel / source / medium /
 *                           campaign_slug are immutable and never accepted here.
 */
import {
  isChannel,
  isSourceAllowedForChannel,
  mediumForChannel,
  normalizeCampaignSlug,
  sanitizeDestinationPath,
  type Channel,
  type Medium,
  type Source,
} from '@/lib/marketing/attribution'

/** Stable, client-safe error codes. Mapped to friendly copy in the UI. */
export type LinkErrorCode =
  | 'invalid_label'
  | 'invalid_channel'
  | 'invalid_source'
  | 'invalid_campaign'
  | 'invalid_destination'
  | 'invalid_content'
  | 'invalid_ref'
  | 'invalid_provider_id'
  | 'invalid_is_active'
  | 'invalid_identifier'
  | 'invalid_affiliate'

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: LinkErrorCode }
export type Result<T> = Ok<T> | Err

const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: LinkErrorCode): Err => ({ ok: false, error })

const LABEL_MIN = 1
const LABEL_MAX = 120
const OPTIONAL_MAX = 120
const PROVIDER_MAX = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim())
}

export function validateLabel(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return err('invalid_label')
  const t = raw.trim()
  if (t.length < LABEL_MIN || t.length > LABEL_MAX) return err('invalid_label')
  return ok(t)
}

/** Optional bounded free-text field; blank => null. */
function validateOptional(
  raw: unknown,
  max: number,
  code: LinkErrorCode,
): Result<string | null> {
  if (raw === null || raw === undefined) return ok(null)
  if (typeof raw !== 'string') return err(code)
  const t = raw.trim()
  if (t.length === 0) return ok(null)
  if (t.length > max) return err(code)
  return ok(t)
}

export function validateContent(raw: unknown): Result<string | null> {
  return validateOptional(raw, OPTIONAL_MAX, 'invalid_content')
}

export function validateRef(raw: unknown): Result<string | null> {
  return validateOptional(raw, OPTIONAL_MAX, 'invalid_ref')
}

export function validateProviderId(raw: unknown): Result<string | null> {
  return validateOptional(raw, PROVIDER_MAX, 'invalid_provider_id')
}

export function validateDestination(raw: unknown): Result<string> {
  const path = sanitizeDestinationPath(raw)
  if (!path) return err('invalid_destination')
  return ok(path)
}

export function validateIsActive(raw: unknown): Result<boolean> {
  if (typeof raw !== 'boolean') return err('invalid_is_active')
  return ok(raw)
}

/**
 * Optional affiliate id supplied ONLY on create. Blank/absent => null (a normal
 * non-affiliate link). A non-empty value must be a UUID. This validates SHAPE
 * only; the route additionally verifies the affiliate EXISTS and is ACTIVE
 * before a new link may reference it. Affiliate is deliberately NOT part of
 * `validateEditInput`: assignment is immutable after creation (UI + API refuse
 * it, and the DB immutability trigger is the final backstop).
 */
export function validateAffiliateId(raw: unknown): Result<string | null> {
  if (raw === null || raw === undefined) return ok(null)
  if (typeof raw !== 'string') return err('invalid_affiliate')
  const t = raw.trim()
  if (t.length === 0) return ok(null)
  if (!isUuid(t)) return err('invalid_affiliate')
  return ok(t)
}

/**
 * Resolve channel + source + medium together. `channel` fixes the medium and
 * constrains the source; a source not allowed for the channel is rejected.
 */
export function resolveTaxonomy(
  rawChannel: unknown,
  rawSource: unknown,
): Result<{ channel: Channel; source: Source; medium: Medium }> {
  if (!isChannel(rawChannel)) return err('invalid_channel')
  if (!isSourceAllowedForChannel(rawChannel, rawSource)) return err('invalid_source')
  const medium = mediumForChannel(rawChannel)
  if (!medium) return err('invalid_channel')
  return ok({ channel: rawChannel, source: rawSource as Source, medium })
}

/** Fully-validated create payload in DB column shape (minus code + audit). */
export interface ValidatedLinkCreate {
  label: string
  channel: Channel
  source: Source
  medium: Medium
  campaign_slug: string
  destination_path: string
  content: string | null
  ref: string | null
  provider_id: string | null
  is_active: boolean
  /** Optional affiliate/partner; null for a normal link. Set only on create. */
  affiliate_id: string | null
}

export function validateCreateInput(body: Record<string, unknown>): Result<ValidatedLinkCreate> {
  const label = validateLabel(body.label)
  if (!label.ok) return label

  const taxonomy = resolveTaxonomy(body.channel, body.source)
  if (!taxonomy.ok) return taxonomy

  const campaign = normalizeCampaignSlug(body.campaign)
  if (!campaign) return err('invalid_campaign')

  const destination = validateDestination(body.destinationPath)
  if (!destination.ok) return destination

  const content = validateContent(body.content)
  if (!content.ok) return content

  const ref = validateRef(body.ref)
  if (!ref.ok) return ref

  const providerId = validateProviderId(body.providerId)
  if (!providerId.ok) return providerId

  const affiliateId = validateAffiliateId(body.affiliateId)
  if (!affiliateId.ok) return affiliateId

  // is_active is optional on create; defaults to true.
  let isActive = true
  if (body.isActive !== undefined) {
    const r = validateIsActive(body.isActive)
    if (!r.ok) return r
    isActive = r.value
  }

  return ok({
    label: label.value,
    channel: taxonomy.value.channel,
    source: taxonomy.value.source,
    medium: taxonomy.value.medium,
    campaign_slug: campaign,
    destination_path: destination.value,
    content: content.value,
    ref: ref.value,
    provider_id: providerId.value,
    is_active: isActive,
    affiliate_id: affiliateId.value,
  })
}

/**
 * Fully-validated EDIT payload. Only the fields that are safe to change after
 * creation. Channel / source / medium / campaign_slug are NEVER included — they
 * define the attribution meaning and are immutable (also enforced by the DB
 * trigger).
 */
export interface ValidatedLinkEdit {
  label: string
  destination_path: string
  content: string | null
  ref: string | null
  provider_id: string | null
}

export function validateEditInput(body: Record<string, unknown>): Result<ValidatedLinkEdit> {
  const label = validateLabel(body.label)
  if (!label.ok) return label

  const destination = validateDestination(body.destinationPath)
  if (!destination.ok) return destination

  const content = validateContent(body.content)
  if (!content.ok) return content

  const ref = validateRef(body.ref)
  if (!ref.ok) return ref

  const providerId = validateProviderId(body.providerId)
  if (!providerId.ok) return providerId

  return ok({
    label: label.value,
    destination_path: destination.value,
    content: content.value,
    ref: ref.value,
    provider_id: providerId.value,
  })
}
