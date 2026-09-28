import 'server-only'

import { getServiceSupabase, normalizeStoredItems } from '@/lib/admin/live-board'
import { classifyGiveaway } from '@/lib/giveaway-classification'
import { isHeroBadge, type HeroBadge } from '@/lib/homepage-hero-badges'

/**
 * Server-side data layer for the single Homepage Main Banner (hero).
 *
 * Storage is the pre-existing `public.homepage_hero` SINGLETON (key='default').
 * This module NEVER creates/alters schema — it only reads the one config row
 * and, for a Balloon Pop selection, that ONE campaign's own live-board.
 *
 * Hard rule from the brief: a different live campaign must NEVER hijack the
 * banner. We resolve the selected campaign from `homepage_hero.hero_campaign_id`
 * and check the takeover flag on THAT campaign only — never the global
 * `getLiveNow()` single-row lookup.
 *
 * Reads use the service client (like `getLiveNow`) purely to read a small,
 * public-safe field set. Everything here fails soft (returns null / featured)
 * so the homepage always renders.
 */

export type HeroState = 'featured' | 'live'

/** Raw singleton config. */
export interface HomepageHeroConfig {
  heroCampaignId: string | null
  heroBadge: HeroBadge | null
}

/** Fully-resolved, render-ready hero data (or null when the slot is hidden). */
export interface HomepageHeroData {
  state: HeroState
  badge: HeroBadge | null
  campaignId: string
  slug: string | null
  title: string | null
  prizeTitle: string | null
  heroImageUrl: string | null
  /**
   * Optional promotional video (Video Phase 1). Present only when the selected
   * campaign has one in its snapshot payload. The Featured Hero layers this
   * over `heroImageUrl` ONLY after playback is genuinely ready and eligible;
   * `heroImageUrl` always remains the poster/LCP/fallback. Never used by
   * LiveHero.
   */
  promoVideoUrl: string | null
  promoVideoDurationS: number | null
  endsAtMs: number | null
  basePricePence: number | null
  wasPricePence: number | null
  ticketsSold: number
  hardCap: number
  percentSold: number | null
  ticketsLeft: number | null
  /**
   * FEATURED third-metric sources (genuine, precomputed in the giveaway
   * snapshot — never fabricated, never parsed from titles):
   *   - instantWinsRemaining: unclaimed instant-win slots across all prize
   *     types (quantity - awarded). Drives the "INSTANT WINS LEFT" tile.
   *   - instantCashRemainingPence: genuine unclaimed CASH value in pence
   *     (fulfilment_type='cash' with an authoritative prize_value_pence).
   *     Null whenever the cash total cannot be trusted/completed, so the hero
   *     never shows an understated cash figure. Drives "£X STILL TO WIN".
   */
  instantWinsRemaining: number | null
  instantCashRemainingPence: number | null
  isFreeEntry: boolean
  /** LIVE-only: genuine watch URL, shown only when present. */
  watchUrl: string | null
  /** LIVE-only: real balloon-board totals (0 in the Featured state). */
  totalLeft: number
  vipLeft: number
  /** LIVE-only: whether the board actually has prize items configured. When
   *  false, the public hero omits the prize/VIP stats entirely (LIVE never
   *  depends on prize-board setup). */
  hasPrizeBoard: boolean
  /** LIVE-only: genuine admin-entered takeover copy (null in Featured). */
  liveHeadline: string | null
  liveSubtext: string | null
  livePrimaryLabel: string | null
  /** LIVE-only: genuine most-recent board event (public-safe), for the "just
   *  popped" chip. Null when the board has no event. Never fabricated. */
  lastEventLabel: string | null
  lastEventAt: string | null
}

/**
 * Read the singleton config row. Never throws.
 * `hero_campaign_id` NULL (or missing row) => the slot is hidden.
 */
export async function loadHomepageHeroConfig(): Promise<HomepageHeroConfig> {
  try {
    const svc = getServiceSupabase()
    const { data } = await svc
      .from('homepage_hero')
      .select('hero_campaign_id, hero_badge')
      .eq('key', 'default')
      .maybeSingle()

    return {
      heroCampaignId: data?.hero_campaign_id ?? null,
      heroBadge: isHeroBadge(data?.hero_badge) ? (data!.hero_badge as HeroBadge) : null,
    }
  } catch (err: any) {
    console.error('[homepage-hero] config read error:', err?.message)
    return { heroCampaignId: null, heroBadge: null }
  }
}

