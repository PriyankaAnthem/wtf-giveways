import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { buildMessagePreview } from '@/lib/admin/inbox/format'
import {
  INBOX_STATUS_FILTERS,
  INBOX_ENQUIRY_TYPES,
  buildInboxExclusionOrFilter,
  type InboxStatusFilter,
  type InboxStatus,
} from '@/lib/admin/inbox/types'

export const runtime = 'nodejs'

// Admin APIs must never be cached by shared/proxy caches.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const MIN_SEARCH_LEN = 2
const MAX_SEARCH_LEN = 200

// Control characters are rejected outright from search input.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/

// The only columns the LIST needs. No conversation, no orders, no winnings, and
// no per-row customer lookup (that would be an N+1 — the RPC is called only
// when a conversation is opened).
const LIST_COLUMNS =
  'id, enquiry_type, full_name, email, message, giveaway_name, order_reference, inbox_status, inbox_assigned_to, inbox_last_message_at, created_at'

// Columns the free-text search scans (server-side ILIKE).
const SEARCH_COLUMNS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'order_reference',
  'giveaway_name',
  'tiktok_username',
]

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * GET /api/admin/inbox
 *
 * Server-only support Inbox list. Authorises the caller (admin or
 * operations_admin) BEFORE creating the service-role client, validates every
 * query parameter, then runs EXACTLY ONE keyset query against
 * `contact_enquiries`.
 *
 * Pagination is forward keyset only: order by (inbox_last_message_at DESC,
 * id DESC), fetch `limit + 1` rows; the extra row establishes `hasNext` without
 * a COUNT(*), and the cursor is (inbox_last_message_at, id) of the last row.
 *
 * The support workflow reads/writes `inbox_status` ONLY — the legacy
 * `contact_enquiries.status` (payout workflow) is never touched.
 */
