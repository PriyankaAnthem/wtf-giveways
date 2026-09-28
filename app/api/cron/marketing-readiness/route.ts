import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Fixed, non-overridable readiness batch ceiling. The RPC additionally clamps
// this to [1, 500], so this constant is only an upper request bound — never a
// way to widen the DB's own limit.
const READINESS_LIMIT = 100

/**
 * Vercel Cron trigger for the marketing RUN READINESS RPC
 * `public.queue_prepared_marketing_runs(p_limit)` (script 023).
 *
 * Vercel Cron invokes configured paths with GET and automatically attaches
 * `Authorization: Bearer <CRON_SECRET>`. This route shares the SAME strict auth
 * contract as the other marketing crons.
 *
 * SCOPE — RUN READINESS ONLY. This route:
 *   - authenticates, then calls the readiness RPC exactly once with a FIXED
 *     p_limit of 100 (no query-string override), and
 *   - returns only the RPC's already-compact, identity-free JSON stats.
 *
 * It owns NO readiness logic. The RPC transitions a run preparing -> queued ONLY
 * when every recipient in that run is content_prepared (the delivery-ready state
 * the claim RPC consumes). This route NEVER claims, sends, or invokes the
 * delivery worker / Resend / any provider, and sends NO email. Transitioning a
 * run to 'queued' makes it CLAIMABLE by the separate delivery cron ONLY when
 * global sending is enabled AND MARKETING_DELIVERY_WORKER_ENABLED is set — this
 * route changes neither of those switches.
 *
 * SAFETY:
 *   - GET ONLY. No body, no accepted parameters.
 *   - Missing/blank CRON_SECRET => 503 (fail closed; RPC NOT called; no client).
 *   - Absent/wrong `Authorization: Bearer <CRON_SECRET>` => 401 (RPC NOT called).
 *   - The service-role client is built ONLY after successful authentication.
 *   - RPC error => fail closed with a STABLE public code; the raw DB message is
 *     logged server-side only, never returned.
 */
export async function GET(request: NextRequest) {
  const expectedToken = process.env.CRON_SECRET
  if (!expectedToken) {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'missing_supabase_service_config' },
      { status: 500, headers: NO_STORE },
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Exactly one readiness invocation with a FIXED limit. No request input is ever
  // forwarded. The all-recipients-prepared contract remains the RPC's authority.
  const { data, error } = await supabase.rpc('queue_prepared_marketing_runs', {
    p_limit: READINESS_LIMIT,
  })

  if (error) {
    console.log('[cron/marketing-readiness] rpc error:', error.message)
    return NextResponse.json(
      { ok: false, error: 'readiness_failed' },
      { status: 500, headers: NO_STORE },
    )
  }

  const result = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
}
