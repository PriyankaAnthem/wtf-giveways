/**
 * Shared Admin → Inbox contract types.
 *
 * These mirror the LIVE database contract for `contact_enquiries` and
 * `contact_enquiry_messages` exactly (Phase 1). Nothing here invents columns or
 * RPCs — every field corresponds to a column/RPC output that already exists in
 * Supabase.
 *
 * IMPORTANT: the support workflow uses `inbox_status` ONLY. The legacy
 * `contact_enquiries.status` (new / paid / problem) belongs to the payout
 * workflow and is never read or written by the Inbox.
 */

/** The three Inbox support statuses. Independent of `contact_enquiries.status`. */
export const INBOX_STATUSES = ['open', 'waiting', 'resolved'] as const
export type InboxStatus = (typeof INBOX_STATUSES)[number]

/** The status filter values accepted by the list API (adds "all"). */
export const INBOX_STATUS_FILTERS = ['open', 'waiting', 'resolved', 'all'] as const
export type InboxStatusFilter = (typeof INBOX_STATUS_FILTERS)[number]

/** Existing enquiry types (from the live contact form contract). */
export const ENQUIRY_TYPES = [
  'general',
  'winner_payout',
  'ticket_order_problem',
  'account_login_issue',
  'other',
] as const
export type EnquiryType = (typeof ENQUIRY_TYPES)[number]

/**
 * Enquiry types the support Inbox does NOT own. `winner_payout` submissions are
 * handled exclusively by the dedicated Payouts module (`/admin/payouts`); they
 * live in the same `contact_enquiries` table but must never surface as Inbox
 * tickets. This is the single source of truth for that exclusion — the list
 * query, type-filter validation, the conversation page and the reply/retry/
 * PATCH APIs all derive from it, so the Inbox and its counts/pagination/search
 * operate only on support enquiries.
 */
export const INBOX_EXCLUDED_ENQUIRY_TYPES: readonly EnquiryType[] = ['winner_payout']

/** Enquiry types the Inbox works with — every type except the excluded ones. */
export const INBOX_ENQUIRY_TYPES: readonly EnquiryType[] = ENQUIRY_TYPES.filter(
  (t) => !INBOX_EXCLUDED_ENQUIRY_TYPES.includes(t),
)

/** True when an enquiry type belongs in the support Inbox workflow. */
export function isInboxEnquiryType(type: string): boolean {
  return !INBOX_EXCLUDED_ENQUIRY_TYPES.includes(type as EnquiryType)
}

/**
 * Builds the NULL-SAFE PostgREST `.or()` condition that excludes payout
 * enquiries from the Inbox list query.
 *
 * The effective SQL is `enquiry_type IS NULL OR enquiry_type <> <excluded...>`.
 * This deliberately differs from a plain `NOT IN` / `<>`, which evaluates to
 * NULL (non-matching) for rows where `enquiry_type IS NULL` and would therefore
 * silently hide legacy/null-type SUPPORT enquiries. Keeping the `is.null`
 * branch preserves those rows while still excluding every payout row.
 *
 * With a single excluded type the tokens are emitted bare — inside `.or(...)`
 * this reads as `is.null OR neq.<type>`, so the produced filter is simply
 * `enquiry_type.is.null,enquiry_type.neq.winner_payout` (no redundant `and()`
 * wrapper). With TWO OR MORE excluded types the neq tokens MUST be wrapped in
 * an `and(...)` group: top-level tokens inside `.or()` are OR-ed, so a bare
 * `is.null,neq.A,neq.B` would wrongly read as `IS NULL OR neq A OR neq B` and a
 * payout row would satisfy `neq B` and slip through. The `and(...)` keeps it as
 * `IS NULL OR (neq A AND neq B)`.
 *
 * Excluded values are fixed enum identifiers (no user input), so string
 * interpolation here is safe.
 */
export function buildInboxExclusionOrFilter(): string {
  const neqClauses = INBOX_EXCLUDED_ENQUIRY_TYPES.map((t) => `enquiry_type.neq.${t}`)
  const excludeGroup = neqClauses.length === 1 ? neqClauses[0] : `and(${neqClauses.join(',')})`
  return `enquiry_type.is.null,${excludeGroup}`
}

/**
 * One-time historical cleanup: "Mark old enquiries replied".
 *
 * This is a MANUAL bulk action, NOT an automatic ageing rule — nothing here is
 * scheduled or triggered. An admin explicitly runs it to move enquiries they
 * already answered manually (outside the Inbox) from Open to Waiting ("we
 * replied; awaiting the customer", the same status a real reply sets).
 *
 * Age is measured from ORIGINAL enquiry age (`created_at`), not
 * `inbox_last_message_at` — this is about how long ago the customer first wrote
 * in, which is what "older than 2 days" means for a historical backlog.
 */
export const BULK_MARK_REPLIED_MIN_AGE_MS = 48 * 60 * 60 * 1000 // 2 days

/** The `created_at` cutoff: enquiries strictly older than this are eligible. */
export function bulkMarkRepliedCutoffIso(nowMs: number): string {
  return new Date(nowMs - BULK_MARK_REPLIED_MIN_AGE_MS).toISOString()
}

/**
 * SINGLE SOURCE OF TRUTH for eligibility. The server SQL filters
 * (`inbox_status = 'open'` AND `created_at < cutoff` AND the NULL-safe payout
 * exclusion from {@link buildInboxExclusionOrFilter}) mirror this predicate
 * exactly, so the route never relies on the frontend for filtering.
 *
 * Eligible IFF the enquiry is:
 *   - currently `open` (never touch `waiting` or `resolved`)
 *   - an Inbox support type (payouts excluded; null/legacy type INCLUDED)
 *   - older than 48h by `created_at`
 */
export function isEligibleForBulkMarkReplied(
  row: { inbox_status: string | null; created_at: string | null; enquiry_type: string | null },
  nowMs: number,
): boolean {
  if (row.inbox_status !== 'open') return false
  // isInboxEnquiryType treats null/unknown as INCLUDED and excludes only payouts.
  if (!isInboxEnquiryType(row.enquiry_type ?? '')) return false
  if (!row.created_at) return false
  const createdMs = new Date(row.created_at).getTime()
  if (Number.isNaN(createdMs)) return false
  return createdMs < nowMs - BULK_MARK_REPLIED_MIN_AGE_MS
}

/** Message direction (contact_enquiry_messages.direction). */
export type MessageDirection = 'inbound' | 'outbound'

/** Outbound email lifecycle (contact_enquiry_messages.email_status). */
export const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'not_required'] as const
export type EmailStatus = (typeof EMAIL_STATUSES)[number]

/** A single row in the Inbox list (only what the list needs — no conversation,
 *  no orders, no winnings, no per-row customer lookup). */
export interface InboxListRow {
  id: string
  enquiry_type: string
  full_name: string
  email: string
  message_preview: string
  giveaway_name: string | null
  order_reference: string | null
  inbox_status: InboxStatus
  inbox_assigned_to: string | null
  inbox_last_message_at: string
  created_at: string
}

/** Keyset cursor for the Inbox list — (inbox_last_message_at, id). */
export interface InboxCursor {
  lastMessageAt: string
  id: string
}

/** Body-length bounds enforced by the DB CHECK constraint (trimmed 1–10000). */
export const REPLY_MIN_LEN = 1
export const REPLY_MAX_LEN = 10000
