import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

// Admin customer APIs must never be cached by shared/proxy caches.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100 // hard ceiling from the DB contract

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Nullable pence: preserve null (main-draw prizes have no canonical value) but
 *  coerce provided numeric/bigint values to a safe non-negative integer. */
function asPenceOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i > 0 ? i : 0
}

/** winning_ticket / placed are only meaningful as non-negative integers. */
function asIntOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return null
  return n
}

/**
 * Maps a recent-winners row to ONLY the defined operational fields. A row must
 * carry a valid UUID user_id (so the whole row can link to the customer detail
 * page); rows without one are dropped. Technical diagnostics (checkout intent
 * id, raw payment fields) are deliberately NOT exposed (§16).
 */
function normalizeRow(row: unknown):
  | {
      win_kind: string | null
      record_id: string | null
      occurred_at: string | null
      user_id: string
      first_name: string | null
      last_name: string | null
      display_name: string | null
      real_name: string | null
      email: string | null
      mobile: string | null
      campaign_id: string | null
      campaign_title: string | null
      prize_title: string | null
      prize_value_pence: number | null
      fulfilment_type: string | null
      winning_ticket: number | null
      is_paid: boolean
      fulfilled_at: string | null
      placed: number | null
    }
  | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (typeof r.user_id !== 'string' || !UUID_RE.test(r.user_id)) return null

  return {
    win_kind: asStringOrNull(r.win_kind),
    record_id: asStringOrNull(r.record_id),
    occurred_at: asStringOrNull(r.occurred_at),
    user_id: r.user_id,
    first_name: asStringOrNull(r.first_name),
    last_name: asStringOrNull(r.last_name),
    display_name: asStringOrNull(r.display_name),
    real_name: asStringOrNull(r.real_name),
    email: asStringOrNull(r.email),
    mobile: asStringOrNull(r.mobile),
    campaign_id: asStringOrNull(r.campaign_id),
    campaign_title: asStringOrNull(r.campaign_title),
    prize_title: asStringOrNull(r.prize_title),
    // NEVER fabricate a numeric prize value — null stays null (§15).
    prize_value_pence: asPenceOrNull(r.prize_value_pence),
    fulfilment_type: asStringOrNull(r.fulfilment_type),
    winning_ticket: asIntOrNull(r.winning_ticket),
    is_paid: r.is_paid === true,
    fulfilled_at: asStringOrNull(r.fulfilled_at),
    placed: asIntOrNull(r.placed),
  }
}

/**
 * GET /api/admin/customers/recent-winners
 *
 * Server-only live winners feed. Authorises the caller (admin or
 * operations_admin) BEFORE creating the service-role client, then calls the
 * privileged `admin_list_recent_winners` RPC EXACTLY ONCE. Uses simple OFFSET
 * pagination to match the RPC contract; the RPC returns `limit + 1` rows so
 * `hasNext` is derived from the extra row without a COUNT(*). Winnings are
 * never all-loaded — pagination is mandatory.
 *
 * Status is deliberately NOT computed here: the raw fields (win_kind,
 * fulfilment_type, is_paid, fulfilled_at) are returned so the shared client
 * helper `resolveWinStatus` can apply the critical status rules (§13) — in
 * particular that a wallet_credit award with is_paid=false but fulfilled_at set
 * is CREDITED, not unpaid.
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

  // === Offset validation (simple offset paging, per RPC contract) ===
  const rawOffset = searchParams.get('offset')
  let offset = 0
  if (rawOffset !== null) {
    const parsed = Number(rawOffset)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return NextResponse.json({ ok: false, error: 'invalid_offset' }, { status: 400, ...NO_STORE })
    }
    offset = parsed
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/customers/recent-winners] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    // === Exactly ONE database round-trip. ===
    const { data, error } = await svc.rpc('admin_list_recent_winners', {
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers/recent-winners] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'winners_failed' }, { status: 500, ...NO_STORE })
    }

    if (!Array.isArray(data)) {
      console.error('[admin/customers/recent-winners] RPC returned a non-array payload')
      return NextResponse.json({ ok: false, error: 'winners_failed' }, { status: 500, ...NO_STORE })
    }

    // RPC returns limit + 1 => the extra row establishes hasNext.
    const hasNext = data.length > limit
    const pageRows = hasNext ? data.slice(0, limit) : data

    const winners = pageRows
      .map(normalizeRow)
      .filter((row): row is NonNullable<ReturnType<typeof normalizeRow>> => row !== null)

    return NextResponse.json({ ok: true, winners, hasNext, limit, offset }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/recent-winners] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'winners_failed' }, { status: 500, ...NO_STORE })
  }
}
