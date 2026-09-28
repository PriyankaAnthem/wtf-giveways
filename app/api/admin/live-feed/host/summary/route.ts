import { type NextRequest, NextResponse } from 'next/server'
import { getHostLiveSummary } from '@/lib/admin/host-live-summary'

/**
 * GET /api/admin/live-feed/host/summary?campaignId=<optional>
 *
 * Compact live-performance summary (Revenue Today / Instants Today / Comp Total)
 * for the AUTHENTICATED host. Identity is derived from the session inside
 * getHostLiveSummary() — this route trusts NO user id from the query. The
 * optional `campaignId` is clamped server-side to the host's assigned
 * campaigns, so tampering with another host's id returns an all-zero summary.
 *
 * Polled ~every 30s by the client (separate from the 10s winner feed). The
 * figures come from the ~1-minute reporting rollup + a daily award count, so a
 * faster poll would add load without adding freshness. Always no-store.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get('campaignId')
  const result = await getHostLiveSummary({ campaignId })

  if (!result.ok) {
    const status = result.error === 'unauthorized' ? 403 : 500
    return NextResponse.json(
      { ok: false, error: result.error },
      { status, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { ok: true, ...result.data },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
