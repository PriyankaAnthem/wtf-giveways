import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params

  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'missing_campaign_id' }, { status: 400, ...NO_STORE })
  }

  try {
    const supabase = getServiceSupabase()

    const { data: counter, error } = await supabase
      .from('giveaway_ticket_counters')
      .select('next_ticket')
      .eq('giveaway_id', campaignId)
      .maybeSingle()

    if (error) {
      console.error('[live-count] query error:', error.message)
      return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500, ...NO_STORE })
    }

    const soldCount = Math.max((counter?.next_ticket ?? 1) - 1, 0)

    return NextResponse.json({ ok: true, soldCount }, NO_STORE)
  } catch (err: any) {
    console.error('[live-count] unexpected error:', err?.message)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500, ...NO_STORE })
  }
}
