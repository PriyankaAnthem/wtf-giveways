import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { getServiceSupabase, normalizeStoredItems } from '@/lib/admin/live-board'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache, no-store' } }

/**
 * GET /api/admin/live-feed/campaigns
 *
 * Admin + Host (ops) only. Returns the currently LIVE campaigns so a host can
 * pick the one they are hosting. Lightweight: no customer, checkout, or ticket
 * data — just campaign metadata plus a small live-board summary.
 */
export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  try {
    const svc = getServiceSupabase()

    const { data: campaigns, error: campaignsErr } = await svc
      .from('campaigns')
      .select('id, title, slug, status, presentation_type')
      .eq('status', 'live')
      .order('title', { ascending: true })

    if (campaignsErr) {
      console.error('[admin/live-feed/campaigns] campaigns query error:', campaignsErr.message)
      return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
    }

    const liveCampaigns = campaigns ?? []
    if (liveCampaigns.length === 0) {
      return NextResponse.json({ ok: true, campaigns: [] }, NO_STORE)
    }

    // Pull any live boards for these campaigns in one query.
    const campaignIds = liveCampaigns.map((c) => c.id)
    const { data: boards, error: boardsErr } = await svc
      .from('campaign_live_boards')
      .select('campaign_id, enabled, items')
      .in('campaign_id', campaignIds)

    if (boardsErr) {
      console.error('[admin/live-feed/campaigns] boards query error:', boardsErr.message)
      return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
    }

    const boardMap = new Map((boards ?? []).map((b) => [b.campaign_id, b]))

    const result = liveCampaigns.map((c) => {
      const board = boardMap.get(c.id)
      let totalRemaining: number | null = null
      if (board) {
        // Sum remaining defensively from stored jsonb items.
        totalRemaining = normalizeStoredItems(board.items).reduce(
          (sum, item) => sum + (item.remaining > 0 ? item.remaining : 0),
          0,
        )
      }
      return {
        id: c.id as string,
        title: (c.title ?? 'Untitled') as string,
        slug: (c.slug ?? '') as string,
        status: (c.status ?? '') as string,
        presentationType: (c.presentation_type ?? null) as string | null,
        boardExists: Boolean(board),
        boardEnabled: Boolean(board?.enabled),
        totalRemaining,
      }
    })

    return NextResponse.json({ ok: true, campaigns: result }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/live-feed/campaigns] unexpected error:', err?.message)
    return NextResponse.json({ ok: false, error: 'live_feed_failed' }, { status: 500, ...NO_STORE })
  }
}
