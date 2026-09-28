import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { normalizeAwardPayload } from '@/lib/payments/confirmPaymentAndAward'

const VERSION = 'simulate-confirmed-v3'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  // Auth
  const tokenParam = request.nextUrl.searchParams.get('token')
  const expectedToken = process.env.CRON_SECRET
  if (!expectedToken || tokenParam !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing Supabase env vars' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // Parse params
  const campaignId = request.nextUrl.searchParams.get('campaignId')
  const userId = request.nextUrl.searchParams.get('userId')
  const qty = parseInt(request.nextUrl.searchParams.get('qty') || '1', 10)

  if (!campaignId || !userId) {
    return NextResponse.json({ error: 'Missing campaignId or userId' }, { status: 400 })
  }

  try {
    // 1) Fetch campaign for price calculation
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id, ticket_price_pence')
      .eq('id', campaignId)
      .single()

    if (campErr || !campaign) {
      return NextResponse.json({ error: 'Campaign not found', details: campErr }, { status: 404 })
    }

    const totalPence = qty * (campaign.ticket_price_pence ?? 0)
    const nowIso = new Date().toISOString()
    const ref = `SIM-${Date.now()}`

    // 2) Create checkout_intent (state=pending, not yet confirmed)
    const { data: intent, error: intentErr } = await supabase
      .from('checkout_intents')
      .insert({
        ref,
        idempotency_key: randomUUID(),
        user_id: userId,
        campaign_id: campaignId,
        qty,
        total_pence: totalPence,
        currency: 'GBP',
        provider: 'debug',
        state: 'pending',
      })
      .select('id, ref')
      .single()

    if (intentErr || !intent) {
      return NextResponse.json({ error: 'Failed to create checkout_intent', details: intentErr }, { status: 500 })
    }

    // 3) Delegate ALL confirmation + entry + award logic to the DB RPC
    const { data: rpcData, error: rpcErr } = await supabase
      .rpc('confirm_payment_and_award', {
        p_ref: intent.ref,
        p_user_id: userId,
      })

    if (rpcErr) {
      console.error('[simulate-confirmed] RPC error:', rpcErr)
      return NextResponse.json({ error: 'RPC failed', details: rpcErr.message }, { status: 500 })
    }

    // Normalise through the shared normaliser so the debug payload always
    // exposes a `prizes` array (backward compatible with the singular `prize`).
    const award = normalizeAwardPayload(rpcData)

    return NextResponse.json({
      version: VERSION,
      ok: true,
      ...award,
    })
  } catch (err: any) {
    console.error('[simulate-confirmed] Unexpected error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
