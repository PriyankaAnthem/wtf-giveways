import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchMarketingPerformance } from '@/lib/admin/marketing/performance-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Marketing Performance JSON — admin + operations_admin.
 *
 * Auth first (user-scoped RLS client), THEN the query lib constructs the
 * service-role client to run `get_marketing_performance`. Unlike the admin-only
 * commercial analytics endpoint, Performance is intentionally reachable by
 * operations_admin as well (mirrors the exact-route grant for the
 * /admin/marketing/performance page). The service-role key is NEVER exposed to
 * the browser; the client only ever fetches this endpoint. Supports the ranges
 * today / yesterday / last_7_days / last_30_days / custom and an optional
 * ?channel drill filter, all validated in the query lib.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const result = await fetchMarketingPerformance(role, request.nextUrl.searchParams)

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
