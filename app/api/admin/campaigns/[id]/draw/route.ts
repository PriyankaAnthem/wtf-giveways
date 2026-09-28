import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { normalizeEndDrawMode } from '@/lib/types/campaign'
import { refreshWinnerDownstream } from '@/lib/server/winner-draw-refresh'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache' } }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/campaigns/[id]/draw
 *
 * Admin-triggered MAIN/END-PRIZE draw for a campaign configured with
 * end_draw_mode = 'manual'. This is the manual counterpart to the automatic
 * cron worker, and both call the SAME algorithm: draw_campaign_winner().
 *
 * There is deliberately NO force/bypass parameter. This endpoint is allowed to
 * call the draw only because it first establishes that the campaign is manual
 * and already closed. The RPC remains the final idempotency authority, backed
 * by the unique partial index on winner_records (giveaway_id) WHERE placed = 1.
 *
 * Instant wins are untouched: this only ever creates a placed = 1 row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1) Admin-only, via the existing admin auth architecture.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { id: campaignId } = await params
  if (!campaignId || !UUID_RE.test(campaignId)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid campaign id' },
      { status: 400, ...NO_STORE },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/campaign-draw] Missing Supabase config')
    return NextResponse.json(
      { ok: false, error: 'Server configuration error' },
      { status: 500, ...NO_STORE },
    )
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    // 2) Campaign must exist.
    const { data: campaign, error: campaignErr } = await svc
      .from('campaigns')
      .select('id, slug, title, status, end_draw_mode')
      .eq('id', campaignId)
      .maybeSingle()

    if (campaignErr) {
      console.error('[admin/campaign-draw] campaign lookup failed:', campaignErr.message)
      return NextResponse.json(
        { ok: false, error: 'Failed to load campaign' },
        { status: 500, ...NO_STORE },
      )
    }

    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404, ...NO_STORE })
    }

    // 3) Must be a manual-draw campaign. An automatic campaign is drawn by the
    //    worker; drawing it here would bypass its configured behaviour.
    if (normalizeEndDrawMode(campaign.end_draw_mode) !== 'manual') {
      return NextResponse.json(
        {
          ok: false,
          error: 'This competition is set to Automatic Draw. Its winner is selected automatically.',
        },
        { status: 409, ...NO_STORE },
      )
    }

    // 4) Must already be closed. Drawing a live competition would end entries
    //    early and is never correct.
    if (campaign.status !== 'ended') {
      return NextResponse.json(
        {
          ok: false,
          error: 'This competition has not finished yet. It can only be drawn once it has ended.',
        },
        { status: 409, ...NO_STORE },
      )
    }

    // 5) Must have issued tickets. Indexed existence check, not a full scan.
    const { count: ticketCount, error: ticketErr } = await svc
      .from('ticket_allocations')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)

    if (ticketErr) {
      console.error('[admin/campaign-draw] ticket count failed:', ticketErr.message)
      return NextResponse.json(
        { ok: false, error: 'Failed to verify issued tickets' },
        { status: 500, ...NO_STORE },
      )
    }

    if (!ticketCount || ticketCount <= 0) {
      return NextResponse.json(
        { ok: false, error: 'This competition has no issued tickets, so no winner can be drawn.' },
        { status: 409, ...NO_STORE },
      )
    }

    // 6) Must not already have a main winner. Non-destructive: report the
    //    existing winner rather than attempting a second draw.
    const { data: existing, error: existingErr } = await svc
      .from('winner_records')
      .select('id, user_id, prize_title, announced_at')
      .eq('giveaway_id', campaignId)
      .eq('placed', 1)
      .maybeSingle()

    if (existingErr) {
      console.error('[admin/campaign-draw] winner lookup failed:', existingErr.message)
      return NextResponse.json(
        { ok: false, error: 'Failed to check for an existing winner' },
        { status: 500, ...NO_STORE },
      )
    }

    if (existing) {
      return NextResponse.json(
        {
          ok: true,
          alreadyDrawn: true,
          message: 'This competition already has an end-prize winner.',
          winner: existing,
        },
        NO_STORE,
      )
    }

    // 7) Draw, using the single authoritative algorithm.
    const { data: drawData, error: drawErr } = await svc.rpc('draw_campaign_winner', {
      p_campaign_id: campaignId,
    })

    // draw_campaign_winner RAISES on failure (SQLSTATE P0001) and only returns
    // jsonb on success, so a Postgres error is the normal failure channel.
    // Translate the known raised messages into a precise, actionable response;
    // anything unrecognised stays a 500.
    if (drawErr) {
      console.error('[admin/campaign-draw] draw rpc failed:', drawErr.message)

      const raised = (drawErr.message || '').toLowerCase()
      const KNOWN: Array<[string, string]> = [
        ['no_tickets_sold', 'This competition has no issued tickets, so no winner can be drawn.'],
        [
          'winner_allocation_not_found',
          'The drawn ticket could not be matched to an entry. No winner was recorded — please retry.',
        ],
        [
          'winner_entry_not_found',
          'The winning entry has no associated customer. No winner was recorded — please investigate this entry.',
        ],
        ['campaign_not_found', 'Campaign not found.'],
      ]

      const match = KNOWN.find(([code]) => raised.includes(code))
      if (match) {
        return NextResponse.json(
          { ok: false, error: match[1], reason: match[0] },
          { status: 409, ...NO_STORE },
        )
      }

      return NextResponse.json(
        { ok: false, error: 'The draw could not be completed. Please try again.' },
        { status: 500, ...NO_STORE },
      )
    }

    const draw = (drawData ?? {}) as {
      ok?: boolean
      already_drawn?: boolean
      error?: string
      winner_record_id?: string
      user_id?: string
      winning_ticket?: number
      total_tickets?: number
      prize_title?: string
    }

    // Defensive only: the function raises rather than returning ok = false, so
    // this should be unreachable. Kept so a future contract change cannot be
    // mistaken for a successful draw.
    if (!draw.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'The draw could not be completed.',
          reason: draw.error ?? 'unknown',
        },
        { status: 409, ...NO_STORE },
      )
    }

    // 8) Same downstream refresh as an automatic draw, so a manual winner shows
    //    up everywhere an automatic one does.
    const refreshErrors = await refreshWinnerDownstream(
      request.nextUrl.origin,
      process.env.CRON_SECRET,
      campaignId,
    )
    if (refreshErrors.length) {
      console.error('[admin/campaign-draw] refresh issues:', refreshErrors.join('; '))
    }

    console.log(
      '[admin/campaign-draw] drawn campaignId=', campaignId,
      'alreadyDrawn=', draw.already_drawn === true,
      'by=', user.id,
    )

    return NextResponse.json(
      {
        ok: true,
        alreadyDrawn: draw.already_drawn === true,
        message:
          draw.already_drawn === true
            ? 'This competition already has an end-prize winner.'
            : 'End-prize winner selected.',
        winner: {
          id: draw.winner_record_id ?? null,
          user_id: draw.user_id ?? null,
          prize_title: draw.prize_title ?? null,
          winning_ticket: draw.winning_ticket ?? null,
          total_tickets: draw.total_tickets ?? null,
        },
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/campaign-draw] Unexpected error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500, ...NO_STORE },
    )
  }
}
