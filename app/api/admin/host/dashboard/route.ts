import { NextResponse } from 'next/server'
import { getHostDashboard } from '@/lib/admin/host-dashboard'

/**
 * GET /api/admin/host/dashboard
 *
 * Host-scoped dashboard payload for the AUTHENTICATED host. Identity is derived
 * from the session inside getHostDashboard() — this route accepts NO
 * host_user_id (or any) query parameter, so a host cannot request another
 * host's data by editing the URL.
 *
 * Used by the client dashboard for background revalidation (~45s) so figures
 * stay fresh while the previous values remain visible. Never cached.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await getHostDashboard()

  if (!result.ok) {
    const status = result.error === 'unauthorized' ? 403 : 500
    return NextResponse.json(
      { error: result.error },
      { status, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
