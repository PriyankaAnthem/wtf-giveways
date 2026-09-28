import 'server-only'

/* -------------------------------------------------------------------------- *
 * Host Dashboard data layer (Phase 3 + live patch — read-only, host-scoped).
 *
 * SECURITY MODEL
 *   The host is ALWAYS the authenticated user. This module never accepts a
 *   host_user_id from the caller/client — it derives identity from the session
 *   via getAdminContext(). A host therefore cannot request another host's
 *   assignments, commission, earnings or campaign list by tampering with a URL.
 *   Only 'admin' and 'ops' (Host) roles are allowed; everyone else gets null.
 *
 * PERFORMANCE MODEL (no N+1, no full admin RPC)
 *   A small FIXED set of host-scoped, set-based reads, independent of campaign
 *   count N:
 *     1. campaign_hosts .............. this host's rows only (ids + commission)
 *     2. campaigns ................... bounded PK lookup (title/status/cap)
 *     3. reporting_sales_daily ....... THIS host's ids, this WHOLE UK month
 *                                      (previous days + today, one row/day)
 *     4. giveaway_ticket_counters .... THIS host's ids (one tiny int each)
 *     5. reporting_meta .............. one keyed row (freshness)
 *   Queries 2–5 run in parallel. No per-campaign loop, no raw checkout/entry
 *   scan, no unbounded lifetime reporting history, no Auth Admin lookups.
 *
 * FRESHNESS MODEL (daily-only — why NOT minute)
 *   Current-month external cash is read entirely from reporting_sales_daily,
 *   including TODAY. This is safe for a live host screen because the refresh
 *   cron runs every minute (vercel.json: "* * * * *") and
 *   refresh_sales_reporting FULLY REBUILDS today's daily rows from the minute
 *   rollup on every run — so today's daily figure is at most ~1 minute stale,
 *   exactly as fresh as the minute rollup (both are written in the same refresh
 *   transaction; the minute table is never newer than daily). Reading daily
 *   instead of every minute row since midnight avoids an ever-growing full-day
 *   transfer as the day progresses, with no loss of freshness. Today's own
 *   figure is derived from the single today-dated daily row, so month and today
 *   come from ONE source and today can never be double-counted.
 *
 * MONEY MODEL (unchanged)
 *   Commission is based ONLY on external cash (external_pence). Wallet/site
 *   credit contributes £0. All maths stays in integer pence and is divided by
 *   100 only at the display boundary in the UI.
 * -------------------------------------------------------------------------- */

import { getAdminContext } from '@/lib/admin/auth'
import { getServiceSupabase } from '@/lib/admin/live-board'
import type {
  HostCampaignSummary,
  HostDashboardPayload,
  HostPastMonth,
} from '@/lib/admin/host-dashboard-types'

export type GetHostDashboardResult =
  | { ok: true; data: HostDashboardPayload }
  | { ok: false; error: 'unauthorized' | 'service_unavailable' | 'query_failed' }

