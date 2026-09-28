/**
 * Stage 034 — Marketing Operations Console pure validators + helpers.
 *
 * NO server-only / React / DB imports: shared by the admin ops API routes, the
 * client console and the node test environment. This is the single source of
 * truth for the narrow, constrained mutations the operations console may
 * request. Nothing here can send email, enqueue a recipient, create a run or
 * invoke the worker — it only describes and validates CONFIG transitions.
 *
 * Enabling sending/discovery, raising the rollout limit, or enabling an
 * automation/definition here only flips authoritative flags. Delivery still
 * depends on the whole gate chain (control state + worker kill switch + claim
 * RPC), which this module never touches.
 */

// ---------------------------------------------------------------------------
// Shared result helpers.
// ---------------------------------------------------------------------------

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: string }
export type Result<T> = Ok<T> | Err

const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: string): Err => ({ ok: false, error })

// ---------------------------------------------------------------------------
// Automation keys / definition key rules (mirror the DB CHECK constraints).
// ---------------------------------------------------------------------------

/** The six automation trigger keys (DB CHECK on marketing_automations). */
export const AUTOMATION_KEYS = [
  'abandoned_checkout',
  'new_account_no_purchase',
  'lapsed_14_days',
  'wtf_credit_waiting',
  'regular_buyer_campaign_alert',
  'vip_early_access',
] as const
export type AutomationKey = (typeof AUTOMATION_KEYS)[number]

/** opportunity_key token rule from marketing_opportunity_definitions CHECK. */
const OPPORTUNITY_KEY_RE = /^[a-z0-9_]+$/

// ---------------------------------------------------------------------------
// Rollout limit — a fixed, constrained option set (never free-text).
// ---------------------------------------------------------------------------

/** The only rollout values an operator may pick. 0 means no delivery claims. */
export const ALLOWED_ROLLOUT_LIMITS = [0, 1, 5, 10, 25, 50, 100] as const
export type AllowedRolloutLimit = (typeof ALLOWED_ROLLOUT_LIMITS)[number]

/** Increasing rollout above this requires an extra confirmation in the UI. */
export const ROLLOUT_EXTRA_CONFIRM_ABOVE = 10

export function isAllowedRolloutLimit(raw: unknown): raw is AllowedRolloutLimit {
  return (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    (ALLOWED_ROLLOUT_LIMITS as readonly number[]).includes(raw)
  )
}

// ---------------------------------------------------------------------------
// Control transitions (sending / discovery / rollout) — discriminated + narrow.
// ---------------------------------------------------------------------------

export type ControlTarget = 'sending' | 'discovery' | 'rollout'

export type ValidatedControlAction =
  | { target: 'sending'; enabled: boolean }
  | { target: 'discovery'; enabled: boolean }
  | { target: 'rollout'; rolloutLimit: AllowedRolloutLimit }

/**
 * Validate a single, narrow control-state transition. Only ever describes one
 * of the three operational fields (sending_enabled, discovery_enabled,
 * rollout_limit); it can never address an arbitrary column. The heavy arming
 * safety (queued/automation/definition/batch re-reads) happens server-side
 * AFTER this shape check.
 */
export function validateControlAction(body: Record<string, unknown>): Result<ValidatedControlAction> {
  const target = body.target
  if (target === 'sending' || target === 'discovery') {
    if (typeof body.enabled !== 'boolean') return err('invalid_enabled')
    return ok({ target, enabled: body.enabled })
  }
  if (target === 'rollout') {
    if (!isAllowedRolloutLimit(body.rolloutLimit)) return err('invalid_rollout_limit')
    return ok({ target: 'rollout', rolloutLimit: body.rolloutLimit })
  }
  return err('invalid_target')
}

// ---------------------------------------------------------------------------
// Arming preconditions (evaluated against freshly re-read authoritative state).
// ---------------------------------------------------------------------------

export interface ArmingState {
  rolloutLimit: number
  enabledAutomationCount: number
  enabledDefinitionCount: number
}

/**
 * Decide whether sending may be turned ON given freshly-read state. Fails
 * closed: sending cannot be armed with rollout 0, zero enabled automations, or
 * zero enabled definitions. Returns the FIRST blocking reason, or ok.
 */
export function canEnableSending(state: ArmingState): Result<true> {
  if (!(state.rolloutLimit > 0)) return err('sending_requires_rollout')
  if (!(state.enabledAutomationCount > 0)) return err('sending_requires_automation')
  if (!(state.enabledDefinitionCount > 0)) return err('sending_requires_definition')
  return ok(true)
}

/**
 * Validate a rollout value against the authoritative maximum batch size.
 * rollout_limit may never exceed marketing_control_state.maximum_batch_size.
 */
export function validateRolloutAgainstBatch(
  rolloutLimit: AllowedRolloutLimit,
  maximumBatchSize: number,
): Result<AllowedRolloutLimit> {
  if (rolloutLimit > maximumBatchSize) return err('rollout_exceeds_batch')
  return ok(rolloutLimit)
}

// ---------------------------------------------------------------------------
// Automation / definition toggles — narrow to a single row.
// ---------------------------------------------------------------------------

export interface ValidatedAutomationToggle {
  automationKey: AutomationKey
  enabled: boolean
}

export function validateAutomationToggle(body: Record<string, unknown>): Result<ValidatedAutomationToggle> {
  if (
    typeof body.automationKey !== 'string' ||
    !(AUTOMATION_KEYS as readonly string[]).includes(body.automationKey)
  ) {
    return err('invalid_automation_key')
  }
  if (typeof body.enabled !== 'boolean') return err('invalid_enabled')
  return ok({ automationKey: body.automationKey as AutomationKey, enabled: body.enabled })
}

export interface ValidatedDefinitionToggle {
  opportunityKey: string
  enabled: boolean
}

export function validateDefinitionToggle(body: Record<string, unknown>): Result<ValidatedDefinitionToggle> {
  if (typeof body.opportunityKey !== 'string') return err('invalid_opportunity_key')
  const key = body.opportunityKey.trim()
  if (key.length === 0 || key.length > 100 || !OPPORTUNITY_KEY_RE.test(key)) {
    return err('invalid_opportunity_key')
  }
  if (typeof body.enabled !== 'boolean') return err('invalid_enabled')
  return ok({ opportunityKey: key, enabled: body.enabled })
}

// ---------------------------------------------------------------------------
// Email masking — never expose a full customer address in the ops console.
// ---------------------------------------------------------------------------

/**
 * Mask an email address for display: keep up to the first 2 characters of the
 * local part, mask the remainder, and keep the domain. Never throws.
 *
 *   "joanne@example.com" -> "jo***@example.com"
 *   "a@example.com"      -> "a***@example.com"
 *   "  "                 -> "***"
 */
export function maskEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '***'
  const email = raw.trim()
  if (email.length === 0) return '***'
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (domain.length === 0) return '***'
  const keep = local.slice(0, Math.min(2, local.length))
  return `${keep}***@${domain}`
}
