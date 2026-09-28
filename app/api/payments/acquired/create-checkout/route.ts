import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createAuthedClient } from '@/lib/supabase/server'
import {
  classifyAcquiredCustomerError,
  collectKnownCustomerName,
  combineNameErrorCode,
  findCustomerNameProblems,
  resolveCustomerName,
  validateCustomerName,
  type CustomerNameField,
} from '@/lib/acquired/customer-name'
import {
  isUserPurchaseRestricted,
  ACCOUNT_SELF_EXCLUDED_ERROR,
  ACCOUNT_SELF_EXCLUDED_MESSAGE,
} from '@/lib/account-restrictions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStore = { 'Cache-Control': 'no-store' }

/**
 * Normalise an Acquired base URL from env so callers can always append
 * `/v1/...` safely. It:
 *   - trims whitespace,
 *   - falls back to the QA/test host when unset (so we never accidentally hit
 *     LIVE without explicit configuration),
 *   - strips any trailing slash(es) (so we never produce `//v1`), and
 *   - strips a trailing `/v1` segment (so env values entered WITH `/v1`, e.g.
 *     `https://api.acquired.com/v1`, never produce `/v1/v1`).
 * Both `https://api.acquired.com` and `https://api.acquired.com/v1` therefore
 * normalise to `https://api.acquired.com`.
 */
function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? '').trim()
  const base = raw || fallback
  return base
    .replace(/\/+$/, '') // drop trailing slash(es)
    .replace(/\/v1$/i, '') // drop a trailing /v1 if the env already included it
    .replace(/\/+$/, '') // drop any slash exposed by removing /v1
}

/**
 * Reduce an unknown thrown value to a SHORT, safe log string.
 *
 * Only a Supabase/Error `code` and `message` are considered, and the result is
 * truncated. Deliberately never serialises the error object itself, so session
 * objects, access/refresh tokens, cookies, Authorization headers and raw user
 * metadata can never reach the logs via a nested error property.
 */
