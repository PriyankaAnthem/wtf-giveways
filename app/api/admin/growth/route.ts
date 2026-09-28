import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchGrowthDashboard } from '@/lib/admin/reporting/growth-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Admin-only Growth analytics JSON.
 *
 * Auth first (user-scoped RLS client), THEN the query lib constructs the
 * service-role client to run the Growth RPC. Growth is admin-only and reuses the
 * same filter parsing + Europe/London date semantics as GET /api/admin/reports.
 * One request per filter state -> one RPC call -> one compact payload.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const result = await fetchGrowthDashboard(role, request.nextUrl.searchParams)

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
