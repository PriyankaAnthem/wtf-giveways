/**
 * WTF Marketing Hub — Stage 3B pure validators + shared config types.
 *
 * NO server-only / React / DB imports: shared by the admin API routes, the
 * client editor and the node test environment. This is the single source of
 * truth for how admin-supplied Marketing Hub config is normalised + validated
 * before a service-role write, and it mirrors the DB CHECK constraints defined
 * in scripts/marketing/005-marketing-automation-foundation.sql exactly.
 *
 * Nothing here can send email, enqueue a recipient or create a run. Validation
 * describes CONFIG only. Enabling an automation or saving a promotion never
 * implies any delivery — the global control state stays authoritative and
 * defaults fully paused.
 */
import { isUuid } from '@/lib/discounts/adminValidation'
import { findUnknownPlaceholders } from '@/lib/admin/marketing/placeholders'

// ---------------------------------------------------------------------------
// Fixed enumerations (mirror the DB CHECK constraints).
// ---------------------------------------------------------------------------

/** The six automation trigger types. The SET is fixed in code (DB CHECK). */
export const AUTOMATION_KEYS = [
  'abandoned_checkout',
  'new_account_no_purchase',
  'lapsed_14_days',
  'wtf_credit_waiting',
  'regular_buyer_campaign_alert',
  'vip_early_access',
] as const
export type AutomationKey = (typeof AUTOMATION_KEYS)[number]

/** Promotion trigger types an admin may create (DB CHECK). */
export const PROMOTION_TYPES = ['regular_buyer_campaign_alert', 'vip_early_access'] as const
export type PromotionType = (typeof PROMOTION_TYPES)[number]

/**
 * Promotion statuses an admin may SET in Stage 3B. The DB permits more
 * (processing/completed/failed) but those are reserved for future automated
 * transitions — an admin can only move between draft, scheduled and cancelled.
 */
export const ADMIN_PROMOTION_STATUSES = ['draft', 'scheduled', 'cancelled'] as const
export type AdminPromotionStatus = (typeof ADMIN_PROMOTION_STATUSES)[number]

// Numeric ceilings that mirror the DB constraints.
export const MAX_RECIPIENTS_PER_RUN_CEIL = 100000
export const MAX_BATCH_SIZE_CEIL = 100

// ---------------------------------------------------------------------------
// Result helpers (same shape as the discount validators).
// ---------------------------------------------------------------------------

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: string }
export type Result<T> = Ok<T> | Err

const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: string): Err => ({ ok: false, error })

// ---------------------------------------------------------------------------
// Small primitive parsers.
// ---------------------------------------------------------------------------

/** Optional non-negative integer: null/undefined/'' => null; else int >= 0. */
function optionalNonNegInt(raw: unknown, code: string): Result<number | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return ok(null)
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isInteger(n) || n < 0) return err(code)
  return ok(n)
}

/** Required integer within [min, max]. */
function requiredIntInRange(raw: unknown, min: number, max: number, code: string): Result<number> {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isInteger(n) || n < min || n > max) return err(code)
  return ok(n)
}

/** Required non-negative integer. */
function requiredNonNegInt(raw: unknown, code: string): Result<number> {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isInteger(n) || n < 0) return err(code)
  return ok(n)
}

function requiredBool(raw: unknown, code: string): Result<boolean> {
  if (typeof raw !== 'boolean') return err(code)
  return ok(raw)
}

/** Bounded, required, trimmed string with no angle brackets (no raw HTML/JS). */
function requiredText(raw: unknown, max: number, code: string): Result<string> {
  if (typeof raw !== 'string') return err(code)
  const t = raw.trim()
  if (t.length === 0 || t.length > max) return err(code)
  if (/[<>]/.test(t)) return err(code)
  return ok(t)
}

/** Optional bounded trimmed string; blank => null; no angle brackets. */
function optionalText(raw: unknown, max: number, code: string): Result<string | null> {
  if (raw === null || raw === undefined) return ok(null)
  if (typeof raw !== 'string') return err(code)
  const t = raw.trim()
  if (t.length === 0) return ok(null)
  if (t.length > max) return err(code)
  if (/[<>]/.test(t)) return err(code)
  return ok(t)
}

/** Optional uuid; null/blank => null. */
function optionalUuid(raw: unknown, code: string): Result<string | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return ok(null)
  }
  if (!isUuid(raw)) return err(code)
  return ok((raw as string).trim())
}

