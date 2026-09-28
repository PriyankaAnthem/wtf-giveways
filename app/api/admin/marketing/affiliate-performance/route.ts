import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchAffiliatePerformance } from '@/lib/admin/marketing/affiliate-performance-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Affiliate Performance JSON — admin + operations_admin.
 *
 * Auth first (user-scoped RLS client), THEN the query lib constructs the
 * service-role client to run `get_affiliate_performance`. Reachable by
 * operations_admin as well as admin, mirroring the exact-route grant for the
 * /admin/marketing/affiliates page. The service-role key is NEVER exposed to
 * the browser; the client only ever fetches this endpoint.
 *
 * Supports the ranges today / yesterday / last_7_days / last_30_days / custom
 * and an optional ?affiliate=<uuid> drill (leaderboard vs detail mode), all
 * validated in the query lib — a malformed uuid or bad custom window is a 400,
 * an RPC/runtime failure is a 500.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const result = await fetchAffiliatePerformance(role, request.nextUrl.searchParams)

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { ok: true, filters: result.filters, data: result.data },
    { headers: NO_STORE },
  )
}
