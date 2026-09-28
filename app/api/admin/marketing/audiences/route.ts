import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { fetchMarketingAudienceOverview } from '@/lib/admin/marketing/audience-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Admin-only Stage 2 marketing audience overview (aggregate counts only).
 *
 * Auth FIRST (user-scoped RLS client). Only after an admin is confirmed does the
 * query lib construct the service-role client and run the single audience RPC.
 * This is admin-only by default (operations_admin / ops / read_only are all
 * rejected). One browser request -> one RPC call -> one compact, identity-free
 * payload. No polling route, no per-audience endpoint.
 */
export async function GET() {
  const supabase = await createClient()
  const { role, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (error || !role) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const result = await fetchMarketingAudienceOverview(role)

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status, headers: NO_STORE },
    )
  }

  return NextResponse.json({ ok: true, data: result.data }, { headers: NO_STORE })
}
