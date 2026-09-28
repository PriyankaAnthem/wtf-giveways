import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

// Shape-only validation: a positive, safe integer. The UPPER bound is NOT a
// fixed constant — it is the campaign's ticket capacity, enforced separately
// once the campaign has been resolved (see POST).
function validateQuantity(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || !Number.isSafeInteger(n) || n < 1) return null
  return n
}

// Canonical UUID (any version) matcher.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim())
}

// The exact known database exception raised by
// admin_set_instant_win_prize_quantity when a reduction would drop below the
// number of already assigned/claimed slots.
const REDUCTION_BLOCKED_EXCEPTION = 'quantity_below_assigned_or_claimed_slots'

// The database function currently enforces its OWN hardcoded ceiling of 10,000
// and raises this exception above it. Until that ceiling is lifted in the RPC,
// map it to a clear 400 so admins see an explanation instead of a raw 500.
// NOTE: this is a known outstanding blocker — quantities above 10,000 cannot
// be saved until admin_set_instant_win_prize_quantity is updated.
const RPC_HARD_CAP = 10000
const RPC_INVALID_QUANTITY_EXCEPTION = 'invalid_prize_quantity'

/**
 * Dedicated quantity-reconciliation endpoint.
 *
 * Quantity is intentionally NOT editable through the ordinary prize PUT.
 * Changing it must go through the staging RPC
 * `admin_set_instant_win_prize_quantity`, which:
 *   - adds only the missing slots when increasing;
 *   - deletes only unassigned & unclaimed slots when decreasing;
 *   - protects assigned/claimed slots;
 *   - is idempotent across repeated saves.
 *
 * The RPC is called ONLY from this admin-authorised server route using the
 * service-role client. It is never called from the browser.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return NextResponse.json({ ok: false, error: authError }, { status: authError === 'Not authenticated' ? 401 : 403 })
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  // Strictly validate identifiers as UUIDs before any service-role query or RPC.
  if (!isUuid(body.id) || !isUuid(body.campaign_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400 })
  }
  const prizeId = (body.id as string).trim()
  const campaignId = (body.campaign_id as string).trim()

  const newQuantity = validateQuantity(body.quantity)
  if (newQuantity === null) {
    return NextResponse.json({ ok: false, error: 'invalid_quantity' }, { status: 400 })
  }

  const svc = getServiceSupabase()

  // Confirm the prize exists (and scope it to the campaign) before the RPC.
  const { data: current, error: curErr } = await svc
    .from('instant_win_prizes')
    .select('quantity')
    .eq('id', prizeId)
    .eq('campaign_id', campaignId)
    .maybeSingle()

  if (curErr) {
    console.error('[instant-win-prizes/quantity] lookup error:', curErr.message)
    return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
  }
  if (!current) {
    return NextResponse.json({ ok: false, error: 'Prize not found' }, { status: 404 })
  }

  // Authoritative capacity check: the quantity may not exceed the campaign's
  // total ticket capacity. A NULL cap means the campaign is uncapped, so no
  // upper bound applies. The maximum is never a client-supplied value.
  const { data: campaignRow, error: capErr } = await svc
    .from('campaigns')
    .select('max_tickets_total')
    .eq('id', campaignId)
    .maybeSingle()

  if (capErr) {
    console.error('[instant-win-prizes/quantity] campaign lookup error:', capErr.message)
    return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
  }
  if (!campaignRow) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 })
  }

  const capacity = campaignRow.max_tickets_total
  if (capacity != null && newQuantity > capacity) {
    return NextResponse.json(
      {
        ok: false,
        error: 'quantity_exceeds_capacity',
        message: `Quantity cannot exceed this campaign's ticket capacity of ${capacity.toLocaleString('en-GB')}.`,
      },
      { status: 400 },
    )
  }

  const { error: rpcErr } = await svc.rpc('admin_set_instant_win_prize_quantity', {
    p_prize_id: prizeId,
    p_campaign_id: campaignId,
    p_new_quantity: newQuantity,
  })

  if (rpcErr) {
    // Never expose raw database exception text to the browser. Map ONLY the
    // known reduction-blocked exception to a 409; every other RPC failure —
    // whether the request increases or reduces quantity — is a generic 500.
    const rawMessage = typeof rpcErr.message === 'string' ? rpcErr.message : ''
    console.error('[instant-win-prizes/quantity] RPC error:', rawMessage.slice(0, 300))

    if (rawMessage.includes(REDUCTION_BLOCKED_EXCEPTION)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'quantity_reduction_blocked',
          message: 'Quantity cannot be reduced because some prize positions are already assigned or won.',
        },
        { status: 409 },
      )
    }

    // Known outstanding blocker: the RPC still caps quantity at 10,000.
    if (rawMessage.includes(RPC_INVALID_QUANTITY_EXCEPTION)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'quantity_exceeds_rpc_limit',
          message: `Quantity is currently limited to ${RPC_HARD_CAP.toLocaleString('en-GB')} per prize. Higher amounts are not yet supported.`,
        },
        { status: 400 },
      )
    }

    return NextResponse.json(
      { ok: false, error: 'quantity_update_failed', message: 'Could not update quantity. Please try again.' },
      { status: 500 },
    )
  }

  // Re-read the reconciled quantity to return the authoritative value.
  const { data: after, error: afterErr } = await svc
    .from('instant_win_prizes')
    .select('quantity')
    .eq('id', prizeId)
    .eq('campaign_id', campaignId)
    .maybeSingle()

  if (afterErr || !after) {
    return NextResponse.json({ ok: true, quantity: newQuantity })
  }

  return NextResponse.json({ ok: true, quantity: after.quantity ?? newQuantity })
}
