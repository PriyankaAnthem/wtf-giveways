import { NextRequest, NextResponse } from 'next/server'
import { runMarketingDeliveryBatch } from '@/lib/marketing/delivery-worker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Vercel Cron trigger for the EXISTING marketing delivery worker.
 *
 * Vercel Cron invokes configured paths with GET and automatically attaches
 * `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set on the project.
 * This route is therefore the GET sibling of the manual POST job route
 * (app/api/jobs/marketing-delivery) — it shares the SAME strict auth contract
 * and calls the SAME worker directly server-side.
 *
 * It intentionally owns NO delivery logic. Claiming, recovery, JIT
 * authorization, Resend sending, success/failure finalization, frequency,
 * rollout, and consent all live inside runMarketingDeliveryBatch and the DB
 * RPCs. This handler only authenticates and forwards.
 *
 * SAFETY (unchanged authorities):
 *   - GET ONLY. No query-string auth, no body, no parameter accepted. Nothing
 *     from the request can override recipient, batch size, rollout, automation,
 *     sending, or any worker behaviour.
 *   - Missing CRON_SECRET => 503 (fail closed; worker NOT called).
 *   - Absent/wrong `Authorization: Bearer <CRON_SECRET>` => 401 (worker NOT
 *     called; no Supabase/Resend/worker touched).
 *   - The worker's own kill switch (MARKETING_DELIVERY_WORKER_ENABLED) and the
 *     DB controls (sending_enabled, rollout_limit, automation/definition enabled
 *     state, consent, frequency) remain authoritative — this route never reads,
 *     weakens, or reproduces them.
 *   - Returns ONLY the worker's already-safe aggregate summary; no retries.
 */
export async function GET(request: NextRequest) {
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
