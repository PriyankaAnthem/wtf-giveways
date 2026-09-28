/**
 * Client-safe display helpers + types for the admin Affiliates surface.
 *
 * MUST NOT import server-only modules — imported by client components. It may
 * import the pure commission helpers from `attribution.ts` (also client-safe).
 */
import { formatCommission } from '@/lib/marketing/attribution'

/** The DTO returned by /api/admin/marketing/affiliates. */
export interface Affiliate {
  id: string
  name: string
  slug: string
  commissionBps: number | null
  notes: string | null
  isActive: boolean
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

/**
 * Display a commission rate. `null` => "—" ("no rate configured"), which is
 * deliberately distinct from `0` => "0%". Re-exported from the pure core.
 */
export const formatCommissionRate = formatCommission

/** Friendly, admin-facing copy for every stable affiliate API/validation code. */
export const AFFILIATE_ERROR_MESSAGES: Record<string, string> = {
  invalid_name: 'Enter a name between 1 and 120 characters.',
  invalid_slug: 'Enter a name that contains at least one letter or number.',
  invalid_commission: 'Enter a commission between 0 and 100 (percent), or leave it blank.',
  invalid_notes: 'Notes are too long (max 2000 characters).',
  invalid_is_active: 'Invalid status value.',
  invalid_identifier: 'Invalid affiliate reference.',
  invalid_json: 'The request could not be processed.',
  duplicate_affiliate: 'An affiliate with that name already exists.',
  not_found: 'That affiliate no longer exists.',
  load_failed: 'Could not load affiliates. Please try again.',
  save_failed: 'Something went wrong saving the affiliate. Please try again.',
  'Not authenticated': 'Your session has expired. Please sign in again.',
  'Not authorized': 'You do not have permission to perform this action.',
}

export function friendlyAffiliateError(code: string | null | undefined): string {
  if (!code) return 'Something went wrong. Please try again.'
  return AFFILIATE_ERROR_MESSAGES[code] ?? 'Something went wrong. Please try again.'
}
