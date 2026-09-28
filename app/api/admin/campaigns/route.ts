import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { END_DRAW_MODES, normalizeRevealType } from '@/lib/types/campaign'
import { loadCampaignAwardCounts } from '@/lib/server/giveaway-snapshot-awards'
import {
  loadCampaignVideoMap,
  videoFieldsFor,
  isMissingVideoColumnError,
  normaliseVideoUrl,
  normaliseVideoDurationS,
} from '@/lib/media/campaign-video'
import { deleteManagedObjectByUrl } from '@/lib/media/storage-cleanup'

/**
 * Explicit allow-list validation for the main/end-prize draw mode.
 *
 * Unlike reveal_type (which safely coerces unknown values to 'normal'), an
 * unexpected draw mode is REJECTED rather than coerced: silently turning a
 * typo into 'automatic' could auto-draw a competition the admin intended to
 * draw by hand. Absent/null is treated as 'automatic' so older clients and the
 * duplicate-campaign flow keep working unchanged.
 */
function resolveEndDrawMode(
  body: Record<string, any>,
): { ok: true; value: 'automatic' | 'manual' } | { ok: false; error: string } {
  const raw = body.end_draw_mode ?? body.endDrawMode

  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: 'automatic' }
  }

  if (typeof raw !== 'string' || !END_DRAW_MODES.includes(raw as any)) {
    return {
      ok: false,
      error: `Invalid end_draw_mode. Expected one of: ${END_DRAW_MODES.join(', ')}`,
    }
  }

  return { ok: true, value: raw as 'automatic' | 'manual' }
}

function toDbRow(body: Record<string, any>, endDrawMode: 'automatic' | 'manual') {
  return {
    // Main/end-prize draw mode. Validated by resolveEndDrawMode() before this
    // mapper is called, so only 'automatic' | 'manual' can ever reach the DB.
    end_draw_mode: endDrawMode,
    status: body.status,
    title: body.title,
    slug: body.slug,
    summary: body.summary,
    description: body.description,
    start_at: body.startAt,
    end_at: body.endAt,
    main_prize_title: body.mainPrizeTitle,
    main_prize_description: body.mainPrizeDescription,
    hero_image_url: body.heroImageUrl,
    ticket_price_pence: body.ticketPricePence,
    was_price_pence: body.wasPricePence ?? null,
    max_tickets_total: body.maxTicketsTotal ?? null,
    max_tickets_per_user: body.maxTicketsPerUser ?? null,
    bundles: body.bundles ?? null,
    presentation_type: body.presentation_type ?? body.presentationType ?? null,
    // Presentation-only. Explicit allow-list ('normal' | 'scratch_card' |
    // 'treasure_chest'); any missing/null/invalid value safely → 'normal'.
    // Applies to both create (insert) and update paths via this shared mapper.
    reveal_type: normalizeRevealType(body.reveal_type ?? body.revealType),
    is_free_entry: body.is_free_entry ?? body.isFreeEntry ?? false,
    free_entry_limit_per_user: body.free_entry_limit_per_user ?? body.freeEntryLimitPerUser ?? 1,
    // Optional promo video (Video Phase 1). Normalised to a clean URL/duration
    // or null (image-only). Stripped automatically if the additive migration
    // has not been applied yet (see stripVideoColumns / the write helpers).
    promo_video_url: normaliseVideoUrl(body.promoVideoUrl ?? body.promo_video_url),
    promo_video_duration_s: normaliseVideoDurationS(
      body.promoVideoDurationS ?? body.promo_video_duration_s,
    ),
  }
}

/** Remove the additive promo-video columns from a row (fallback when the
 *  013-campaign-video migration has not been applied yet). */
function stripVideoColumns<T extends Record<string, any>>(row: T): T {
  const { promo_video_url, promo_video_duration_s, ...rest } = row
  return rest as T
}