/** Optional ISO timestamp; null/blank => null. */
function optionalTimestamp(raw: unknown, code: string): Result<string | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return ok(null)
  }
  if (typeof raw !== 'string' && !(raw instanceof Date)) return err(code)
  const d = new Date(raw as string | Date)
  if (!Number.isFinite(d.getTime())) return err(code)
  return ok(d.toISOString())
}

/** Optional http(s) URL; null/blank => null; bounded. */
function optionalUrl(raw: unknown, max: number, code: string): Result<string | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return ok(null)
  }
  if (typeof raw !== 'string') return err(code)
  const t = raw.trim()
  if (t.length > max || /[<>]/.test(t)) return err(code)
  let url: URL
  try {
    url = new URL(t)
  } catch {
    return err(code)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return err(code)
  return ok(t)
}

// ---------------------------------------------------------------------------
// Automation update (PATCH one automation, identified by automation_key).
// ---------------------------------------------------------------------------

export interface ValidatedAutomationUpdate {
  automation_key: AutomationKey
  enabled: boolean
  template_id: string | null
  first_delay_minutes: number | null
  follow_up_delay_minutes: number | null
  cooldown_hours: number | null
  minimum_wallet_pence: number | null
  discount_code_id: string | null
  maximum_recipients_per_run: number
}

export function validateAutomationKey(raw: unknown): raw is AutomationKey {
  return typeof raw === 'string' && (AUTOMATION_KEYS as readonly string[]).includes(raw)
}

/**
 * Validate an automation config update. Enforces DB ranges AND the Stage 3B
 * safety rule: an automation may NOT be enabled without a template assigned
 * (template EXISTENCE is verified server-side afterwards).
 */
export function validateAutomationUpdate(body: Record<string, unknown>): Result<ValidatedAutomationUpdate> {
  if (!validateAutomationKey(body.automationKey)) return err('invalid_automation_key')

  const enabled = requiredBool(body.enabled, 'invalid_enabled')
  if (!enabled.ok) return enabled

  const templateId = optionalUuid(body.templateId, 'invalid_template_id')
  if (!templateId.ok) return templateId

  const firstDelay = optionalNonNegInt(body.firstDelayMinutes, 'invalid_first_delay')
  if (!firstDelay.ok) return firstDelay

  const followUp = optionalNonNegInt(body.followUpDelayMinutes, 'invalid_follow_up_delay')
  if (!followUp.ok) return followUp

  const cooldown = optionalNonNegInt(body.cooldownHours, 'invalid_cooldown')
  if (!cooldown.ok) return cooldown

  const minWallet = optionalNonNegInt(body.minimumWalletPence, 'invalid_minimum_wallet')
  if (!minWallet.ok) return minWallet

  const discountCodeId = optionalUuid(body.discountCodeId, 'invalid_discount_code_id')
  if (!discountCodeId.ok) return discountCodeId

  const maxRecipients = requiredIntInRange(
    body.maximumRecipientsPerRun,
    1,
    MAX_RECIPIENTS_PER_RUN_CEIL,
    'invalid_maximum_recipients',
  )
  if (!maxRecipients.ok) return maxRecipients

  // Stage 3B safety rule: cannot enable without a template assigned.
  if (enabled.value && templateId.value === null) {
    return err('template_required_to_enable')
  }

  return ok({
    automation_key: body.automationKey as AutomationKey,
    enabled: enabled.value,
    template_id: templateId.value,
    first_delay_minutes: firstDelay.value,
    follow_up_delay_minutes: followUp.value,
    cooldown_hours: cooldown.value,
    minimum_wallet_pence: minWallet.value,
    discount_code_id: discountCodeId.value,
    maximum_recipients_per_run: maxRecipients.value,
  })
}

// ---------------------------------------------------------------------------
// Template create / update.
// ---------------------------------------------------------------------------

export interface ValidatedTemplateInput {
  template_key: string
  name: string
  subject: string
  preview_text: string | null
  heading: string
  body_text: string
  cta_label: string
  default_url: string | null
  discount_code_id: string | null
  is_active: boolean
}

/**
 * Per-field maximum lengths, mirroring the DB CHECK constraints. Exposed so the
 * client editor can apply the same maxLength caps it will be validated against.
 */
export const TEMPLATE_LIMITS = {
  name: 200,
  templateKey: 100,
  subject: 300,
  previewText: 300,
  heading: 300,
  bodyText: 5000,
  ctaLabel: 100,
  defaultUrl: 2048,
} as const

