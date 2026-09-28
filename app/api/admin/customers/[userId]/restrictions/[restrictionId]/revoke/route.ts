import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  NO_STORE,
  REASON_MAX,
  UUID_RE,
  getServiceRoleClient,
  mapRestrictionRpcError,
} from '@/lib/admin/restrictions'

/**
 * POST /api/admin/customers/[userId]/restrictions/[restrictionId]/revoke
 *
 * SUPER-ADMIN-ONLY soft revocation of an ADMIN-originated self-exclusion.
 * Support- and customer-originated exclusions can NEVER be revoked here.
 *
 * Server flow (authoritative, browser cannot spoof any of it):
 *  1. authorise admin-only
 *  2. validate userId + restrictionId are UUIDs
 *  3. validate a non-empty revocation reason
 *  4. load the EXACT restriction row and confirm it belongs to route userId
 *  5. pre-check source==='admin' and not-already-revoked for clean messaging
 *  6. call the service-role RPC `admin_revoke_restriction`, passing the
 *     authenticated admin's genuine UUID as p_revoked_by (NEVER from the body)
 *
 * The RPC re-validates everything authoritatively and performs the mutation +
 * audit-log insert atomically; the pre-checks only produce friendlier errors.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; restrictionId: string }> },
) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError === 'Not authenticated' ? 'unauthorized' : 'forbidden' },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { userId, restrictionId } = await params
  if (!UUID_RE.test(userId) || !UUID_RE.test(restrictionId)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, ...NO_STORE })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400, ...NO_STORE })
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 1 || reason.length > REASON_MAX) {
    return NextResponse.json({ ok: false, error: 'invalid_reason' }, { status: 400, ...NO_STORE })
  }

  const svc = getServiceRoleClient()
  if (!svc) {
    console.error('[admin/customers/revoke] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'revoke_failed' }, { status: 500, ...NO_STORE })
  }

  // Load the exact row so we can (a) confirm it belongs to this customer and
  // (b) give precise, non-leaky errors before the mutation is attempted.
  const { data: row, error: loadError } = await svc
    .from('account_restrictions')
    .select('id, user_id, source, revoked_at')
    .eq('id', restrictionId)
    .maybeSingle()

  if (loadError) {
    console.error('[admin/customers/revoke] load error:', loadError.message?.slice(0, 300))
    return NextResponse.json({ ok: false, error: 'revoke_failed' }, { status: 500, ...NO_STORE })
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: 'restriction_not_found' }, { status: 404, ...NO_STORE })
  }
  // The restriction MUST belong to the customer named in the route.
  if (row.user_id !== userId) {
    return NextResponse.json({ ok: false, error: 'restriction_mismatch' }, { status: 400, ...NO_STORE })
  }
  if (row.source !== 'admin') {
    return NextResponse.json({ ok: false, error: 'not_admin_originated' }, { status: 409, ...NO_STORE })
  }
  if (row.revoked_at != null) {
    return NextResponse.json({ ok: false, error: 'already_revoked' }, { status: 409, ...NO_STORE })
  }

  // Authoritative mutation. p_revoked_by is the acting admin's genuine auth
  // UUID from the server session — the browser never provides it.
  const { error } = await svc.rpc('admin_revoke_restriction', {
    p_restriction_id: restrictionId,
    p_revoked_by: user.id,
    p_revocation_reason: reason,
  })

  if (error) {
    const rawMessage = typeof error.message === 'string' ? error.message : ''
    const mapped = mapRestrictionRpcError(rawMessage)
    console.error('[admin/customers/revoke] RPC error:', rawMessage.slice(0, 300))
    return NextResponse.json({ ok: false, error: mapped.code }, { status: mapped.status, ...NO_STORE })
  }

  console.info(
    '[admin/customers/revoke] account_restriction_revoked',
    JSON.stringify({ restrictionId, targetUserId: userId, adminUserId: user.id, at: new Date().toISOString() }),
  )

  return NextResponse.json({ ok: true, revoked: true }, NO_STORE)
}
