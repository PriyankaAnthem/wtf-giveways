import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { computeAuthoritativeSubtotal, normalizeBundlePence, normalizeQty } from '@/lib/checkout/pricing'
import { validateDiscountCode } from '@/lib/discounts/validateDiscountCode'
import type { AppliedDiscount } from '@/lib/discounts/discountCalc'
import {
  isUserPurchaseRestricted,
  ACCOUNT_SELF_EXCLUDED_ERROR,
  ACCOUNT_SELF_EXCLUDED_MESSAGE,
} from '@/lib/account-restrictions'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_COOKIE_NAME_V2,
  parseAttributionCookie,
  pickAttributionCookieValue,
  toCheckoutAttributionColumns,
  type CheckoutAttributionColumns,
} from '@/lib/marketing/attribution'
import {
  WTF_VID_COOKIE,
  WTF_SID_COOKIE,
  readTrafficColumnsFromCookies,
  type CheckoutTrafficColumns,
} from '@/lib/analytics/traffic'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

/**
 * True ONLY for the two expected stale-refresh-token conditions:
 *   - refresh_token_not_found    ("Invalid Refresh Token: Refresh Token Not Found")
 *   - refresh_token_already_used ("Invalid Refresh Token: Already Used")
 * Every other auth error (network, config, invalid key, outage, DB, unexpected
 * auth failure) is intentionally excluded and must NOT trigger cookie clearing.
 */
function isStaleRefreshTokenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  if (code === 'refresh_token_not_found' || code === 'refresh_token_already_used') {
    return true
  }
  const message = String((err as { message?: string }).message ?? '')
  return /refresh token not found/i.test(message) || /invalid refresh token: already used/i.test(message)
}

/**
 * Read the marketing-attribution cookie and map it to the checkout_intents
 * attribution columns. FULLY wrapped: any failure (missing/malformed/expired
 * cookie, parse error, unexpected throw) resolves to `{}` so attribution can
 * NEVER block or fail a checkout. Returns the columns to spread into the
 * intent insert, or an empty object when there is no valid attribution.
 *
 * Prefers the domain-scoped v2 cookie; when it is absent, falls back to the
 * legacy host-only cookie so clicks made before the v2 rollout still attribute.
 */
async function readAttributionColumns(): Promise<Partial<CheckoutAttributionColumns>> {
  try {
    const cookieStore = await cookies()
    const rawV2 = cookieStore.get(ATTRIBUTION_COOKIE_NAME_V2)?.value
    const rawLegacy = cookieStore.get(ATTRIBUTION_COOKIE_NAME)?.value
    // v2 wins when present; otherwise fall back to the legacy cookie.
    const raw = pickAttributionCookieValue(rawV2, rawLegacy)
    const snapshot = parseAttributionCookie(raw, Date.now())

    // Temporary diagnostics: host + presence/parse booleans only. Never the
    // cookie value or any customer data.
    try {
      const host = (await headers()).get('host')
      console.log('[v0][attr] read', {
        host,
        v2Present: Boolean(rawV2),
        legacyPresent: Boolean(rawLegacy),
        parsed: Boolean(snapshot),
      })
    } catch {
      // headers() unavailable — diagnostics are best-effort, never fatal.
    }

    return toCheckoutAttributionColumns(snapshot, Date.now()) ?? {}
  } catch (err) {
    console.error(
      '[checkout/create] attribution read failed (ignored):',
      err instanceof Error ? err.message : String(err),
    )
    return {}
  }
}

/**
 * Snapshot the first-party analytics visitor/session IDs from their cookies
 * into the checkout_intents traffic columns AT creation time. This is a pure
 * read — it never mints IDs and returns ONLY `visitor_id`/`session_id`, so it
 * cannot disturb the independent `attribution_*` snapshot. FULLY wrapped: any
 * failure (missing/malformed cookies, unexpected throw) resolves to `{}` so
 * analytics can NEVER block or fail a checkout — both systems coexist.
 */