/**
 * Convenience wrapper for the client editor: given the camelCase draft fields,
 * return the sorted list of placeholder tokens that are NOT allowed across any
 * rendered slot. Reuses the same pure engine the server validator uses, so the
 * editor's live warning and the server's rejection can never diverge.
 */
export function findUnknownPlaceholdersForForm(fields: {
  subject?: string | null
  previewText?: string | null
  heading?: string | null
  bodyText?: string | null
  ctaLabel?: string | null
  defaultUrl?: string | null
}): string[] {
  return findUnknownPlaceholders([
    fields.subject,
    fields.previewText,
    fields.heading,
    fields.bodyText,
    fields.ctaLabel,
    fields.defaultUrl,
  ])
}

const TEMPLATE_KEY_RE = /^[a-z][a-z0-9_]*$/

export function validateTemplateKey(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return err('invalid_template_key')
  const t = raw.trim().toLowerCase()
  if (t.length === 0 || t.length > 100 || !TEMPLATE_KEY_RE.test(t)) return err('invalid_template_key')
  return ok(t)
}

/**
 * Validate a full template payload. Rejects raw HTML/JS (angle brackets) in
 * every content field and rejects ANY placeholder outside the controlled
 * allowlist across all rendered slots. discount code EXISTENCE + active-state
 * is verified server-side afterwards.
 */
export function validateTemplateInput(body: Record<string, unknown>): Result<ValidatedTemplateInput> {
  const key = validateTemplateKey(body.templateKey)
  if (!key.ok) return key

  const name = requiredText(body.name, 200, 'invalid_name')
  if (!name.ok) return name

  const subject = requiredText(body.subject, 300, 'invalid_subject')
  if (!subject.ok) return subject

  const preview = optionalText(body.previewText, 300, 'invalid_preview_text')
  if (!preview.ok) return preview

  const heading = requiredText(body.heading, 300, 'invalid_heading')
  if (!heading.ok) return heading

  const bodyText = requiredText(body.bodyText, 5000, 'invalid_body_text')
  if (!bodyText.ok) return bodyText

  const cta = requiredText(body.ctaLabel, 100, 'invalid_cta_label')
  if (!cta.ok) return cta

  const url = optionalUrl(body.defaultUrl, 2048, 'invalid_default_url')
  if (!url.ok) return url

  const discountCodeId = optionalUuid(body.discountCodeId, 'invalid_discount_code_id')
  if (!discountCodeId.ok) return discountCodeId

  const isActive = requiredBool(body.isActive, 'invalid_is_active')
  if (!isActive.ok) return isActive

  // Reject any placeholder outside the controlled allowlist across every slot
  // that gets rendered into the email.
  const unknown = findUnknownPlaceholders([
    subject.value,
    preview.value,
    heading.value,
    bodyText.value,
    cta.value,
    url.value,
  ])
  if (unknown.length > 0) return err('unknown_placeholder')

  return ok({
    template_key: key.value,
    name: name.value,
    subject: subject.value,
    preview_text: preview.value,
    heading: heading.value,
    body_text: bodyText.value,
    cta_label: cta.value,
    default_url: url.value,
    discount_code_id: discountCodeId.value,
    is_active: isActive.value,
  })
}

/** Content fields whose change forces a template version bump. */
export const TEMPLATE_CONTENT_FIELDS = [
  'subject',
  'preview_text',
  'heading',
  'body_text',
  'cta_label',
  'default_url',
  'discount_code_id',
] as const

/**
 * Decide whether a template edit changed rendered content (=> version bump).
 * Metadata-only edits (name, is_active) do NOT bump the version.
 */
export function templateContentChanged(
  existing: Record<string, unknown>,
  next: ValidatedTemplateInput,
): boolean {
  return TEMPLATE_CONTENT_FIELDS.some((f) => {
    const before = existing[f] ?? null
    const after = (next as unknown as Record<string, unknown>)[f] ?? null
    return before !== after
  })
}

// ---------------------------------------------------------------------------
// Promotion create / update.
// ---------------------------------------------------------------------------

export interface ValidatedPromotionCreate {
  campaign_id: string
  promotion_type: PromotionType
  template_id: string | null
  scheduled_at: string | null
  rollout_limit: number
  status: AdminPromotionStatus
}

export interface ValidatedPromotionUpdate {
  status: AdminPromotionStatus
  template_id: string | null
  scheduled_at: string | null
  rollout_limit: number
}

function validatePromotionType(raw: unknown): Result<PromotionType> {
  if (typeof raw === 'string' && (PROMOTION_TYPES as readonly string[]).includes(raw)) {
    return ok(raw as PromotionType)
  }
  return err('invalid_promotion_type')
}

