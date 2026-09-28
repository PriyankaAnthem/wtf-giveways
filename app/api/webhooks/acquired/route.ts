import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { normalizeAwardPayload } from '@/lib/payments/confirmPaymentAndAward'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStore = { 'Cache-Control': 'no-store' }

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Acquired webhook (staging).
 *
 * Verifies the Acquired webhook hash, records the provider result against the
 * matching checkout_intents row, and — for a verified successful status_update —
 * fulfils the order by calling the existing idempotent DB RPC
 * public.confirm_payment_and_award(p_ref, p_user_id).
 *
 * This route NEVER sets state/confirmed_at directly and NEVER allocates tickets
 * or awards instant wins itself — all of that is delegated to the RPC, which is
 * idempotent. We additionally skip the RPC entirely when the intent is already
 * confirmed, so duplicate Acquired webhooks cannot trigger redundant work.
 */
export async function POST(request: Request) {
  // 1) Signing key must be configured.
  const signingKey = process.env.ACQUIRED_SIGNING_KEY
  if (!signingKey) {
    console.error('[webhooks/acquired] missing ACQUIRED_SIGNING_KEY')
    return NextResponse.json(
      { ok: false, error: 'missing_acquired_signing_key' },
      { status: 500, headers: noStore },
    )
  }

  // 2) Read the RAW body for signature verification, then parse safely.
  const rawBody = await request.text().catch(() => '')

  let parsedBody: Record<string, any>
  try {
    parsedBody = JSON.parse(rawBody || '')
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400, headers: noStore },
    )
  }

  // 3) Read the received hash from the Hash header (case-insensitive).
  const receivedHash =
    request.headers.get('Hash') || request.headers.get('hash') || ''

  // 4) Compute the expected HMAC SHA256 over the minified JSON of the parsed
  //    body, then compare timing-safely. Never log the signing key or hashes.
  const expectedHash = crypto
    .createHmac('sha256', signingKey)
    .update(JSON.stringify(parsedBody))
    .digest('hex')

  const receivedBuf = Buffer.from(receivedHash, 'utf8')
  const expectedBuf = Buffer.from(expectedHash, 'utf8')
  const hashValid =
    receivedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(receivedBuf, expectedBuf)

  if (!hashValid) {
    console.error('[webhooks/acquired] hash verification failed')
    return NextResponse.json(
      { ok: false, error: 'invalid_signature' },
      { status: 401, headers: noStore },
    )
  }

  // 5) Extract the expected webhook shape.
  const webhookType = parsedBody.webhook_type as string | undefined
  const webhookId = parsedBody.webhook_id as string | undefined
  const webhookBody = (parsedBody.webhook_body ?? {}) as Record<string, any>
  const orderId = webhookBody.order_id as string | undefined
  const status = webhookBody.status as string | undefined
  const transactionId = webhookBody.transaction_id as string | undefined
  const cardId = webhookBody.card_id as string | undefined

  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: 'missing_order_id' },
      { status: 400, headers: noStore },
    )
  }

  // 6) Find the matching checkout_intents row by ref = order_id.
  const svc = getServiceSupabase()
  const { data: intent, error: lookupErr } = await svc
    .from('checkout_intents')
    .select(
      'id, ref, user_id, state, total_pence, provider_transaction_id, provider_status, provider_payload, wallet_credit_requested, wallet_credit_pence, external_payment_pence',
    )
    .eq('ref', orderId)
    .maybeSingle()

  if (lookupErr) {
    console.error('[webhooks/acquired] lookup error', lookupErr.message)
    return NextResponse.json(
      { ok: false, error: 'lookup_failed' },
      { status: 500, headers: noStore },
    )
  }

  if (!intent) {
    return NextResponse.json(
      { ok: false, error: 'intent_not_found' },
      { status: 404, headers: noStore },
    )
  }

  // 6b) card_new webhook: Acquired stored the card credential and returned a
  //     card_id. This branch is CAPTURE ONLY — it records the card_id and never
  //     touches state/confirmed_at, never calls confirm_payment_and_award, and
  //     never allocates tickets or awards instant wins. It is intentionally
  //     independent of the status_update payment flow so card_new arriving
  //     before OR after status_update can neither confirm nor undo a payment.
  if (webhookType === 'card_new') {
    if (!cardId) {
      return NextResponse.json(
        { ok: false, error: 'missing_card_id' },
        { status: 400, headers: noStore },
      )
    }

    // Preserve existing provider_payload (the payment status_update data) and
    // merge the card_new payload under a clear key, without clobbering it. Only
    // merge when the existing payload is a plain object; otherwise start fresh.
    const existingPayload = intent.provider_payload
    const mergedPayload =
      existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload)
        ? { ...(existingPayload as Record<string, unknown>), acquired_card_new_webhook: parsedBody }
        : { acquired_card_new_webhook: parsedBody }

    // Deliberately do NOT overwrite provider_status (keep it as the payment
    // status) or provider_webhook_event_id (keep the payment status_update id) —
    // card_new details live inside provider_payload instead.
    const cardPatch: Record<string, unknown> = {
      provider: 'acquired',
      provider_card_id: cardId,
      provider_payload: mergedPayload,
      updated_at: new Date().toISOString(),
    }
    if (transactionId) cardPatch.provider_transaction_id = transactionId

    const { error: cardUpdateErr } = await svc
      .from('checkout_intents')
      .update(cardPatch)
      .eq('ref', orderId)

    if (cardUpdateErr) {
      console.error('[webhooks/acquired] card_new update failed', cardUpdateErr.message)
      return NextResponse.json(
        { ok: false, error: 'card_update_failed' },
        { status: 500, headers: noStore },
      )
    }

    // Never expose the actual card_id in the response.
    return NextResponse.json(
      {
        ok: true,
        webhook_type: 'card_new',
        webhook_id: webhookId ?? null,
        order_id: orderId,
        transaction_id: transactionId ?? null,
        card_status: status ?? null,
        card_saved: true,
      },
      { status: 200, headers: noStore },
    )
  }

  // 7) Capture-only update. Deliberately does NOT touch state, confirmed_at,
  //    tickets, or instant wins.
  //
  //    provider_payload is MERGED, never overwritten. We preserve every
  //    existing key (especially acquired_payment_link_request_debug and any
  //    acquired_card_new_webhook already stored) and record this webhook under
  //    acquired_status_update_webhook. Only merge when the existing payload is
  //    a plain object; otherwise start fresh.
  const existingStatusPayload = intent.provider_payload
  const mergedStatusPayload =
    existingStatusPayload &&
    typeof existingStatusPayload === 'object' &&
    !Array.isArray(existingStatusPayload)
      ? {
          ...(existingStatusPayload as Record<string, unknown>),
          acquired_status_update_webhook: parsedBody,
        }
      : { acquired_status_update_webhook: parsedBody }

  const updatePatch: Record<string, unknown> = {
    provider: 'acquired',
    provider_payload: mergedStatusPayload,
    updated_at: new Date().toISOString(),
  }
  if (transactionId) updatePatch.provider_transaction_id = transactionId
  if (status) updatePatch.provider_status = status
  if (webhookId) updatePatch.provider_webhook_event_id = webhookId

  const { error: updateErr } = await svc
    .from('checkout_intents')
    .update(updatePatch)
    .eq('ref', orderId)

  if (updateErr) {
    console.error('[webhooks/acquired] update failed', updateErr.message)
    return NextResponse.json(
      { ok: false, error: 'update_failed' },
      { status: 500, headers: noStore },
    )
  }

  // 8) Fulfilment (delegated to the idempotent RPC). The capture update above
  //    has already persisted the provider result regardless of the outcome here.
  const ackBase = {
    ok: true as const,
    webhook_type: webhookType ?? null,
    webhook_id: webhookId ?? null,
    order_id: orderId,
    status: status ?? null,
    transaction_id: transactionId ?? null,
  }

  // 8a) Already confirmed → never call the RPC again (idempotency guard at the
  //     route level, on top of the RPC's own protection).
  if (intent.state === 'confirmed') {
    return NextResponse.json(
      { ...ackBase, fulfilment_status: 'already_confirmed' },
      { status: 200, headers: noStore },
    )
  }

  // 8b) Only a verified successful status_update with a transaction id may
  //     fulfil. Anything else is captured but not fulfilled.
  const eligibleToFulfil =
    webhookType === 'status_update' && status === 'success' && Boolean(transactionId)

  if (!eligibleToFulfil) {
    // 8b-i) Terminal-failure wallet release (best-effort, internal only).
    //   Reached ONLY after the signature is verified, the body is parsed, and
    //   the matching intent is found. The already-confirmed guard (8a) runs
    //   first, and card_new is handled/returned earlier, so neither a confirmed
    //   order nor card_new can ever reach this release path.
    //
    //   A held WTF Credit reservation is released ONLY when EVERY condition
    //   holds:
    //     - this is a status_update webhook,
    //     - the normalised status is exactly one of the strict five-status
    //       terminal-failure allowlist below (the external payment definitively
    //       failed — success, pending/processing, authorised and any unknown or
    //       ambiguous status are never released and stay reserved until the
    //       15-minute expiry engine handles them),
    //     - the intent is NOT already confirmed,
    //     - the intent is a wallet order with a well-formed split that sums to
    //       total_pence,
    //     - a reservation was actually held (wallet_credit_pence is a finite
    //       positive integer), and
    //     - the intent has a user_id.
    //
    //   The release RPC is service-role callable and idempotent. Any error is
    //   logged and NEVER alters the webhook acknowledgement, which is byte-for-
    //   byte identical to the pre-Phase-3B response.
    const normalizedStatus =
      typeof status === 'string' ? status.trim().toLowerCase() : ''

    // Strict terminal-failure allowlist → internal release reason. Raw provider
    // status text is never persisted as the reason.
    const TERMINAL_FAILURE_REASONS: Record<string, string> = {
      failed: 'acquired_failed',
      declined: 'acquired_declined',
      cancelled: 'acquired_cancelled',
      canceled: 'acquired_cancelled',
      expired: 'acquired_expired',
    }

    const releaseReason = TERMINAL_FAILURE_REASONS[normalizedStatus]

    const walletCreditPence = intent.wallet_credit_pence
    const externalPaymentPence = intent.external_payment_pence

    const isPositiveInt = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0

    const isNonNegInt = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0

    const releaseEligible =
      webhookType === 'status_update' &&
      Boolean(releaseReason) &&
      intent.state !== 'confirmed' &&
      intent.wallet_credit_requested === true &&
      isPositiveInt(walletCreditPence) &&
      isNonNegInt(externalPaymentPence) &&
      (walletCreditPence as number) + (externalPaymentPence as number) === intent.total_pence &&
      Boolean(intent.user_id)

    if (releaseEligible) {
      try {
        const { error: releaseErr } = await svc.rpc('wallet_release_checkout_reservation', {
          p_checkout_intent_id: intent.id,
          p_user_id: intent.user_id,
          p_reason: releaseReason,
        })
        if (releaseErr) {
          console.error(
            `[webhooks/acquired] wallet_release_checkout_reservation failed for ref ${orderId}:`,
            releaseErr.message,
          )
        }
      } catch (err: any) {
        console.error(
          `[webhooks/acquired] wallet_release_checkout_reservation threw for ref ${orderId}:`,
          String(err?.message || err),
        )
      }
    }

    return NextResponse.json(
      { ...ackBase, fulfilment_status: 'not_success_status' },
      { status: 200, headers: noStore },
    )
  }

  // 8c) Successful, pending checkout → fulfil via the existing RPC only.
  const { data: rpcData, error: rpcErr } = await svc.rpc('confirm_payment_and_award', {
    p_ref: intent.ref,
    p_user_id: intent.user_id,
  })

  if (rpcErr) {
    console.error('[webhooks/acquired] fulfilment RPC failed', rpcErr.message)
    return NextResponse.json(
      {
        ok: false,
        error: 'fulfilment_failed',
        webhook_id: webhookId ?? null,
        order_id: orderId,
        transaction_id: transactionId ?? null,
        provider_status: status ?? null,
        rpc_error_message: rpcErr.message,
      },
      { status: 500, headers: noStore },
    )
  }

  // 8d) Fulfilled. Normalise the RPC result through the shared normaliser so a
  //     multi-prize response is never reduced to only the first prize, then
  //     echo the full ticket/instant-win allocation summary.
  const fulfilment = normalizeAwardPayload(rpcData)

  // Safe metadata only — no customer PII, no provider secrets/payloads.
  console.log('[webhooks/acquired] fulfilled:', {
    order_id: orderId,
    won: fulfilment.won,
    prize_count: fulfilment.prizes.length,
  })

  return NextResponse.json(
    { ...ackBase, fulfilment_status: 'fulfilled', fulfilment },
    { status: 200, headers: noStore },
  )
}