/**
 * Read the takeover flag for ONE specific campaign's live-board.
 * Used both by the public hero decision and the admin read-only indicator.
 * Never throws.
 */
export async function getCampaignTakeoverEnabled(campaignId: string): Promise<boolean> {
  try {
    const svc = getServiceSupabase()
    const { data } = await svc
      .from('campaign_live_boards')
      .select('site_takeover_enabled')
      .eq('campaign_id', campaignId)
      .maybeSingle()
    return data?.site_takeover_enabled === true
  } catch (err: any) {
    console.error('[homepage-hero] takeover read error:', err?.message)
    return false
  }
}

/** Site-takeover value shape shared with the admin `LiveTakeoverControl`. */
export interface HeroTakeoverValue {
  enabled: boolean
  headline: string | null
  subtext: string | null
  primaryLabel: string | null
  watchUrl: string | null
  updatedAt: string | null
}

/** Admin-side LIVE state for the selected hero campaign (read-only load). */
export interface HeroLiveAdminState {
  isBalloon: boolean
  /** The takeover row/board exists (required before it can be enabled). */
  boardExists: boolean
  takeover: HeroTakeoverValue | null
}

/**
 * Read the admin-facing LIVE state for ONE campaign so the /admin/homepage
 * screen can host the existing takeover controls inline. Never throws; a failed
 * read degrades to "not balloon / no board" so the admin page still renders.
 *
 * This is a READ only — all LIVE writes go through the existing
 * `PATCH /api/admin/campaigns/[id]/live-board` mutation (reused verbatim by the
 * `LiveTakeoverControl` component). No new live flag is introduced here.
 */
export async function getHeroLiveAdminState(
  campaignId: string,
): Promise<HeroLiveAdminState> {
  try {
    const svc = getServiceSupabase()

    const { data: campaign } = await svc
      .from('campaigns')
      .select('presentation_type')
      .eq('id', campaignId)
      .maybeSingle()

    const isBalloon = campaign?.presentation_type === 'balloon_pop'
    if (!isBalloon) return { isBalloon: false, boardExists: false, takeover: null }

    const { data: board } = await svc
      .from('campaign_live_boards')
      .select(
        'site_takeover_enabled, site_takeover_headline, site_takeover_subtext, site_takeover_primary_label, site_takeover_watch_url, site_takeover_updated_at',
      )
      .eq('campaign_id', campaignId)
      .maybeSingle()

    if (!board) return { isBalloon: true, boardExists: false, takeover: null }

    return {
      isBalloon: true,
      boardExists: true,
      takeover: {
        enabled: board.site_takeover_enabled === true,
        headline: board.site_takeover_headline ?? null,
        subtext: board.site_takeover_subtext ?? null,
        primaryLabel: board.site_takeover_primary_label ?? null,
        watchUrl: board.site_takeover_watch_url ?? null,
        updatedAt: board.site_takeover_updated_at ?? null,
      },
    }
  } catch (err: any) {
    console.error('[homepage-hero] admin live state read error:', err?.message)
    return { isBalloon: false, boardExists: false, takeover: null }
  }
}

/**
 * Resolve the render-ready hero from the ALREADY-loaded eligible homepage
 * payloads (no extra list query). Returns null when the slot is hidden or the
 * selected campaign is not currently eligible/live.
 *
 * State logic (exactly per the approved brief):
 *   selected campaign
 *     -> not Balloon Pop            => FEATURED
 *     -> Balloon Pop
 *          -> THIS campaign's board site_takeover_enabled = true => LIVE
 *          -> otherwise                                          => FEATURED
 */
