import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import type { InstantWinFulfilmentType } from '@/lib/types/instantWins'

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const SELECT_COLUMNS =
  'id, campaign_id, prize_title, prize_value_text, unlock_ratio, image_url, quantity, is_high_value, fulfilment_type, prize_value_pence, created_at'

const FULFILMENT_TYPES: InstantWinFulfilmentType[] = ['cash', 'wallet_credit', 'manual']

// Strict GBP syntax: up to 9 integer digits, optional 1–2 decimal places.
// Rejects negatives, leading +, commas, currency symbols, exponent notation
// (e.g. 1e2) and more than two decimal places.
const GBP_RE = /^\d{1,9}(\.\d{1,2})?$/

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

// Canonical UUID (any version) matcher. Identifiers must be UUID strings
// before any service-role query or RPC call is performed with them.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim())
}

/**
 * Convert an admin-supplied GBP string to integer pence with STRICT syntax.
 * Never trusts client-calculated pence. Returns integer pence or an error.
 */
function parseGbpToPence(raw: unknown): ParseResult<number> {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_amount' }
  const s = raw.trim()
  if (s.length === 0) return { ok: false, error: 'invalid_amount' }
  if (!GBP_RE.test(s)) return { ok: false, error: 'invalid_amount' }

  const [intPart, fracPartRaw = ''] = s.split('.')
  const fracPart = (fracPartRaw + '00').slice(0, 2)
  const pence = Number(intPart) * 100 + Number(fracPart)

  if (!Number.isSafeInteger(pence) || pence < 0) return { ok: false, error: 'invalid_amount' }
  return { ok: true, value: pence }
}

/**
 * Validate fulfilment type + amount together and return the pence to store.
 * - cash / wallet_credit: a positive amount is REQUIRED.
 * - manual: amount may be null, or a positive amount if supplied.
 * `amountProvided === false` means the caller is not changing the amount.
 */
function resolveFulfilmentAmount(
  fulfilment: InstantWinFulfilmentType,
  rawAmount: unknown,
  amountProvided: boolean,
): ParseResult<number | null> {
  const isNullish = rawAmount === null || rawAmount === undefined || (typeof rawAmount === 'string' && rawAmount.trim() === '')

  if (fulfilment === 'cash' || fulfilment === 'wallet_credit') {
    if (isNullish) return { ok: false, error: 'amount_required' }
    const parsed = parseGbpToPence(rawAmount)
    if (!parsed.ok) return parsed
    if (parsed.value <= 0) return { ok: false, error: 'amount_must_be_positive' }
    return { ok: true, value: parsed.value }
  }

  // manual: amount is optional. A missing/blank amount stores null.
  void amountProvided
  if (isNullish) {
    return { ok: true, value: null }
  }
  const parsed = parseGbpToPence(rawAmount)
  if (!parsed.ok) return parsed
  if (parsed.value <= 0) return { ok: false, error: 'amount_must_be_positive' }
  return { ok: true, value: parsed.value }
}

function validateFulfilmentType(raw: unknown): ParseResult<InstantWinFulfilmentType> {
  if (typeof raw === 'string' && (FULFILMENT_TYPES as string[]).includes(raw)) {
    return { ok: true, value: raw as InstantWinFulfilmentType }
  }
  return { ok: false, error: 'invalid_fulfilment_type' }
}

function validateTitle(raw: unknown): ParseResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_title' }
  const t = raw.trim()
  if (t.length === 0 || t.length > 200) return { ok: false, error: 'invalid_title' }
  return { ok: true, value: t }
}

// Shape-only validation: a positive, safe integer. The UPPER bound is NOT a
// fixed constant — it is each prize's campaign ticket capacity, enforced
// separately in POST once the campaign(s) have been resolved.
function validateQuantity(raw: unknown): ParseResult<number> {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || !Number.isSafeInteger(n) || n < 1) return { ok: false, error: 'invalid_quantity' }
  return { ok: true, value: n }
}

