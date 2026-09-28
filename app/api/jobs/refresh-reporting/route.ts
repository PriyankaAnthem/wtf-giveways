import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Cron job: incrementally refresh the reporting_sales_minute rollup.
 *
 * Auth mirrors /api/jobs/run:
 *   A) manual trigger via Bearer CRON_SECRET or ?token=CRON_SECRET
 *   B) Vercel cron via x-vercel-cron header / vercel-cron UA
 *
 * The heavy lifting + advisory lock live in the SQL function
 * `refresh_sales_reporting_job(p_lookback_minutes)`, so overlapping invocations
 * are safe (a concurrent run simply reports skipped=true).
 *
 * Normal recurring lookback is 15 minutes (small, indexed, bounded). A wider
 * reconciliation catch-up can be requested explicitly via ?lookback_minutes=,
 * clamped in SQL to at most 7 days; it must NOT be run every minute.
 */
async function handleRefresh(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const tokenParam = request.nextUrl.searchParams.get('token')
  const expectedToken = process.env.CRON_SECRET

  const isManualTrigger = !!(
    expectedToken &&
    (authHeader === `Bearer ${expectedToken}` || tokenParam === expectedToken)
  )
  const isVercelCron =
    request.headers.get('x-vercel-cron') === '1' ||
    request.headers.has('x-vercel-cron-job') ||
    (request.headers.get('user-agent') ?? '').includes('vercel-cron')

  if (!isManualTrigger && !isVercelCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'missing_supabase_service_config' },
      { status: 500, headers: NO_STORE },
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Normal recurring lookback is 15 minutes. An explicit ?lookback_minutes=
  // override is allowed for manual reconciliation catch-up (SQL clamps to 7 days),
  // but the scheduled cron passes no override and therefore uses 15.
  const lookbackParam = Number(request.nextUrl.searchParams.get('lookback_minutes'))
  const lookbackMinutes =
    Number.isFinite(lookbackParam) && lookbackParam > 0 ? Math.floor(lookbackParam) : 15

  const startedAt = Date.now()
  const { data, error } = await supabase.rpc('refresh_sales_reporting_job', {
    p_lookback_minutes: lookbackMinutes,
  })

  if (error) {
    console.log('[jobs/refresh-reporting] rpc error:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json(
    { ok: true, durationMs: Date.now() - startedAt, result: data ?? null },
    { headers: NO_STORE },
  )
}

export async function GET(request: NextRequest) {
  return handleRefresh(request)
}

export async function POST(request: NextRequest) {
  return handleRefresh(request)
}
