import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Fixed, non-overridable preparation batch ceiling. The RPC additionally clamps
// this to [1, 500], so this constant is only an upper request bound — never a
// way to widen the DB's own limit.
const PREPARATION_LIMIT = 100

/**
 * Vercel Cron trigger for the marketing CONTENT PREPARATION RPC
 * `public.prepare_marketing_recipient_content(p_limit)` (script 023).
 *
 * Vercel Cron invokes configured paths with GET and automatically attaches
 * `Authorization: Bearer <CRON_SECRET>`. This route shares the SAME strict auth
 * contract as the marketing-discovery / marketing-materialisation crons.
 *
 * SCOPE — CONTENT PREPARATION ONLY. This route:
 *   - authenticates, then calls the preparation RPC exactly once with a FIXED
 *     p_limit of 100 (no query-string override), and
 *   - returns only the RPC's already-compact, identity-free JSON stats.
 *
 * It owns NO preparation logic and NO gating. Eligibility (the Stage 022 gate),
 * snapshot resolution, and the VERSION 1 validation all live inside the RPC and
 * remain authoritative. Preparation only populates template_snapshot +
 * context_snapshot on eligible recipients; it NEVER transitions runs, invokes
 * the delivery worker, materialisation, discovery, Resend, or any provider, and
 * sends NO email. Enabling sending has no effect on this route.
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

  // Exactly one preparation invocation with a FIXED limit. No request input is
  // ever forwarded. Eligibility + snapshot validation remain the RPC's authority.
  const { data, error } = await supabase.rpc('prepare_marketing_recipient_content', {
    p_limit: PREPARATION_LIMIT,
  })

  if (error) {
    console.log('[cron/marketing-preparation] rpc error:', error.message)
    return NextResponse.json(
      { ok: false, error: 'preparation_failed' },
      { status: 500, headers: NO_STORE },
    )
  }

  const result = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
}
