import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

function coerceInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n)
}

function coerceNonNegInt(value: unknown): number {
  const i = coerceInt(value)
  return i > 0 ? i : 0
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** start/end ticket are only meaningful as non-negative integers; otherwise null. */
function asTicketOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return null
  return n
}

/**
 * GET /api/admin/customers/[userId]/orders
 *
 * Server-only paginated purchase history. Calls `admin_get_customer_orders`
 * EXACTLY ONCE with offset pagination. The RPC returns `limit + 1` rows so
 * `hasNext` is derived from the extra row without a COUNT(*). No joins or N+1
 * campaign lookups happen in application code — the RPC already returns
 * campaign_title and the ticket allocation range.
 *
 * Only the fields defined by the contract are returned. Provider payloads / card
 * identifiers are never exposed (the RPC does not return them, and this route
 * whitelists its output regardless).
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
    console.error('[admin/customers/orders] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const { data, error } = await svc.rpc('admin_get_customer_orders', {
      p_user_id: userId,
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/customers/orders] RPC error:', rawMessage.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'orders_failed' }, { status: 500, ...NO_STORE })
    }

    if (!Array.isArray(data)) {
      console.error('[admin/customers/orders] RPC returned a non-array payload')
      return NextResponse.json({ ok: false, error: 'orders_failed' }, { status: 500, ...NO_STORE })
    }

    // RPC returns limit + 1 => the extra row establishes hasNext.
    const hasNext = data.length > limit
    const pageRows = hasNext ? data.slice(0, limit) : data

    const orders = pageRows.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>
      const totalPence = coerceNonNegInt(r.total_pence)
      const walletCreditPence = coerceNonNegInt(r.wallet_credit_pence)
      // Display normalisation only (§15): prefer external_payment_pence when
      // present; otherwise derive max(total - wallet_credit, 0). Never mutates
      // stored data.
      const rawExternal = r.external_payment_pence
      const cashPaidPence =
        rawExternal === null || rawExternal === undefined
          ? Math.max(totalPence - walletCreditPence, 0)
          : coerceNonNegInt(rawExternal)

      return {
        checkout_intent_id: asStringOrNull(r.checkout_intent_id),
        checkout_ref: asStringOrNull(r.checkout_ref),
        created_at: asStringOrNull(r.created_at),
        confirmed_at: asStringOrNull(r.confirmed_at),
        campaign_id: asStringOrNull(r.campaign_id),
        campaign_title: asStringOrNull(r.campaign_title),
        qty: coerceNonNegInt(r.qty),
        total_pence: totalPence,
        cash_paid_pence: cashPaidPence,
        wallet_credit_pence: walletCreditPence,
        currency: asStringOrNull(r.currency),
        provider: asStringOrNull(r.provider),
        provider_status: asStringOrNull(r.provider_status),
        checkout_state: asStringOrNull(r.checkout_state),
        start_ticket: asTicketOrNull(r.start_ticket),
        end_ticket: asTicketOrNull(r.end_ticket),
      }
    })

    return NextResponse.json({ ok: true, orders, hasNext, limit, offset }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/orders] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'orders_failed' }, { status: 500, ...NO_STORE })
  }
}
