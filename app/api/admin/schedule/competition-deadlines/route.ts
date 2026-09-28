import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isCalendarDate } from '@/lib/types/schedule'
import { classifyGiveaway } from '@/lib/giveaway-classification'
import {
  compareDeadlines,
  deriveDeadlineMetrics,
  londonParts,
  type CompetitionDeadline,
} from '@/lib/types/competition-deadline'

/**
 * Read-only competition deadline overlay (Layer B of the Sales Calendar).
 *
 * ISOLATION: reads ONLY `campaigns` (+ a single bulk `giveaway_snapshots` read
 * for precomputed ticket counts). It NEVER touches admin_schedule_events, never
 * writes anything, never inserts a synthetic marker into the Schedule, and never
 * alters campaign dates or status. Every marker it returns is generated at
 * request time.
 *
 * PERFORMANCE: at most TWO bounded, set-based queries regardless of how many
 * campaigns match - one `campaigns` range query and one bulk `in(...)` snapshot
 * lookup. No per-campaign query, no N+1, no payment/order/entry aggregation.
 */

// campaigns is readable via anon RLS, but we mirror the Schedule convention and
// use the service-role client after admin authorization for a consistent,
// policy-independent read.
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const ALLOWED_ROLES = ['admin', 'operations_admin'] as const
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } } as const

// Same bounded-range philosophy as the manual Schedule API.
const MAX_RANGE_DAYS = 70

const CAMPAIGN_COLUMNS =
  'id, slug, title, status, presentation_type, end_at, ticket_price_pence, max_tickets_total'

function authStatus(authError: string | null): number {
  return authError === 'Not authenticated' ? 401 : 403
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

function toNumberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * GET /api/admin/schedule/competition-deadlines?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns synthetic, read-only deadline markers for LIVE, non-TikTok campaigns
 * whose Europe/London closing date falls inside the requested (bounded) range.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: [...ALLOWED_ROLES] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authStatus(authError), ...NO_STORE },
    )
  }

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return NextResponse.json({ ok: false, error: 'invalid_range' }, { status: 400, ...NO_STORE })
  }
  const span = daysBetween(from, to)
  if (span < 0) {
    return NextResponse.json({ ok: false, error: 'invalid_range' }, { status: 400, ...NO_STORE })
  }
  if (span > MAX_RANGE_DAYS) {
    return NextResponse.json({ ok: false, error: 'range_too_large' }, { status: 400, ...NO_STORE })
  }

  // Query `end_at` on a UTC window padded by a day on each side. London is only
  // ever UTC or UTC+1, so a +/-1 day pad guarantees we fetch every instant that
  // could map to a London calendar date inside [from, to]; the precise London
  // membership test happens in JS below.
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const fromBufferIso = new Date(Date.UTC(fy, fm - 1, fd - 1)).toISOString()
  const toBufferIso = new Date(Date.UTC(ty, tm - 1, td + 2)).toISOString()

  // A campaign can briefly stay status = 'live' after its end_at has passed,
  // while the draw/status worker catches up. Mirror the public "live" rule and
  // require the closing instant to still be in the future, compared as a real
  // timestamptz instant (NOT a formatted London string). This lower bound is
  // applied in the DB query below alongside the padded window; when the visible
  // range is in the future it is a no-op, and when it spans now it trims the
  // already-closed campaigns.
  const nowIso = new Date().toISOString()

  const svc = getServiceSupabase()

  // Query 1: only LIVE campaigns with a real, still-future end_at inside the
  // padded window. Filtering status = 'live' at the DB excludes draft/paused/
  // ended/sold_out/closed outright, so a sold-out campaign's stale future
  // end_at can never surface here; the end_at > now() bound additionally
  // excludes an expired competition whose status worker has not run yet.
  const { data: rows, error } = await svc
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('status', 'live')
    .not('end_at', 'is', null)
    .gt('end_at', nowIso)
    .gte('end_at', fromBufferIso)
    .lte('end_at', toBufferIso)

  if (error) {
    console.error('[admin/schedule/competition-deadlines] campaigns query error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500, ...NO_STORE })
  }

  type Pending = {
    deadline: CompetitionDeadline
    pricePence: number | null
    maxTickets: number | null
  }
  const pending: Pending[] = []

  for (const row of rows ?? []) {
    const r = row as Record<string, unknown>

    // Reuse the canonical classifier verbatim. TikTok/Balloon stays MANUAL.
    const classification = classifyGiveaway({
      slug: r.slug,
      presentation_type: r.presentation_type,
    })
    if (classification === 'live_balloon') continue

    const parts = londonParts(r.end_at as string)
    if (!parts) continue
    // Precise Europe/London membership (the DB window was intentionally padded).
    if (parts.date < from || parts.date > to) continue

    const pricePence = toNumberOrNull(r.ticket_price_pence)
    const maxTickets = toNumberOrNull(r.max_tickets_total)

    pending.push({
      pricePence,
      maxTickets,
      deadline: {
        source: 'campaign',
        campaignId: String(r.id),
        slug: (r.slug as string) ?? '',
        title: (r.title as string) ?? 'Untitled competition',
        classification,
        endDate: parts.date,
        endTime: parts.time,
        endAt: String(r.end_at),
        ticketPricePence: pricePence,
        maxTickets,
        ticketsSold: null,
        ticketsRemaining: null,
        percentSold: null,
        potentialRemainingPence: null,
        adminUrl: `/admin/campaigns/${String(r.id)}`,
      },
    })
  }

  // Query 2 (only if there is anything to enrich): a SINGLE bulk lookup of the
  // precomputed `tickets_sold` from each campaign's `list` snapshot. This is one
  // set-based `in(...)` request, not a per-campaign query. If it fails we still
  // return the deadlines - the commercial metrics just degrade to omitted.
  if (pending.length > 0) {
    const ids = pending.map((p) => p.deadline.campaignId)
    const { data: snaps, error: snapErr } = await svc
      .from('giveaway_snapshots')
      .select('giveaway_id, payload')
      .eq('kind', 'list')
      .in('giveaway_id', ids)

    if (snapErr) {
      console.error(
        '[admin/schedule/competition-deadlines] snapshot enrich failed (non-fatal):',
        snapErr.message,
      )
    } else {
      const soldById = new Map<string, number>()
      for (const s of snaps ?? []) {
        const sold = toNumberOrNull((s as any).payload?.tickets_sold)
        if (sold != null) soldById.set(String((s as any).giveaway_id), sold)
      }

      for (const p of pending) {
        const sold = soldById.get(p.deadline.campaignId)
        if (sold == null) continue
        const metrics = deriveDeadlineMetrics({
          ticketsSold: sold,
          maxTickets: p.maxTickets,
          ticketPricePence: p.pricePence,
        })
        p.deadline.ticketsSold = metrics.ticketsSold
        p.deadline.ticketsRemaining = metrics.ticketsRemaining
        p.deadline.percentSold = metrics.percentSold
        p.deadline.potentialRemainingPence = metrics.potentialRemainingPence
      }
    }
  }

  const items = pending.map((p) => p.deadline).sort(compareDeadlines)
  return NextResponse.json({ ok: true, items }, NO_STORE)
}