export async function loadHomepageHero(
  eligiblePayloads: any[],
): Promise<HomepageHeroData | null> {
  try {
    const { heroCampaignId, heroBadge } = await loadHomepageHeroConfig()
    if (!heroCampaignId) return null

    const payload = eligiblePayloads.find(
      (p: any) => String(p?.id) === String(heroCampaignId),
    )
    // Selected campaign is no longer live/eligible: hide the slot cleanly.
    if (!payload) return null

    const sold = Number(payload.tickets_sold ?? 0)
    const cap = Number(payload.hard_cap_total_tickets ?? 0)
    const percentSold = cap > 0 ? Math.min(100, Math.floor((sold / cap) * 100)) : null
    const ticketsLeft = cap > 0 ? Math.max(0, cap - sold) : null
    const endMs = payload.ends_at ? new Date(payload.ends_at).getTime() : Number.NaN

    const base: Omit<HomepageHeroData, 'state'> = {
      badge: heroBadge,
      campaignId: String(payload.id),
      slug: payload.slug ?? null,
      title: payload.title ?? null,
      prizeTitle: payload.prize_title ?? null,
      heroImageUrl: payload.hero_image_url ?? null,
      // Optional promo video rides inside the snapshot payload (no extra query,
      // no Storage lookup on render). Absent key => null => poster-only.
      promoVideoUrl:
        typeof payload.promo_video_url === 'string' && payload.promo_video_url.trim()
          ? payload.promo_video_url.trim()
          : null,
      promoVideoDurationS:
        typeof payload.promo_video_duration_s === 'number' &&
        payload.promo_video_duration_s > 0
          ? Math.floor(payload.promo_video_duration_s)
          : null,
      endsAtMs: Number.isFinite(endMs) ? endMs : null,
      basePricePence: payload.base_ticket_price_pence ?? null,
      wasPricePence: payload.was_ticket_price_pence ?? null,
      ticketsSold: sold,
      hardCap: cap,
      percentSold,
      ticketsLeft,
      instantWinsRemaining:
        typeof payload.instant_wins_remaining_count === 'number'
          ? Math.max(0, Math.floor(payload.instant_wins_remaining_count))
          : null,
      instantCashRemainingPence:
        typeof payload.instant_cash_remaining_pence === 'number' &&
        payload.instant_cash_remaining_pence >= 0
          ? Math.floor(payload.instant_cash_remaining_pence)
          : null,
      isFreeEntry: payload.is_free_entry === true,
      watchUrl: null,
      totalLeft: 0,
      vipLeft: 0,
      hasPrizeBoard: false,
      liveHeadline: null,
      liveSubtext: null,
      livePrimaryLabel: null,
      lastEventLabel: null,
      lastEventAt: null,
    }

    // Non-balloon selections are always the Featured design.
    if (classifyGiveaway(payload) !== 'live_balloon') {
      return { ...base, state: 'featured' }
    }

    // Balloon Pop: gate LIVE strictly on THIS campaign's own board.
    const svc = getServiceSupabase()
    const { data: board } = await svc
      .from('campaign_live_boards')
      .select(
        'site_takeover_enabled, site_takeover_watch_url, site_takeover_headline, site_takeover_subtext, site_takeover_primary_label, items, last_event_label, last_event_at',
      )
      .eq('campaign_id', base.campaignId)
      .maybeSingle()

    if (!board || board.site_takeover_enabled !== true) {
      return { ...base, state: 'featured' }
    }

    const items = normalizeStoredItems(board.items)
    let totalLeft = 0
    let vipLeft = 0
    for (const it of items) {
      const r = it.remaining > 0 ? it.remaining : 0
      totalLeft += r
      if (it.type === 'vip') vipLeft += r
    }

    const clean = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null

    const rawWatch = board.site_takeover_watch_url
    const watchUrl =
      typeof rawWatch === 'string' && rawWatch.trim() ? rawWatch.trim() : null

    return {
      ...base,
      state: 'live',
      watchUrl,
      totalLeft,
      vipLeft,
      hasPrizeBoard: items.length > 0,
      liveHeadline: clean(board.site_takeover_headline),
      liveSubtext: clean(board.site_takeover_subtext),
      livePrimaryLabel: clean(board.site_takeover_primary_label),
      lastEventLabel: clean(board.last_event_label),
      lastEventAt: clean(board.last_event_at),
    }
  } catch (err: any) {
    console.error('[homepage-hero] load error:', err?.message)
    return null
  }
}
