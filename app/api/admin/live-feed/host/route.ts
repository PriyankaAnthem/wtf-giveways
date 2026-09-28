import { type NextRequest, NextResponse } from 'next/server'
import { getHostLiveFeed } from '@/lib/admin/host-live-feed'

/**
 * GET /api/admin/live-feed/host?campaignId=<optional>
 *
 * Host-scoped winner feed for the AUTHENTICATED host. Identity is derived from
 * the session inside getHostLiveFeed() — this route trusts NO user id from the
 * query. The optional `campaignId` filter is clamped server-side to the host's
 * assigned campaigns, so URL tampering with another host's campaign id returns
 * an empty feed, never their wins.
 *
 * Polled ~every 10s by the client stream. Always no-store.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get('campaignId')
  const result = await getHostLiveFeed({ campaignId })

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
