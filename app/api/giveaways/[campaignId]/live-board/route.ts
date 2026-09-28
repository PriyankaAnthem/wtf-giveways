import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase, normalizeStoredItems } from '@/lib/admin/live-board'

/**
 * PUBLIC, read-only Live Balloon Board endpoint.
 *
 * Customer-facing — NO admin auth. Uses the service-role client server-side
 * only (public RLS has no policies), exactly like the sibling `live-count`
 * route. The response is CDN-cacheable so 1,000+ concurrent viewers collapse
 * onto a shared cached payload rather than hammering the database.
 *
 * Only sanitized, public-safe board data is returned. Never event logs,
 * customer, checkout, ticket, payment, or admin/action-history data.
 */

// CDN caching is mandatory here for public performance: a shared cached
// response is served to the crowd, and at most ~1 origin hit every 3s per
// region. Do NOT switch this to no-store.
const PUBLIC_CACHE = {
  headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5' },
}

/** Disabled/ineligible boards return a tiny, still-cacheable payload. */
function disabledResponse() {
  return NextResponse.json({ ok: true, enabled: false }, PUBLIC_CACHE)
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params

  if (!campaignId) {
    return NextResponse.json(
      { ok: false, error: 'missing_campaign_id' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const svc = getServiceSupabase()

    // Gate on campaign status + presentation type.
    const { data: campaign, error: campaignErr } = await svc
      .from('campaigns')
      .select('status, presentation_type')
      .eq('id', campaignId)
      .maybeSingle()

    if (campaignErr) {
      console.error('[public/live-board] campaign query error:', campaignErr.message)
      // Fail soft: treat as disabled so the public page never errors.
      return disabledResponse()
    }

    if (!campaign || campaign.status !== 'live' || campaign.presentation_type !== 'balloon_pop') {
      return disabledResponse()
    }

    // Board must exist and be enabled.
    const { data: boardRow, error: boardErr } = await svc
      .from('campaign_live_boards')
      .select('enabled, items, last_event_label, last_event_at, updated_at')
      .eq('campaign_id', campaignId)
      .maybeSingle()

    if (boardErr) {
      console.error('[public/live-board] board query error:', boardErr.message)
      return disabledResponse()
    }

    if (!boardRow || boardRow.enabled !== true) {
      return disabledResponse()
    }

    // Coerce stored items, then strip to public-safe fields only.
    const items = normalizeStoredItems(boardRow.items).map((it) => ({
      id: it.id,
      label: it.label,
      type: it.type,
      amountPence: it.amountPence,
      starting: it.starting,
      remaining: it.remaining,
      featured: it.featured,
    }))

    let totalRemaining = 0
    let standardRemaining = 0
    let vipRemaining = 0
    for (const it of items) {
      const r = it.remaining > 0 ? it.remaining : 0
      totalRemaining += r
      if (it.type === 'vip') vipRemaining += r
      else standardRemaining += r
    }

    return NextResponse.json(
      {
        ok: true,
        enabled: true,
        campaignId,
        updatedAt: boardRow.updated_at ?? null,
        lastEventLabel: boardRow.last_event_label ?? null,
        lastEventAt: boardRow.last_event_at ?? null,
        totals: { totalRemaining, standardRemaining, vipRemaining },
        items,
      },
      PUBLIC_CACHE,
    )
  } catch (err: any) {
    console.error('[public/live-board] unexpected error:', err?.message)
    // Fail soft so the public giveaway page is never broken by this panel.
    return disabledResponse()
  }
}
