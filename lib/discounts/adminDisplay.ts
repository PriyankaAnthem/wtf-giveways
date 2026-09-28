/**
 * Client-safe display helpers + types for the admin Discount Codes surface.
 *
 * MUST NOT import server-only modules — this is imported by client components.
 */

export interface DiscountCode {
  id: string
  code: string
  description: string | null
  discountType: 'fixed' | 'percentage'
  discountValue: number
  scope: 'site_wide' | 'campaign'
  campaignId: string | null
  campaignTitle: string | null
  campaignSlug: string | null
  isActive: boolean
  startsAt: string | null
  expiresAt: string | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
  /**
   * Lifetime performance metrics, computed server-side by the authoritative
   * `get_discount_code_performance()` RPC and merged into the DTO. A code with
   * no confirmed usage is absent from the RPC result and defaults to 0.
   * These are read-only display values — never recalculated on the client.
   */
  uses: number
  netRevenuePence: number
}

/**
 * Derived presentation status. Derived from `is_active` + schedule against the
 * current time. This NEVER replaces the stored `is_active` value — it is a
 * display concern only.
 *
 *  - disabled  : is_active === false (always wins).
 *  - expired   : active but expires_at <= now.
 *  - scheduled : active but starts_at > now.
 *  - active    : active and within its window.
 */
export type DerivedStatus = 'active' | 'disabled' | 'scheduled' | 'expired'

export function deriveStatus(code: DiscountCode, now: number = Date.now()): DerivedStatus {
  if (!code.isActive) return 'disabled'
  if (code.expiresAt) {
    const exp = new Date(code.expiresAt).getTime()
    if (Number.isFinite(exp) && exp <= now) return 'expired'
  }
  if (code.startsAt) {
    const start = new Date(code.startsAt).getTime()
    if (Number.isFinite(start) && start > now) return 'scheduled'
  }
  return 'active'
}

export const STATUS_LABELS: Record<DerivedStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  scheduled: 'Scheduled',
  expired: 'Expired',
}

export function statusBadgeVariant(
  status: DerivedStatus,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'active':
      return 'default'
    case 'scheduled':
      return 'outline'
    case 'disabled':
      return 'secondary'
    case 'expired':
      return 'destructive'
  }
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

/** Format an integer pence amount as GBP, e.g. 250106 -> "£2,501.06". */
export function formatGbpFromPence(pence: number): string {
  const n = Number.isFinite(pence) ? pence : 0
  return GBP.format(n / 100)
}

/** e.g. "£5.00 off" for fixed, "10% off" for percentage. */
export function formatDiscount(code: Pick<DiscountCode, 'discountType' | 'discountValue'>): string {
  if (code.discountType === 'fixed') {
    return `£${(code.discountValue / 100).toFixed(2)} off`
  }
  return `${code.discountValue}% off`
}

/** e.g. "Site-wide" or the campaign title. */
export function formatScope(code: Pick<DiscountCode, 'scope' | 'campaignTitle'>): string {
  if (code.scope === 'site_wide') return 'Site-wide'
  return code.campaignTitle ?? 'Campaign'
}

/** UK-readable date-time, or an em dash when absent. */
export function formatUkDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Convert a stored ISO/UTC timestamp into the `value` a
 * <input type="datetime-local"> expects, expressed in the browser's local
 * (UK) time. Returns '' when null/invalid.
 */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** Convert a datetime-local value (local time) to an ISO/UTC string, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Friendly, admin-facing copy for every stable API error code. */
export const ERROR_MESSAGES: Record<string, string> = {
  discount_code_invalid_format:
    'Code must be 3–40 characters using only letters, numbers, hyphens and underscores.',
  invalid_description: 'Description is too long (max 500 characters).',
  invalid_discount_type: 'Choose a valid discount type.',
  invalid_fixed_amount: 'Enter a valid amount greater than £0.00 with up to two decimal places.',
  invalid_percentage: 'Enter a whole percentage between 1 and 99.',
  invalid_scope: 'Choose a valid scope.',
  invalid_campaign_id: 'The selected competition is invalid.',
  campaign_required: 'Select a competition for a campaign-scoped code.',
  campaign_not_allowed_for_site_wide: 'A site-wide code cannot target a competition.',
  campaign_not_found: 'The selected competition could not be found.',
  invalid_start_time: 'Enter a valid start date and time.',
  invalid_expiry_time: 'Enter a valid expiry date and time.',
  expiry_not_after_start: 'Expiry must be later than the start time.',
  invalid_is_active: 'Invalid status value.',
  invalid_identifier: 'Invalid discount code reference.',
  discount_code_already_exists: 'A discount code with this code already exists.',
  not_found: 'That discount code no longer exists.',
  invalid_json: 'The request could not be processed.',
  load_failed: 'Could not load discount codes. Please try again.',
  metrics_failed: 'Could not load discount code performance. Please try again.',
  save_failed: 'Something went wrong saving the discount code. Please try again.',
  'Not authenticated': 'Your session has expired. Please sign in again.',
  'Not authorized': 'You do not have permission to perform this action.',
}

export function friendlyError(code: string | null | undefined): string {
  if (!code) return 'Something went wrong. Please try again.'
  return ERROR_MESSAGES[code] ?? 'Something went wrong. Please try again.'
}
