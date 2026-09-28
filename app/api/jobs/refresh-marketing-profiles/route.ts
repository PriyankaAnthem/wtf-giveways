import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Cron job: refresh public.customer_marketing_profiles (Stage 1).
 *
 * All the work + advisory lock live in the SQL function
 * `refresh_customer_marketing_profiles(p_backfill_batch_size)`, so overlapping
 * invocations are safe (a concurrent run reports skippedBecauseLocked=true).
 * One batch of backfill runs per tick until complete, then each tick does a
 * small incremental changed-user refresh.
 *
 * AUTH — must NOT rely on a spoofable header. Vercel Cron automatically sends
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is configured, so we
 * require the shared secret via the Authorization header or a ?token= param
 * (for manual runs). The spoofable x-vercel-cron header is intentionally NOT
 * accepted on its own.
 *
 * The response contains ONLY compact operational statistics — never an email,
 * a user id, or a raw SQL error string.
 */
async function handleRefresh(request: NextRequest) {
  const expectedToken = process.env.CRON_SECRET
  if (!expectedToken) {
    // Fail closed: without a configured secret the endpoint cannot be trusted.
    return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 503, headers: NO_STORE })
  }

  const authHeader = request.headers.get('authorization')
  const tokenParam = request.nextUrl.searchParams.get('token')
  const authorized = authHeader === `Bearer ${expectedToken}` || tokenParam === expectedToken

  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
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

  // Optional manual batch-size override for backfill catch-up; SQL clamps to
  // [1, 1000]. The scheduled cron passes nothing and uses the default (500).
  const batchParam = Number(request.nextUrl.searchParams.get('batch_size'))
  const rpcArgs =
    Number.isFinite(batchParam) && batchParam > 0
      ? { p_backfill_batch_size: Math.floor(batchParam) }
      : {}

  const startedAt = Date.now()
  const { data, error } = await supabase.rpc('refresh_customer_marketing_profiles', rpcArgs)

  if (error) {
    // Log server-side for debugging; return a STABLE public code only. The raw
    // DB message is never sent to the caller.
    console.log('[jobs/refresh-marketing-profiles] rpc error:', error.message)
    return NextResponse.json(
      { ok: false, error: 'refresh_failed' },
      { status: 500, headers: NO_STORE },
    )
  }

  // Pass through only the compact, identity-free stats produced by the RPC.
  const result = (data ?? {}) as Record<string, unknown>
  return NextResponse.json(
    {
      ok: true,
      mode: result.mode ?? null,
      skippedBecauseLocked: result.skippedBecauseLocked ?? false,
      processedUsers: result.processedUsers ?? 0,
      backfillComplete: result.backfillComplete ?? null,
      lastSuccessAt: result.lastSuccessAt ?? null,
      durationMs: Date.now() - startedAt,
    },
    { headers: NO_STORE },
  )
}

export async function GET(request: NextRequest) {
  return handleRefresh(request)
}

export async function POST(request: NextRequest) {
  return handleRefresh(request)
}