async function readTrafficColumns(): Promise<Partial<CheckoutTrafficColumns>> {
  try {
    const cookieStore = await cookies()
    return readTrafficColumnsFromCookies((name) => {
      if (name === WTF_VID_COOKIE) return cookieStore.get(WTF_VID_COOKIE)?.value
      if (name === WTF_SID_COOKIE) return cookieStore.get(WTF_SID_COOKIE)?.value
      return undefined
    })
  } catch (err) {
    console.error(
      '[checkout/create] traffic read failed (ignored):',
      err instanceof Error ? err.message : String(err),
    )
    return {}
  }
}

export async function POST(request: Request) {
  // 1) Auth — a real authenticated Supabase user is REQUIRED in every
  //    environment (local, preview/staging, and production). There is no
  //    bypass/fallback/fixed user_id: unauthenticated checkout is rejected so a
  //    checkout_intent can never be attributed to a shared placeholder user.
  const supabase = await createClient()

  // Keep the SINGLE existing getUser() call; capture both the user and the auth
  // error (getUser may also reject on some client internals, so guard it).
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  let authError: unknown = null
  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
    authError = result.error
  } catch (err) {
    authError = err
  }

  if (!user) {
    // Preserve the exact existing 401 body, status, and Cache-Control.
    const res = NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401, ...NO_STORE })

    // Only on the expected stale-refresh-token conditions, expire the browser's
    // Supabase auth-token cookies so it stops replaying a dead token. This adds
    // NO extra Supabase/DB/network call — just a local cookie-name loop. It is
    // idempotent, so concurrent stale requests are safe (no throw, no 500).
    if (isStaleRefreshTokenError(authError)) {
      const cookieStore = await cookies()
      for (const cookie of cookieStore.getAll()) {
        if (/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) {
          res.cookies.set(cookie.name, '', { maxAge: 0, expires: new Date(0), path: '/' })
        }
      }
    }

    return res
  }

  const resolvedUser = user

  // 1b) Self-exclusion gate (PRIMARY BLOCK). This runs immediately after the
  //     user is resolved and BEFORE anything with side effects — before the
  //     campaign fetch, per-user cap check, discount validation, checkout_intent
  //     insert, and (critically) before any wallet reservation. A restricted
  //     customer therefore cannot start a new purchase by ANY funding path
  //     (card, full-wallet, or partial-wallet), because no intent is ever
  //     created and wallet_prepare_checkout is never reached. Enforcement is
  //     entirely server-side. It fails closed (see the helper) — existing
  //     entries, winnings, wallet balance/history and login are all untouched.
  if (await isUserPurchaseRestricted(supabase, resolvedUser.id)) {
    return NextResponse.json(
      { ok: false, error: ACCOUNT_SELF_EXCLUDED_ERROR, message: ACCOUNT_SELF_EXCLUDED_MESSAGE },
      { status: 403, ...NO_STORE },
    )
  }

  // 2) Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, ...NO_STORE })
  }

  const campaignId = body.campaignId as string | undefined
  const qty = normalizeQty(body.qty)
  // Optional WTF Credit opt-in. ONLY the literal boolean `true` counts as opting
  // in; missing/false/string/numeric/malformed values all behave as false. No
  // client currently sends this field, so existing checkouts are unaffected. A
  // wallet AMOUNT is never accepted from the client — the DB function computes it.
  const useCredit = body.useCredit === true
  const bundlePricePence = normalizeBundlePence((body as Record<string, unknown>).bundlePricePence)

  // Optional discount code. We ONLY ever read the raw submitted STRING here; the
  // amount/type/scope/id are computed server-side from the discount_codes row.
  // Any client-supplied discountPence/discountType/discountValue/discountCodeId/
  // subtotalPence/totalPence fields are deliberately ignored as authoritative.
  const discountCodeRaw = (body as Record<string, unknown>).discountCode
  const discountCode = typeof discountCodeRaw === 'string' ? discountCodeRaw : null

  // Optional client idempotency key. When absent we keep the historical
  // behaviour (a fresh server-generated key, so every request is a new intent).
  const idempotencyKeyRaw = (body as Record<string, unknown>).idempotencyKey
  const clientIdempotencyKey =
    typeof idempotencyKeyRaw === 'string' && idempotencyKeyRaw.trim().length >= 8 && idempotencyKeyRaw.trim().length <= 200
      ? idempotencyKeyRaw.trim()
      : null

  if (!campaignId || typeof campaignId !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing or invalid campaignId' }, { status: 400, ...NO_STORE })
  }

  if (qty == null) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid qty' }, { status: 400, ...NO_STORE })
  }

  // 3) Fetch campaign for price + hard cap
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, ticket_price_pence, max_tickets_total, max_tickets_per_user, bundles')
    .eq('id', campaignId)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 400, ...NO_STORE })
  }

  // 3b) Per-user cap precheck
  if (campaign.max_tickets_per_user != null) {
    const { data: confirmedRows } = await supabase
      .from('checkout_intents')
      .select('qty')
      .eq('user_id', resolvedUser.id)
      .eq('campaign_id', campaignId)
      .not('confirmed_at', 'is', null)

    const alreadyConfirmedQty = (confirmedRows ?? []).reduce(
      (sum: number, row: { qty: number }) => sum + (Number(row.qty) || 0),
      0
    )

    if (alreadyConfirmedQty + qty > campaign.max_tickets_per_user) {
      return NextResponse.json(
        { ok: false, error: 'user_ticket_cap_exceeded' },
        { status: 409, ...NO_STORE }
      )
    }
  }

  // 3c) Compatibility bridge: legacy columns still reference giveaway_id,
  //     but our system is campaign-based. Map campaignId directly.
  const giveawayId = campaignId

  // 3d) Hard-cap check: ensure tickets are still available
  if (campaign.max_tickets_total != null) {
    const { data: counter } = await supabase
      .from('giveaway_ticket_counters')
      .select('next_ticket')
      .eq('giveaway_id', giveawayId)
      .maybeSingle()

    const nextTicket = counter?.next_ticket ?? 1
    const endTicket = nextTicket + qty - 1

    if (endTicket > campaign.max_tickets_total) {
      return NextResponse.json({ ok: false, error: 'sold_out' }, { status: 409, ...NO_STORE })
    }
  }

  // Bundle validation + authoritative subtotal. The exact historical bundle
  // rule is preserved by `computeAuthoritativeSubtotal` (match a configured
  // { quantity, price_pence } bundle, else qty * ticket_price_pence).
  const subtotalResult = computeAuthoritativeSubtotal(campaign, qty, bundlePricePence)
  if (!subtotalResult.ok) {
    const badBundle = subtotalResult.code === 'invalid_bundle'
    return NextResponse.json(
      { ok: false, error: badBundle ? 'Invalid bundle' : 'Invalid pricing' },
      { status: 400, ...NO_STORE },
    )
  }
  const subtotalPence = subtotalResult.subtotalPence

  // Validate + calculate the optional discount BEFORE inserting the intent and
  // BEFORE any wallet reservation, so wallet_prepare_checkout (which reads the
  // persisted total_pence) always splits against the discounted total.
  const discountResult = await validateDiscountCode({
    campaignId,
    subtotalPence,
    submittedCode: discountCode,
  })

  if (!discountResult.ok) {
    // Client-safe stable error code only — never a raw DB error.
    return NextResponse.json(
      { ok: false, error: discountResult.code },
      { status: discountResult.status, ...NO_STORE },
    )
  }

  const appliedDiscount: AppliedDiscount | null = discountResult.discount
  const discountPence = appliedDiscount?.discountPence ?? 0
  const totalPence = discountResult.totalPence

  // The authoritative pricing snapshot persisted on the checkout intent. This is
  // captured now and never depends on a later edit to the live discount record.
  const discountSnapshot = {
    subtotal_pence: subtotalPence,
    discount_pence: discountPence,
    discount_code_id: appliedDiscount?.id ?? null,
    discount_code_entered: appliedDiscount ? appliedDiscount.code : null,
    discount_type_applied: appliedDiscount?.discountType ?? null,
    discount_value_applied: appliedDiscount?.discountValue ?? null,
    discount_scope_applied: appliedDiscount?.scope ?? null,
  }

  // Marketing-attribution snapshot captured from the first-party cookie set by
  // the /t short-link resolver. Read defensively — it resolves to `{}` on any
  // problem, so a missing/malformed/expired cookie leaves every attribution
  // column NULL and never affects the checkout. Captured once here and spread
  // (unchanged) into whichever intent-insert branch runs below.
  const attributionSnapshot = await readAttributionColumns()
  // Independent first-party analytics snapshot (visitor_id/session_id), captured
  // in the SAME insert as the intent. Never updated later; never timestamp-inferred.
  const trafficSnapshot = await readTrafficColumns()

  // Additive, backward-compatible pricing section returned to the client.
  const pricingResponse = {
    subtotalPence,
    discountPence,
    totalPence,
    discount: appliedDiscount
      ? {
          code: appliedDiscount.code,
          discountType: appliedDiscount.discountType,
          discountValue: appliedDiscount.discountValue,
          scope: appliedDiscount.scope,
        }
      : null,
  }

  // 4) Resolve the checkout intent — either reuse an existing one for a repeated
  //    client idempotency key (only when the authoritative pricing inputs are
  //    identical) or insert a fresh intent with the full pricing snapshot.
  let checkoutIntentId: string
  let ref: string
  let providerSessionId: string

  if (clientIdempotencyKey) {
    const { data: existing, error: existingErr } = await supabase
      .from('checkout_intents')
      .select(
        'id, ref, provider_session_id, state, campaign_id, qty, subtotal_pence, discount_pence, total_pence, discount_code_id, discount_code_entered',
      )
      .eq('user_id', resolvedUser.id)
      .eq('idempotency_key', clientIdempotencyKey)
      .maybeSingle()

    if (existingErr) {
      console.error('[checkout/create] idempotency lookup failed:', existingErr.message)
      return NextResponse.json({ ok: false, error: 'Failed to create checkout intent' }, { status: 500, ...NO_STORE })
    }

    if (existing) {
      // A confirmed/failed (non-pending) intent is TERMINAL. Never reuse, reprice
      // or re-run wallet preparation against it — return a safe conflict so the
      // finished checkout is left exactly as-is.
      if (existing.state !== 'pending') {
        return NextResponse.json({ ok: false, error: 'idempotency_conflict' }, { status: 409, ...NO_STORE })
      }

      // A repeated key must NEVER reuse an intent whose pricing inputs differ.
      const samePricing =
        existing.campaign_id === campaignId &&
        Number(existing.qty) === qty &&
        Number(existing.subtotal_pence) === subtotalPence &&
        Number(existing.discount_pence) === discountPence &&
        Number(existing.total_pence) === totalPence &&
        (existing.discount_code_id ?? null) === (appliedDiscount?.id ?? null) &&
        (existing.discount_code_entered ?? null) === (appliedDiscount?.code ?? null)

      if (!samePricing) {
        // Do not mutate the existing intent and do not create a wallet
        // reservation against changed pricing.
        return NextResponse.json({ ok: false, error: 'idempotency_conflict' }, { status: 409, ...NO_STORE })
      }

      checkoutIntentId = existing.id as string
      ref = existing.ref as string
      providerSessionId = existing.provider_session_id as string
    } else {
      ref = `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      providerSessionId = randomUUID()
      const { data: inserted, error: insertErr } = await supabase
        .from('checkout_intents')
        .insert({
          ref,
          idempotency_key: clientIdempotencyKey,
          user_id: resolvedUser.id,
          campaign_id: campaignId,
          giveaway_id: giveawayId,
          qty,
          total_pence: totalPence,
          currency: 'GBP',
          provider: 'debug',
          provider_session_id: providerSessionId,
          state: 'pending',
          ...discountSnapshot,
          ...attributionSnapshot,
          ...trafficSnapshot,
        })
        .select('id')
        .single()

      if (insertErr || !inserted) {
        console.error('[checkout/create] Insert error:', insertErr)
        return NextResponse.json({ ok: false, error: 'Failed to create checkout intent' }, { status: 500, ...NO_STORE })
      }
      checkoutIntentId = inserted.id
    }
  } else {
    ref = `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    providerSessionId = randomUUID()

    // Insert checkout_intent as the authenticated user (RLS-scoped client).
    // Select the new row's id so the wallet prepare RPC (below) can reference it.
    const { data: inserted, error: insertErr } = await supabase
      .from('checkout_intents')
      .insert({
        ref,
        idempotency_key: randomUUID(),
        user_id: resolvedUser.id,
        campaign_id: campaignId,
        giveaway_id: giveawayId,
        qty,
        total_pence: totalPence,
        currency: 'GBP',
        provider: 'debug',
        provider_session_id: providerSessionId,
        state: 'pending',
        ...discountSnapshot,
        ...attributionSnapshot,
        ...trafficSnapshot,
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      console.error('[checkout/create] Insert error:', insertErr)
      return NextResponse.json({ ok: false, error: 'Failed to create checkout intent' }, { status: 500, ...NO_STORE })
    }
    checkoutIntentId = inserted.id
  }

  // 4b) WTF Credit prepare — ONLY when the user explicitly opted in.
  //     When useCredit === false we never touch the wallet and the response is
  //     byte-for-byte identical to before. When useCredit === true this MUST
  //     fail closed: any RPC error, malformed result, or split that does not add
  //     up to the authoritative totalPence returns a 500 and prevents the client
  //     from proceeding to a payment provider. No client-supplied wallet amount
  //     is ever read — the DB function computes the split. The RPC is called via
  //     the same RLS-scoped client (never service role) and is ownership-checked
  //     and idempotent for the same checkout intent.
  let walletResponse:
    | {
        useCredit: true
        walletCreditPence: number
        externalPaymentPence: number
        reservationId: string | null
        expiresAt: string | null
        providerPaymentRequired: boolean
        alreadyPrepared: boolean
      }
    | undefined

  if (useCredit) {
    const { data: walletData, error: walletErr } = await supabase.rpc('wallet_prepare_checkout', {
      p_checkout_intent_id: checkoutIntentId,
      p_user_id: resolvedUser.id,
      p_use_credit: true,
    })

    if (walletErr) {
      // Do not expose the raw RPC/database error to the client.
      console.error(`[checkout/create] wallet_prepare_checkout RPC failed for ref ${ref}:`, walletErr.message)

      // A finalized (released/expired/captured) reservation means this checkout
      // intent can no longer be prepared — the session is spent. Surface a
      // distinct, client-safe conflict so the UI can prompt a fresh start
      // instead of showing a generic failure.
      if (typeof walletErr.message === 'string' && walletErr.message.includes('wallet_checkout_reservation_finalized')) {
        return NextResponse.json({ ok: false, error: 'checkout_expired' }, { status: 409, ...NO_STORE })
      }

      return NextResponse.json({ ok: false, error: 'wallet_prepare_failed' }, { status: 500, ...NO_STORE })
    }

    // The RPC may return a single object or a single-row array; normalise it.
    const result = (Array.isArray(walletData) ? walletData[0] : walletData) as
      | Record<string, unknown>
      | null
      | undefined

    const walletCreditPence = result?.wallet_credit_pence
    const externalPaymentPence = result?.external_payment_pence

    const isNonNegInt = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0

    const validSplit =
      !!result &&
      isNonNegInt(walletCreditPence) &&
      isNonNegInt(externalPaymentPence) &&
      walletCreditPence + externalPaymentPence === totalPence

    if (!validSplit) {
      console.error(
        `[checkout/create] wallet_prepare_checkout returned an invalid split for ref ${ref} ` +
          `(expected total ${totalPence})`,
      )
      return NextResponse.json({ ok: false, error: 'wallet_prepare_failed' }, { status: 500, ...NO_STORE })
    }

    walletResponse = {
      useCredit: true,
      walletCreditPence,
      externalPaymentPence,
      reservationId: typeof result.reservation_id === 'string' ? result.reservation_id : null,
      expiresAt: typeof result.expires_at === 'string' ? result.expires_at : null,
      providerPaymentRequired: externalPaymentPence > 0,
      alreadyPrepared: result.already_prepared === true,
    }
  }

  console.log('[checkout/create] created intent', {
    ref,
    campaignId,
    giveawayId,
    qty,
    userId: resolvedUser.id,
  })

  return NextResponse.json(
    walletResponse
      ? { ok: true, ref, providerSessionId, pricing: pricingResponse, wallet: walletResponse }
      : { ok: true, ref, providerSessionId, pricing: pricingResponse },
    NO_STORE,
  )
}
