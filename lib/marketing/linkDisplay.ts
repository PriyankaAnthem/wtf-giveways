/**
 * Client-safe display helpers + types for the admin Tracking Links surface.
 *
 * MUST NOT import server-only modules — imported by client components. It may
 * import the pure taxonomy from `attribution.ts` (also client-safe).
 */
import { CHANNELS, type Channel } from '@/lib/marketing/attribution'

/** The DTO returned by /api/admin/marketing/links and rendered by the table. */
export interface TrackingLink {
  id: string
  code: string
  label: string
  channel: string
  source: string
  medium: string
  campaign: string
  destinationPath: string
  content: string | null
  ref: string | null
  providerId: string | null
  isActive: boolean
  /** Attached affiliate (null for a normal link). Immutable after creation. */
  affiliateId: string | null
  affiliateName: string | null
  /** Whether the attached affiliate is still active (null = no affiliate). */
  affiliateActive: boolean | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

/** Human label for a channel value, falling back to the raw value. */
export function channelLabel(channel: string): string {
  return (CHANNELS as Record<string, { label: string }>)[channel]?.label ?? channel
}

/** Human label for a source within a channel, falling back to the raw value. */
export function sourceLabel(channel: string, source: string): string {
  const cfg = (CHANNELS as Record<string, (typeof CHANNELS)[Channel]>)[channel]
  return cfg?.sources.find((s) => s.value === source)?.label ?? source
}

/** UK-readable date-time, or an em dash when absent/invalid. */
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
 * Build the absolute short-link for display / copy. Prefers the provided origin
 * (from the browser) so it always matches the current environment.
 */
export function shortLinkUrl(code: string, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/t/${code}`
}

/** Friendly, admin-facing copy for every stable API / validation error code. */
export const ERROR_MESSAGES: Record<string, string> = {
  invalid_label: 'Enter a label between 1 and 120 characters.',
  invalid_channel: 'Choose a valid channel.',
  invalid_source: 'Choose a source that belongs to the selected channel.',
  invalid_campaign: 'Enter a campaign name (letters and numbers).',
  invalid_destination: 'Enter a valid internal destination path starting with “/”.',
  invalid_content: 'Content is too long (max 120 characters).',
  invalid_ref: 'Ref is too long (max 120 characters).',
  invalid_provider_id: 'Provider ID is too long (max 200 characters).',
  invalid_is_active: 'Invalid status value.',
  invalid_identifier: 'Invalid tracking link reference.',
  invalid_affiliate: 'Choose a valid affiliate, or leave it as None.',
  affiliate_inactive: 'That affiliate is inactive and cannot be attached to a new link.',
  invalid_json: 'The request could not be processed.',
  code_generation_failed: 'Could not generate a unique short code. Please try again.',
  not_found: 'That tracking link no longer exists.',
  load_failed: 'Could not load tracking links. Please try again.',
  save_failed: 'Something went wrong saving the tracking link. Please try again.',
  'Not authenticated': 'Your session has expired. Please sign in again.',
  'Not authorized': 'You do not have permission to perform this action.',
}

export function friendlyError(code: string | null | undefined): string {
  if (!code) return 'Something went wrong. Please try again.'
  return ERROR_MESSAGES[code] ?? 'Something went wrong. Please try again.'
}
