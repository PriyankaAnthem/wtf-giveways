import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { loadCampaignAwardCounts } from '@/lib/server/giveaway-snapshot-awards'
import { loadCampaignVideoMap, videoFieldsFor } from '@/lib/media/campaign-video'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // 1) Auth
  const token = request.nextUrl.searchParams.get('token')
  const expected = process.env.CRON_SECRET
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2) Require campaignId
  const campaignId = request.nextUrl.searchParams.get('campaignId')
  if (!campaignId) {
    return NextResponse.json({ error: 'Missing campaignId query param' }, { status: 400 })
  }

  // 3) Supabase service role client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // 4) Fetch campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('id, slug, title, summary, description, status, start_at, end_at, main_prize_title, main_prize_description, hero_image_url, ticket_price_pence, was_price_pence, max_tickets_total, max_tickets_per_user, bundles, presentation_type, is_free_entry, free_entry_limit_per_user')
    .eq('id', campaignId)
    .single()

  if (campaignErr || !campaign) {
    console.error('[refresh-giveaway-snapshots] campaign not found', campaignId, campaignErr)
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // 5) Fetch instant win prizes + awards
  const { data: prizes, error: prizesErr } = await supabase
    .from('instant_win_prizes')
    .select('id, prize_title, image_url, quantity, fulfilment_type, prize_value_pence, created_at')
    .eq('campaign_id', campaign.id)
    .order('created_at', { ascending: true })

  if (prizesErr) {
    // Fail closed: do NOT write a snapshot from incomplete prize data.
    console.error('[refresh-giveaway-snapshots] prize load failed', campaign.id, prizesErr)
    return NextResponse.json({ error: 'Failed to load instant-win prizes' }, { status: 500 })
  }

  // Count ALL awards per prize_id via the shared paginated helper. This throws
  // on any Supabase error so we never build counts from a truncated result set.
  let awardCountByPrize: Record<string, number>
  let awardTotals: { totalAwards: number; pageCount: number; prizeIdCount: number }
  try {
    const counts = await loadCampaignAwardCounts(supabase, campaign.id)
    awardCountByPrize = counts.awardCountByPrize
    awardTotals = counts
  } catch (err) {
    console.error('[refresh-giveaway-snapshots] award load failed', campaign.id, err)
    return NextResponse.json({ error: 'Failed to load instant-win awards' }, { status: 500 })
  }

  console.log(
    '[refresh-giveaway-snapshots] awards loaded',
    'campaignId=', campaign.id,
    'totalAwards=', awardTotals.totalAwards,
    'pages=', awardTotals.pageCount,
    'prizeIds=', awardTotals.prizeIdCount,
  )

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

  console.log('[refresh-giveaway-snapshots] campaignId=', campaign.id, 'slug=', campaign.slug, 'instant_wins=', Array.isArray(instantWins) ? instantWins.length : 'MISSING_KEY')

  // Genuine remaining instant-win opportunity, precomputed here (reusing the
  // award counts already loaded above) so the Homepage Hero reads a single
  // aggregate from the snapshot payload with ZERO per-render cost.
  //
  //   instant_wins_remaining_count — unclaimed slots across ALL instant-win
  //     prize types (quantity - awarded). Never counts claimed/awarded slots.
  //   instant_cash_remaining_pence — genuine unclaimed CASH value in pence,
  //     counting ONLY fulfilment_type='cash' with an authoritative
  //     prize_value_pence. It is null (not 0) whenever any remaining cash prize
  //     lacks a stored value, so the hero can never display an understated /
  //     misleading cash figure. Value is NEVER parsed from the prize title.
  let instantWinsRemainingCount = 0
  let cashRemainingPence = 0
  let hasCashPrize = false
  let cashValueComplete = true
  for (const p of prizes ?? []) {
    const quantity = p.quantity ?? 1
    const remainingCount = Math.max(quantity - (awardCountByPrize[p.id] ?? 0), 0)
    instantWinsRemainingCount += remainingCount
    if (p.fulfilment_type === 'cash') {
      hasCashPrize = true
      if (remainingCount > 0) {
        if (p.prize_value_pence == null) cashValueComplete = false
        else cashRemainingPence += remainingCount * p.prize_value_pence
      }
    }
  }
  const instantCashRemainingPence = hasCashPrize && cashValueComplete ? cashRemainingPence : null

  console.log(
    '[refresh-giveaway-snapshots] hero-metrics',
    'instant_wins_remaining=', instantWinsRemainingCount,
    'cash_remaining_pence=', instantCashRemainingPence,
    'hasCashPrize=', hasCashPrize,
    'cashValueComplete=', cashValueComplete,
  )

  // 5b) Fetch ticket counter (try campaign_ticket_counters first, fallback to giveaway_ticket_counters)
  let nextTicket = 1

  const { data: campaignCounter } = await supabase
    .from('campaign_ticket_counters')
    .select('next_ticket')
    .eq('campaign_id', campaign.id)
    .maybeSingle()

  if (campaignCounter?.next_ticket) {
    nextTicket = campaignCounter.next_ticket
  } else {
    // Fallback to legacy giveaway_ticket_counters table
    const { data: giveawayCounter } = await supabase
      .from('giveaway_ticket_counters')
      .select('next_ticket')
      .eq('giveaway_id', campaign.id)
      .maybeSingle()

    if (giveawayCounter?.next_ticket) {
      nextTicket = giveawayCounter.next_ticket
    }
  }

  const ticketsSold = Math.max(nextTicket - 1, 0)

  console.log(
    '[refresh-giveaway-snapshots] counter',
    'next_ticket=',
    nextTicket,
    'tickets_sold=',
    ticketsSold
  )

  // Optional promo video (Video Phase 1). Batched, tolerant read — returns
  // empty (poster-only) if the additive migration has not been applied yet.
  const videoMap = await loadCampaignVideoMap(supabase, [campaign.id])
  const video = videoFieldsFor(videoMap, campaign.id)

  // 6) Build payloads
  const listPayload = {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    prize_title: campaign.main_prize_title,
    prize_value_text: null,
    hero_image_url: campaign.hero_image_url,
    ends_at: campaign.end_at,
    base_ticket_price_pence: campaign.ticket_price_pence,
    was_ticket_price_pence: campaign.was_price_pence ?? null,
    status: campaign.status,
    tickets_sold: ticketsSold,
    next_ticket: nextTicket,
    bundles: campaign.bundles ?? null,
    hard_cap_total_tickets: campaign.max_tickets_total,
    presentation_type: campaign.presentation_type ?? null,
    is_free_entry: campaign.is_free_entry ?? false,
    free_entry_limit_per_user: campaign.free_entry_limit_per_user ?? 1,
    // Genuine remaining instant-win opportunity (see computation above).
    instant_wins_remaining_count: instantWinsRemainingCount,
    instant_cash_remaining_pence: instantCashRemainingPence,
    // Optional promo video (poster-first enhancement; null = image-only).
    promo_video_url: video.promo_video_url,
    promo_video_duration_s: video.promo_video_duration_s,
  }

  const detailPayload = {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    prize_title: campaign.main_prize_title,
    prize_description: campaign.main_prize_description ?? null,
    description: campaign.description ?? null,
    prize_value_text: null,
    hero_image_url: campaign.hero_image_url,
    images: null,
    variant: 'raffle',
    status: campaign.status,
    starts_at: campaign.start_at,
    ends_at: campaign.end_at,
    currency: 'GBP',
    base_ticket_price_pence: campaign.ticket_price_pence,
    was_ticket_price_pence: campaign.was_price_pence ?? null,
    bundles: campaign.bundles ?? null,
    hard_cap_total_tickets: campaign.max_tickets_total,
    instant_wins: instantWins,
    tickets_sold: ticketsSold,
    next_ticket: nextTicket,
    is_free_entry: campaign.is_free_entry ?? false,
    free_entry_limit_per_user: campaign.free_entry_limit_per_user ?? 1,
    // Aggregates only (no per-prize value leak) — parity with the list payload.
    instant_wins_remaining_count: instantWinsRemainingCount,
    instant_cash_remaining_pence: instantCashRemainingPence,
    // Optional promo video — the detail page reads this for tap-to-play.
    promo_video_url: video.promo_video_url,
    promo_video_duration_s: video.promo_video_duration_s,
  }

  // 7) Upsert snapshots (atomic - no delete required)
  const generatedAt = new Date().toISOString()

  const { error: listErr } = await supabase
    .from('giveaway_snapshots')
    .upsert({
      giveaway_id: campaign.id,
      kind: 'list',
      generated_at: generatedAt,
      payload: listPayload,
    }, { onConflict: 'giveaway_id,kind' })

  if (listErr) {
    console.error('[refresh-giveaway-snapshots] list insert failed', listErr)
    return NextResponse.json({ error: 'Failed to insert list snapshot' }, { status: 500 })
  }

  const { error: detailErr } = await supabase
    .from('giveaway_snapshots')
    .upsert({
      giveaway_id: campaign.id,
      kind: 'detail',
      generated_at: generatedAt,
      payload: detailPayload,
    }, { onConflict: 'giveaway_id,kind' })

  if (detailErr) {
    console.error('[refresh-giveaway-snapshots] detail insert failed', detailErr)
    return NextResponse.json({ error: 'Failed to insert detail snapshot' }, { status: 500 })
  }

  console.log('[refresh-giveaway-snapshots] wrote list+detail snapshots')

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    instantWinsCount: instantWins.length,
    totalAwards: awardTotals.totalAwards,
  })
}