function validateAdminStatus(raw: unknown): Result<AdminPromotionStatus> {
  if (typeof raw === 'string' && (ADMIN_PROMOTION_STATUSES as readonly string[]).includes(raw)) {
    return ok(raw as AdminPromotionStatus)
  }
  return err('invalid_status')
}

/** A `scheduled` promotion must carry a schedule time. */
function coherentSchedule(status: AdminPromotionStatus, scheduledAt: string | null): boolean {
  return status !== 'scheduled' || scheduledAt !== null
}

export function validatePromotionCreate(body: Record<string, unknown>): Result<ValidatedPromotionCreate> {
  if (!isUuid(body.campaignId)) return err('invalid_campaign_id')

  const type = validatePromotionType(body.promotionType)
  if (!type.ok) return type

  const templateId = optionalUuid(body.templateId, 'invalid_template_id')
  if (!templateId.ok) return templateId

  const scheduledAt = optionalTimestamp(body.scheduledAt, 'invalid_scheduled_at')
  if (!scheduledAt.ok) return scheduledAt

  const rollout = requiredNonNegInt(body.rolloutLimit, 'invalid_rollout_limit')
  if (!rollout.ok) return rollout

  // On create, only draft or scheduled are meaningful; default to draft.
  const rawStatus = body.status === undefined ? 'draft' : body.status
  const status = validateAdminStatus(rawStatus)
  if (!status.ok) return status
  if (status.value === 'cancelled') return err('invalid_status')
  if (!coherentSchedule(status.value, scheduledAt.value)) return err('schedule_time_required')

  return ok({
    campaign_id: (body.campaignId as string).trim(),
    promotion_type: type.value,
    template_id: templateId.value,
    scheduled_at: scheduledAt.value,
    rollout_limit: rollout.value,
    status: status.value,
  })
}

export function validatePromotionUpdate(body: Record<string, unknown>): Result<ValidatedPromotionUpdate> {
  const status = validateAdminStatus(body.status)
  if (!status.ok) return status

  const templateId = optionalUuid(body.templateId, 'invalid_template_id')
  if (!templateId.ok) return templateId

  const scheduledAt = optionalTimestamp(body.scheduledAt, 'invalid_scheduled_at')
  if (!scheduledAt.ok) return scheduledAt

  const rollout = requiredNonNegInt(body.rolloutLimit, 'invalid_rollout_limit')
  if (!rollout.ok) return rollout

  if (!coherentSchedule(status.value, scheduledAt.value)) return err('schedule_time_required')

  return ok({
    status: status.value,
    template_id: templateId.value,
    scheduled_at: scheduledAt.value,
    rollout_limit: rollout.value,
  })
}

// ---------------------------------------------------------------------------
// Control state update.
// ---------------------------------------------------------------------------

export interface ValidatedControlUpdate {
  sending_enabled: boolean
  discovery_enabled: boolean
  rollout_limit: number
  maximum_batch_size: number
  maximum_daily_per_contact: number
  maximum_weekly_per_contact: number
}

export function validateControlUpdate(body: Record<string, unknown>): Result<ValidatedControlUpdate> {
  const sending = requiredBool(body.sendingEnabled, 'invalid_sending_enabled')
  if (!sending.ok) return sending

  const discovery = requiredBool(body.discoveryEnabled, 'invalid_discovery_enabled')
  if (!discovery.ok) return discovery

  const rollout = requiredNonNegInt(body.rolloutLimit, 'invalid_rollout_limit')
  if (!rollout.ok) return rollout

  const batch = requiredIntInRange(body.maximumBatchSize, 1, MAX_BATCH_SIZE_CEIL, 'invalid_batch_size')
  if (!batch.ok) return batch

  const daily = requiredNonNegInt(body.maximumDailyPerContact, 'invalid_daily_limit')
  if (!daily.ok) return daily

  const weekly = requiredNonNegInt(body.maximumWeeklyPerContact, 'invalid_weekly_limit')
  if (!weekly.ok) return weekly

  // Mirror the DB CHECK: a weekly cap can never be stricter than the daily cap.
  if (weekly.value < daily.value) return err('weekly_below_daily')

  return ok({
    sending_enabled: sending.value,
    discovery_enabled: discovery.value,
    rollout_limit: rollout.value,
    maximum_batch_size: batch.value,
    maximum_daily_per_contact: daily.value,
    maximum_weekly_per_contact: weekly.value,
  })
}
