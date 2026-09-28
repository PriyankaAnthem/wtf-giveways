import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Coerce a DB integer/bigint (number OR numeric string) to a safe non-negative int. */
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
 * GET /api/admin/customers/[userId]/winnings-summary
 *
 * Server-only. Authorises the caller (admin or operations_admin) BEFORE
 * creating the service-role client, then calls
 * `admin_get_customer_winnings_summary` EXACTLY ONCE. No client-side
 * aggregation — the RPC returns the finished counts and pence values.
 *
 * Cash and site-credit values are returned as distinct fields and are NEVER
 * summed (§11). `unpaid_cash_win_count` is surfaced so the UI can flag cash
 * wins awaiting payout — an operationally important signal.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/customers/winnings-summary] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const { data, error } = await svc.rpc('admin_get_customer_winnings_summary', {
      p_user_id: userId,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers/winnings-summary] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'winnings_summary_failed' }, { status: 500, ...NO_STORE })
    }

    // Single row (may arrive as a one-element array or as an object).
    const row = Array.isArray(data) ? data[0] : data
    const r = (row ?? {}) as Record<string, unknown>

    const summary = {
      instant_win_count: coerceNonNegInt(r.instant_win_count),
      main_draw_win_count: coerceNonNegInt(r.main_draw_win_count),
      total_win_count: coerceNonNegInt(r.total_win_count),
      cash_win_count: coerceNonNegInt(r.cash_win_count),
      site_credit_win_count: coerceNonNegInt(r.site_credit_win_count),
      manual_win_count: coerceNonNegInt(r.manual_win_count),
      cash_won_pence: coerceNonNegInt(r.cash_won_pence),
      site_credit_won_pence: coerceNonNegInt(r.site_credit_won_pence),
      unpaid_cash_win_count: coerceNonNegInt(r.unpaid_cash_win_count),
      last_win_at: asStringOrNull(r.last_win_at),
    }

    return NextResponse.json({ ok: true, summary }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/winnings-summary] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'winnings_summary_failed' }, { status: 500, ...NO_STORE })
  }
}
