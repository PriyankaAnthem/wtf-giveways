import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

// Admin customer APIs must never be cached by shared/proxy caches.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100 // hard ceiling from the DB contract
const MIN_SEARCH_LEN = 3
const MAX_SEARCH_LEN = 200

const VALID_STATUSES = ['all', 'active', 'self_excluded'] as const
type CustomerStatus = (typeof VALID_STATUSES)[number]

// Control characters are rejected from every search string.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/

/** Coerce a DB integer/bigint (number OR numeric string) into a safe, non-negative
 *  integer. Aggregates are display-only, so a malformed value degrades to 0
 *  rather than failing the whole page. */
function coerceNonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  const i = Math.trunc(n)
  return i > 0 ? i : 0
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** A row is only usable if it carries a valid UUID user_id. Everything else is
 *  coerced defensively for display. Returns null for an unusable row. */
function normalizeRow(row: unknown): {
  user_id: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  real_name: string | null
  email: string | null
  mobile: string | null
  account_active: boolean
  is_self_excluded: boolean
  self_excluded_at: string | null
  account_created_at: string | null
  confirmed_order_count: number
  lifetime_external_pence: number
  last_confirmed_at: string | null
  wallet_available_pence: number
  // V3 winnings aggregates (kept separate; cash vs site credit never summed).
  instant_win_count: number
  main_draw_win_count: number
  total_win_count: number
  cash_win_count: number
  site_credit_win_count: number
  cash_won_pence: number
  site_credit_won_pence: number
  aggregates_refreshed_at: string | null
} | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (typeof r.user_id !== 'string' || !UUID_RE.test(r.user_id)) return null

  return {
    user_id: r.user_id,
    // Genuine supplied names. `real_name` is often username-style noise, so the
    // UI ranks it below these for the primary display name.
    first_name: asStringOrNull(r.first_name),
    last_name: asStringOrNull(r.last_name),
    display_name: asStringOrNull(r.display_name),
    real_name: asStringOrNull(r.real_name),
    email: asStringOrNull(r.email),
    mobile: asStringOrNull(r.mobile),
    account_active: r.account_active === true,
    is_self_excluded: r.is_self_excluded === true,
    self_excluded_at: asStringOrNull(r.self_excluded_at),
    account_created_at: asStringOrNull(r.account_created_at),
    confirmed_order_count: coerceNonNegInt(r.confirmed_order_count),
    lifetime_external_pence: coerceNonNegInt(r.lifetime_external_pence),
    last_confirmed_at: asStringOrNull(r.last_confirmed_at),
    wallet_available_pence: coerceNonNegInt(r.wallet_available_pence),
    // V3 winnings summary — surfaced directly on each list row, no extra query.
    instant_win_count: coerceNonNegInt(r.instant_win_count),
    main_draw_win_count: coerceNonNegInt(r.main_draw_win_count),
    total_win_count: coerceNonNegInt(r.total_win_count),
    cash_win_count: coerceNonNegInt(r.cash_win_count),
    site_credit_win_count: coerceNonNegInt(r.site_credit_win_count),
    cash_won_pence: coerceNonNegInt(r.cash_won_pence),
    site_credit_won_pence: coerceNonNegInt(r.site_credit_won_pence),
    aggregates_refreshed_at: asStringOrNull(r.aggregates_refreshed_at),
  }
}

