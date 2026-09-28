import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  NO_STORE,
  getServiceSupabase,
  validateItemsForSetup,
  normalizeStoredItems,
  mapEventRow,
} from '@/lib/admin/live-board'

const RECENT_EVENTS_LIMIT = 20

/**
 * GET /api/admin/campaigns/[campaignId]/live-board
 *
 * Admin-only. Returns the campaign summary, its live board (or null), and the
 * most recent board events. Read-only — does not require Balloon Pop so the
 * admin UI can always inspect state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Temporary staging diagnostic: returns immediately, before auth/DB, so we
  // can confirm the route resolves at all. Safe — echoes only the campaign id.
  const { id: campaignId } = await params
  if (request.nextUrl.searchParams.get('ping') === '1') {
    return NextResponse.json(
      { ok: true, route: 'admin-live-board', campaignId: campaignId ?? null },
      NO_STORE,
    )
  }

  const supabase = await createClient()
  // Hosts (ops) operate the live board during TikTok lives, so they need read
  // access here too — alongside full admins.
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400, ...NO_STORE })
  }

  try {
    const svc = getServiceSupabase()

    const { data: campaign, error: campaignErr } = await svc
      .from('campaigns')
      .select('id, slug, title, status, presentation_type')
      .eq('id', campaignId)
      .maybeSingle()

    if (campaignErr) {
      console.error('[admin/live-board] campaign query error:', campaignErr.message)
      return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
    }
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 404, ...NO_STORE })
    }

    const { data: boardRow, error: boardErr } = await svc
      .from('campaign_live_boards')
      .select(
        'id, enabled, items, last_event_label, last_event_at, updated_at, site_takeover_enabled, site_takeover_headline, site_takeover_subtext, site_takeover_primary_label, site_takeover_watch_url, site_takeover_updated_at',
      )
      .eq('campaign_id', campaignId)
      .maybeSingle()

    if (boardErr) {
      console.error('[admin/live-board] board query error:', boardErr.message)
      return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
    }

    let recentEvents: ReturnType<typeof mapEventRow>[] = []
    if (boardRow) {
      const { data: events, error: eventsErr } = await svc
        .from('campaign_live_board_events')
        .select('id, action_type, item_id, label, delta, before_remaining, after_remaining, created_at')
        .eq('board_id', boardRow.id)
        .order('created_at', { ascending: false })
        .limit(RECENT_EVENTS_LIMIT)

      if (eventsErr) {
        console.error('[admin/live-board] events query error:', eventsErr.message)
        return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
      }
      recentEvents = (events ?? []).map(mapEventRow)
    }

    return NextResponse.json(
      {
        ok: true,
        campaign: {
          id: campaign.id,
          slug: campaign.slug,
          title: campaign.title,
          status: campaign.status,
          presentationType: campaign.presentation_type ?? null,
        },
        board: boardRow
          ? {
              id: boardRow.id,
              enabled: boardRow.enabled === true,
              items: normalizeStoredItems(boardRow.items),
              lastEventLabel: boardRow.last_event_label ?? null,
              lastEventAt: boardRow.last_event_at ?? null,
              updatedAt: boardRow.updated_at,
              siteTakeover: {
                enabled: boardRow.site_takeover_enabled === true,
                headline: boardRow.site_takeover_headline ?? null,
                subtext: boardRow.site_takeover_subtext ?? null,
                primaryLabel: boardRow.site_takeover_primary_label ?? null,
                watchUrl: boardRow.site_takeover_watch_url ?? null,
                updatedAt: boardRow.site_takeover_updated_at ?? null,
              },
            }
          : null,
        recentEvents,
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/live-board] GET unexpected error:', err?.message)
    return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
  }
}

/**
 * Create/update (setup or edit) the live board for a campaign.
 *
 * Admin-only. Campaign must exist and be Balloon Pop. Items are validated and
 * normalized. Writes a `setup` event on first create, `edit` thereafter.
 */
