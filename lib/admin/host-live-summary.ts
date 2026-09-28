import 'server-only'

/* -------------------------------------------------------------------------- *
 * Host Live Feed — compact performance summary (read-only, host-scoped).
 *
 * WHAT
 *   Three numbers shown directly above the winner feed while a host runs a
 *   TikTok live: Revenue Today, Instants Today, and Comp Total — for either a
 *   single assigned campaign or (when no filter) ALL of the host's assigned
 *   campaigns aggregated.
 *
 * SECURITY MODEL (identical to getHostLiveFeed)
 *   Identity is ALWAYS the authenticated session user (getAdminContext); this
 *   module never accepts a host_user_id from the caller. The optional campaign
 *   filter is clamped server-side to the host's campaign_hosts rows: an
 *   unassigned id resolves to an EMPTY selection (all-zero summary), never
 *   another host's figures and never all-company data.
 *
 * MONEY MODEL
 *   Revenue is external cash ONLY (external_pence). Site/wallet credit
 *   (credit_pence) is never read. All maths stays in integer pence; the UI
 *   divides by 100 only at the display boundary.
 *
 * PERFORMANCE MODEL (no N+1, no raw scans, no admin RPC)
 *   A small FIXED set of set-based queries, independent of campaign count:
 *     1. campaign_hosts ......... this host's assigned ids
 *     2. reporting_sales_daily .. external_pence + bucket_date for the selection
 *        (existing ~1-minute rollup) → sum lifetime = Comp Total, sum today =
 *        Revenue Today. ONE query yields both; no raw checkout/entry/order scan.
 *     3. instant_win_prizes ..... prize ids for the selection
 *     4. instant_win_awards ..... HEAD count-only where awarded today (true
 *        count, not limited to the 30 displayed feed rows)
 *   Queries 2 and (3→4) run in parallel. Never one query per campaign.
 * -------------------------------------------------------------------------- */

import { getAdminContext } from '@/lib/admin/auth'
import { getServiceSupabase } from '@/lib/admin/live-board'
import type { HostLiveSummary } from '@/lib/admin/host-live-feed-types'

export type GetHostLiveSummaryResult =
  | { ok: true; data: HostLiveSummary }
  | { ok: false; error: 'unauthorized' | 'service_unavailable' | 'query_failed' }

/* --------------------------- UK time boundaries --------------------------- *
 * reporting_sales_daily.bucket_date stores UK calendar dates, and awarded_at is
 * a timestamptz. Both "today" boundaries must be computed in Europe/London
 * (correct under GMT and BST), never the server's UTC midnight.
 * -------------------------------------------------------------------------- */

/** Europe/London Y-M-D parts for an instant. */
function ukDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970')
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '01')
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '01')
  return { year, month, day }
}

/** Today's UK calendar date as 'YYYY-MM-DD' (to match daily bucket_date rows). */
function ukTodayDate(now: Date): string {
  const { year, month, day } = ukDateParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Offset (ms) of a timezone at a given UTC instant: localWallClockAsUTC - utc. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(utcMs))) map[p.type] = p.value
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return asUTC - utcMs
}

/**
 * UTC instant (ISO) of the START of today's UK calendar day, for filtering the
 * timestamptz awarded_at. UK midnight is never inside a DST transition
 * (transitions occur at 01:00/02:00), so it is unambiguous.
 */
function ukTodayStartUtcISO(now: Date): string {
  const { year, month, day } = ukDateParts(now)
  const guessUtc = Date.UTC(year, month - 1, day, 0, 0, 0)
  const offset = tzOffsetMs(guessUtc, 'Europe/London')
  return new Date(guessUtc - offset).toISOString()
}

