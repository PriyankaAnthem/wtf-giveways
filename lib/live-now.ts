import 'server-only'
import { getServiceSupabase, normalizeStoredItems } from '@/lib/admin/live-board'

/**
 * Public, non-sensitive shape for the "LIVE NOW" site takeover. Only the fields
 * needed to render the public banner are ever exposed here.
 */
export interface LiveNowData {
  campaignId: string
  slug: string | null
  title: string | null
  headline: string | null
  subtext: string | null
  primaryLabel: string | null
  watchUrl: string | null
  totalLeft: number
  vipLeft: number
  heroImageUrl: string | null
}

/**
 * Resolve the single currently-enabled site takeover (if any).
 *
 * - Returns null when no takeover is enabled (the common case).
 * - Never throws: any error is swallowed and returns null so the public
 *   homepage/listing always renders.
 * - Uses the service client purely to read a whitelisted, public-safe set of
 *   fields for the ONE enabled takeover. Output is strictly limited to
 *   `LiveNowData`; no admin/audit data is exposed.
 * - No polling and no realtime: this is a one-shot read per request.
 */
export async function getLiveNow(): Promise<LiveNowData | null> {
  try {
    const svc = getServiceSupabase()

    const { data: board, error: boardErr } = await svc
      .from('campaign_live_boards')
      .select(
        'campaign_id, items, site_takeover_headline, site_takeover_subtext, site_takeover_primary_label, site_takeover_watch_url',
      )
      .eq('site_takeover_enabled', true)
      .order('site_takeover_updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (boardErr || !board) return null

    const { data: campaign } = await svc
      .from('campaigns')
      .select('slug, title, hero_image_url')
      .eq('id', board.campaign_id)
      .maybeSingle()

    const items = normalizeStoredItems(board.items)
    let totalLeft = 0
    let vipLeft = 0
    for (const it of items) {
      totalLeft += it.remaining
      if (it.type === 'vip') vipLeft += it.remaining
    }

    return {
      campaignId: board.campaign_id,
      slug: campaign?.slug ?? null,
      title: campaign?.title ?? null,
      headline: board.site_takeover_headline ?? null,
      subtext: board.site_takeover_subtext ?? null,
      primaryLabel: board.site_takeover_primary_label ?? null,
      watchUrl: board.site_takeover_watch_url ?? null,
      totalLeft,
      vipLeft,
      heroImageUrl: campaign?.hero_image_url ?? null,
    }
  } catch (err: any) {
    console.error('[live-now] getLiveNow error:', err?.message)
    return null
  }
}
