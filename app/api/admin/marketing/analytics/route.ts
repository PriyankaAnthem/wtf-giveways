import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchMarketingAnalytics } from '@/lib/admin/marketing/analytics-queries'
import { parsePeriodDays } from '@/lib/admin/marketing/analytics'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Admin-only marketing commercial analytics JSON.
 *
 * Auth first (user-scoped RLS client), THEN the query lib constructs the
 * service-role client to run the analytics RPC. Marketing analytics is
 * admin-only — mirrors the same guard as the Marketing operations console and
 * the finance reports. The service-role key is NEVER exposed to the browser;
 * the client only ever fetches this endpoint.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  // --- TEMPORARILY DISABLED FOR HIGH TRAFFIC EVENT ---
  return NextResponse.json({ ok: false, error: 'service_unavailable - Analytics temporarily disabled to prioritize checkout.' }, { status: 503, headers: NO_STORE })
  // --- END TEMPORARY OVERRIDE ---

  const days = parsePeriodDays(request.nextUrl.searchParams.get('days'))
  const result = await fetchMarketingAnalytics(days)

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status, headers: NO_STORE },
    )
  }

  return NextResponse.json({ ok: true, data: result.data }, { headers: NO_STORE })
}
