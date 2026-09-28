import 'server-only'
import { getServiceSupabase } from '@/lib/admin/live-board'
import {
  normalizeAnalytics,
  parsePeriodDays,
  type MarketingAnalyticsPayload,
} from '@/lib/admin/marketing/analytics'

/**
 * Server-only read for the marketing commercial analytics RPC.
 *
 * IMPORTANT: authorization MUST already have happened at the route/page layer
 * before this is called. The service-role client (which bypasses forced RLS)
 * is constructed here ONLY to run `get_marketing_admin_analytics`, which is
 * itself executable only by service_role. This function is strictly READ-ONLY:
 * it never sends, enqueues, claims, creates a run, or mutates any table.
 */

export type FetchMarketingAnalyticsResult =
  | { ok: true; data: MarketingAnalyticsPayload }
  | { ok: false; error: string; status: number }

/**
 * Fetch and normalise the analytics payload for a supported period.
 *
 * `days` is passed through `parsePeriodDays`, so only 1 / 7 / 30 can ever reach
 * the RPC (anything else falls back to the default 7). The result is always the
 * fully-normalised, defensively-typed payload — safe zeros/empties rather than
 * undefined — so the UI never has to guard against missing branches.
 */
export async function fetchMarketingAnalytics(
  days: number,
): Promise<FetchMarketingAnalyticsResult> {
  const p_days = parsePeriodDays(days)

  let supabase
  try {
    supabase = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable', status: 500 }
  }

  const { data, error } = await supabase.rpc('get_marketing_admin_analytics', { p_days })

  if (error) {
    // Log server-side for diagnostics; never leak the raw DB message to the client.
    console.error('[marketing-analytics] get_marketing_admin_analytics failed:', error.message)
    return { ok: false, error: 'query_failed', status: 500 }
  }
  if (!data) {
    return { ok: false, error: 'no_data', status: 500 }
  }

  return { ok: true, data: normalizeAnalytics(data) }
}