export async function GET(request: NextRequest) {
  // Super Admins and Operations Admins only. Hosts (ops) / read_only rejected.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { searchParams } = new URL(request.url)

  // === Status filter ===
  const rawStatus = searchParams.get('status')
  let statusFilter: InboxStatusFilter = 'open' // default view is Open
  if (rawStatus !== null) {
    if (!INBOX_STATUS_FILTERS.includes(rawStatus as InboxStatusFilter)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400, ...NO_STORE })
    }
    statusFilter = rawStatus as InboxStatusFilter
  }

  // === Enquiry type filter (optional) ===
  const rawType = searchParams.get('type')
  let typeFilter: string | null = null
  if (rawType !== null && rawType !== '' && rawType !== 'all') {
    // Only Inbox-eligible types are accepted. An explicit `type=winner_payout`
    // (or any excluded/unknown type) is rejected — payouts are never listable
    // through the Inbox regardless of the requested filter.
    if (!INBOX_ENQUIRY_TYPES.includes(rawType as (typeof INBOX_ENQUIRY_TYPES)[number])) {
      return NextResponse.json({ ok: false, error: 'invalid_type' }, { status: 400, ...NO_STORE })
    }
    typeFilter = rawType
  }

  // === Assignee filter (optional): a UUID, or the literal "unassigned" ===
  const rawAssignee = searchParams.get('assignee')
  let assigneeFilter: string | null = null // null = no filter
  let assigneeUnassigned = false
  if (rawAssignee !== null && rawAssignee !== '' && rawAssignee !== 'all') {
    if (rawAssignee === 'unassigned') {
      assigneeUnassigned = true
    } else if (UUID_RE.test(rawAssignee)) {
      assigneeFilter = rawAssignee
    } else {
      return NextResponse.json({ ok: false, error: 'invalid_assignee' }, { status: 400, ...NO_STORE })
    }
  }

  // === Search validation ===
  const rawSearch = searchParams.get('search')
  let search: string | null = null
  if (typeof rawSearch === 'string') {
    const trimmed = rawSearch.trim()
    if (trimmed.length > MAX_SEARCH_LEN || CONTROL_CHAR_RE.test(trimmed)) {
      return NextResponse.json({ ok: false, error: 'invalid_search' }, { status: 400, ...NO_STORE })
    }
    // Strip characters that are structural in a PostgREST or() filter so the
    // term can never break out of its ILIKE operand. Search is best-effort.
    const safe = trimmed.replace(/[,()*]/g, ' ').replace(/\s+/g, ' ').trim()
    search = safe.length >= MIN_SEARCH_LEN ? safe : null
  }

  // === Limit ===
  const rawLimit = searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ ok: false, error: 'invalid_limit' }, { status: 400, ...NO_STORE })
    }
    limit = Math.min(parsed, MAX_LIMIT)
  }

  // === Cursor (both parts together, or neither) ===
  const rawAfterAt = searchParams.get('afterLastMessageAt')
  const rawAfterId = searchParams.get('afterId')
  const hasAt = rawAfterAt !== null && rawAfterAt !== ''
  const hasId = rawAfterId !== null && rawAfterId !== ''
  if (hasAt !== hasId) {
    return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
  }
  let afterAt: string | null = null
  let afterId: string | null = null
  if (hasAt && hasId) {
    const ts = new Date(rawAfterAt as string)
    if (Number.isNaN(ts.getTime()) || !UUID_RE.test(rawAfterId as string)) {
      return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
    }
    afterAt = rawAfterAt as string
    afterId = rawAfterId as string
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/inbox] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    let query = svc
      .from('contact_enquiries')
      .select(LIST_COLUMNS)
      .order('inbox_last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // limit + 1 -> establishes hasNext without COUNT(*)

    // ALWAYS exclude payout enquiries at the query level. This applies to every
    // status view (open/waiting/resolved/all), search, and keyset pagination —
    // "All" means all SUPPORT enquiries, never payouts.
    //
    // NULL-SAFE BY DESIGN. A plain `NOT (enquiry_type IN (...))` /
    // `enquiry_type <> 'winner_payout'` evaluates to NULL (not TRUE) for rows
    // where enquiry_type IS NULL, which Postgres treats as non-matching — so
    // legacy/null support records would be silently dropped. Instead we express
    // the condition as `enquiry_type IS NULL OR enquiry_type <> <excluded...>`,
    // which keeps null-type support records visible while still excluding every
    // payout row. `.or()` adds a top-level AND-ed group, so this composes
    // correctly with the search and keyset `.or()` clauses below. Values are
    // fixed enum identifiers, safe to interpolate.
    query = query.or(buildInboxExclusionOrFilter())

    if (statusFilter !== 'all') query = query.eq('inbox_status', statusFilter)
    if (typeFilter) query = query.eq('enquiry_type', typeFilter)
    if (assigneeUnassigned) query = query.is('inbox_assigned_to', null)
    else if (assigneeFilter) query = query.eq('inbox_assigned_to', assigneeFilter)

    if (search) {
      const conditions = SEARCH_COLUMNS.map((col) => `${col}.ilike.*${search}*`).join(',')
      query = query.or(conditions)
    }

    // Forward keyset on (inbox_last_message_at DESC, id DESC).
    if (afterAt && afterId) {
      query = query.or(
        `inbox_last_message_at.lt.${afterAt},and(inbox_last_message_at.eq.${afterAt},id.lt.${afterId})`,
      )
    }

    const { data, error } = await query

    if (error) {
      console.error('[admin/inbox] query error:', (error.message || '').slice(0, 300))
      return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
    }
    if (!Array.isArray(data)) {
      return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
    }

    const hasNext = data.length > limit
    const pageRows = hasNext ? data.slice(0, limit) : data

    const rows = pageRows
      .map((row) => {
        const r = row as Record<string, unknown>
        const id = asStringOrNull(r.id)
        const lastAt = asStringOrNull(r.inbox_last_message_at)
        if (!id || !UUID_RE.test(id) || !lastAt) return null
        const status = asStringOrNull(r.inbox_status) ?? 'open'
        return {
          id,
          enquiry_type: asStringOrNull(r.enquiry_type) ?? 'other',
          full_name: asStringOrNull(r.full_name) ?? 'Unknown',
          email: asStringOrNull(r.email) ?? '',
          message_preview: buildMessagePreview(asStringOrNull(r.message)),
          giveaway_name: asStringOrNull(r.giveaway_name),
          order_reference: asStringOrNull(r.order_reference),
          inbox_status: status as InboxStatus,
          inbox_assigned_to: asStringOrNull(r.inbox_assigned_to),
          inbox_last_message_at: lastAt,
          created_at: asStringOrNull(r.created_at) ?? lastAt,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    const last = rows.length > 0 ? rows[rows.length - 1] : null
    const nextCursor =
      hasNext && last ? { lastMessageAt: last.inbox_last_message_at, id: last.id } : null

    return NextResponse.json({ ok: true, rows, hasNext, nextCursor }, NO_STORE)
  } catch (err) {
    console.error('[admin/inbox] Unexpected error:', (err as Error)?.message)
    return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
  }
}
