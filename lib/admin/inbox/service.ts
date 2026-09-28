import 'server-only'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-only shared helpers for the Admin → Inbox.
 *
 * Every Inbox API authorises the admin FIRST and only then calls
 * `getInboxServiceClient()`. This module never performs its own authorization —
 * callers must have already passed `authorizeAdminApi` / `requireAdmin`.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Creates the service-role client, or null when server config is missing. */
export function getInboxServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('[inbox/service] Missing Supabase config')
    return null
  }
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

/** The full enquiry row shape the Inbox reads (support + payout metadata). */
export interface EnquiryRow {
  id: string
  enquiry_type: string
  full_name: string
  first_name: string | null
  last_name: string | null
  email: string
  phone: string | null
  giveaway_name: string | null
  order_reference: string | null
  tiktok_username: string | null
  message: string
  created_at: string
  updated_at: string
  inbox_status: string
  inbox_assigned_to: string | null
  inbox_last_message_at: string
  inbox_resolved_at: string | null
  inbox_status_updated_at: string | null
  inbox_assigned_at: string | null
  // Payout metadata (winner_payout enquiries). Bank details are masked in the UI.
  preferred_payout_method: string | null
  payout_account_holder_name: string | null
  payout_sort_code: string | null
  payout_account_number: string | null
  payout_paypal_email: string | null
  payout_contact_detail: string | null
  amount_claimed_pence: number | null
  verified_amount_pence: number | null
  payout_admin_notes: string | null
  payout_paid_at: string | null
  payout_processed_at: string | null
  status: string
}

const ENQUIRY_COLUMNS =
  'id, enquiry_type, full_name, first_name, last_name, email, phone, giveaway_name, order_reference, tiktok_username, message, created_at, updated_at, inbox_status, inbox_assigned_to, inbox_last_message_at, inbox_resolved_at, inbox_status_updated_at, inbox_assigned_at, preferred_payout_method, payout_account_holder_name, payout_sort_code, payout_account_number, payout_paypal_email, payout_contact_detail, amount_claimed_pence, verified_amount_pence, payout_admin_notes, payout_paid_at, payout_processed_at, status'

/**
 * Loads a single enquiry by id. Returns the row or null (not found / error).
 * Used by reply/retry/PATCH to obtain the authoritative recipient email — the
 * recipient is ALWAYS taken from here, never from client input.
 */
export async function loadEnquiry(svc: SupabaseClient, id: string): Promise<EnquiryRow | null> {
  const { data, error } = await svc
    .from('contact_enquiries')
    .select(ENQUIRY_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[inbox/service] loadEnquiry error:', (error.message || '').slice(0, 200))
    return null
  }
  return (data as EnquiryRow | null) ?? null
}

/** A message row in a conversation. */
export interface MessageRow {
  id: string
  enquiry_id: string
  direction: string
  body: string
  author_user_id: string | null
  email_status: string
  email_provider_message_id: string | null
  email_error: string | null
  email_sent_at: string | null
  created_at: string
}

const MESSAGE_COLUMNS =
  'id, enquiry_id, direction, body, author_user_id, email_status, email_provider_message_id, email_error, email_sent_at, created_at'

/**
 * Loads every message for an enquiry, ordered chronologically (created_at ASC,
 * id ASC) per the contract. The ORIGINAL customer message lives on
 * `contact_enquiries.message` and is rendered separately — it is NOT stored
 * here and must not be duplicated.
 */
export async function loadMessages(svc: SupabaseClient, enquiryId: string): Promise<MessageRow[]> {
  const { data, error } = await svc
    .from('contact_enquiry_messages')
    .select(MESSAGE_COLUMNS)
    .eq('enquiry_id', enquiryId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) {
    console.error('[inbox/service] loadMessages error:', (error.message || '').slice(0, 200))
    return []
  }
  return (data as MessageRow[] | null) ?? []
}

export interface InboxAssignee {
  user_id: string
  role: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
}

/**
 * Returns the enabled staff allowed to work Inbox tickets, via the live
 * `admin_list_inbox_assignees()` RPC. Never queries auth.users directly.
 */
export async function listAssignees(svc: SupabaseClient): Promise<InboxAssignee[]> {
  const { data, error } = await svc.rpc('admin_list_inbox_assignees')
  if (error || !Array.isArray(data)) {
    if (error) console.error('[inbox/service] listAssignees error:', (error.message || '').slice(0, 200))
    return []
  }
  const asStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  return data
    .map((row): InboxAssignee | null => {
      const r = row as Record<string, unknown>
      const userId = typeof r.user_id === 'string' ? r.user_id : null
      if (!userId || !UUID_RE.test(userId)) return null
      return {
        user_id: userId,
        role: asStr(r.role),
        email: asStr(r.email),
        first_name: asStr(r.first_name),
        last_name: asStr(r.last_name),
        display_name: asStr(r.display_name),
      }
    })
    .filter((r): r is InboxAssignee => r !== null)
}

/**
 * Validates that `userId` is a currently-allowed Inbox assignee. The server
 * must never persist an arbitrary UUID — assignment is only accepted when the
 * id appears in `admin_list_inbox_assignees()`.
 */
export async function isValidAssignee(svc: SupabaseClient, userId: string): Promise<boolean> {
  const assignees = await listAssignees(svc)
  return assignees.some((a) => a.user_id === userId)
}

/** The customer identity resolved from an enquiry email (or null when guest). */
export interface ResolvedCustomer {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
  real_name: string | null
  mobile: string | null
}

/**
 * Resolves an enquiry email to an existing WTF customer via the live
 * `admin_resolve_inbox_customer(p_email)` RPC. Returns null for guests/unmatched
 * — we never fabricate a user_id. Called only when a conversation is opened.
 */
export async function resolveInboxCustomer(
  svc: SupabaseClient,
  email: string,
): Promise<ResolvedCustomer | null> {
  const { data, error } = await svc.rpc('admin_resolve_inbox_customer', { p_email: email })
  if (error) {
    console.error('[inbox/service] resolveInboxCustomer error:', (error.message || '').slice(0, 200))
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const userId = typeof r.user_id === 'string' ? r.user_id : null
  if (!userId || !UUID_RE.test(userId)) return null
  return {
    user_id: userId,
    email: (r.email as string) ?? null,
    first_name: (r.first_name as string) ?? null,
    last_name: (r.last_name as string) ?? null,
    display_name: (r.display_name as string) ?? null,
    real_name: (r.real_name as string) ?? null,
    mobile: (r.mobile as string) ?? null,
  }
}
