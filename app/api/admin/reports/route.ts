import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchDashboard } from '@/lib/admin/reporting/queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Admin-only finance dashboard JSON.
 *
 * Auth first (user-scoped RLS client), THEN the query lib constructs the
 * service-role client to run the reporting RPC. Reports are admin-only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const result = await fetchDashboard(role, request.nextUrl.searchParams)

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
