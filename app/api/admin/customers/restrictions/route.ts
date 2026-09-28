import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  NO_STORE,
  RESTRICTION_TYPE_SELF_EXCLUSION,
  actorName,
  getServiceRoleClient,
  resolveUsers,
} from '@/lib/admin/restrictions'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/**
 * GET /api/admin/customers/restrictions
 *
 * The ACTIVE self-exclusions list for the Self Exclusions module. Authorises
 * the caller (admin OR operations_admin — both may VIEW) BEFORE creating the
 * service-role client, then reads `account_restrictions` DIRECTLY (not a stale
 * customer-profile snapshot) for the authoritative active state:
 *
 *   restriction_type = 'self_exclusion' AND revoked_at IS NULL, newest first.
 *
 * Pagination is server-side offset/limit — only one page of rows is ever read,
 * never the whole directory. Identity for the page (and the applying admins) is
 * resolved with a single batched profiles read plus one deduplicated auth
 * lookup per distinct id (no N+1 inside a loop).
 */
export async function GET(request: NextRequest) {
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

  let limit = DEFAULT_LIMIT
  const rawLimit = searchParams.get('limit')
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ ok: false, error: 'invalid_limit' }, { status: 400, ...NO_STORE })
    }
    limit = Math.min(parsed, MAX_LIMIT)
  }

  let page = 0
  const rawPage = searchParams.get('page')
  if (rawPage !== null) {
    const parsed = Number(rawPage)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return NextResponse.json({ ok: false, error: 'invalid_page' }, { status: 400, ...NO_STORE })
    }
    page = parsed
  }

  const svc = getServiceRoleClient()
  if (!svc) {
    console.error('[admin/customers/restrictions] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  try {
    const from = page * limit
    // Read limit + 1 to establish hasNext without a COUNT(*).
    const to = from + limit
    const { data, error } = await svc
      .from('account_restrictions')
      .select('id, user_id, source, restriction_type, reason, created_at, created_by')
      .eq('restriction_type', RESTRICTION_TYPE_SELF_EXCLUSION)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[admin/customers/restrictions] query error:', error.message?.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
    }

    const rows = Array.isArray(data) ? data : []
    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows

    const identities = await resolveUsers(
      svc,
      pageRows.flatMap((r) => [r.user_id as string, r.created_by as string | null]),
    )

    const restrictions = pageRows.map((r) => {
      const person = identities.get(r.user_id as string)
      return {
        id: r.id,
        user_id: r.user_id,
        source: r.source,
        restriction_type: r.restriction_type,
        reason: r.reason ?? null,
        created_at: r.created_at ?? null,
        created_by: r.created_by ?? null,
        created_by_name: actorName(identities.get((r.created_by as string) ?? '')),
        active: true,
        customer: {
          user_id: r.user_id,
          first_name: person?.first_name ?? null,
          last_name: person?.last_name ?? null,
          display_name: person?.display_name ?? null,
          real_name: person?.real_name ?? null,
          email: person?.email ?? null,
          mobile: person?.mobile ?? null,
        },
      }
    })

    return NextResponse.json({ ok: true, restrictions, hasNext, page }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/customers/restrictions] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'list_failed' }, { status: 500, ...NO_STORE })
  }
}
