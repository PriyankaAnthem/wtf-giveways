import 'server-only'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { MARKETING_CONSENT_VERSION } from './consent'

/**
 * Server-only marketing preference/suppression service.
 *
 * All writes and reads to the marketing_* tables go through the service-role
 * client and the SECURITY DEFINER database functions from
 * scripts/marketing/001-marketing-consent-foundation.sql. Those tables have RLS
 * forced with no policies, so the browser can never touch them directly.
 *
 * Callers are responsible for authenticating the user (or validating the signed
 * unsubscribe token) BEFORE calling anything here. This module never trusts a
 * browser-supplied user id or email.
 */

/** Fresh service-role client per call (matches the existing repo pattern). */
export function getMarketingServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('missing_supabase_service_config')
  }
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

/** Trim + lowercase, matching the database's email_lc constraint. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface MarketingPreferenceState {
  /** Marketing is enabled AND the account is not actively suppressed. */
  enabled: boolean
  /** The customer may turn marketing on (no blocking non-unsubscribe suppression). */
  canEnable: boolean
}

/**
 * Read the customer's current marketing state for the account UI.
 * Returns ONLY two booleans — never any suppression reason or provider detail.
 *
 * Both booleans come from SECURITY DEFINER functions that own the suppression
 * semantics (verified present in the live database):
 *   - is_marketing_email_eligible -> enabled AND no active suppression at all
 *   - marketing_can_reenable      -> no active NON-unsubscribe suppression
 * Keeping this logic in the database avoids a second source of truth for what
 * blocks re-enabling. Fails closed (enabled:false, canEnable:false) on error.
 */
export async function getMarketingPreferenceState(
  userId: string,
  emailLc: string,
): Promise<MarketingPreferenceState> {
  const supabase = getMarketingServiceClient()
  const email = normalizeEmail(emailLc)

  const [{ data: enabled, error: enabledErr }, { data: canEnable, error: canEnableErr }] =
    await Promise.all([
      supabase.rpc('is_marketing_email_eligible', { p_user_id: userId, p_email_lc: email }),
      supabase.rpc('marketing_can_reenable', { p_user_id: userId, p_email_lc: email }),
    ])

  if (enabledErr || canEnableErr) {
    console.error(
      '[marketing] preference state read failed:',
      enabledErr?.message ?? canEnableErr?.message,
    )
    return { enabled: false, canEnable: false }
  }

  return { enabled: enabled === true, canEnable: canEnable === true }
}

/**
 * Set the marketing preference for an already-authenticated user.
 * Uses the atomic, idempotent set_marketing_email_preference function.
 * `consentVersion` is only required (and only used) when enabling.
 */
export async function setMarketingEmailPreference(args: {
  userId: string
  emailLc: string
  enabled: boolean
  source: string
  consentVersion?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getMarketingServiceClient()
  const { error } = await supabase.rpc('set_marketing_email_preference', {
    p_user_id: args.userId,
    p_email_lc: normalizeEmail(args.emailLc),
    p_enabled: args.enabled,
    p_source: args.source,
    p_consent_version: args.enabled
      ? (args.consentVersion ?? MARKETING_CONSENT_VERSION)
      : null,
  })
  if (error) {
    // Log a safe, generic message — never the full email address.
    console.error('[marketing] set preference failed:', error.message)
    return { ok: false, error: 'marketing_preference_write_failed' }
  }
  return { ok: true }
}

/**
 * Disable marketing via the signed unsubscribe flow. Idempotent — repeated
 * calls keep the same end state and still resolve successfully.
 */
export async function unsubscribeMarketingEmail(args: {
  userId: string
  emailLc: string
  source: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getMarketingServiceClient()
  const { error } = await supabase.rpc('unsubscribe_marketing_email', {
    p_user_id: args.userId,
    p_email_lc: normalizeEmail(args.emailLc),
    p_source: args.source,
  })
  if (error) {
    console.error('[marketing] unsubscribe failed:', error.message)
    return { ok: false, error: 'marketing_unsubscribe_failed' }
  }
  return { ok: true }
}
