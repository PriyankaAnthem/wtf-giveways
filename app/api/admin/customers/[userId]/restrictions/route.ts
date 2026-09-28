import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { NO_STORE, UUID_RE, actorName, getServiceRoleClient, resolveUsers } from '@/lib/admin/restrictions'

/**
 * GET /api/admin/customers/[userId]/restrictions
 *
 * Full restriction HISTORY for one customer (active + revoked), newest first.
 * Viewable by admin AND operations_admin. Reads `account_restrictions` directly
 * for the authoritative record and never deletes history. Actor names
 * (created_by / revoked_by) are resolved via the shared, deduplicated resolver;
 * no unrelated auth.users data is exposed.
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

  const svc = getServiceRoleClient()
  if (!svc) {
    console.error('[admin/customers/history] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  try {
    const { data, error } = await svc
      .from('account_restrictions')
      .select(
        'id, user_id, restriction_type, source, reason, created_at, created_by, revoked_at, revoked_by, revocation_reason',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (error) {
      console.error('[admin/customers/history] query error:', error.message?.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'history_failed' }, { status: 500, ...NO_STORE })
    }

    const rows = Array.isArray(data) ? data : []

    // Resolve every distinct actor (created_by + revoked_by) in one pass.
    const identities = await resolveUsers(
      svc,
      rows.flatMap((r) => [r.created_by as string | null, r.revoked_by as string | null]),
    )

    const restrictions = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      restriction_type: r.restriction_type,
      source: r.source,
      reason: r.reason ?? null,
      created_at: r.created_at ?? null,
      created_by: r.created_by ?? null,
      created_by_name: actorName(identities.get((r.created_by as string) ?? '')),
      revoked_at: r.revoked_at ?? null,
      revoked_by: r.revoked_by ?? null,
      revoked_by_name: actorName(identities.get((r.revoked_by as string) ?? '')),
      revocation_reason: r.revocation_reason ?? null,
      active: r.revoked_at == null,
    }))

    return NextResponse.json({ ok: true, restrictions }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/history] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'history_failed' }, { status: 500, ...NO_STORE })
  }
}
