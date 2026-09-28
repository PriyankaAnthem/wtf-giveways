import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Fixed, non-overridable discovery batch ceiling. The RPC additionally clamps
// this to [1, 500] and to maximum_batch_size/rollout_limit, so this constant is
// only an upper request bound — never a way to widen the DB's own limits.
const DISCOVERY_LIMIT = 100

/**
 * Vercel Cron trigger for the EXISTING marketing opportunity discovery RPC
 * `public.discover_marketing_opportunities(p_limit)` (script 013).
 *
 * Vercel Cron invokes configured paths with GET and automatically attaches
 * `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set on the project.
 * This route is the GET-only sibling of the marketing-delivery cron and shares
 * the SAME strict auth contract.
 *
 * SCOPE — DISCOVERY ONLY. This route:
 *   - authenticates, then calls the discovery RPC exactly once with a FIXED
 *     p_limit of 100 (no query-string override of any kind), and
 *   - returns only the RPC's already-compact, identity-free JSON stats.
 *
 * It owns NO discovery logic and NO gating. Detection, the `discovery_enabled`
 * gate, `rollout_limit > 0`, per-definition `enabled`, dedupe, and the insert
 * ceiling all live inside the RPC and remain authoritative — this handler never
 * reads, reproduces, or weakens them. It NEVER invokes the delivery worker,
 * recipient materialisation, Resend, or any provider, and sends no email.
 *
 * SAFETY:
 *   - GET ONLY. No body, no accepted parameters. Nothing from the request can
 *     change the limit or any discovery behaviour.
 *   - Missing/blank CRON_SECRET => 503 (fail closed; RPC NOT called; no client).
 *   - Absent/wrong `Authorization: Bearer <CRON_SECRET>` => 401 (RPC NOT called;
 *     no Supabase client constructed).
 *   - The service-role client is built ONLY after successful authentication.
 *   - RPC error => fail closed with a STABLE public code; the raw DB message is
 *     logged server-side only, never returned.
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

  // Build the service-role client ONLY after successful authentication.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'missing_supabase_service_config' },
      { status: 500, headers: NO_STORE },
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Exactly one discovery invocation with a FIXED limit. No request input is
  // ever forwarded. The DB gates (discovery_enabled, rollout_limit,
  // per-definition enabled) remain the sole authority over what is discovered.
  const { data, error } = await supabase.rpc('discover_marketing_opportunities', {
    p_limit: DISCOVERY_LIMIT,
  })

  if (error) {
    // Log server-side for debugging; return a STABLE public code only.
    console.log('[cron/marketing-discovery] rpc error:', error.message)
    return NextResponse.json(
      { ok: false, error: 'discovery_failed' },
      { status: 500, headers: NO_STORE },
    )
  }

  // The RPC already returns compact, identity-free stats (no emails/user ids).
  const result = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
}