/**
 * GET /api/admin/customers
 *
 * Server-only customer directory. Authorises the caller (admin or
 * operations_admin) BEFORE creating the service-role client, validates every
 * query parameter, and then calls the privileged `admin_list_customers_v3` RPC
 * EXACTLY ONCE. There are no per-row database calls — self-exclusion status,
 * order counts, cash paid, last purchase, wallet balance AND the winnings
 * summary all arrive from the single list RPC (which already solved the N+1
 * problem).
 *
 * Pagination is forward keyset only, per the DB contract: the RPC returns
 * `limit + 1` rows; the extra row establishes `hasNext` without a COUNT(*), and
 * the cursor is (account_created_at, user_id) of the last displayed row.
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

  // === Search validation ===
  // Empty / short searches are treated as "no filter" (p_search = null), matching
  // the client rule of applying only at >= 3 characters. Over-long or
  // control-character searches are hard rejects.
  const rawSearch = searchParams.get('search')
  let pSearch: string | null = null
  if (typeof rawSearch === 'string') {
    const trimmed = rawSearch.trim()
    if (trimmed.length > MAX_SEARCH_LEN) {
      return NextResponse.json({ ok: false, error: 'invalid_search' }, { status: 400, ...NO_STORE })
    }
    if (CONTROL_CHAR_RE.test(trimmed)) {
      return NextResponse.json({ ok: false, error: 'invalid_search' }, { status: 400, ...NO_STORE })
    }
    pSearch = trimmed.length >= MIN_SEARCH_LEN ? trimmed : null
  }

  // === Status validation ===
  const rawStatus = searchParams.get('status')
  let pStatus: CustomerStatus = 'all'
  if (rawStatus !== null) {
    if (!VALID_STATUSES.includes(rawStatus as CustomerStatus)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400, ...NO_STORE })
    }
    pStatus = rawStatus as CustomerStatus
  }

  // === Limit validation (capped at the DB-supported maximum) ===
  const rawLimit = searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ ok: false, error: 'invalid_limit' }, { status: 400, ...NO_STORE })
    }
    limit = Math.min(parsed, MAX_LIMIT)
  }

  // === Cursor validation (both parts, or neither) ===
  const rawAfterCreatedAt = searchParams.get('afterCreatedAt')
  const rawAfterUserId = searchParams.get('afterUserId')
  const hasCreatedAt = rawAfterCreatedAt !== null && rawAfterCreatedAt !== ''
  const hasUserId = rawAfterUserId !== null && rawAfterUserId !== ''

  if (hasCreatedAt !== hasUserId) {
    // A partial cursor is always malformed.
    return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
  }

  let pAfterCreatedAt: string | null = null
  let pAfterUserId: string | null = null
  if (hasCreatedAt && hasUserId) {
    const ts = new Date(rawAfterCreatedAt as string)
    if (Number.isNaN(ts.getTime())) {
      return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
    }
    if (!UUID_RE.test(rawAfterUserId as string)) {
      return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
    }
    pAfterCreatedAt = (rawAfterCreatedAt as string)
    pAfterUserId = (rawAfterUserId as string)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/customers] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    // === Exactly ONE database round-trip. ===
    // V3 returns the identity + activity + wallet payload PLUS a full winnings
    // summary (instant/draw/total counts, cash vs site-credit counts and pence)
    // so the list can show winnings without any per-row query (no N+1).
    const { data, error } = await svc.rpc('admin_list_customers_v3', {
      p_search: pSearch,
      p_status: pStatus,
      p_limit: limit,
      p_after_created_at: pAfterCreatedAt,
      p_after_user_id: pAfterUserId,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
    }

    if (!Array.isArray(data)) {
      console.error('[admin/customers] RPC returned a non-array payload')
      return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
    }

    // The RPC returns limit + 1 rows. The extra row means "there is a next page".
    const hasNext = data.length > limit
    const pageRows = hasNext ? data.slice(0, limit) : data

    const customers = pageRows
      .map(normalizeRow)
      .filter((row): row is NonNullable<ReturnType<typeof normalizeRow>> => row !== null)

    // Forward-keyset cursor from the LAST displayed row.
    const last = customers.length > 0 ? customers[customers.length - 1] : null
    const nextCursor =
      hasNext && last && last.account_created_at
        ? { createdAt: last.account_created_at, userId: last.user_id }
        : null

    return NextResponse.json({ ok: true, customers, hasNext, nextCursor }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
  }
}