function sanitiseErrorText(err: unknown): string {
  const source = err && typeof err === 'object' ? (err as Record<string, unknown>) : null
  const code = source && typeof source.code === 'string' ? source.code : ''
  const message = source && typeof source.message === 'string' ? source.message : ''
  const text = [code, message].filter(Boolean).join(': ') || 'unknown_error'
  return text.slice(0, 200)
}

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(request: Request) {
  // 1) Env-driven Acquired base URLs (production cutover). Production sets these
  //    to the LIVE Acquired hosts; Preview/staging sets them to the QA/test
  //    hosts. This real checkout route is allowed to run in production — the
  //    provider used per-environment is controlled at the client via
  //    NEXT_PUBLIC_CHECKOUT_PROVIDER (Acquired vs SumUp), and SumUp remains the
  //    rollback path.
  const apiBaseUrl = normalizeBaseUrl(
    process.env.ACQUIRED_API_BASE_URL,
    'https://test-api.acquired.com',
  )
  const payBaseUrl = normalizeBaseUrl(
    process.env.ACQUIRED_PAY_BASE_URL,
    'https://test-pay.acquired.com',
  )

  // 2) Parse body and validate checkout ref.
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid checkout ref' },
      { status: 400, headers: noStore },
    )
  }

  const ref = (body.checkout_ref ?? body.ref) as string | undefined
  if (!ref || typeof ref !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid checkout ref' },
      { status: 400, headers: noStore },
    )
  }

  // 2a) Optional client-supplied name (ONLY sent by the inline "Confirm your
  //     name" form after the server reported the stored name was missing or
  //     invalid). When absent — the overwhelming majority of checkouts — nothing
  //     below changes: no auth call, no account write, and the stored name is
  //     used exactly as before. These values are NEVER trusted blindly: they are
  //     re-validated server-side and only applied to the authenticated owner.
  const clientFirstRaw = typeof body.firstName === 'string' ? body.firstName : undefined
  const clientLastRaw = typeof body.lastName === 'string' ? body.lastName : undefined
  const clientSuppliedName = clientFirstRaw !== undefined || clientLastRaw !== undefined

  // 3) Service-role client.
  const svc = getServiceSupabase()

  // 4) Fetch the matching checkout_intents row.
  const { data: intent, error: intentErr } = await svc
    .from('checkout_intents')
    .select(
      'id, ref, user_id, total_pence, currency, state, campaign_id, provider_customer_id, wallet_credit_requested, wallet_credit_pence, external_payment_pence',
    )
    .eq('ref', ref)
    .single()

  if (intentErr || !intent) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404, headers: noStore })
  }

  // 5) Validate the intent.
  if (intent.state !== 'pending') {
    return NextResponse.json(
      { ok: false, error: 'Intent is not pending' },
      { status: 409, headers: noStore },
    )
  }

  if (!intent.total_pence || intent.total_pence <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Invalid amount' },
      { status: 422, headers: noStore },
    )
  }

  if ((intent.currency || 'GBP') !== 'GBP') {
    return NextResponse.json(
      { ok: false, error: 'Unsupported currency' },
      { status: 422, headers: noStore },
    )
  }

  if (!intent.campaign_id) {
    return NextResponse.json(
      { ok: false, error: 'Missing campaign' },
      { status: 422, headers: noStore },
    )
  }

  // 5-auth) Identity gate for client-supplied names ONLY. Checkouts that do not
  //         submit a name skip this entirely (no extra auth round-trip on the
  //         normal path). When a name IS submitted we require a real session AND
  //         that the session user owns this checkout intent, so one user can
  //         never write a name onto another user's account via a guessed ref.
  if (clientSuppliedName) {
    let authedUserId: string | null = null
    try {
      const authed = await createAuthedClient()
      const { data } = await authed.auth.getUser()
      authedUserId = data.user?.id ?? null
    } catch {
      authedUserId = null
    }
    if (!authedUserId) {
      return NextResponse.json(
        { ok: false, error: 'auth_required' },
        { status: 401, headers: noStore },
      )
    }
    if (!intent.user_id || authedUserId !== intent.user_id) {
      console.error('[payments/acquired] name update ownership mismatch for ref', ref)
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers: noStore })
    }
  }

  // 5-restrict) Self-exclusion STALE-INTENT guard. This protects an intent that
  //             was created while the customer was still allowed but who has
  //             since become self-excluded. We check the intent's OWNER (not the
  //             request session — this route is normally called without a name
  //             and thus without an auth round-trip) using the same service
  //             client, and refuse to create/continue an Acquired payment. We do
  //             NOT mutate the intent: it stays 'pending' exactly as a normal
  //             rejected request leaves it, and no wallet reservation has been
  //             touched yet at this point. This is a NEW-purchase block only; it
  //             never runs on the webhook/confirmation (already-paid) path.
  if (await isUserPurchaseRestricted(svc, intent.user_id)) {
    console.warn('[payments/acquired] blocked self-excluded owner for ref', ref)
    return NextResponse.json(
      { ok: false, error: ACCOUNT_SELF_EXCLUDED_ERROR, message: ACCOUNT_SELF_EXCLUDED_MESSAGE },
      { status: 403, headers: noStore },
    )
  }

  // 5a) Wallet reservation release helper.
  //     walletReservationActive becomes true ONLY once a partial-wallet order's
  //     reservation has been validated in step 5b. releaseWalletReservation()
  //     is a best-effort, idempotent no-op for every normal (non-wallet) order
  //     — it never touches wallet_reservations unless a reservation was actually
  //     held. The RPC is service-role callable and idempotent; a release failure
  //     is logged and never alters the response.
  //
  //     Release policy (deliberately NOT "release on every post-validation
  //     failure"):
  //       - Release ONLY on terminal failures that occur BEFORE the payment-link
  //         POST is attempted (missing config, login failures, customer failures),
  //         plus the one case where Acquired returns an explicit non-2xx response
  //         to POST /v1/payment-links (no usable link was created).
  //       - Once the POST has been attempted and the outcome is ambiguous or
  //         successful (network/parse error after 2xx, 2xx with missing link_id,
  //         or a local DB-update failure after the link exists) we do NOT release,
  //         because a payment link may already be usable. Those reservations are
  //         reclaimed solely by the 15-minute expiry engine.
  let walletReservationActive = false
  let walletReservationReleased = false
  // Captured from the (non-null) intent so the hoisted helper closure has
  // stable, correctly-typed identifiers without re-narrowing `intent`.
  const releaseIntentId = intent.id
  const releaseUserId = intent.user_id
  async function releaseWalletReservation(reason: string): Promise<void> {
    if (!walletReservationActive || walletReservationReleased) return
    walletReservationReleased = true
    try {
      const { error: releaseErr } = await svc.rpc('wallet_release_checkout_reservation', {
        p_checkout_intent_id: releaseIntentId,
        p_user_id: releaseUserId,
        p_reason: reason,
      })
      if (releaseErr) {
        console.error(
          `[payments/acquired] wallet_release_checkout_reservation failed for ref ${ref}:`,
          releaseErr.message,
        )
      }
    } catch (err: any) {
      console.error(
        `[payments/acquired] wallet_release_checkout_reservation threw for ref ${ref}:`,
        String(err?.message || err),
      )
    }
  }

  // 5b) Determine the AUTHORITATIVE provider amount (WTF Credit aware).
  //     The amount charged by Acquired is derived entirely from the persisted
  //     checkout_intents row — a client-supplied amount is NEVER read here.
  //     - Normal (non-wallet) order: preserve existing behaviour → charge
  //       total_pence, and never touch wallet_reservations.
  //     - Wallet order: require a well-formed split that sums exactly to
  //       total_pence, charge only the external remainder, and (for partial
  //       orders) require a valid, active, unexpired reservation.
  const totalPence = intent.total_pence as number
  const walletCreditRequested = intent.wallet_credit_requested === true
  let providerAmountPence = totalPence

  if (walletCreditRequested) {
    const walletCreditPence = intent.wallet_credit_pence
    const externalPaymentPence = intent.external_payment_pence

    const isNonNegInt = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0

    const validSplit =
      isNonNegInt(walletCreditPence) &&
      isNonNegInt(externalPaymentPence) &&
      walletCreditPence + externalPaymentPence === totalPence

    if (!validSplit) {
      // Log safely with the checkout reference only — never raw amounts beyond
      // the expected total (which is already server-derived, not client data).
      console.error(
        `[payments/acquired] invalid wallet split for ref ${ref} (expected total ${totalPence})`,
      )
      return NextResponse.json(
        { ok: false, error: 'invalid_wallet_split' },
        { status: 409, headers: noStore },
      )
    }

    // Fully wallet-funded: no external payment is required, so Acquired must not
    // be called. This route does not confirm or fulfil the checkout.
    if (externalPaymentPence === 0) {
      return NextResponse.json(
        { ok: false, error: 'provider_payment_not_required' },
        { status: 409, headers: noStore },
      )
    }

    // Partial-wallet order: verify the reservation in a single batched row query.
    // Normal non-wallet checkouts never reach this branch, so they never query
    // wallet_reservations.
    if (walletCreditPence > 0) {
      const { data: reservation, error: reservationErr } = await svc
        .from('wallet_reservations')
        .select('id, checkout_intent_id, user_id, amount_pence, status, expires_at')
        .eq('checkout_intent_id', intent.id)
        .eq('user_id', intent.user_id)
        .eq('amount_pence', walletCreditPence)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (reservationErr || !reservation) {
        console.error(
          `[payments/acquired] wallet reservation invalid for ref ${ref}`,
          reservationErr?.message ?? '(no active reservation)',
        )
        return NextResponse.json(
          { ok: false, error: 'wallet_reservation_invalid' },
          { status: 409, headers: noStore },
        )
      }

      // A valid, active, unexpired reservation is held for this checkout — from
      // here on, any failure exit must release it.
      walletReservationActive = true
    }

    // Charge only the external remainder.
    providerAmountPence = externalPaymentPence
  }

  // 6) Env vars. Per Acquired support, Hosted Checkout payment-links must NOT
  //    specify a MID, so ACQUIRED_MID is no longer read or required.
  const appId = process.env.ACQUIRED_APP_ID
  const appKey = process.env.ACQUIRED_APP_KEY
  const companyId = process.env.ACQUIRED_COMPANY_ID

  if (!appId || !appKey || !companyId) {
    // Build a list of names only (never values/lengths). Safe to return in any
    // environment because it contains configuration key names only, no secrets.
    const missing = [
      ['ACQUIRED_APP_ID', appId],
      ['ACQUIRED_APP_KEY', appKey],
      ['ACQUIRED_COMPANY_ID', companyId],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name)

    console.error('[payments/acquired] Missing Acquired configuration', { missing })
    await releaseWalletReservation('acquired_config_missing')
    return NextResponse.json(
      { ok: false, error: 'Server configuration error', missing },
      { status: 500, headers: noStore },
    )
  }

  // 7) Login to the Acquired API (env-driven host) for a server-side-only
  //    access token.
  let accessToken = ''
  try {
    const loginRes = await fetch(`${apiBaseUrl}/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_key: appKey }),
    })

    if (!loginRes.ok) {
      console.error('[payments/acquired] login failed', loginRes.status)
      await releaseWalletReservation('acquired_login_failed')
      return NextResponse.json(
        { ok: false, error: 'acquired_login_failed', status: loginRes.status },
        { status: 502, headers: noStore },
      )
    }

    const loginData = await loginRes.json().catch(() => ({}))
    accessToken = (loginData.access_token as string) || ''
  } catch (err: any) {
    console.error('[payments/acquired] login fetch error', String(err?.message || err))
    await releaseWalletReservation('acquired_login_failed')
    return NextResponse.json(
      { ok: false, error: 'acquired_login_failed' },
      { status: 502, headers: noStore },
    )
  }

  if (!accessToken) {
    console.error('[payments/acquired] login returned no access token')
    await releaseWalletReservation('acquired_login_failed')
    return NextResponse.json(
      { ok: false, error: 'acquired_login_failed' },
      { status: 502, headers: noStore },
    )
  }

  // 7b) Resolve an Acquired customer_id (staging QA). We either reuse a
  //     previously-created customer for this user, or create a new one from the
  //     safe data we already hold. Failures to CREATE are fatal (we do not
  //     create a payment link without a customer). Failures to *enrich* the
  //     payload (auth/profile lookups) are soft — reference is the only hard
  //     requirement. No secrets, email, name, mobile, or user_id are ever
  //     returned to the client.
  let customerId = ''
  let customerSource: 'reused' | 'created' | 'recovered_by_reference' | 'none' = 'none'
  let customerPayloadKeys: string[] = []

  // Staging/preview detector. The restored staging database contains Acquired
  // `provider_customer_id` values issued by the LIVE Acquired tenant; those IDs
  // do not exist in the QA/test tenant and are rejected by the QA payment-link
  // endpoint ("customer.customer_id — Customer is invalid"). On staging/preview
  // we therefore SKIP reuse of persisted customer IDs and always create/recover
  // a customer against the currently-configured QA host. Production is never
  // classified as staging, so its reuse behaviour is unchanged.
  const isStagingOrPreview =
    process.env.VERCEL_ENV === 'preview' ||
    (process.env.NEXT_PUBLIC_SITE_URL ?? '').includes('staging.wtf-giveaways.co.uk')

  // A) Reuse the most recent acquired customer_id for this user, if any.
  //    Production only — see isStagingOrPreview note above.
  if (intent.user_id && !isStagingOrPreview) {
    const { data: priorIntent } = await svc
      .from('checkout_intents')
      .select('provider_customer_id')
      .eq('user_id', intent.user_id)
      .eq('provider', 'acquired')
      .not('provider_customer_id', 'is', null)
      .neq('provider_customer_id', '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (priorIntent?.provider_customer_id) {
      customerId = priorIntent.provider_customer_id as string
      customerSource = 'reused'
    }
  }

  // B) No reusable customer → create one from safe available data.
  if (!customerId) {
    // Soft-fetch auth email + metadata (never blocks on failure).
    let email = ''
    let metaFirstName = ''
    let metaLastName = ''
    // Full existing user_metadata, preserved so a name write MERGES rather than
    // clobbers unrelated keys (e.g. mobile, display_name).
    let authMetaObject: Record<string, unknown> = {}
    if (intent.user_id) {
      try {
        const { data: authData } = await svc.auth.admin.getUserById(intent.user_id)
        const authUser = authData?.user
        email = (authUser?.email as string) || ''
        const meta = (authUser?.user_metadata ?? {}) as Record<string, unknown>
        authMetaObject = meta
        metaFirstName = typeof meta.first_name === 'string' ? meta.first_name : ''
        metaLastName = typeof meta.last_name === 'string' ? meta.last_name : ''
      } catch {
        // Ignore — continue with whatever we have.
      }
    }

    // NOTE: `profiles_private.real_name` and `user_metadata.display_name` are
    // deliberately NOT read here. They are legacy display/username fields, and
    // inferring a payment name from them either invented a wrong first name
    // (real_name "bengovier" -> first_name "bengovier") or left an unfixable
    // missing surname. The only accepted stored payment name is an explicit
    // user_metadata.first_name / last_name pair.

    // Resolve the customer name against Acquired's CONFIRMED rules (length 0-50,
    // regex ^[a-zA-Z.\- ']*$) BEFORE calling the provider. A missing or invalid
    // name is a deterministic, user-fixable condition — never a provider outage
    // — so we stop with 422 rather than sending the request and mapping a
    // provider 400 to a misleading 502. Legitimate accented / smart-punctuation
    // names are folded to their Acquired-acceptable ASCII form rather than
    // rejected.
    let firstName: string
    let lastName: string

    if (clientSuppliedName) {
      // The inline form submitted a name. Ownership was verified at step 5-auth.
      // Re-validate server-side (never trust the client) and, if valid, persist
      // it to the authoritative fields future checkouts read, then CONTINUE this
      // same request to Acquired — a single round-trip for the customer.
      const clientFirst = validateCustomerName(clientFirstRaw ?? '', 'first_name')
      const clientLast = validateCustomerName(clientLastRaw ?? '', 'last_name')

      if (!clientFirst.ok || !clientLast.ok) {
        const requiredFields: CustomerNameField[] = []
        if (!clientFirst.ok) requiredFields.push('first_name')
        if (!clientLast.ok) requiredFields.push('last_name')
        const errorCode =
          (clientFirst.ok || clientFirst.error === 'customer_name_required') &&
          (clientLast.ok || clientLast.error === 'customer_name_required')
            ? 'customer_name_required'
            : 'customer_name_invalid'
        // Safe structured log — required field names only, never the values.
        console.error('[payments/acquired] checkout_payment_name_required', {
          event: 'checkout_payment_name_required',
          requiredFields,
          source: 'submitted_name_invalid',
        })
        // Keep whichever submitted field WAS valid (plus anything already
        // stored) so a partial correction does not clear the good field.
        const knownFields = {
          ...collectKnownCustomerName({ metaFirstName, metaLastName }),
          ...(clientFirst.ok ? { first_name: clientFirst.value } : {}),
          ...(clientLast.ok ? { last_name: clientLast.value } : {}),
        }
        // Deliberately DO NOT release the wallet reservation: the customer can
        // correct and resubmit within the existing reservation window.
        return NextResponse.json(
          { ok: false, error: errorCode, requiredFields, knownFields },
          { status: 422, headers: noStore },
        )
      }

      firstName = clientFirst.value
      lastName = clientLast.value

      // Persist to Supabase Auth user_metadata — the ONLY store this flow
      // writes. Existing keys are spread first so unrelated metadata
      // (display_name, mobile, ...) is preserved rather than clobbered.
      //
      // Best-effort BY DESIGN: the customer has already supplied a validated,
      // ownership-checked payment name, so `firstName`/`lastName` are safe to
      // use for THIS checkout regardless of whether the write lands. A transient
      // metadata failure must never turn into a second revenue-blocking
      // checkout failure. On failure we continue with the validated submitted
      // values and never fall back to real_name/display_name; the only
      // consequence is that the form may reappear on a future purchase.
      //
      // profiles_private is intentionally NOT written: checkout must not mutate
      // that table.
      let namePersisted = false
      if (intent.user_id) {
        try {
          const { error: metaError } = await svc.auth.admin.updateUserById(intent.user_id, {
            user_metadata: { ...authMetaObject, first_name: firstName, last_name: lastName },
          })
          if (metaError) throw metaError
          namePersisted = true
        } catch (err: any) {
          // Sanitised warning: error CODE/message text only. Never the session,
          // tokens, cookies, headers, raw metadata, name values, email or mobile.
          console.warn('[payments/acquired] checkout_payment_name_persist_failed', {
            event: 'checkout_payment_name_persist_failed',
            ref,
            reason: sanitiseErrorText(err),
            continuedToPayment: true,
          })
        }
      }

      console.log('[payments/acquired] checkout_payment_name_updated', {
        event: 'checkout_payment_name_updated',
        updatedFields: ['first_name', 'last_name'],
        namePersisted,
        continuedToPayment: true,
      })
    } else {
      const nameResult = resolveCustomerName({ metaFirstName, metaLastName })

      if (!nameResult.ok) {
        // Compute EVERY failing field so the inline form asks for exactly what is
        // needed (both, when both are missing).
        const problems = findCustomerNameProblems({ metaFirstName, metaLastName })
        const requiredFields = problems.map((p) => p.field)
        // The name fields we already legitimately hold, so the form can prefill
        // them and ask ONLY for what is missing. This is the authenticated
        // owner's own name (intent ownership is enforced for every write, and
        // this response is no-store + keyed to a ref the caller already holds).
        // Never includes email, mobile, display_name or any other metadata.
        const knownFields = collectKnownCustomerName({ metaFirstName, metaLastName })
        // Safe structured log — field names + normalisation flag only. NEVER the
        // name value, email, or other PII.
        console.error('[payments/acquired] checkout_payment_name_required', {
          event: 'checkout_payment_name_required',
          requiredFields,
          source: 'missing_stored_name',
          wasNormalised: nameResult.wasNormalised,
        })
        // Deliberately DO NOT release the wallet reservation: keep it valid so
        // the inline name-form submission can reuse this checkout within the
        // reservation window (reclaimed only by the 15-minute expiry engine).
        return NextResponse.json(
          { ok: false, error: combineNameErrorCode(problems), requiredFields, knownFields },
          { status: 422, headers: noStore },
        )
      }

      firstName = nameResult.firstName
      lastName = nameResult.lastName
    }

    // Deterministic per-user reference. Acquired enforces uniqueness on this, so
    // it is also the key we use to recover an already-existing customer on 409.
    const customerReference = `wtf_user_${intent.user_id ?? intent.id}`

    // Build the customer payload. Both names are now validated + present. No
    // address/postcode/phone is sent in this first QA pass.
    const customerPayload: Record<string, unknown> = {
      reference: customerReference,
      first_name: firstName,
      last_name: lastName,
    }
    if (email) customerPayload.billing = { email }
    customerPayloadKeys = Object.keys(customerPayload)

    try {
      const customerRes = await fetch(`${apiBaseUrl}/v1/customers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Company-Id': companyId,
        },
        body: JSON.stringify(customerPayload),
      })

      const customerRaw = await customerRes.text().catch(() => '')

      if (!customerRes.ok) {
        let acquiredError: unknown
        try {
          acquiredError = JSON.parse(customerRaw || '')
        } catch {
          acquiredError = (customerRaw || '').slice(0, 1000)
        }

        // Safe, structured server-side diagnostic for customer-creation failures
        // (e.g. 409 conflicts). Logs ONLY what Acquired returned (status, parsed
        // body or truncated text, common error fields, correlation headers) plus
        // non-sensitive request debug. It NEVER logs the access token, Company-Id
        // value, app_key/signing keys, cookies, card data, the outgoing customer
        // payload, the raw email/name, or the full user id / customer reference.
        const errorObj =
          acquiredError && typeof acquiredError === 'object'
            ? (acquiredError as Record<string, unknown>)
            : null
        // Acquired error bodies vary; surface the common fields when present.
        const acquiredErrorFields = errorObj
          ? {
              status: errorObj.status ?? null,
              error_code: errorObj.error_code ?? null,
              code: errorObj.code ?? null,
              title: errorObj.title ?? null,
              message: errorObj.message ?? null,
              detail: errorObj.detail ?? null,
              error: errorObj.error ?? null,
              error_description: errorObj.error_description ?? null,
              errors: errorObj.errors ?? null,
              error_codes: errorObj.error_codes ?? null,
              data: errorObj.data ?? null,
            }
          : null
        // Correlation / request id response headers (safe to log). Only include
        // those actually present.
        const correlationHeaderNames = [
          'x-request-id',
          'request-id',
          'x-correlation-id',
          'correlation-id',
          'x-amzn-requestid',
          'cf-ray',
        ]
        const correlationHeaders: Record<string, string> = {}
        for (const name of correlationHeaderNames) {
          const value = customerRes.headers.get(name)
          if (value) correlationHeaders[name] = value
        }

        // Fully serialise nested objects so Vercel logs don't collapse them to
        // "[Object]". Guards against circular refs and caps length. This body is
        // Acquired's own error response — it contains no secrets or our PII.
        const safeStringify = (value: unknown): string => {
          try {
            return JSON.stringify(value)
          } catch {
            return '[unserializable]'
          }
        }
        // Acquired 409 conflicts return an `invalid_parameters` array describing
        // which field/value conflicted; extract it explicitly so it is visible.
        const invalidParameters = errorObj ? (errorObj.invalid_parameters ?? null) : null

        console.error('[payments/acquired] customer creation failed', {
          status: customerRes.status,
          // Parsed JSON body when Acquired returned JSON; otherwise null (the raw
          // text is surfaced separately, already truncated to 1000 chars above).
          acquired_response_body: errorObj ?? null,
          // Flattened JSON string of the full parsed body so nested structures
          // (e.g. invalid_parameters) are printed rather than shown as [Object].
          acquired_response_body_json: errorObj ? safeStringify(errorObj).slice(0, 4000) : null,
          acquired_response_text: errorObj ? null : acquiredError,
          acquired_error_fields: acquiredErrorFields,
          // Explicit nested detail for 409 conflicts, both raw and stringified.
          acquired_invalid_parameters: invalidParameters,
          acquired_invalid_parameters_json:
            invalidParameters != null ? safeStringify(invalidParameters).slice(0, 2000) : null,
          correlation_headers:
            Object.keys(correlationHeaders).length > 0 ? correlationHeaders : null,
          request_debug: {
            hasCompanyId: Boolean(companyId),
            hasAuthToken: Boolean(accessToken),
            // Endpoint path only — no secrets, no query string.
            endpointPath: '/v1/customers',
            customerSource,
            // Non-identifying: confirms a reference was sent and its safe prefix,
            // without logging the full reference (which embeds the user id).
            hasReference: customerPayloadKeys.includes('reference'),
            referencePrefix: 'wtf_user_',
            // Key names only — never the values (no email/name/PII).
            customerPayloadKeys,
          },
        })

        // Classify the provider error via the shared, unit-tested classifier so
        // the route and its tests use a single source of truth:
        //   - name_validation  -> deterministic bad customer data -> HTTP 422
        //   - reference_conflict-> customer already exists -> recover by reference
        //   - upstream          -> genuine provider/outage failure -> HTTP 502
        const errorClass = classifyAcquiredCustomerError(customerRes.status, errorObj)

        // Deterministic customer-name rejection: surface as 422 (never a 502
        // outage) so the client shows an actionable message and does NOT invite
        // a blind retry with the same account data.
        if (errorClass.kind === 'name_validation') {
          const providerCorrelationId =
            correlationHeaders['x-request-id'] ||
            correlationHeaders['request-id'] ||
            correlationHeaders['x-correlation-id'] ||
            correlationHeaders['correlation-id'] ||
            correlationHeaders['cf-ray'] ||
            null
          // Safe structured log: field + provider status + correlation id only.
          // NEVER the name value, email, or other PII.
          console.error('[payments/acquired] acquired_customer_name_rejected', {
            event: 'acquired_customer_name_rejected',
            stage: 'provider_response',
            field: errorClass.field,
            providerStatus: customerRes.status,
            providerCorrelationId,
            wasNormalised: true,
          })
          // Deliberately DO NOT release the wallet reservation: this is a
          // deterministic, user-fixable name rejection. The inline form lets the
          // customer correct the field and resubmit within the reservation
          // window. `requiredFields` drives that form (same shape as the local
          // 422s above) so the client opens it consistently.
          return NextResponse.json(
            {
              ok: false,
              error: 'customer_name_invalid',
              field: errorClass.field,
              requiredFields: [errorClass.field],
            },
            { status: 422, headers: noStore },
          )
        }

        // Idempotent recovery: a 409 whose invalid_parameters names `reference`
        // means the customer already exists in Acquired but our DB had no
        // provider_customer_id saved. Do ONE lookup by reference, reuse the
        // existing customer_id, and continue — never create a second customer.
        const isReferenceConflict = errorClass.kind === 'reference_conflict'

        if (isReferenceConflict) {
          console.log('[payments/acquired] attempting customer recovery by reference')
          let recoveredCustomerId = ''
          try {
            // Single request only — no loops, no pagination, no N+1.
            const lookupUrl = `${apiBaseUrl}/v1/customers?reference=${encodeURIComponent(
              customerReference,
            )}&limit=1&filter=customer_id,reference`
            const lookupRes = await fetch(lookupUrl, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Company-Id': companyId,
              },
            })
            const lookupRaw = await lookupRes.text().catch(() => '')
            if (lookupRes.ok) {
              let parsed: unknown = {}
              try {
                parsed = JSON.parse(lookupRaw || '{}')
              } catch {
                parsed = {}
              }
              // Acquired list responses commonly wrap rows in `data`; also handle
              // a `customers` array or a bare array, defensively.
              const p = parsed as Record<string, unknown>
              const rows: unknown[] = Array.isArray(parsed)
                ? (parsed as unknown[])
                : Array.isArray(p?.data)
                  ? (p.data as unknown[])
                  : Array.isArray(p?.customers)
                    ? (p.customers as unknown[])
                    : []
              // Require an EXACT reference match before trusting the row.
              const match = rows.find(
                (r) =>
                  r &&
                  typeof r === 'object' &&
                  (r as Record<string, unknown>).reference === customerReference,
              ) as Record<string, unknown> | undefined
              const foundId = match && typeof match.customer_id === 'string' ? match.customer_id : ''
              if (foundId) recoveredCustomerId = foundId
            } else {
              console.error('[payments/acquired] customer lookup-by-reference non-ok', {
                status: lookupRes.status,
              })
            }
          } catch (lookupErr: unknown) {
            console.error(
              '[payments/acquired] customer lookup-by-reference error',
              String((lookupErr as { message?: string })?.message || lookupErr),
            )
          }

          if (recoveredCustomerId) {
            customerId = recoveredCustomerId
            customerSource = 'recovered_by_reference'
            console.log('[payments/acquired] customer recovery by reference succeeded', {
              customerSource,
            })
          } else {
            console.error('[payments/acquired] customer recovery by reference failed', {
              status: customerRes.status,
            })
            await releaseWalletReservation('acquired_customer_create_failed')
            return NextResponse.json(
              {
                ok: false,
                error: 'acquired_customer_create_failed',
                status: customerRes.status,
                acquired_error: acquiredError,
              },
              { status: 502, headers: noStore },
            )
          }
        } else {
          await releaseWalletReservation('acquired_customer_create_failed')
          return NextResponse.json(
            {
              ok: false,
              error: 'acquired_customer_create_failed',
              status: customerRes.status,
              acquired_error: acquiredError,
            },
            { status: 502, headers: noStore },
          )
        }
      }

      // Only parse the create response body as success when the create call
      // actually succeeded. On a recovered 409 we already have customerId and
      // must NOT overwrite it with the (error) response body.
      if (customerRes.ok) {
        let customerData: Record<string, any> = {}
        try {
          customerData = JSON.parse(customerRaw || '{}')
        } catch {
          customerData = {}
        }
        customerId = (customerData.customer_id as string) || ''
        customerSource = 'created'
      }
    } catch (err: any) {
      console.error('[payments/acquired] customer fetch error', String(err?.message || err))
      await releaseWalletReservation('acquired_customer_create_failed')
      return NextResponse.json(
        { ok: false, error: 'acquired_customer_create_failed' },
        { status: 502, headers: noStore },
      )
    }

    if (!customerId) {
      console.error('[payments/acquired] customer creation returned no customer_id')
      await releaseWalletReservation('acquired_customer_create_failed')
      return NextResponse.json(
        { ok: false, error: 'acquired_customer_create_failed' },
        { status: 502, headers: noStore },
      )
    }

    // Persist the freshly-created customer_id on the intent immediately (in
    // addition to the later provider_session_id/status/payload update).
    await svc
      .from('checkout_intents')
      .update({
        provider_customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
      .eq('ref', ref)
  }

  // 7c) Tracking only: copy a previously-stored provider_card_id forward.
  //     Acquired's card_new webhook only fires the FIRST time a card is stored
  //     for a customer, so later reuse checkouts would otherwise leave
  //     provider_card_id null even though a stored card exists. We look up the
  //     latest existing provider_card_id for this user + customer and copy it
  //     onto the current row for audit/QA. This is NOT sent to Acquired (the
  //     stored card is selected via customer.customer_id at Hosted Checkout) and
  //     it never blocks checkout. If none is found we leave it null so card_new
  //     can still populate it later.
  let existingCardId = ''
  if (intent.user_id && customerId) {
    try {
      const { data: priorCard } = await svc
        .from('checkout_intents')
        .select('provider_card_id')
        .eq('user_id', intent.user_id)
        .eq('provider', 'acquired')
        .eq('provider_customer_id', customerId)
        .not('provider_card_id', 'is', null)
        .neq('provider_card_id', '')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (priorCard?.provider_card_id) {
        existingCardId = priorCard.provider_card_id as string
      }
    } catch {
      // Soft-fail: tracking only, never blocks checkout.
    }
  }

  // 8) Create Acquired payment link. The amount is the authoritative,
  //    server-derived provider amount: total_pence for a normal order, or the
  //    external remainder for a wallet order (see step 5b). Never client input.
  const amountDecimal = parseFloat((providerAmountPence / 100).toFixed(2))

  // Minimum Hosted Checkout request per Acquired support: Company-Id only,
  // no MID/public key/signing keys, and only the transaction object (no
  // is_recurring/tds or other optional fields). Defined as variables so the
  // staging diagnostic below can describe exactly what was sent (key names and
  // booleans only — never values).
  const linkHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Company-Id': companyId,
  }
  // Acquired will POST status updates to this URL (source of truth). The
  // redirect_url is where the customer's browser is returned after paying — it
  // points at the existing WTF success page and ALWAYS includes
  // provider=acquired so the success page can never fall back to its unverified
  // "debug" provider default. Both URLs are built from the current request
  // origin so they follow whichever staging/preview host served this request.
  // Still no template_id/MID/public key/signing key in the body.
  const origin = new URL(request.url).origin
  const webhookUrl = `${origin}/api/webhooks/acquired`
  const redirectUrl = `${origin}/checkout/success?ref=${encodeURIComponent(intent.ref)}&provider=acquired`
  // Optional payment-method allow-list. Only sent when ACQUIRED_PAYMENT_METHODS
  // is explicitly configured (comma-separated). When unset we OMIT
  // payment_methods entirely so Acquired uses its account defaults. This is the
  // safeguard that keeps Pay by Bank (a QA-only method) out of Production: it
  // can only ever appear if "pay_by_bank" is explicitly listed in this env var.
  const paymentMethods = (process.env.ACQUIRED_PAYMENT_METHODS ?? '')
    .split(',')
    .map((method) => method.trim())
    .filter(Boolean)

  // is_recurring:true instructs Acquired Hosted Checkout to store the card
  // credential against the customer (returning a card_id via the card_new
  // webhook) so it can be reused. tds.is_active:true enables 3-D Secure
  // (PSD2/SCA) on the Hosted Checkout. Still no MID header / public key /
  // signing key / template_id / address / postcode / phone in the body.
  // payment_methods is included ONLY when explicitly configured (see above).
  const linkPayload = {
    transaction: {
      order_id: intent.ref,
      amount: amountDecimal,
      currency: 'GBP',
    },
    customer: {
      customer_id: customerId,
    },
    tds: {
      is_active: true,
      // Required by Acquired whenever tds.is_active is true. Must be a full
      // absolute HTTPS URL (Acquired rejects relative paths / localhost).
      contact_url: 'https://www.wtf-giveaways.co.uk/contact',
      challenge_preference: 'no_preference',
    },
    is_recurring: true,
    webhook_url: webhookUrl,
    redirect_url: redirectUrl,
    ...(paymentMethods.length > 0 ? { payment_methods: paymentMethods } : {}),
  }

  let linkData: Record<string, any> = {}
  try {
    const linkRes = await fetch(`${apiBaseUrl}/v1/payment-links`, {
      method: 'POST',
      headers: linkHeaders,
      body: JSON.stringify(linkPayload),
    })

    const raw = await linkRes.text().catch(() => '')

    if (!linkRes.ok) {
      // Build a safe diagnostic from Acquired's RESPONSE only. This never
      // contains our app key, access token, Authorization header, Company-Id,
      // or outgoing request body — only what Acquired returned to us.
      let acquiredError: unknown
      try {
        acquiredError = JSON.parse(raw || '')
      } catch {
        acquiredError = (raw || '').slice(0, 1000)
      }

      // Safe staging-only diagnostic: key names and booleans only, derived from
      // the actual outgoing headers/payload. Never includes the app key, access
      // token, Authorization header, Company-Id value, any MID value, or the
      // outgoing field values themselves.
      const ACQUIRED_SUPPORT_COMPANY_ID = '019e081a-d351-714b-b676-6c2c1c08dd63'
      const requestDebug = {
        company_id_present: Boolean(process.env.ACQUIRED_COMPANY_ID),
        company_id_matches_support_value:
          process.env.ACQUIRED_COMPANY_ID === ACQUIRED_SUPPORT_COMPANY_ID,
        mid_header_sent: Object.prototype.hasOwnProperty.call(linkHeaders, 'Mid'),
        payload_top_level_keys: Object.keys(linkPayload),
        transaction_keys: Object.keys(linkPayload.transaction),
      }

      // Safe, structured server-side diagnostic. This logs ONLY what Acquired
      // returned to us (status, response body/text, any error code/message/
      // details/validation array, and correlation/request id response headers).
      // It never logs our app_key, app_id, access token, Authorization header,
      // Company-Id value, cookies, the outgoing customer payload, or card data.
      const errorObj =
        acquiredError && typeof acquiredError === 'object'
          ? (acquiredError as Record<string, unknown>)
          : null
      // Acquired error bodies vary; surface the common fields when present.
      const acquiredErrorFields = errorObj
        ? {
            status: errorObj.status ?? null,
            error_code: errorObj.error_code ?? errorObj.code ?? null,
            title: errorObj.title ?? null,
            message: errorObj.message ?? errorObj.detail ?? errorObj.error ?? null,
            error_description: errorObj.error_description ?? null,
            // Validation arrays are commonly named `errors`, `error_codes`, or `data`.
            errors: errorObj.errors ?? errorObj.error_codes ?? errorObj.data ?? null,
          }
        : null
      // Correlation / request id response headers (safe to log). Try a few
      // common names; only include those actually present.
      const correlationHeaderNames = [
        'x-request-id',
        'request-id',
        'x-correlation-id',
        'correlation-id',
        'x-amzn-requestid',
        'cf-ray',
      ]
      const correlationHeaders: Record<string, string> = {}
      for (const name of correlationHeaderNames) {
        const value = linkRes.headers.get(name)
        if (value) correlationHeaders[name] = value
      }

      // Fully serialise nested objects so Vercel logs don't collapse them to
      // "[Object]". Guards against circular refs and caps length. This body is
      // Acquired's own error response — it contains no secrets or our PII.
      const safeStringify = (value: unknown): string => {
        try {
          return JSON.stringify(value)
        } catch {
          return '[unserializable]'
        }
      }
      // Acquired validation errors return an `invalid_parameters` array naming
      // which payment-link field/value was rejected; extract it explicitly so it
      // is visible rather than collapsed to [Object].
      const invalidParameters = errorObj ? (errorObj.invalid_parameters ?? null) : null

      // Safe company-id diagnostics: length and first-8-char prefix only, plus a
      // match check against the known support value (declared above). Never logs
      // the full value.
      const rawCompanyId = process.env.ACQUIRED_COMPANY_ID ?? ''
      const companyIdDebug = {
        hasCompanyId: Boolean(rawCompanyId),
        companyIdLength: rawCompanyId.length,
        companyIdPrefix: rawCompanyId.slice(0, 8),
        company_id_matches_support_value: rawCompanyId === ACQUIRED_SUPPORT_COMPANY_ID,
      }

      console.error('[payments/acquired] payment-link creation failed', {
        status: linkRes.status,
        // Parsed JSON body when Acquired returned JSON; otherwise this is the
        // truncated raw text (see acquiredError construction above).
        acquired_response_body: errorObj ?? null,
        // Flattened JSON string of the full parsed body so nested structures
        // (e.g. invalid_parameters) are printed rather than shown as [Object].
        acquired_response_body_json: errorObj ? safeStringify(errorObj).slice(0, 4000) : null,
        acquired_response_text: errorObj ? null : acquiredError,
        acquired_error_fields: acquiredErrorFields,
        // Explicit nested detail for validation failures, both raw and stringified.
        acquired_invalid_parameters: invalidParameters,
        acquired_invalid_parameters_json:
          invalidParameters != null ? safeStringify(invalidParameters).slice(0, 2000) : null,
        correlation_headers:
          Object.keys(correlationHeaders).length > 0 ? correlationHeaders : null,
        request_debug: requestDebug,
        company_id_debug: companyIdDebug,
      })

      await releaseWalletReservation('acquired_payment_link_failed')
      return NextResponse.json(
        {
          ok: false,
          error: 'acquired_payment_link_failed',
          status: linkRes.status,
          acquired_error: acquiredError,
          request_debug: requestDebug,
        },
        { status: 502, headers: noStore },
      )
    }

    linkData = JSON.parse(raw || '{}')
  } catch (err: any) {
    console.error('[payments/acquired] payment-link fetch error', String(err?.message || err))
    // Do NOT release the reservation here. This catch covers both a genuine
    // network exception AND a JSON parse failure that follows an HTTP 2xx
    // response, so Acquired may already have created a payment link. Releasing
    // now could let a late external payment succeed after the WTF Credit became
    // spendable again. The 15-minute expiry engine reclaims any truly-unused
    // reservation instead.
    return NextResponse.json(
      { ok: false, error: 'acquired_payment_link_failed' },
      { status: 502, headers: noStore },
    )
  }

  // 9) Parse response for link_id.
  const linkId = (linkData.link_id as string) || ''
  if (!linkId) {
    console.error('[payments/acquired] missing link_id in response')
    // Do NOT release the reservation here. Acquired already returned HTTP 2xx,
    // so a payment-link resource may exist server-side even though we cannot
    // derive its URL. The 15-minute expiry engine reclaims the reservation if
    // it truly went unused.
    return NextResponse.json(
      { ok: false, error: 'acquired_missing_link_id' },
      { status: 502, headers: noStore },
    )
  }

  const checkoutUrl = `${payBaseUrl}/v1/${linkId}`

  // 10) Build the safe request diagnostic BEFORE the DB update so it can be
  //     persisted into provider_payload (and reused in the response). It uses
  //     key names and booleans only — never the actual customer_id, card_id,
  //     email, name, mobile, user_id, app key, access token, signing key,
  //     Company ID, full webhook_url, or the redirect_url query string.
  const webhookUrlSent =
    typeof (linkPayload as Record<string, unknown>).webhook_url === 'string'
  let webhookUrlOrigin: string | null = null
  let webhookUrlPathname: string | null = null
  if (webhookUrlSent) {
    try {
      const parsed = new URL((linkPayload as { webhook_url: string }).webhook_url)
      webhookUrlOrigin = parsed.origin
      webhookUrlPathname = parsed.pathname
    } catch {
      // Leave origin/pathname null if the URL is somehow unparseable.
    }
  }

  // Safe redirect_url diagnostic: pathname + the provider value only. We never
  // echo the full query string (which contains the checkout ref).
  const redirectUrlSent =
    typeof (linkPayload as Record<string, unknown>).redirect_url === 'string'
  let redirectUrlPathname: string | null = null
  let redirectUrlProvider: string | null = null
  if (redirectUrlSent) {
    try {
      const parsed = new URL((linkPayload as { redirect_url: string }).redirect_url)
      redirectUrlPathname = parsed.pathname
      redirectUrlProvider = parsed.searchParams.get('provider')
    } catch {
      // Leave pathname/provider null if the URL is somehow unparseable.
    }
  }

  // Persisted diagnostic (safe subset). current_intent_card_id_was_stored
  // reflects whether THIS create-checkout carried a card id forward.
  const requestDebug = {
    customer_id_was_sent: Boolean(customerId),
    is_recurring_was_sent:
      (linkPayload as Record<string, unknown>).is_recurring === true,
    tds_was_sent:
      typeof (linkPayload as Record<string, unknown>).tds === 'object' &&
      (linkPayload as Record<string, unknown>).tds !== null,
    tds_is_active_was_sent: linkPayload.tds?.is_active === true,
    tds_challenge_preference_was_sent:
      typeof linkPayload.tds?.challenge_preference === 'string' &&
      linkPayload.tds.challenge_preference.length > 0,
    webhook_url_was_sent: webhookUrlSent,
    redirect_url_was_sent: redirectUrlSent,
    payload_top_level_keys: Object.keys(linkPayload),
    transaction_keys: Object.keys(linkPayload.transaction),
    redirect_url_pathname: redirectUrlPathname,
    redirect_url_provider: redirectUrlProvider,
    customer_id_source: customerSource,
    existing_card_id_found: Boolean(existingCardId),
    current_intent_card_id_was_stored: Boolean(existingCardId),
  }

  // 10b) Update the existing checkout_intents row at runtime only.
  //     provider_customer_id is ALWAYS included here (for both "created" and
  //     "reused" sources) so the current row is guaranteed to carry its own
  //     customer_id and the final update can never accidentally clear it. It is
  //     only set when we actually have a customerId (always true at this point,
  //     since a missing customer aborts earlier with 502).
  //     provider_payload persists the Acquired response fields PLUS the safe
  //     acquired_payment_link_request_debug diagnostic; the webhook later MERGES
  //     into this object so the diagnostic is preserved.
  const finalUpdate: Record<string, unknown> = {
    provider: 'acquired',
    provider_session_id: linkId,
    provider_status: 'payment_link_created',
    provider_payload: {
      ...(linkData && typeof linkData === 'object' && !Array.isArray(linkData)
        ? linkData
        : {}),
      acquired_payment_link_request_debug: requestDebug,
    },
    updated_at: new Date().toISOString(),
  }
  if (customerId) {
    finalUpdate.provider_customer_id = customerId
  }
  // Tracking only: carry the previously-stored card forward when we found one.
  // If none was found we leave provider_card_id untouched so the card_new
  // webhook can still populate it later.
  if (existingCardId) {
    finalUpdate.provider_card_id = existingCardId
  }

  const { data: updated, error: updateErr } = await svc
    .from('checkout_intents')
    .update(finalUpdate)
    .eq('ref', ref)
    .select('ref, provider_session_id, provider_customer_id, provider_card_id')
    .maybeSingle()

  if (updateErr || !updated?.provider_session_id) {
    console.error('[payments/acquired] DB update failed', updateErr?.message)
    // Do NOT release the reservation here. A usable payment link and checkout
    // URL already exist at this point, so releasing would allow a late external
    // payment after the WTF Credit became spendable again. Only the 15-minute
    // expiry engine may reclaim this reservation.
    return NextResponse.json(
      { ok: false, error: 'Failed to update intent' },
      { status: 500, headers: noStore },
    )
  }

  // 11) Success. Reuse the persisted diagnostic (proving the deployed
  //     payment-link request), plus a few response-only fields verified against
  //     the returned row. Still key names + booleans only — no secrets, MID, or
  //     field values, and the full webhook_url / redirect_url query string are
  //     never echoed.
  return NextResponse.json(
    {
      ok: true,
      checkout_url: checkoutUrl,
      provider: 'acquired',
      provider_session_id: linkId,
      request_debug: {
        ...requestDebug,
        // Response-only extras (not persisted): full origin/pathname of the
        // webhook and the payload key list, plus post-update verifications.
        webhook_url_origin: webhookUrlOrigin,
        webhook_url_pathname: webhookUrlPathname,
        customer_payload_keys: customerPayloadKeys,
        // Verified against the returned row rather than assumed.
        current_intent_customer_id_was_stored: Boolean(updated?.provider_customer_id),
        current_intent_card_id_was_stored: Boolean(updated?.provider_card_id),
      },
    },
    { status: 200, headers: noStore },
  )
}