function validateOptionalText(raw: unknown, max: number): ParseResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_text' }
  const t = raw.trim()
  if (t.length === 0) return { ok: true, value: null }
  if (t.length > max) return { ok: false, error: 'invalid_text' }
  return { ok: true, value: t }
}

function validateCampaignId(raw: unknown): ParseResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_campaign_id' }
  const t = raw.trim()
  if (t.length === 0 || t.length > 64) return { ok: false, error: 'invalid_campaign_id' }
  return { ok: true, value: t }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authError === 'Not authenticated' ? 401 : 403 })

  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaignId')
  if (!campaignId) return NextResponse.json({ ok: false, error: 'Missing campaignId' }, { status: 400 })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from('instant_win_prizes')
    .select(SELECT_COLUMNS)
    .eq('campaign_id', campaignId)
    .order('unlock_ratio', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[instant-win-prizes] GET error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Default nullable/legacy columns for backwards compatibility.
  const items = (data ?? []).map((row: any) => ({
    ...row,
    quantity: row.quantity ?? 1,
    is_high_value: row.is_high_value ?? false,
    fulfilment_type: (row.fulfilment_type as InstantWinFulfilmentType) ?? 'cash',
    prize_value_pence: row.prize_value_pence ?? null,
  }))

  return NextResponse.json({ ok: true, items })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authError === 'Not authenticated' ? 401 : 403 })

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const items: Record<string, any>[] = Array.isArray(body.items) ? body.items : [body]
  if (items.length === 0) return NextResponse.json({ ok: false, error: 'No prizes provided' }, { status: 400 })

  const rows: Record<string, any>[] = []
  for (const item of items) {
    const campaignId = validateCampaignId(item.campaign_id)
    if (!campaignId.ok) return NextResponse.json({ ok: false, error: campaignId.error }, { status: 400 })

    const title = validateTitle(item.prize_title)
    if (!title.ok) return NextResponse.json({ ok: false, error: title.error }, { status: 400 })

    const quantity = validateQuantity(item.quantity ?? 1)
    if (!quantity.ok) return NextResponse.json({ ok: false, error: quantity.error }, { status: 400 })

    const fulfilment = validateFulfilmentType(item.fulfilment_type)
    if (!fulfilment.ok) return NextResponse.json({ ok: false, error: fulfilment.error }, { status: 400 })

    const amount = resolveFulfilmentAmount(fulfilment.value, item.prize_value_gbp, item.prize_value_gbp !== undefined)
    if (!amount.ok) return NextResponse.json({ ok: false, error: amount.error }, { status: 400 })

    const displayText = validateOptionalText(item.prize_value_text, 500)
    if (!displayText.ok) return NextResponse.json({ ok: false, error: displayText.error }, { status: 400 })

    const imageUrl = validateOptionalText(item.image_url, 2048)
    if (!imageUrl.ok) return NextResponse.json({ ok: false, error: imageUrl.error }, { status: 400 })

    rows.push({
      campaign_id: campaignId.value,
      prize_title: title.value,
      prize_value_text: displayText.value,
      // unlock_ratio is retained in the DB for compatibility but is no longer
      // used by the admin UI. New rows always store a harmless 0.
      unlock_ratio: 0,
      image_url: imageUrl.value,
      quantity: quantity.value,
      is_high_value: item.is_high_value === true,
      fulfilment_type: fulfilment.value,
      prize_value_pence: amount.value,
    })
  }

  const svc = getServiceSupabase()

  // Authoritative capacity check: no prize quantity may exceed its campaign's
  // total ticket capacity. A NULL cap means the campaign is uncapped. The
  // maximum is resolved from the database, never trusted from the client.
  const distinctCampaignIds = [...new Set(rows.map((r) => r.campaign_id as string))]
  const { data: campaignRows, error: capErr } = await svc
    .from('campaigns')
    .select('id, max_tickets_total')
    .in('id', distinctCampaignIds)

  if (capErr) {
    console.error('[instant-win-prizes] POST capacity lookup error:', capErr.message)
    return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
  }

  const capacityByCampaign = new Map<string, number | null>(
    (campaignRows ?? []).map((c: any) => [c.id as string, (c.max_tickets_total ?? null) as number | null]),
  )

  for (const r of rows) {
    const campaignId = r.campaign_id as string
    if (!capacityByCampaign.has(campaignId)) {
      return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400 })
    }
    const capacity = capacityByCampaign.get(campaignId) ?? null
    if (capacity != null && (r.quantity as number) > capacity) {
      return NextResponse.json(
        {
          ok: false,
          error: 'quantity_exceeds_capacity',
          message: `Quantity cannot exceed the campaign ticket capacity of ${capacity.toLocaleString('en-GB')}.`,
        },
        { status: 400 },
      )
    }
  }

  // The DB trigger creates exactly `quantity` instant_win_slots per inserted
  // prize row. We never expand quantity into duplicate prize rows here.
  const { data, error } = await svc
    .from('instant_win_prizes')
    .insert(rows)
    .select(SELECT_COLUMNS)

  if (error) {
    console.error('[instant-win-prizes] POST error:', error)
    return NextResponse.json({ ok: false, error: error.message, details: error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, items: data })
}