/** Derive a friendly greeting name from an email/label (no PII beyond own account). */
function friendlyName(email: string | null | undefined): string {
  if (!email) return 'there'
  const local = email.split('@')[0] ?? ''
  const first = local.split(/[.\-_+]/)[0] ?? local
  if (!first) return 'there'
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/** Integer-pence commission: external cash × pct / 100, rounded to whole pence. */
function earningsPence(externalPence: number, commissionPct: number): number {
  if (!Number.isFinite(externalPence) || externalPence <= 0) return 0
  if (!Number.isFinite(commissionPct) || commissionPct <= 0) return 0
  return Math.round((externalPence * commissionPct) / 100)
}

/* --------------------------- UK time boundaries --------------------------- *
 * reporting_sales_daily.bucket_date stores UK calendar dates; the admin RPC
 * defines 'this_month' as date_trunc('month', today) in Europe/London. So the
 * month/day boundaries MUST be computed in UK local time (correct under BST and
 * GMT), never the server's UTC midnight.
 * -------------------------------------------------------------------------- */

/** Europe/London Y-M-D parts for an instant. */
function ukDateParts(now: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return { year, month, day }
}

/** First day of the current UK month, as 'YYYY-MM-01' (for reporting_sales_daily). */
function ukMonthStartDate(now: Date): string {
  const { year, month } = ukDateParts(now)
  return `${year}-${month}-01`
}

/** Today's UK calendar date, as 'YYYY-MM-DD' (to pick out today's daily row). */
function ukTodayDate(now: Date): string {
  const { year, month, day } = ukDateParts(now)
  return `${year}-${month}-${day}`
}

/**
 * Build the Host Dashboard payload for the AUTHENTICATED host.
 *
 * Returns an `unauthorized` result for non-admin/non-host sessions. Hosts with
 * no assignments get an ok result with an empty campaign list (useful empty
 * state), never an error.
 */
export async function getHostDashboard(): Promise<GetHostDashboardResult> {
  // 1) Identity + role strictly from the session.
  const ctx = await getAdminContext()
  if (!ctx || (ctx.role !== 'ops' && ctx.role !== 'admin')) {
    return { ok: false, error: 'unauthorized' }
  }
  const hostUserId = ctx.user.id
  const hostName = friendlyName(ctx.user.email)

  let svc
  try {
    svc = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable' }
  }

  // 2) This host's assignments (bounded to their own rows).
  const { data: assignmentRows, error: assignErr } = await svc
    .from('campaign_hosts')
    .select('campaign_id, commission_pct')
    .eq('host_user_id', hostUserId)

  if (assignErr) {
    console.log('[v0] host-dashboard assignments error:', assignErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const commissionByCampaign = new Map<string, number>()
  for (const row of assignmentRows ?? []) {
    const id = row.campaign_id as string
    const pct = Number(row.commission_pct)
    if (id && Number.isFinite(pct)) commissionByCampaign.set(id, pct)
  }

  const now = new Date()
  const generatedAt = now.toISOString()

  // No assignments → useful empty state (no further queries).
  if (commissionByCampaign.size === 0) {
    return {
      ok: true,
      data: {
        hostName,
        month: { label: 'This month', hostedCashPence: 0, estimatedEarningsPence: 0 },
        campaigns: [],
        meta: { lastRefreshAt: null, generatedAt },
      },
    }
  }

  const campaignIds = [...commissionByCampaign.keys()]
  const monthStart = ukMonthStartDate(now)
  const todayDate = ukTodayDate(now)

  // 3–5) All host-scoped and bounded by campaignIds — run in parallel.
  //   - campaigns: authoritative title/status/cap (also surfaces zero-sales
  //     campaigns that would be absent from the reporting rollups).
  //   - reporting_sales_daily: the WHOLE current UK month INCLUDING today
  //     (bucket_date >= monthStart). One row per day×provider — bounded and
  //     constant through the day. Today's daily row is rebuilt every minute by
  //     the refresh cron, so it is ~1 minute fresh (see FRESHNESS MODEL above).
  //     Uses the (campaign_id, bucket_date) index.
  //   - giveaway_ticket_counters: one tiny row per campaign for ticket progress.
  //   - reporting_meta: single keyed row for freshness.
  const [
    { data: campaignRows, error: campaignErr },
    { data: dailyRows, error: dailyErr },
    { data: counterRows, error: counterErr },
    { data: metaRow, error: metaErr },
  ] = await Promise.all([
    svc.from('campaigns').select('id, title, status, max_tickets_total').in('id', campaignIds),
    svc
      .from('reporting_sales_daily')
      .select('campaign_id, external_pence, bucket_date')
      .in('campaign_id', campaignIds)
      .gte('bucket_date', monthStart),
    svc.from('giveaway_ticket_counters').select('giveaway_id, next_ticket').in('giveaway_id', campaignIds),
    svc.from('reporting_meta').select('value').eq('key', 'last_refresh').maybeSingle(),
  ])

  if (campaignErr) {
    console.log('[v0] host-dashboard campaigns error:', campaignErr.message)
    return { ok: false, error: 'query_failed' }
  }
  if (dailyErr) {
    console.log('[v0] host-dashboard daily error:', dailyErr.message)
    return { ok: false, error: 'query_failed' }
  }
  if (counterErr) {
    console.log('[v0] host-dashboard counter error:', counterErr.message)
    return { ok: false, error: 'query_failed' }
  }
  // reporting_meta is non-critical: a freshness lookup failure must not 500 the
  // whole dashboard — we simply show no "updated" label.
  if (metaErr) {
    console.log('[v0] host-dashboard meta (non-fatal) error:', metaErr.message)
  }

  // Split the single daily result into month-so-far and today per campaign.
  // Both come from ONE source (reporting_sales_daily), so today (the row dated
  // todayDate) is a strict subset of the month total — it can never be
  // double-counted. Today's row is rebuilt every minute by the refresh cron.
  const monthByCampaign = new Map<string, number>()
  const todayByCampaign = new Map<string, number>()
  for (const row of dailyRows ?? []) {
    const id = row.campaign_id as string
    if (!id) continue
    const ext = Math.max(0, Number(row.external_pence ?? 0) || 0)
    monthByCampaign.set(id, (monthByCampaign.get(id) ?? 0) + ext)
    if (String(row.bucket_date) === todayDate) {
      todayByCampaign.set(id, (todayByCampaign.get(id) ?? 0) + ext)
    }
  }

  // Tickets sold per campaign from the counter (next_ticket - 1, floored at 0).
  const ticketsSoldByCampaign = new Map<string, number>()
  for (const row of counterRows ?? []) {
    const id = row.giveaway_id as string
    if (!id) continue
    const sold = Math.max(0, (Number(row.next_ticket ?? 1) || 1) - 1)
    ticketsSoldByCampaign.set(id, sold)
  }

  const lastRefreshAt =
    (metaRow?.value as { refreshed_at?: string } | null | undefined)?.refreshed_at ?? null

  // 7) Merge into host-scoped, costed summaries.
  const campaigns: HostCampaignSummary[] = []
  let hostedCashPence = 0
  let estimatedEarningsPence = 0

  for (const meta of campaignRows ?? []) {
    const campaignId = meta.id as string
    const commissionPct = commissionByCampaign.get(campaignId) ?? 0

    const externalPenceToday = Math.max(0, todayByCampaign.get(campaignId) ?? 0)
    // Current month so far, read directly from the daily rollup (includes today).
    const externalPenceMonth = Math.max(0, monthByCampaign.get(campaignId) ?? 0)
    const earnings = earningsPence(externalPenceMonth, commissionPct)

    const status = String(meta.status ?? 'unknown')
    const maxTicketsTotal =
      meta.max_tickets_total != null && Number.isFinite(Number(meta.max_tickets_total))
        ? Number(meta.max_tickets_total)
        : null

    // Lifetime tickets from the counter (matches the public progress bar).
    const ticketsSold = ticketsSoldByCampaign.get(campaignId) ?? 0
    const ticketsRemaining =
      maxTicketsTotal && maxTicketsTotal > 0 ? Math.max(0, maxTicketsTotal - ticketsSold) : null
    const pctSold =
      maxTicketsTotal && maxTicketsTotal > 0
        ? Math.round((ticketsSold / maxTicketsTotal) * 1000) / 10
        : null

    campaigns.push({
      campaignId,
      title: String(meta.title ?? '(untitled competition)'),
      status,
      isActive: status === 'live' || status === 'paused',
      isEnded: status === 'ended',
      commissionPct,
      externalPenceMonth,
      externalPenceToday,
      earningsPenceMonth: earnings,
      ticketsSold,
      ticketsRemaining,
      pctSold,
      maxTicketsTotal,
    })

    // Each campaign contributes ONCE to this host's totals. Revenue is NOT
    // divided across joint hosts — every host sees the full campaign cash and
    // their own commission slice.
    hostedCashPence += externalPenceMonth
    estimatedEarningsPence += earnings
  }

  // Stable, useful ordering: active first, then by external cash desc, then title.
  campaigns.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (b.externalPenceMonth !== a.externalPenceMonth) return b.externalPenceMonth - a.externalPenceMonth
    return a.title.localeCompare(b.title)
  })

  return {
    ok: true,
    data: {
      hostName,
      month: { label: 'This month', hostedCashPence, estimatedEarningsPence },
      campaigns,
      meta: { lastRefreshAt, generatedAt },
    },
  }
}

export type GetHostPastEarningsResult =
  | { ok: true; data: HostPastMonth[] }
  | { ok: false; error: 'unauthorized' | 'service_unavailable' | 'query_failed' }

/** How many previous UK months of history to surface (bounded, not eager). */
const PAST_MONTHS_WINDOW = 6

/** 'YYYY-MM-01' for the month that is `back` months before the given UK month. */
function ukMonthStartMonthsAgo(now: Date, back: number): string {
  const { year, month } = ukDateParts(now)
  // First-of-month arithmetic only (no time/DST edge); UTC is safe here.
  const d = new Date(Date.UTC(Number(year), Number(month) - 1 - back, 1))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/** Human month label from a 'YYYY-MM' key, e.g. "July 2026". */
function monthLabelFromKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return monthKey
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/**
 * Previous UK months of ESTIMATED host earnings for the AUTHENTICATED host.
 *
 * SECURITY: identical model to getHostDashboard — identity from the session,
 * never a client-supplied id; only the host's own campaigns are read.
 *
 * PERFORMANCE: a SINGLE bounded reporting_sales_daily read for the host's
 * campaigns over the last PAST_MONTHS_WINDOW months, EXCLUDING the current month
 * (that lives on the live dashboard). No per-campaign query, no per-month query,
 * no raw checkout/entry scan, no Auth Admin lookups.
 *
 * COMMISSION HISTORY CAVEAT: earnings are computed per-campaign using that
 * campaign's CURRENT commission_pct (campaign_hosts stores only the current
 * value; there is no commission-history/audit table). Because a WTF campaign is
 * a single event with one host arrangement from creation to completion, this is
 * accurate in practice — but if an admin later edits a campaign's rate, this
 * recomputes past months at the new rate. Values are therefore labelled
 * ESTIMATED. A payout ledger (see recommendation) would make history immutable.
 */
export async function getHostPastEarnings(): Promise<GetHostPastEarningsResult> {
  const ctx = await getAdminContext()
  if (!ctx || (ctx.role !== 'ops' && ctx.role !== 'admin')) {
    return { ok: false, error: 'unauthorized' }
  }
  const hostUserId = ctx.user.id

  let svc
  try {
    svc = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable' }
  }

  const { data: assignmentRows, error: assignErr } = await svc
    .from('campaign_hosts')
    .select('campaign_id, commission_pct')
    .eq('host_user_id', hostUserId)

  if (assignErr) {
    console.log('[v0] host-past-earnings assignments error:', assignErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const commissionByCampaign = new Map<string, number>()
  for (const row of assignmentRows ?? []) {
    const id = row.campaign_id as string
    const pct = Number(row.commission_pct)
    if (id && Number.isFinite(pct)) commissionByCampaign.set(id, pct)
  }
  if (commissionByCampaign.size === 0) return { ok: true, data: [] }

  const campaignIds = [...commissionByCampaign.keys()]
  const now = new Date()
  const currentMonthStart = ukMonthStartDate(now)
  const windowStart = ukMonthStartMonthsAgo(now, PAST_MONTHS_WINDOW)

  // Single bounded read: host's campaigns, previous months only (< this month).
  const { data: dailyRows, error: dailyErr } = await svc
    .from('reporting_sales_daily')
    .select('campaign_id, external_pence, bucket_date')
    .in('campaign_id', campaignIds)
    .gte('bucket_date', windowStart)
    .lt('bucket_date', currentMonthStart)

  if (dailyErr) {
    console.log('[v0] host-past-earnings daily error:', dailyErr.message)
    return { ok: false, error: 'query_failed' }
  }

  // Group external cash per (month, campaign) so per-campaign rates apply.
  const perMonthPerCampaign = new Map<string, Map<string, number>>()
  for (const row of dailyRows ?? []) {
    const campaignId = row.campaign_id as string
    const bucketDate = String(row.bucket_date ?? '')
    if (!campaignId || bucketDate.length < 7) continue
    const monthKey = bucketDate.slice(0, 7) // 'YYYY-MM'
    const ext = Math.max(0, Number(row.external_pence ?? 0) || 0)
    if (ext === 0) continue
    let byCampaign = perMonthPerCampaign.get(monthKey)
    if (!byCampaign) {
      byCampaign = new Map<string, number>()
      perMonthPerCampaign.set(monthKey, byCampaign)
    }
    byCampaign.set(campaignId, (byCampaign.get(campaignId) ?? 0) + ext)
  }

  const months: HostPastMonth[] = []
  for (const [monthKey, byCampaign] of perMonthPerCampaign) {
    let hostedCashPence = 0
    let estimatedEarningsPence = 0
    for (const [campaignId, ext] of byCampaign) {
      const pct = commissionByCampaign.get(campaignId) ?? 0
      hostedCashPence += ext
      estimatedEarningsPence += earningsPence(ext, pct)
    }
    if (hostedCashPence > 0) {
      months.push({ monthKey, label: monthLabelFromKey(monthKey), hostedCashPence, estimatedEarningsPence })
    }
  }

  // Most recent month first.
  months.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0))

  return { ok: true, data: months }
}
