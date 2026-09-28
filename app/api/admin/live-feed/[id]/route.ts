import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { getServiceSupabase } from '@/lib/admin/live-board'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache, no-store' } }
const FEED_LIMIT = 10

/**
 * GET /api/admin/live-feed/[id]
 *
 * Admin + Host (ops) only. Returns the most recent instant wins for ONE
 * campaign so hosts can see who won and what during a live.
 *
 * PRIVACY: This route DOES return sensitive PII — the winner's real name and
 * mobile number (from profiles_private) — in addition to the public display
 * name and prize title. It is therefore admin/ops ONLY, always served with
 * no-store, and must NEVER be exposed to public pages. It still does NOT
 * return checkout ids, payment data, or raw entry/ticket ids.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin', 'ops'] })
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

  try {
    const svc = getServiceSupabase()

    // Confirm campaign exists; return its safe summary.
    const { data: campaign, error: campaignErr } = await svc
      .from('campaigns')
      .select('id, title, slug, status')
      .eq('id', campaignId)
      .maybeSingle()

    if (campaignErr) {
      console.error('[admin/live-feed/[id]] campaign query error:', campaignErr.message)
      return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
    }
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 404, ...NO_STORE })
    }

    const campaignSummary = {
      id: campaign.id as string,
      title: (campaign.title ?? 'Untitled') as string,
      slug: (campaign.slug ?? '') as string,
      status: (campaign.status ?? '') as string,
    }

    // Resolve this campaign's instant-win prizes (bounded, small set). Awards
    // are filtered by these prize ids so we only ever touch this campaign.
    const { data: prizes, error: prizesErr } = await svc
      .from('instant_win_prizes')
      .select('id, prize_title')
      .eq('giveaway_id', campaignId)

    if (prizesErr) {
      console.error('[admin/live-feed/[id]] prizes query error:', prizesErr.message)
      return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
    }

    const prizeMap = new Map((prizes ?? []).map((p) => [p.id, p.prize_title as string | null]))
    const prizeIds = [...prizeMap.keys()]
    if (prizeIds.length === 0) {
      return NextResponse.json({ ok: true, campaign: campaignSummary, items: [] }, NO_STORE)
    }

    // Most recent awards for this campaign's prizes only.
    const { data: awards, error: awardsErr } = await svc
      .from('instant_win_awards')
      .select('checkout_intent_id, prize_id, awarded_at')
      .in('prize_id', prizeIds)
      .order('awarded_at', { ascending: false })
      .limit(FEED_LIMIT)

    if (awardsErr) {
      console.error('[admin/live-feed/[id]] awards query error:', awardsErr.message)
      return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
    }

    const awardRows = awards ?? []
    if (awardRows.length === 0) {
      return NextResponse.json({ ok: true, campaign: campaignSummary, items: [] }, NO_STORE)
    }

    // Resolve user_id per award via entries (checkout_intent_id -> user_id).
    const checkoutIntentIds = [...new Set(awardRows.map((a) => a.checkout_intent_id).filter(Boolean))]
    const { data: entries } = await svc
      .from('entries')
      .select('checkout_intent_id, user_id')
      .in('checkout_intent_id', checkoutIntentIds)

    const userIdByIntent = new Map((entries ?? []).map((e) => [e.checkout_intent_id, e.user_id]))

    // Resolve public display names (no private data) for all winners.
    const userIds = [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))]
    let displayNameByUser = new Map<string, string | null>()
    if (userIds.length > 0) {
      const { data: profiles } = await svc
        .from('profiles_public_snapshot')
        .select('user_id, display_name')
        .in('user_id', userIds)
      displayNameByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name ?? null]))
    }

    // Single bulk PII lookup (admin/ops only): real name + mobile per winner.
    // Reuses the userIds already derived from entries — no N+1, no per-row calls.
    // Fail-soft: any error/missing row leaves realName/mobile null.
    const privateByUser = new Map<string, { realName: string | null; mobile: string | null }>()
    if (userIds.length > 0) {
      const { data: privateProfiles, error: privateErr } = await svc
        .from('profiles_private')
        .select('user_id, real_name, mobile')
        .in('user_id', userIds)
      if (privateErr) {
        console.error('[admin/live-feed/[id]] profiles_private query error:', privateErr.message)
      } else {
        for (const p of privateProfiles ?? []) {
          privateByUser.set(p.user_id, {
            realName: (p.real_name ?? null) as string | null,
            mobile: (p.mobile ?? null) as string | null,
          })
        }
      }
    }

    const items = awardRows.map((award, i) => {
      const userId = award.checkout_intent_id ? userIdByIntent.get(award.checkout_intent_id) : null
      const displayName = userId ? (displayNameByUser.get(userId) ?? null) : null
      const priv = userId ? privateByUser.get(userId) : undefined
      return {
        // Synthetic, stable id — contains no checkout/entry/customer identifiers.
        id: `${award.awarded_at}-${award.prize_id}-${i}`,
        createdAt: award.awarded_at as string,
        displayName,
        realName: priv?.realName ?? null,
        mobile: priv?.mobile ?? null,
        prizeTitle: prizeMap.get(award.prize_id) ?? 'Instant win',
      }
    })

    return NextResponse.json({ ok: true, campaign: campaignSummary, items }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/live-feed/[id]] unexpected error:', err?.message)
    return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
  }
}
