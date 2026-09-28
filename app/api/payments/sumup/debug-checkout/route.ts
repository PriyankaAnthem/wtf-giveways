import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

export async function POST(request: Request) {
  // 1) Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
  }

  // 2) Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const ref = body.ref as string | undefined
  if (!ref || typeof ref !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing ref' }, { status: 400 })
  }

  // 3) Fetch checkout_intent
  const svc = getServiceSupabase()
  const { data: intent, error: intentErr } = await svc
    .from('checkout_intents')
    .select('ref, provider_session_id, total_pence, currency, state, provider')
    .eq('ref', ref)
    .single()

  if (intentErr || !intent) {
    return NextResponse.json({ ok: false, error: 'Intent not found' }, { status: 404 })
  }

  if (!intent.provider_session_id) {
    return NextResponse.json({ ok: false, error: 'No provider_session_id on this intent' }, { status: 400 })
  }

  // 4) Call SumUp GET
  const sumupToken = process.env.SUMUP_ACCESS_TOKEN
  if (!sumupToken) {
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500 })
  }

  let sumupStatus = 0
  let sumupRaw = ''

  try {
    const res = await fetch(
      `https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(intent.provider_session_id)}`,
      { headers: { Authorization: `Bearer ${sumupToken}` } },
    )
    sumupStatus = res.status
    sumupRaw = await res.text().catch(() => '')
  } catch (err: any) {
    sumupRaw = `fetch error: ${err?.message || 'unknown'}`
  }

  return NextResponse.json({
    ok: true,
    ref,
    checkoutId: intent.provider_session_id,
    intent: {
      state: intent.state,
      total_pence: intent.total_pence,
      currency: intent.currency,
      provider: intent.provider,
    },
    sumup_status: sumupStatus,
    sumup_raw: sumupRaw,
  })
}
