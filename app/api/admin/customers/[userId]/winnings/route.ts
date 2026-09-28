import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/** Nullable pence: preserve null (draws have no canonical value) but coerce
 *  provided numeric/bigint values to a safe non-negative integer. */
function asPenceOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i > 0 ? i : 0
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** winning_ticket / placed are only meaningful as non-negative integers. */
function asIntOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return null
  return n
}

/**
 * GET /api/admin/customers/[userId]/winnings
 *
 * Server-only paginated winnings history. Calls `admin_get_customer_winnings`
 * EXACTLY ONCE with offset pagination. The RPC returns `limit + 1` rows, so
 * `hasNext` is derived from the extra row without a COUNT(*). Some customers
 * legitimately have 2,000+ instant wins, so ALL winnings are NEVER loaded at
 * once — pagination is mandatory.
 *
 * Status is deliberately NOT computed here: the raw fields (fulfilment_type,
 * is_paid, fulfilled_at, win_kind) are returned so the shared client helper
 * `resolveWinStatus` can apply the critical status rules (§30) — in particular
 * that a wallet_credit award with is_paid=false but fulfilled_at set is
 * CREDITED, not unpaid.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
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

  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, ...NO_STORE })
  }

  const { searchParams } = new URL(request.url)

  // === Limit (capped at DB maximum) ===
  const rawLimit = searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ ok: false, error: 'invalid_limit' }, { status: 400, ...NO_STORE })
    }
    limit = Math.min(parsed, MAX_LIMIT)
  }

  // === Offset ===
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
    console.error('[admin/customers/winnings] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const { data, error } = await svc.rpc('admin_get_customer_winnings', {
      p_user_id: userId,
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers/winnings] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'winnings_failed' }, { status: 500, ...NO_STORE })
    }

    if (!Array.isArray(data)) {
      console.error('[admin/customers/winnings] RPC returned a non-array payload')
      return NextResponse.json({ ok: false, error: 'winnings_failed' }, { status: 500, ...NO_STORE })
    }

    // RPC returns limit + 1 => the extra row establishes hasNext.
    const hasNext = data.length > limit
    const pageRows = hasNext ? data.slice(0, limit) : data

    const winnings = pageRows.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>
      return {
        win_kind: asStringOrNull(r.win_kind),
        record_id: asStringOrNull(r.record_id),
        occurred_at: asStringOrNull(r.occurred_at),
        campaign_id: asStringOrNull(r.campaign_id),
        campaign_title: asStringOrNull(r.campaign_title),
        prize_title: asStringOrNull(r.prize_title),
        // NEVER fabricate a numeric prize value — null stays null (§11/§29).
        prize_value_pence: asPenceOrNull(r.prize_value_pence),
        fulfilment_type: asStringOrNull(r.fulfilment_type),
        winning_ticket: asIntOrNull(r.winning_ticket),
        is_paid: r.is_paid === true,
        paid_at: asStringOrNull(r.paid_at),
        fulfilled_at: asStringOrNull(r.fulfilled_at),
        payout_amount_pence: asPenceOrNull(r.payout_amount_pence),
        checkout_intent_id: asStringOrNull(r.checkout_intent_id),
        placed: asIntOrNull(r.placed),
      }
    })

    return NextResponse.json({ ok: true, winnings, hasNext, limit, offset }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/winnings] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'winnings_failed' }, { status: 500, ...NO_STORE })
  }
}
