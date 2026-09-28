import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

// Admin customer APIs must never be cached by shared/proxy caches.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100 // hard ceiling from the DB contract

/** Coerce a DB integer/bigint (number OR numeric string) into a safe, non-negative
 *  integer. Aggregates are display-only, so a malformed value degrades to 0. */
function coerceNonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  const i = Math.trunc(n)
  return i > 0 ? i : 0
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Normalizes a single top-spenders row. A row is only usable if it carries a
 * valid UUID user_id; everything else is coerced defensively for display.
 * Note: this RPC intentionally exposes NO created_at, self_excluded_at, or
 * total/cash/site win-count breakdown beyond the fields below (per contract).
 */
function normalizeRow(row: unknown):
  | {
      user_id: string
      first_name: string | null
      last_name: string | null
      display_name: string | null
      real_name: string | null
      email: string | null
      mobile: string | null
      is_self_excluded: boolean
      confirmed_order_count: number
      lifetime_external_pence: number
      last_confirmed_at: string | null
      wallet_available_pence: number
      instant_win_count: number
      main_draw_win_count: number
      cash_won_pence: number
      site_credit_won_pence: number
    }
  | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (typeof r.user_id !== 'string' || !UUID_RE.test(r.user_id)) return null

  return {
    user_id: r.user_id,
    first_name: asStringOrNull(r.first_name),
    last_name: asStringOrNull(r.last_name),
    display_name: asStringOrNull(r.display_name),
    real_name: asStringOrNull(r.real_name),
    email: asStringOrNull(r.email),
    mobile: asStringOrNull(r.mobile),
    is_self_excluded: r.is_self_excluded === true,
    confirmed_order_count: coerceNonNegInt(r.confirmed_order_count),
    lifetime_external_pence: coerceNonNegInt(r.lifetime_external_pence),
    last_confirmed_at: asStringOrNull(r.last_confirmed_at),
    wallet_available_pence: coerceNonNegInt(r.wallet_available_pence),
    instant_win_count: coerceNonNegInt(r.instant_win_count),
    main_draw_win_count: coerceNonNegInt(r.main_draw_win_count),
    cash_won_pence: coerceNonNegInt(r.cash_won_pence),
    site_credit_won_pence: coerceNonNegInt(r.site_credit_won_pence),
  }
}

/**
 * GET /api/admin/customers/top-spenders
 *
 * Server-only VIP/value ranking. Authorises the caller (admin or
 * operations_admin) BEFORE creating the service-role client, then calls the
 * privileged `admin_list_top_spenders` RPC EXACTLY ONCE. The ranking is already
 * pre-aggregated in the RPC — this route NEVER recalculates spend from
 * checkout_intents and issues no COUNT(*).
 *
 * Pagination is forward keyset only, per the DB contract: the RPC returns
 * `limit + 1` rows (the extra row establishes `hasNext` without a COUNT), and
 * the cursor is (lifetime_external_pence, user_id) of the last displayed row.
 * This RPC supports NO search and NO status filter, so this route accepts
 * neither.
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
  // Cursor = (lifetime_external_pence, user_id) of the last displayed row.
  const rawAfterSpend = searchParams.get('afterSpendPence')
  const rawAfterUserId = searchParams.get('afterUserId')
  const hasSpend = rawAfterSpend !== null && rawAfterSpend !== ''
  const hasUserId = rawAfterUserId !== null && rawAfterUserId !== ''

  if (hasSpend !== hasUserId) {
    // A partial cursor is always malformed.
    return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
  }

  let pAfterSpendPence: number | null = null
  let pAfterUserId: string | null = null
  if (hasSpend && hasUserId) {
    const spend = Number(rawAfterSpend)
    if (!Number.isInteger(spend) || spend < 0) {
      return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
    }
    if (!UUID_RE.test(rawAfterUserId as string)) {
      return NextResponse.json({ ok: false, error: 'invalid_cursor' }, { status: 400, ...NO_STORE })
    }
    pAfterSpendPence = spend
    pAfterUserId = rawAfterUserId as string
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/customers/top-spenders] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    // === Exactly ONE database round-trip. Pre-aggregated ranking. ===
    const { data, error } = await svc.rpc('admin_list_top_spenders', {
      p_limit: limit,
      p_after_spend_pence: pAfterSpendPence,
      p_after_user_id: pAfterUserId,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers/top-spenders] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
    }

    if (!Array.isArray(data)) {
      console.error('[admin/customers/top-spenders] RPC returned a non-array payload')
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
      hasNext && last ? { afterSpendPence: last.lifetime_external_pence, afterUserId: last.user_id } : null

    return NextResponse.json({ ok: true, customers, hasNext, nextCursor }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/top-spenders] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
  }
}