async function refreshSnapshotsNow(campaignId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[snapshots] missing supabaseUrl or service role key')
    return
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: c, error: fetchError } = await svc
    .from('campaigns')
    .select('id, slug, title, summary, description, status, start_at, end_at, main_prize_title, main_prize_description, hero_image_url, ticket_price_pence, max_tickets_total, max_tickets_per_user, bundles, presentation_type, reveal_type, is_free_entry, free_entry_limit_per_user')
    .eq('id', campaignId)
    .single()

  if (fetchError) throw new Error(`Failed to fetch campaign: ${fetchError.message}`)
  if (!c) return

  // Fetch instant win prizes + awards for this campaign
  const { data: prizes, error: prizesError } = await svc
    .from('instant_win_prizes')
    .select('id, prize_title, image_url, quantity, created_at')
    .eq('campaign_id', c.id)
    .order('created_at', { ascending: true })

  if (prizesError) {
    // Fail closed: throwing prevents overwriting a valid snapshot with partial data.
    throw new Error(`Failed to load instant-win prizes for campaign ${c.id}: ${prizesError.message}`)
  }

  // Count ALL awards per prize_id via the shared paginated helper (throws on
  // any Supabase error, so a truncated/failed read never becomes zero awards).
  const { awardCountByPrize, totalAwards, pageCount, prizeIdCount } =
    await loadCampaignAwardCounts(svc, c.id)

  console.log(
    '[admin/campaigns/refreshSnapshotsNow] awards loaded',
    'campaignId=', c.id,
    'totalAwards=', totalAwards,
    'pages=', pageCount,
    'prizeIds=', prizeIdCount,
  )

  // Fetch ticket counter for this campaign
  const { data: counter } = await svc
    .from('giveaway_ticket_counters')
    .select('next_ticket')
    .eq('giveaway_id', c.id)
    .maybeSingle()

  const ticketsSold = Math.max((counter?.next_ticket ?? 1) - 1, 0)

  // Optional promo video (Video Phase 1). Tolerant batched read (poster-only if
  // the additive migration is not applied yet).
  const videoMap = await loadCampaignVideoMap(svc, [c.id])
  const video = videoFieldsFor(videoMap, c.id)

  const instantWins = (prizes ?? []).map((p: any) => {
    const quantity = p.quantity ?? 1
    const awardedCount = awardCountByPrize[p.id] ?? 0
    const remainingCount = Math.max(quantity - awardedCount, 0)
    return {
      id: p.id,
      title: p.prize_title,
      image_url: p.image_url ?? null,
      quantity,
      awarded_count: awardedCount,
      remaining_count: remainingCount,
      is_won: remainingCount === 0,
    }
  })

  console.log('[admin/campaigns/refreshSnapshotsNow] campaignId=', c.id, 'slug=', c.slug, 'instant_wins=', instantWins.length)

  const generatedAt = new Date().toISOString()

  const listPayload = {
    id: c.id,
    slug: c.slug,
    title: c.title,
    prize_title: c.main_prize_title,
    prize_value_text: null,
    hero_image_url: c.hero_image_url,
    ends_at: c.end_at,
    base_ticket_price_pence: c.ticket_price_pence,
    status: c.status,
    tickets_sold: ticketsSold,
    hard_cap_total_tickets: c.max_tickets_total,
    presentation_type: c.presentation_type ?? null,
    reveal_type: c.reveal_type ?? 'normal',
    is_free_entry: c.is_free_entry ?? false,
    free_entry_limit_per_user: c.free_entry_limit_per_user ?? 1,
    // Optional promo video (poster-first Featured Hero enhancement).
    promo_video_url: video.promo_video_url,
    promo_video_duration_s: video.promo_video_duration_s,
  }

  const detailPayload = {
    id: c.id,
    slug: c.slug,
    title: c.title,
    prize_title: c.main_prize_title,
    prize_description: c.main_prize_description ?? null,
    description: c.description ?? null,
    prize_value_text: null,
    hero_image_url: c.hero_image_url,
    images: null,
    variant: 'raffle',
    status: c.status,
    starts_at: c.start_at,
    ends_at: c.end_at,
    currency: 'GBP',
    base_ticket_price_pence: c.ticket_price_pence,
    bundles: c.bundles ?? null,
    hard_cap_total_tickets: c.max_tickets_total,
    tickets_sold: ticketsSold,
    instant_wins: instantWins,
    presentation_type: c.presentation_type ?? null,
    reveal_type: c.reveal_type ?? 'normal',
    is_free_entry: c.is_free_entry ?? false,
    free_entry_limit_per_user: c.free_entry_limit_per_user ?? 1,
    // Optional promo video — the detail page reads this for tap-to-play.
    promo_video_url: video.promo_video_url,
    promo_video_duration_s: video.promo_video_duration_s,
  }

  // Use UPSERT instead of DELETE+INSERT for atomic snapshot updates
  const { error: upsert1 } = await svc.from('giveaway_snapshots').upsert(
    { giveaway_id: c.id, kind: 'list', generated_at: generatedAt, payload: listPayload },
    { onConflict: 'giveaway_id,kind' }
  )
  if (upsert1) throw new Error(`Failed to upsert list snapshot for ${c.id}: ${upsert1.message}`)

  const { error: upsert2 } = await svc.from('giveaway_snapshots').upsert(
    { giveaway_id: c.id, kind: 'detail', generated_at: generatedAt, payload: detailPayload },
    { onConflict: 'giveaway_id,kind' }
  )
  if (upsert2) throw new Error(`Failed to upsert detail snapshot for ${c.id}: ${upsert2.message}`)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authError === 'Not authenticated' ? 401 : 403 })

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const drawMode = resolveEndDrawMode(body)
  if (!drawMode.ok) {
    return NextResponse.json({ ok: false, error: drawMode.error }, { status: 400 })
  }

  const row = toDbRow(body, drawMode.value)

  let { data, error } = await supabase
    .from('campaigns')
    .insert(row)
    .select('id')
    .single()

  // Additive-migration tolerance: if the promo-video columns are not present
  // yet, retry once WITHOUT them so campaign creation keeps working exactly as
  // before (the campaign is simply image-only until 013-campaign-video runs).
  if (error && isMissingVideoColumnError(error)) {
    console.warn('[campaigns] promo-video columns absent on insert; saving without video')
    ;({ data, error } = await supabase
      .from('campaigns')
      .insert(stripVideoColumns(row))
      .select('id')
      .single())
  }

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message, details: error }, { status: 500 })
  }

  refreshSnapshotsNow(data.id).catch((e) => console.error('[snapshots] refresh failed', e))

  return NextResponse.json({ ok: true, id: data.id })
}

