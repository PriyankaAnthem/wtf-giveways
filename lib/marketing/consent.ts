/**
 * Single source of truth for the marketing-email consent wording + version.
 *
 * The version stored in the database (marketing_preferences.consent_version and
 * marketing_preference_events.consent_version) MUST always correspond to the
 * exact wording shown to the customer at the moment they consented. To keep that
 * guarantee, both the label and the version live here and nowhere else — do not
 * duplicate the literal string in signup, account settings, or anywhere else.
 *
 * When the wording changes, bump the version too (e.g. -v2-YYYY-MM) so historic
 * consent records remain attributable to the wording that was actually shown.
 *
 * This module holds constants only (no secrets, no server-only APIs) so it can
 * be imported by both server code and client components (e.g. the signup form).
 */
export const MARKETING_CONSENT_VERSION = 'wtf-marketing-email-v1-2026-08'

export const MARKETING_CONSENT_LABEL =
  'Email me about new competitions, instant wins and WTF Giveaways offers. I can unsubscribe at any time.'

/** Where a consent/preference change originated. Kept in one place so the
 *  values written to the audit log stay consistent across the app. */
export const MARKETING_CONSENT_SOURCE = {
  signup: 'signup',
  accountSettings: 'account_settings',
  unsubscribeLink: 'unsubscribe_link',
} as const

export type MarketingConsentSource =
  (typeof MARKETING_CONSENT_SOURCE)[keyof typeof MARKETING_CONSENT_SOURCE]
