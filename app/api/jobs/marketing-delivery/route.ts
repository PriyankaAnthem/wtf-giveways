import { NextRequest, NextResponse } from 'next/server'
import { runMarketingDeliveryBatch } from '@/lib/marketing/delivery-worker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Protected job route: trigger ONE marketing-delivery batch.
 *
 * This is a high-risk route (it can cause real marketing sends once the DB
 * controls + the app kill switch are all enabled), so it is intentionally the
 * STRICTER variant of the repo's job-auth convention:
 *
 *   - POST ONLY. No GET, no query-string auth, no public convenience endpoint.
 *   - Requires `Authorization: Bearer <CRON_SECRET>` — exact match only.
 *   - Missing CRON_SECRET => 503 (fail closed; worker NOT called).
 *   - Wrong/absent header => 401 (worker NOT called; no DB/provider call).
 *
 * The request carries NO parameters: it merely triggers runMarketingDeliveryBatch().
 * There is no override for recipient, email, campaign, automation, definition,
 * sending, rollout, batch size, lease duration, retry delay, provider, template,
 * or claim. The application kill switch + DB controls remain authoritative inside
 * the worker. The response is the worker's aggregate, identity-free summary.
 */
export async function POST(request: NextRequest) {
  const expectedToken = process.env.CRON_SECRET
  if (!expectedToken) {
    // Fail closed: without a configured secret the endpoint cannot be trusted.
    return NextResponse.json(
      { ok: false, error: 'cron_not_configured' },
      { status: 503, headers: NO_STORE },
    )
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    )
  }

  // Authorized. The worker owns the kill switch, service-role client, and all
  // delivery logic. We pass NOTHING from the request.
  const summary = await runMarketingDeliveryBatch()

  return NextResponse.json({ ok: true, ...summary }, { headers: NO_STORE })
}