export async function getHostLiveSummary(opts?: {
  campaignId?: string | null
}): Promise<GetHostLiveSummaryResult> {
  // 1) Identity + role strictly from the session.
  const ctx = await getAdminContext()
  if (!ctx || (ctx.role !== 'ops' && ctx.role !== 'admin' && ctx.role !== 'operations_admin')) {
    return { ok: false, error: 'unauthorized' }
  }
  const hostUserId = ctx.user.id

  let svc
  try {
    svc = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable' }
  }

  const now = new Date()
  const generatedAt = now.toISOString()

  // 2) This host's assignments (bounded to their own rows).
  const { data: assignmentRows, error: assignErr } = await svc
    .from('campaign_hosts')
    .select('campaign_id')
    .eq('host_user_id', hostUserId)

  if (assignErr) {
    console.log('[v0] host-live-summary assignments error:', assignErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const assignedIds = [
    ...new Set((assignmentRows ?? []).map((r) => r.campaign_id as string).filter(Boolean)),
  ]

  // Clamp the optional filter to the AUTHORISED set. An unassigned id (URL/param
  // tampering) yields an empty selection → all-zero summary, never a leak.
  const requested = opts?.campaignId?.trim() || null
  const effectiveIds = requested
    ? assignedIds.includes(requested)
      ? [requested]
      : []
    : assignedIds

  const emptySummary: HostLiveSummary = {
    campaignId: requested,
    revenueTodayPence: 0,
    instantsToday: 0,
    compTotalPence: 0,
    generatedAt,
  }

  if (effectiveIds.length === 0) {
    return { ok: true, data: emptySummary }
  }

  const todayDate = ukTodayDate(now)
  const todayStartUtc = ukTodayStartUtcISO(now)

  // 3) Run revenue (daily rollup) and instants (prizes → awards count) in parallel.
  const [revenue, instantsToday] = await Promise.all([
    computeRevenue(svc, effectiveIds, todayDate),
    computeInstantsToday(svc, effectiveIds, todayStartUtc),
  ])

  if (!revenue.ok) return { ok: false, error: 'query_failed' }
  if (!instantsToday.ok) return { ok: false, error: 'query_failed' }

  return {
    ok: true,
    data: {
      campaignId: requested,
      revenueTodayPence: revenue.today,
      compTotalPence: revenue.lifetime,
      instantsToday: instantsToday.count,
      generatedAt,
    },
  }
}

/**
 * ONE reporting_sales_daily read for the selection yields both figures:
 *   - Comp Total = Σ external_pence over ALL rows (lifetime)
 *   - Revenue Today = Σ external_pence over rows dated today (UK)
 * Uses the existing (campaign_id, bucket_date) rollup — no raw transaction scan.
 * Each campaign contributes once, so a joint campaign is never double-counted
 * within a single host's aggregate.
 */
async function computeRevenue(
  svc: ReturnType<typeof getServiceSupabase>,
  campaignIds: string[],
  todayDate: string,
): Promise<{ ok: true; today: number; lifetime: number } | { ok: false }> {
  const { data, error } = await svc
    .from('reporting_sales_daily')
    .select('external_pence, bucket_date')
    .in('campaign_id', campaignIds)

  if (error) {
    console.log('[v0] host-live-summary revenue error:', error.message)
    return { ok: false }
  }

  let today = 0
  let lifetime = 0
  for (const row of data ?? []) {
    const ext = Math.max(0, Number(row.external_pence ?? 0) || 0)
    lifetime += ext
    if (String(row.bucket_date) === todayDate) today += ext
  }
  return { ok: true, today, lifetime }
}

/**
 * True COUNT of instant prizes won today for the selection. Two bounded,
 * set-based queries: prizes for the selection, then a HEAD count of awards
 * since UK midnight. This is the real total (NOT limited to the 30 displayed
 * feed rows) and pulls no award rows.
 */
async function computeInstantsToday(
  svc: ReturnType<typeof getServiceSupabase>,
  campaignIds: string[],
  todayStartUtc: string,
): Promise<{ ok: true; count: number } | { ok: false }> {
  const { data: prizes, error: prizesErr } = await svc
    .from('instant_win_prizes')
    .select('id')
    .in('giveaway_id', campaignIds)

  if (prizesErr) {
    console.log('[v0] host-live-summary prizes error:', prizesErr.message)
    return { ok: false }
  }

  const prizeIds = [...new Set((prizes ?? []).map((p) => p.id as string).filter(Boolean))]
  if (prizeIds.length === 0) return { ok: true, count: 0 }

  const { count, error: awardsErr } = await svc
    .from('instant_win_awards')
    .select('prize_id', { count: 'exact', head: true })
    .in('prize_id', prizeIds)
    .gte('awarded_at', todayStartUtc)

  if (awardsErr) {
    console.log('[v0] host-live-summary awards count error:', awardsErr.message)
    return { ok: false }
  }

  return { ok: true, count: count ?? 0 }
}