async function saveBoard(request: NextRequest, campaignId: string, userId: string) {
  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_items' }, { status: 400, ...NO_STORE })
  }

  const itemsResult = validateItemsForSetup(body.items)
  if (!itemsResult.ok) {
    return NextResponse.json({ ok: false, error: itemsResult.error }, { status: 400, ...NO_STORE })
  }
  const enabled = body.enabled === true

  try {
    const svc = getServiceSupabase()

    const { data: campaign, error: campaignErr } = await svc
      .from('campaigns')
      .select('id, presentation_type')
      .eq('id', campaignId)
      .maybeSingle()

    if (campaignErr) {
      console.error('[admin/live-board] save campaign query error:', campaignErr.message)
      return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
    }
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 404, ...NO_STORE })
    }
    if (campaign.presentation_type !== 'balloon_pop') {
      return NextResponse.json({ ok: false, error: 'not_balloon_pop' }, { status: 400, ...NO_STORE })
    }

    const { data: existing, error: existingErr } = await svc
      .from('campaign_live_boards')
      .select('id')
      .eq('campaign_id', campaignId)
      .maybeSingle()

    if (existingErr) {
      console.error('[admin/live-board] save existing query error:', existingErr.message)
      return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
    }

    const nowIso = new Date().toISOString()
    const isFirstCreate = !existing
    const label = isFirstCreate ? 'Board setup saved' : 'Board updated'

    let boardId: string
    if (existing) {
      const { data: updated, error: updateErr } = await svc
        .from('campaign_live_boards')
        .update({
          enabled,
          items: itemsResult.items,
          updated_at: nowIso,
          updated_by: userId,
        })
        .eq('id', existing.id)
        .select('id')
        .single()
      if (updateErr || !updated) {
        console.error('[admin/live-board] board update error:', updateErr?.message)
        return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
      }
      boardId = updated.id
    } else {
      const { data: inserted, error: insertErr } = await svc
        .from('campaign_live_boards')
        .insert({
          campaign_id: campaignId,
          enabled,
          items: itemsResult.items,
          updated_at: nowIso,
          updated_by: userId,
        })
        .select('id')
        .single()
      if (insertErr || !inserted) {
        console.error('[admin/live-board] board insert error:', insertErr?.message)
        return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
      }
      boardId = inserted.id
    }

    const { error: eventErr } = await svc.from('campaign_live_board_events').insert({
      campaign_id: campaignId,
      board_id: boardId,
      action_type: isFirstCreate ? 'setup' : 'edit',
      label,
      note: label,
      created_by: userId,
    })
    if (eventErr) {
      console.error('[admin/live-board] setup event insert error:', eventErr.message)
      // Board already saved; surface a soft error but don't fail the save outright.
    }

    return NextResponse.json({ ok: true, boardId, isFirstCreate }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/live-board] save unexpected error:', err?.message)
    return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
  }
}

/**
 * Update ONLY the "Live site takeover" fields for a campaign's board.
 *
 * Admin-only. Does NOT touch board items, so hosts can edit takeover text or
 * flip it off without affecting mark-popped / add-back / undo state. Takeover is
 * globally exclusive: enabling one campaign first disables every other one.
 *
 * The takeover columns live on the `campaign_live_boards` row. If that row does
 * not exist yet, this safely initialises a MINIMAL row for a Balloon Pop
 * campaign (mirroring the setup insert, but with no prize items) so the Homepage
 * Main Banner workflow can go LIVE without the old Live Board setup UI. This is
 * ordinary application data on the EXISTING table — no schema change.
 */
