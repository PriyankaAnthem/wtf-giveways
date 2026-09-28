import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeAuthoritativeSubtotal, normalizeBundlePence, normalizeQty } from '@/lib/checkout/pricing'
import { validateDiscountCode } from '@/lib/discounts/validateDiscountCode'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

/**
 * Provisional discount-code validation for the (future) Apply button.
 *
 * This endpoint is ADVISORY ONLY. It computes the same authoritative subtotal
 * as checkout-create (via the shared pricing helper) and runs the same shared
 * discount validator, but it NEVER creates a checkout intent, reserves wallet
 * credit or opens a payment session. A successful response is not proof that
 * the code will still be valid at checkout — the create route always
 * re-validates everything from scratch.
 */
export async function POST(request: Request) {
  // Require a real authenticated user (no bypass).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401, ...NO_STORE })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, ...NO_STORE })
  }

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : undefined
  const qty = normalizeQty(body.qty)
  const bundlePricePence = normalizeBundlePence(body.bundlePricePence)
  const code = typeof body.code === 'string' ? body.code : ''

  if (!campaignId) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid campaignId' }, { status: 400, ...NO_STORE })
  }
  if (qty == null) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid qty' }, { status: 400, ...NO_STORE })
  }

  // 1) Load the authoritative campaign (RLS-scoped client).
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, ticket_price_pence, bundles')
    .eq('id', campaignId)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 400, ...NO_STORE })
  }

  // 2/3/4) Validate the bundle and compute the SAME authoritative subtotal used
  // by checkout-create.
  const subtotalResult = computeAuthoritativeSubtotal(campaign, qty, bundlePricePence)
  if (!subtotalResult.ok) {
    const badBundle = subtotalResult.code === 'invalid_bundle'
    return NextResponse.json(
      { ok: false, error: badBundle ? 'Invalid bundle' : 'Invalid pricing' },
      { status: 400, ...NO_STORE },
    )
  }
  const subtotalPence = subtotalResult.subtotalPence

  // 5) Run the shared discount validator.
  const discountResult = await validateDiscountCode({
    campaignId,
    subtotalPence,
    submittedCode: code,
  })

  if (!discountResult.ok) {
    return NextResponse.json(
      { ok: false, error: discountResult.code },
      { status: discountResult.status, ...NO_STORE },
    )
  }

  // A provisional request with no (or empty) code is not a meaningful discount
  // preview — surface it with the same stable "invalid" code.
  if (!discountResult.discount) {
    return NextResponse.json(
      { ok: false, error: 'discount_code_invalid' },
      { status: 400, ...NO_STORE },
    )
  }

  const d = discountResult.discount

  // 6) Provisional pricing result. No intent, no reservation, no session.
  return NextResponse.json(
    {
      ok: true,
      pricing: {
        subtotalPence: discountResult.subtotalPence,
        discountPence: d.discountPence,
        totalPence: discountResult.totalPence,
      },
      discount: {
        code: d.code,
        discountType: d.discountType,
        discountValue: d.discountValue,
        scope: d.scope,
      },
    },
    NO_STORE,
  )
}