export async function PUT(request: Request) {
  console.log('[instant-debug][campaign-api] PUT hit')
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    console.log('[instant-debug][campaign-api] PUT auth failed:', authError)
    return NextResponse.json({ ok: false, error: authError }, { status: authError === 'Not authenticated' ? 401 : 403 })
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    console.log('[instant-debug][campaign-api] PUT invalid JSON body')
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  console.log('[instant-debug][campaign-api] PUT payload: id=', body.id, 'title=', body.title, 'status=', body.status)

  if (!body.id) {
    console.log('[instant-debug][campaign-api] PUT missing campaign id')
    return NextResponse.json({ ok: false, error: 'Missing campaign id' }, { status: 400 })
  }

  const drawMode = resolveEndDrawMode(body)
  if (!drawMode.ok) {
    console.log('[instant-debug][campaign-api] PUT invalid end_draw_mode')
    return NextResponse.json({ ok: false, error: drawMode.error }, { status: 400 })
  }

  const row = toDbRow(body, drawMode.value)

  // Promo-video replacement/removal bookkeeping (Video Phase 1). The client
  // sends the previously-persisted managed URL so we can safely clean it up
  // AFTER the new state is committed and propagated — never before.
  const previousVideoUrl = normaliseVideoUrl(body.previousPromoVideoUrl)
  const newVideoUrl = normaliseVideoUrl(body.promoVideoUrl ?? body.promo_video_url)
  const videoChanged = !!previousVideoUrl && previousVideoUrl !== newVideoUrl

  let { error } = await supabase
    .from('campaigns')
    .update(row)
    .eq('id', body.id)

  // Additive-migration tolerance: retry once without the promo-video columns
  // so ordinary campaign edits keep working before 013-campaign-video runs.
  if (error && isMissingVideoColumnError(error)) {
    console.warn('[campaigns] promo-video columns absent on update; saving without video')
    ;({ error } = await supabase
      .from('campaigns')
      .update(stripVideoColumns(row))
      .eq('id', body.id))
  }

  if (error) {
    console.log('[instant-debug][campaign-api] PUT DB error:', error)
    return NextResponse.json({ ok: false, error: error.message, details: error }, { status: 500 })
  }

  console.log('[instant-debug][campaign-api] PUT DB update success for id=', body.id)

  if (videoChanged) {
    // Correct replacement/removal sequence: DB is already committed above.
    // (1) Ensure public propagation BEFORE deleting the old object — snapshots
    // keep referencing the old URL until refreshed, so we AWAIT the refresh.
    try {
      await refreshSnapshotsNow(body.id)
    } catch (e) {
      // Snapshot refresh failed: do NOT delete the old object (public data may
      // still reference it). Leave the previous video in place; it is harmless.
      console.error('[snapshots] refresh failed (video kept for safety)', e)
      return NextResponse.json({ ok: true, id: body.id })
    }
    // (2) Now safe to remove the previous managed video object — confined to
    // OUR campaign-video bucket on OUR Supabase host by the cleanup helper.
    const svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
    const cleanup = await deleteManagedObjectByUrl(svc, previousVideoUrl, {
      allowedBuckets: ['campaign-video'],
    })
    console.log('[campaigns] previous promo video cleanup:', JSON.stringify(cleanup))
    return NextResponse.json({ ok: true, id: body.id })
  }

  console.log('[instant-debug][campaign-api] starting snapshot refresh (fire-and-forget)')
  refreshSnapshotsNow(body.id).catch((e) => console.error('[snapshots] refresh failed', e))

  console.log('[instant-debug][campaign-api] PUT returning ok=true for id=', body.id)
  return NextResponse.json({ ok: true, id: body.id })
}