async function saveTakeover(request: NextRequest, campaignId: string, userId: string) {
  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_takeover' }, { status: 400, ...NO_STORE })
  }

  const enabled = body.enabled === true
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const headline = clean(body.headline, 200)
  const subtext = clean(body.subtext, 300)
  const primaryLabel = clean(body.primaryLabel, 60)
  const watchUrlRaw = clean(body.watchUrl, 500)

  // Optional watch URL — only accept absolute http(s) URLs so we never render a
  // javascript: or otherwise unsafe link on the public site.
  let watchUrl: string | null = null
  if (watchUrlRaw) {
    try {
      const u = new URL(watchUrlRaw)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return NextResponse.json({ ok: false, error: 'invalid_takeover_url' }, { status: 400, ...NO_STORE })
      }
      watchUrl = u.toString()
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_takeover_url' }, { status: 400, ...NO_STORE })
    }
  }

  // A headline is required when the takeover is turned on (it is the banner's
  // main line on the public site).
  if (enabled && !headline) {
    return NextResponse.json({ ok: false, error: 'invalid_takeover' }, { status: 400, ...NO_STORE })
  }

  try {
    const svc = getServiceSupabase()
    const nowIso = new Date().toISOString()

    const { data: existing, error: existingErr } = await svc
      .from('campaign_live_boards')
      .select('id')
      .eq('campaign_id', campaignId)
      .maybeSingle()
    if (existingErr) {
      console.error('[admin/live-board] takeover existing query error:', existingErr.message)
      return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
    }

    // Resolve the board row id — initialising a minimal row if one does not yet
    // exist. This removes the old "set up the live board first" prerequisite:
    // the Homepage Main Banner workflow can enable LIVE for a Balloon Pop that
    // has never used the old Live Board UI. Only Balloon Pop campaigns may have
    // a takeover, so we verify presentation_type before creating anything.
    let boardId: string
    if (existing) {
      boardId = existing.id
    } else {
      const { data: campaign, error: campaignErr } = await svc
        .from('campaigns')
        .select('id, presentation_type')
        .eq('id', campaignId)
        .maybeSingle()
      if (campaignErr) {
        console.error('[admin/live-board] takeover campaign query error:', campaignErr.message)
        return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
      }
      if (!campaign) {
        return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 404, ...NO_STORE })
      }
      if (campaign.presentation_type !== 'balloon_pop') {
        return NextResponse.json({ ok: false, error: 'not_balloon_pop' }, { status: 400, ...NO_STORE })
      }

      // Minimal init: same columns the setup insert writes, but with NO prize
      // items (an empty board is valid — prize stats are optional on the hero).
      const { data: inserted, error: insertErr } = await svc
        .from('campaign_live_boards')
        .insert({
          campaign_id: campaignId,
          enabled: false,
          items: [],
          updated_at: nowIso,
          updated_by: userId,
        })
        .select('id')
        .single()
      if (insertErr || !inserted) {
        console.error('[admin/live-board] takeover row init error:', insertErr?.message)
        return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
      }
      boardId = inserted.id
    }

    // Enforce a single active takeover across the whole site: when enabling this
    // campaign, disable any others that are currently enabled first.
    if (enabled) {
      const { error: offErr } = await svc
        .from('campaign_live_boards')
        .update({ site_takeover_enabled: false, site_takeover_updated_at: nowIso })
        .eq('site_takeover_enabled', true)
        .neq('campaign_id', campaignId)
      if (offErr) {
        console.error('[admin/live-board] takeover exclusivity update error:', offErr.message)
        return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
      }
    }

    const { error: updErr } = await svc
      .from('campaign_live_boards')
      .update({
        site_takeover_enabled: enabled,
        site_takeover_headline: headline || null,
        site_takeover_subtext: subtext || null,
        site_takeover_primary_label: primaryLabel || null,
        site_takeover_watch_url: watchUrl,
        site_takeover_updated_at: nowIso,
      })
      .eq('id', boardId)
    if (updErr) {
      console.error('[admin/live-board] takeover update error:', updErr.message)
      return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
    }

    return NextResponse.json(
      {
        ok: true,
        siteTakeover: {
          enabled,
          headline: headline || null,
          subtext: subtext || null,
          primaryLabel: primaryLabel || null,
          watchUrl,
          updatedAt: nowIso,
        },
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/live-board] takeover unexpected error:', err?.message)
    return NextResponse.json({ ok: false, error: 'live_board_action_failed' }, { status: 500, ...NO_STORE })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }
  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400, ...NO_STORE })
  }
  return saveBoard(request, campaignId, user.id)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }
  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400, ...NO_STORE })
  }
  return saveTakeover(request, campaignId, user.id)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }
  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400, ...NO_STORE })
  }
  return saveBoard(request, campaignId, user.id)
}
