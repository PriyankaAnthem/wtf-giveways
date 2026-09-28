import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isUserPurchaseRestricted } from '@/lib/account-restrictions'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REASON_MIN = 1 // mandatory: rejected when blank / whitespace-only (post-trim)
const REASON_MAX = 500

/**
 * POST /api/admin/wallets/[userId]/self-exclude
 *
 * Marks a customer as purchase-restricted (self-excluded) via the privileged,
 * server-only `admin_self_exclude_user` RPC. This is a CONSEQUENTIAL,
 * IRREVERSIBLE action (there is deliberately no reversal endpoint), so it is
 * gated to Super Admins only — stricter than the ['admin','operations_admin']
 * used for reversible wallet-credit adjustments, matching the project's
 * admin-only tier for permanent operations.
 *
 * The browser calls this route; the route (and only the route, server-side)
 * calls the database RPC using the service-role client. It never touches
 * auth.users, entries, winnings, wallet balances or transaction history — it
 * only creates the purchasing restriction.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  // Super Admins only. Operations Admins, Hosts (ops) and read_only are rejected.
  // This explicit check runs before the service-role client is created.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError === 'Not authenticated' ? 'unauthorized' : 'forbidden' },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, ...NO_STORE })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400, ...NO_STORE })
  }

  // Reason: mandatory, trimmed, non-empty, <= 500 chars.
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return NextResponse.json({ ok: false, error: 'invalid_reason' }, { status: 400, ...NO_STORE })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/wallets/self-exclude] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'self_exclude_failed' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Idempotency: if the customer is ALREADY restricted, do not call the RPC
  // again (avoids a duplicate restriction / duplicate audit row). Treat it as a
  // successful no-op and let the UI refresh the status. The DB RPC is itself
  // idempotent; this is a belt-and-braces application guard.
  const alreadyRestricted = await isUserPurchaseRestricted(svc, userId)
  if (alreadyRestricted) {
    return NextResponse.json(
      { ok: true, restricted: true, alreadyExcluded: true },
      NO_STORE,
    )
  }

  // The ONLY restriction path: the privileged admin_self_exclude_user RPC.
  // p_created_by is the acting admin's genuine auth.users UUID (admin_users
  // rows reference auth.users(id)); it is NOT cast or invented. The RPC records
  // the action + target + admin identity + reason + timestamp, which is the
  // authoritative audit trail for this mutation (mirrors admin_credit_wallet).
  const { error } = await svc.rpc('admin_self_exclude_user', {
    p_user_id: userId,
    p_reason: reason,
    p_created_by: user.id,
  })

  if (error) {
    const rawMessage = typeof error.message === 'string' ? error.message : ''
    console.error('[admin/wallets/self-exclude] RPC error:', rawMessage.slice(0, 300))
    if (rawMessage.includes('not_found') || rawMessage.includes('user_not_found')) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404, ...NO_STORE })
    }
    return NextResponse.json({ ok: false, error: 'self_exclude_failed' }, { status: 500, ...NO_STORE })
  }

  // Structured server-side log (secondary trail; the RPC row is authoritative).
  console.info(
    '[admin/wallets/self-exclude] customer_self_excluded',
    JSON.stringify({ targetUserId: userId, adminUserId: user.id, at: new Date().toISOString() }),
  )

  // Confirm the resulting state so the UI can trust the refresh.
  const restricted = await isUserPurchaseRestricted(svc, userId)

  return NextResponse.json({ ok: true, restricted, alreadyExcluded: false }, NO_STORE)
}