export async function PUT(request: Request) {
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

  if (!body.id || !body.campaign_id) {
    return NextResponse.json({ ok: false, error: 'Missing id or campaign_id' }, { status: 400 })
  }

  const svc = getServiceSupabase()

  // Quantity is NEVER updated through the ordinary PUT. Changing quantity must
  // go through the dedicated reconciliation route (see ./quantity/route.ts),
  // which calls admin_set_instant_win_prize_quantity to protect claimed slots.
  const wantsAmount = body.prize_value_gbp !== undefined
  const wantsFulfilment = body.fulfilment_type !== undefined

  const update: Record<string, any> = {}

  if (body.prize_title !== undefined) {
    const title = validateTitle(body.prize_title)
    if (!title.ok) return NextResponse.json({ ok: false, error: title.error }, { status: 400 })
    update.prize_title = title.value
  }

  if (body.prize_value_text !== undefined) {
    const displayText = validateOptionalText(body.prize_value_text, 500)
    if (!displayText.ok) return NextResponse.json({ ok: false, error: displayText.error }, { status: 400 })
    update.prize_value_text = displayText.value
  }

  if (body.image_url !== undefined) {
    const imageUrl = validateOptionalText(body.image_url, 2048)
    if (!imageUrl.ok) return NextResponse.json({ ok: false, error: imageUrl.error }, { status: 400 })
    update.image_url = imageUrl.value
  }

  if (body.is_high_value !== undefined) {
    update.is_high_value = body.is_high_value === true
  }

  // Resolve fulfilment/amount together. When either is changing we need the
  // effective fulfilment type to validate the amount correctly.
  if (wantsAmount || wantsFulfilment) {
    let effectiveFulfilment: InstantWinFulfilmentType
    if (wantsFulfilment) {
      const fulfilment = validateFulfilmentType(body.fulfilment_type)
      if (!fulfilment.ok) return NextResponse.json({ ok: false, error: fulfilment.error }, { status: 400 })
      effectiveFulfilment = fulfilment.value
      update.fulfilment_type = fulfilment.value
    } else {
      const { data: current, error: curErr } = await svc
        .from('instant_win_prizes')
        .select('fulfilment_type')
        .eq('id', body.id)
        .eq('campaign_id', body.campaign_id)
        .maybeSingle()
      if (curErr) return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
      if (!current) return NextResponse.json({ ok: false, error: 'Prize not found' }, { status: 404 })
      effectiveFulfilment = (current.fulfilment_type as InstantWinFulfilmentType) ?? 'cash'
    }

    const amount = resolveFulfilmentAmount(effectiveFulfilment, body.prize_value_gbp, wantsAmount)
    if (!amount.ok) return NextResponse.json({ ok: false, error: amount.error }, { status: 400 })
    // Only persist a pence change when the caller actually sent an amount, or
    // when the fulfilment type change forces a re-evaluation.
    if (wantsAmount || wantsFulfilment) update.prize_value_pence = amount.value
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data: updatedRows, error } = await svc
    .from('instant_win_prizes')
    .update(update)
    .eq('id', body.id)
    .eq('campaign_id', body.campaign_id)
    .select(SELECT_COLUMNS)

  if (error) {
    console.error('[instant-win-prizes] PUT DB error:', error)
    return NextResponse.json({ ok: false, error: error.message, details: error }, { status: 500 })
  }

  const updated = updatedRows?.[0]
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Prize not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, updated })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authError === 'Not authenticated' ? 401 : 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const campaignId = searchParams.get('campaignId')
  if (!id || !campaignId) return NextResponse.json({ ok: false, error: 'Missing id or campaignId' }, { status: 400 })

  // Strictly validate identifiers as UUIDs before any service-role query.
  if (!isUuid(id) || !isUuid(campaignId)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400 })
  }
  const prizeId = id.trim()
  const campaign = campaignId.trim()

  const svc = getServiceSupabase()

  // Delete protection — never rely solely on the FK exception. A prize may be
  // deleted ONLY when ALL of these hold:
  //   - it has zero instant_win_awards rows;
  //   - every linked slot is unassigned (winning_ticket IS NULL);
  //   - every linked slot is unclaimed (claimed_at IS NULL AND
  //     claimed_by_checkout_intent_id IS NULL).
  // A failure to run ANY safety-check query is treated as a server error and
  // aborts the delete — we never proceed when protection state is unknown.

  // 1) Award protection.
  const { count: awardCount, error: awardErr } = await svc
    .from('instant_win_awards')
    .select('id', { count: 'exact', head: true })
    .eq('prize_id', prizeId)

  if (awardErr) {
    console.error('[instant-win-prizes] DELETE award-check failed:', awardErr.message)
    return NextResponse.json({ ok: false, error: 'delete_check_failed' }, { status: 500 })
  }
  if ((awardCount ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: 'prize_cannot_be_deleted' }, { status: 409 })
  }

  // 2) Slot protection — any assigned OR claimed slot blocks deletion. Run each
  // predicate as its own COUNT query so a query failure is unambiguous.
  const { count: assignedSlotCount, error: assignedErr } = await svc
    .from('instant_win_slots')
    .select('id', { count: 'exact', head: true })
    .eq('prize_id', prizeId)
    .not('winning_ticket', 'is', null)

  if (assignedErr) {
    console.error('[instant-win-prizes] DELETE assigned-slot-check failed:', assignedErr.message)
    return NextResponse.json({ ok: false, error: 'delete_check_failed' }, { status: 500 })
  }
  if ((assignedSlotCount ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: 'prize_cannot_be_deleted' }, { status: 409 })
  }

  const { count: claimedAtCount, error: claimedAtErr } = await svc
    .from('instant_win_slots')
    .select('id', { count: 'exact', head: true })
    .eq('prize_id', prizeId)
    .not('claimed_at', 'is', null)

  if (claimedAtErr) {
    console.error('[instant-win-prizes] DELETE claimed_at-check failed:', claimedAtErr.message)
    return NextResponse.json({ ok: false, error: 'delete_check_failed' }, { status: 500 })
  }
  if ((claimedAtCount ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: 'prize_cannot_be_deleted' }, { status: 409 })
  }

  const { count: claimedIntentCount, error: claimedIntentErr } = await svc
    .from('instant_win_slots')
    .select('id', { count: 'exact', head: true })
    .eq('prize_id', prizeId)
    .not('claimed_by_checkout_intent_id', 'is', null)

  if (claimedIntentErr) {
    console.error('[instant-win-prizes] DELETE claimed_intent-check failed:', claimedIntentErr.message)
    return NextResponse.json({ ok: false, error: 'delete_check_failed' }, { status: 500 })
  }
  if ((claimedIntentCount ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: 'prize_cannot_be_deleted' }, { status: 409 })
  }

  const { error } = await svc
    .from('instant_win_prizes')
    .delete()
    .eq('id', prizeId)
    .eq('campaign_id', campaign)

  if (error) {
    console.error('[instant-win-prizes] DELETE error:', error.message)
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
