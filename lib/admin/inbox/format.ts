/**
 * Client-safe presentation helpers for the Admin → Inbox.
 *
 * Pure functions only — no server imports, no data fetching. Shared by both the
 * list and conversation UIs so labels/tones never drift.
 */
import {
  type EnquiryType,
  type InboxStatus,
  type EmailStatus,
  REPLY_MIN_LEN,
  REPLY_MAX_LEN,
} from './types'

/** Human labels for enquiry types. Unknown values fall back to a title-cased
 *  version of the raw value so nothing renders as a blank. */
const ENQUIRY_TYPE_LABELS: Record<EnquiryType, string> = {
  general: 'General',
  winner_payout: 'Winner payout',
  ticket_order_problem: 'Ticket / order',
  account_login_issue: 'Account / login',
  other: 'Other',
}

export function enquiryTypeLabel(value: string | null | undefined): string {
  if (!value) return 'Enquiry'
  if (value in ENQUIRY_TYPE_LABELS) return ENQUIRY_TYPE_LABELS[value as EnquiryType]
  return value
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** True for the winner-payout enquiry type (used to flag payout tickets and to
 *  gate the sensitive payout metadata block). */
export function isWinnerPayout(value: string | null | undefined): boolean {
  return value === 'winner_payout'
}

export type InboxStatusTone = 'open' | 'waiting' | 'resolved'

/** Label + tone for an inbox status. Colour is paired with text so status is
 *  never conveyed by colour alone. */
export function inboxStatusMeta(status: InboxStatus): { label: string; tone: InboxStatusTone } {
  switch (status) {
    case 'open':
      return { label: 'Open', tone: 'open' }
    case 'waiting':
      return { label: 'Waiting', tone: 'waiting' }
    case 'resolved':
      return { label: 'Resolved', tone: 'resolved' }
    default:
      return { label: 'Open', tone: 'open' }
  }
}

/** Label + whether the state is a hard failure, for an outbound message's email
 *  delivery state. */
export function emailStatusMeta(
  status: EmailStatus,
): { label: string; tone: 'sent' | 'pending' | 'failed' | 'muted' } {
  switch (status) {
    case 'sent':
      return { label: 'Email sent', tone: 'sent' }
    case 'pending':
      return { label: 'Sending…', tone: 'pending' }
    case 'failed':
      return { label: 'Email failed', tone: 'failed' }
    case 'not_required':
      return { label: 'No email', tone: 'muted' }
    default:
      return { label: 'Email sent', tone: 'sent' }
  }
}

/**
 * A short, single-line preview of a message for the list. Collapses all
 * whitespace/newlines, trims, and truncates with an ellipsis. Pure text — never
 * HTML. Returns "No message" when empty.
 */
export function buildMessagePreview(message: string | null | undefined, maxLen = 140): string {
  const collapsed = (message ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return 'No message'
  if (collapsed.length <= maxLen) return collapsed
  return `${collapsed.slice(0, maxLen - 1).trimEnd()}…`
}

/**
 * Masks a UK bank account number, showing only the last 2 digits.
 * "12345678" -> "••••••78". Non-empty short values fully masked.
 */
export function maskAccountNumber(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  const digits = v.replace(/\D/g, '')
  if (digits.length <= 2) return '•'.repeat(Math.max(digits.length, 2))
  return `${'•'.repeat(digits.length - 2)}${digits.slice(-2)}`
}

/**
 * Masks a UK sort code, showing only the final pair.
 * "123456" -> "••-••-56".
 */
export function maskSortCode(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  const digits = v.replace(/\D/g, '')
  if (digits.length < 2) return '••-••-••'
  return `••-••-${digits.slice(-2)}`
}

/**
 * Validates a reply body against the DB CHECK constraint (trimmed 1–10000).
 * Returns the trimmed body when valid, or an error code the API maps to a
 * message. Used by BOTH the API (authoritative) and the composer (UX).
 */
export function validateReplyBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; error: 'empty' | 'too_long' } {
  const body = typeof raw === 'string' ? raw.trim() : ''
  if (body.length < REPLY_MIN_LEN) return { ok: false, error: 'empty' }
  if (body.length > REPLY_MAX_LEN) return { ok: false, error: 'too_long' }
  return { ok: true, body }
}

/**
 * Resolves a staff member's display name from assignee RPC fields.
 * Priority: first + last -> display_name -> email -> "Unknown". Never a raw UUID.
 */
export function resolveStaffName(parts: {
  first_name?: string | null
  last_name?: string | null
  display_name?: string | null
  email?: string | null
}): string {
  const first = (parts.first_name ?? '').trim()
  const last = (parts.last_name ?? '').trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  const display = (parts.display_name ?? '').trim()
  if (display) return display
  const email = (parts.email ?? '').trim()
  if (email) return email
  return 'Unknown'
}
