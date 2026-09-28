import 'server-only'
import { getServiceSupabase } from '@/lib/admin/live-board'
import type { AdminRole } from '@/lib/admin/permissions'
import { findIdentityFields, type MarketingAudienceOverview } from './audiences'

export type FetchAudienceOverviewResult =
  | { ok: true; data: MarketingAudienceOverview }
  | { ok: false; error: 'query_failed'; status: number }

/**
 * Fetch the Stage 2 marketing audience overview from the single
 * `get_admin_marketing_audience_overview` RPC.
 *
 * IMPORTANT: authorization MUST already have happened before this is called.
 * The service-role client (which bypasses RLS on the forced-RLS Stage 1 tables)
 * is constructed here ONLY to run the admin-only RPC. The resolved admin role is
 * passed purely so we fail loudly if this is ever wired ahead of an auth guard.
 *
 * Exactly ONE RPC call is made. All errors collapse to a stable public
 * `query_failed` code — a raw Supabase/PostgreSQL message is never returned.
 */
export async function fetchMarketingAudienceOverview(
  role: AdminRole | null,
): Promise<FetchAudienceOverviewResult> {
  // Defensive: the route guard is authoritative, but never build a service-role
  // client for a request that was not authorized as an admin.
  if (role !== 'admin') {
    return { ok: false, error: 'query_failed', status: 401 }
  }

  let supabase
  try {
    supabase = getServiceSupabase()
  } catch {
    return { ok: false, error: 'query_failed', status: 500 }
  }

  const { data, error } = await supabase.rpc('get_admin_marketing_audience_overview')

  if (error) {
    // Log server-side for debugging; return a STABLE public code only.
    console.log('[v0] get_admin_marketing_audience_overview rpc error:', error.message)
    return { ok: false, error: 'query_failed', status: 500 }
  }
  if (!data) {
    return { ok: false, error: 'query_failed', status: 500 }
  }

  // Defensive privacy guard: never leak customer identities even if the SQL is
  // later edited incorrectly. Fail closed rather than return identifiers.
  const leaks = findIdentityFields(data)
  if (leaks.length > 0) {
    console.log('[v0] marketing audience payload identity guard tripped:', leaks.join(','))
    return { ok: false, error: 'query_failed', status: 500 }
  }

  return { ok: true, data: data as MarketingAudienceOverview }
}
