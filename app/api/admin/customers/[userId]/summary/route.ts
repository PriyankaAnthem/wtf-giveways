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
 * GET /api/admin/customers/[userId]/summary
 *
 * Server-only. Calls `admin_get_customer_purchase_summary` EXACTLY ONCE and
 * returns a normalised summary. Money fields are kept distinct on purpose:
 *   - total_order_value_pence  => "Total Order Value"
 *   - lifetime_external_pence  => "Cash Paid"
 *   - total_wallet_credit_pence => "Site Credit Used"
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
    console.error('[admin/customers/summary] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const { data, error } = await svc.rpc('admin_get_customer_purchase_summary', {
      p_user_id: userId,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers/summary] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'summary_failed' }, { status: 500, ...NO_STORE })
    }

    // The RPC returns a single row (may arrive as a one-element array or object).
    const row = Array.isArray(data) ? data[0] : data
    const r = (row ?? {}) as Record<string, unknown>

    const summary = {
      confirmed_order_count: coerceNonNegInt(r.confirmed_order_count),
      total_order_value_pence: coerceNonNegInt(r.total_order_value_pence),
      lifetime_external_pence: coerceNonNegInt(r.lifetime_external_pence),
      total_wallet_credit_pence: coerceNonNegInt(r.total_wallet_credit_pence),
      total_tickets_purchased: coerceNonNegInt(r.total_tickets_purchased),
      first_confirmed_at: asStringOrNull(r.first_confirmed_at),
      last_confirmed_at: asStringOrNull(r.last_confirmed_at),
    }

    return NextResponse.json({ ok: true, summary }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/summary] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'summary_failed' }, { status: 500, ...NO_STORE })
  }
}
