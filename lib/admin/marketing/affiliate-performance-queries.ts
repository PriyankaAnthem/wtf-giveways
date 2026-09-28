import 'server-only'
import { getServiceSupabase } from '@/lib/admin/live-board'
import type { AdminRole } from '@/lib/admin/permissions'
import {
  normalizeAffiliatePerformance,
  parsePerformanceRange,
  type AffiliatePerformancePayload,
  type PerformanceRange,
} from '@/lib/admin/marketing/affiliate-performance'

/**
 * Server-only read for the Affiliate Performance RPC
 * (`get_affiliate_performance`).
 *
 * IMPORTANT: authorization MUST already have happened at the route/page layer
 * (admin + operations_admin) before this is called. The service-role client
 * (which bypasses forced RLS) is constructed here ONLY to run the RPC, which is
 * itself executable only by service_role. This function is strictly READ-ONLY.
 *
 * Like `get_marketing_performance`, the RPC reads channel/source/campaign/link
 * from the FROZEN checkout snapshot — never the live tracking_links table — so
 * this lib simply forwards a validated range/window (+ optional affiliate uuid)
 * and normalises the compact payload. Commission/revenue/voucher maths are done
 * in SQL; we never recompute them here.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface AffiliatePerformanceFilters {
  range: PerformanceRange
  from: string | null
  to: string | null
  /** null = leaderboard mode; a uuid = single-affiliate detail mode. */
  affiliate: string | null
}

export type FetchAffiliatePerformanceResult =
  | { ok: true; data: AffiliatePerformancePayload; filters: AffiliatePerformanceFilters }
  | { ok: false; error: string; status: number }

export class AffiliatePerformanceFilterError extends Error {}

/**
 * Parse untrusted query params into a safe filter object. Only supported ranges
 * reach the RPC; a custom range requires two valid ISO dates, from <= to, and a
 * window no larger than the RPC's 366-day cap. `affiliate`, when present, MUST
 * be a valid uuid (a malformed value is a client error, not a silent
 * leaderboard fallback) so the route can return 400.
 */
export function parseAffiliatePerformanceFilters(
  params: URLSearchParams,
): AffiliatePerformanceFilters {
  const range = parsePerformanceRange(params.get('range'))

  const affiliateRaw = (params.get('affiliate') ?? '').trim()
  let affiliate: string | null = null
  if (affiliateRaw.length > 0) {
    if (!UUID.test(affiliateRaw)) {
      throw new AffiliatePerformanceFilterError('invalid affiliate id')
    }
    affiliate = affiliateRaw
  }

  if (range !== 'custom') {
    return { range, from: null, to: null, affiliate }
  }

  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new AffiliatePerformanceFilterError('custom range requires from and to (yyyy-mm-dd)')
  }
  if (to < from) {
    throw new AffiliatePerformanceFilterError('to must be on or after from')
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (!Number.isFinite(days) || days > 366) {
    throw new AffiliatePerformanceFilterError('custom range too large (max 366 days)')
  }
  return { range, from, to, affiliate }
}

function toRpcArgs(filters: AffiliatePerformanceFilters) {
  return {
    p_range: filters.range,
    p_from: filters.from,
    p_to: filters.to,
    p_affiliate: filters.affiliate,
  }
}

/**
 * Fetch and normalise the Affiliate Performance payload for a validated filter
 * state. Returns the fully-normalised, defensively-typed payload (safe
 * zeros/empties rather than undefined) so the UI never guards against missing
 * branches.
 */
export async function fetchAffiliatePerformance(
  role: AdminRole | null,
  params: URLSearchParams,
): Promise<FetchAffiliatePerformanceResult> {
  if (!role) {
    return { ok: false, error: 'unauthorized', status: 401 }
  }

  let filters: AffiliatePerformanceFilters
  try {
    filters = parseAffiliatePerformanceFilters(params)
  } catch (e) {
    const message =
      e instanceof AffiliatePerformanceFilterError ? e.message : 'invalid_filters'
    return { ok: false, error: message, status: 400 }
  }

  let supabase
  try {
    supabase = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable', status: 500 }
  }

  const { data, error } = await supabase.rpc('get_affiliate_performance', toRpcArgs(filters))

  if (error) {
    // Log server-side for diagnostics; never leak the raw DB message to the client.
    console.error('[affiliate-performance] get_affiliate_performance failed:', error.message)
    return { ok: false, error: 'query_failed', status: 500 }
  }
  if (!data) {
    return { ok: false, error: 'no_data', status: 500 }
  }

  return { ok: true, data: normalizeAffiliatePerformance(data), filters }
}
