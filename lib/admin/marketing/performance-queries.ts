import 'server-only'
import { getServiceSupabase } from '@/lib/admin/live-board'
import type { AdminRole } from '@/lib/admin/permissions'
import {
  normalizePerformance,
  parsePerformanceRange,
  type PerformancePayload,
  type PerformanceRange,
} from '@/lib/admin/marketing/performance'

/**
 * Server-only read for the Marketing Performance RPC.
 *
 * IMPORTANT: authorization MUST already have happened at the route/page layer
 * (admin + operations_admin) before this is called. The service-role client
 * (which bypasses forced RLS) is constructed here ONLY to run
 * `get_marketing_performance`, which is itself executable only by service_role.
 * This function is strictly READ-ONLY: it never writes, enqueues, or mutates.
 *
 * The RPC is DECOUPLED from the live tracking_links table on purpose — channel/
 * source/campaign are read only from the frozen checkout snapshot — so this lib
 * simply forwards a validated range/window and normalises the compact payload.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface PerformanceFilters {
  range: PerformanceRange
  from: string | null
  to: string | null
  channel: string | null
}

export type FetchPerformanceResult =
  | { ok: true; data: PerformancePayload; filters: PerformanceFilters }
  | { ok: false; error: string; status: number }

export class PerformanceFilterError extends Error {}

/**
 * Parse untrusted query params into a safe filter object. Only supported ranges
 * can reach the RPC; a custom range requires two valid ISO dates, from <= to,
 * and a window no larger than the RPC's own 366-day cap. Channel is passed
 * through as an optional canonical-slug drill filter.
 */
export function parsePerformanceFilters(params: URLSearchParams): PerformanceFilters {
  const range = parsePerformanceRange(params.get('range'))
  const channelRaw = (params.get('channel') ?? '').trim()
  const channel = channelRaw.length > 0 ? channelRaw : null

  if (range !== 'custom') {
    return { range, from: null, to: null, channel }
  }

  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new PerformanceFilterError('custom range requires from and to (yyyy-mm-dd)')
  }
  if (to < from) {
    throw new PerformanceFilterError('to must be on or after from')
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (!Number.isFinite(days) || days > 366) {
    throw new PerformanceFilterError('custom range too large (max 366 days)')
  }
  return { range, from, to, channel }
}

function toRpcArgs(filters: PerformanceFilters) {
  return {
    p_range: filters.range,
    p_from: filters.from,
    p_to: filters.to,
    p_channel: filters.channel,
  }
}

/**
 * Fetch and normalise the Performance payload for a validated filter state.
 * Returns the fully-normalised, defensively-typed payload (safe zeros/empties
 * rather than undefined) so the UI never has to guard against missing branches.
 */
export async function fetchMarketingPerformance(
  role: AdminRole | null,
  params: URLSearchParams,
): Promise<FetchPerformanceResult> {
  if (!role) {
    return { ok: false, error: 'unauthorized', status: 401 }
  }

  let filters: PerformanceFilters
  try {
    filters = parsePerformanceFilters(params)
  } catch (e) {
    const message = e instanceof PerformanceFilterError ? e.message : 'invalid_filters'
    return { ok: false, error: message, status: 400 }
  }

  let supabase
  try {
    supabase = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable', status: 500 }
  }

  const { data, error } = await supabase.rpc('get_marketing_performance', toRpcArgs(filters))

  if (error) {
    // Log server-side for diagnostics; never leak the raw DB message to the client.
    console.error('[marketing-performance] get_marketing_performance failed:', error.message)
    return { ok: false, error: 'query_failed', status: 500 }
  }
  if (!data) {
    return { ok: false, error: 'no_data', status: 500 }
  }

  return { ok: true, data: normalizePerformance(data), filters }
}
