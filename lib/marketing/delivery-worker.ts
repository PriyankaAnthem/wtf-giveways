import 'server-only'
import { getMarketingServiceClient } from './service'
import { sendMarketingEmailViaResend } from './resend-provider'
import { createUnsubscribeToken } from './unsubscribe-token'

/**
 * WTF Marketing — Stage 030 SAFE DELIVERY WORKER.
 *
 * This is the FIRST production consumer of the Stage 029 Resend provider. It ties
 * together the already-installed database delivery state machine (Stages 026-028,
 * installed + canary-tested manually in Supabase) with the isolated provider:
 *
 *   recover expired leases
 *     -> claim a bounded batch (max 10, lease 120s)
 *       -> for EACH claim, sequentially:
 *            validate -> mint unsubscribe token -> build one-click URL
 *              -> JIT authorize (Stage 027) -> IMMEDIATELY send (Stage 029)
 *                -> finalize success / failure (Stage 028)
 *
 * HARD SAFETY INVARIANTS (enforced here, not merely documented):
 *   - Application kill switch (MARKETING_DELIVERY_WORKER_ENABLED === 'true') is
 *     the FIRST check. When off: no Supabase client, no RPC, no token, no
 *     provider call, no finalizer.
 *   - ALL delivery-state mutations go through RPCs. This module performs NO
 *     direct marketing-table writes and NO control writes.
 *   - No provider attempt => no attempt finalizer (malformed / token / URL /
 *     JIT-rejected claims are left for lease recovery; attempts never synthesised).
 *   - Provider success + finalizer failure NEVER re-sends and NEVER calls the
 *     failure finalizer — the email may already be delivered.
 *   - Sequential `for...of` only (never Promise.all); at most 10 provider calls.
 *   - The returned summary and all logs are aggregate + machine-safe: no email,
 *     no id/uuid, no token, no URL, no rendered content, no provider body.
 *
 * All external effects are injected (defaulting to the real implementations) so
 * tests can exercise every path with zero real Supabase / Resend / email.
 */

// ---------------------------------------------------------------------------
// Injected dependencies (default to the real, audited implementations)
// ---------------------------------------------------------------------------

export interface MarketingRpcClient {
  rpc(fn: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

export interface DeliveryWorkerDeps {
  /** Fresh service-role client (built ONLY after the kill switch passes). */
  getClient?: () => MarketingRpcClient
  /** Stage 029 provider — the sole production caller lives in THIS module. */
  sendProvider?: typeof sendMarketingEmailViaResend
  /** Existing opaque unsubscribe-token minter. */
  createToken?: (userId: string, emailLc: string) => string
  /**
   * OPTIONAL Stage 032 canary safety guard — INTERNAL SERVER-SIDE ONLY.
   *
   * When omitted, the worker behaves EXACTLY as before (normal batch delivery).
   * When supplied, after the normal recovery + claim, the worker refuses to
   * proceed to JIT authorization / the provider unless the claim batch is
   * EXACTLY one claim whose recipientId equals this value. Any other shape
   * (zero, more than one, or a different/malformed recipient) aborts BEFORE the
   * provider, calls NO failure finalizer, and leaves leases for normal recovery.
   *
   * This must NEVER be sourced from HTTP input (query/body/form/cookie) — the
   * Stage 032 admin route hard-codes it server-side.
   */
  expectedRecipientId?: string
}

// ---------------------------------------------------------------------------
// Public aggregate result contract (safe — no identity/financial fields)
// ---------------------------------------------------------------------------

export type DeliveryWorkerStatus = 'blocked' | 'no_work' | 'ok' | 'partial' | 'error'

export interface DeliveryWorkerResult {
  status: DeliveryWorkerStatus
  reason?: string
  recoveredClaims: number
  claimStatus: string
  claimed: number
  malformedClaims: number
  preProviderRejected: number
  authorized: number
  authorizationRejected: number
  providerSucceeded: number
  providerFailed: number
  successFinalized: number
  failureFinalized: number
  providerSucceededFinalizeFailed: number
  providerFailedFinalizeFailed: number
}

// ---------------------------------------------------------------------------
// Fixed, non-overridable limits (never accept HTTP input for these)
// ---------------------------------------------------------------------------

const CLAIM_LIMIT = 10
const CLAIM_LEASE_SECONDS = 120
const RECOVERY_LIMIT = 100
const RETRY_AFTER_SECONDS = 300

const MAX_EMAIL_LEN = 320
const MAX_IDEMPOTENCY_KEY_LEN = 256

const LOG_PREFIX = '[jobs/marketing-delivery]'

// ---------------------------------------------------------------------------
// Untrusted-data validation helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedLine(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes('\r') &&
    !value.includes('\n')
  )
}

/** Parseable as a timestamp, but the ORIGINAL string is what we keep + pass back. */
function isParseableTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

/** A structurally valid claim, with every field already narrowed. */
interface ValidatedClaim {
  recipientId: string
  runId: string
  opportunityId: string
  userId: string
  emailLc: string
  idempotencyKey: string
  claimToken: string
  templateSnapshot: Record<string, unknown>
  contextSnapshot: Record<string, unknown>
}

/**
 * Validate a single untrusted claim entry. Returns the narrowed claim, or null
 * when ANYTHING is malformed. Never logs the claim contents.
 */
function validateClaim(raw: unknown): ValidatedClaim | null {
  if (!isPlainObject(raw)) return null

  const {
    recipientId,
    runId,
    opportunityId,
    userId,
    emailLc,
    idempotencyKey,
    claimToken,
    lockedUntil,
    templateSnapshot,
    contextSnapshot,
    discountSnapshot,
  } = raw

  if (!isUuid(recipientId)) return null
  if (!isUuid(runId)) return null
  if (!isUuid(opportunityId)) return null
  if (!isUuid(userId)) return null
  if (!isBoundedLine(emailLc, MAX_EMAIL_LEN)) return null
  if (!isBoundedLine(idempotencyKey, MAX_IDEMPOTENCY_KEY_LEN)) return null
  if (!isParseableTimestamp(claimToken)) return null
  if (!isParseableTimestamp(lockedUntil)) return null
  if (!isPlainObject(templateSnapshot)) return null
  if (!isPlainObject(contextSnapshot)) return null
  // Stage 025/027 safety gate: only a null discount snapshot is supported.
  if (discountSnapshot !== null) return null

  return {
    recipientId,
    runId,
    opportunityId,
    userId,
    emailLc,
    idempotencyKey,
    // Keep the EXACT original strings — never reformat the claim token.
    claimToken: claimToken as string,
    templateSnapshot,
    contextSnapshot,
  }
}

// ---------------------------------------------------------------------------
// Canonical one-click unsubscribe URL (fail closed, never logged/persisted)
// ---------------------------------------------------------------------------

/**
 * Build the RFC 8058 one-click unsubscribe URL for a claim. Requires a valid
 * https NEXT_PUBLIC_SITE_URL — never falls back to Host headers or localhost.
 * Throws on any problem so the caller can count it as preProviderRejected.
 */
function buildUnsubscribeUrl(
  userId: string,
  emailLc: string,
  createToken: (userId: string, emailLc: string) => string,
): string {
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL
  if (!siteOrigin || siteOrigin.trim().length === 0) {
    throw new Error('site_origin_missing')
  }

  const url = new URL('/api/marketing/unsubscribe', siteOrigin)
  if (url.protocol !== 'https:') {
    throw new Error('site_origin_insecure')
  }

  // createToken may throw on secret misconfiguration — that is a pre-provider
  // rejection too. URLSearchParams performs correct token encoding.
  url.searchParams.set('token', createToken(userId, emailLc))
  return url.toString()
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

function emptyResult(): DeliveryWorkerResult {
  return {
    status: 'ok',
    recoveredClaims: 0,
    claimStatus: '',
    claimed: 0,
    malformedClaims: 0,
    preProviderRejected: 0,
    authorized: 0,
    authorizationRejected: 0,
    providerSucceeded: 0,
    providerFailed: 0,
    successFinalized: 0,
    failureFinalized: 0,
    providerSucceededFinalizeFailed: 0,
    providerFailedFinalizeFailed: 0,
  }
}

/** Claim statuses that mean "do not send" (the RPC declined to hand out work). */
const NON_WORK_CLAIM_STATUSES = new Set([
  'control_missing',
  'sending_disabled',
  'rollout_disabled',
  'invalid_batch_configuration',
])

export async function runMarketingDeliveryBatch(
  deps: DeliveryWorkerDeps = {},
): Promise<DeliveryWorkerResult> {
  const result = emptyResult()

  // STEP 0 — APPLICATION KILL SWITCH (must be first; only exact 'true' enables).
  if (process.env.MARKETING_DELIVERY_WORKER_ENABLED !== 'true') {
    result.status = 'blocked'
    result.reason = 'worker_disabled'
    console.log(`${LOG_PREFIX} blocked: worker_disabled`)
    return result
  }

  const getClient = deps.getClient ?? (() => getMarketingServiceClient() as unknown as MarketingRpcClient)
  const sendProvider = deps.sendProvider ?? sendMarketingEmailViaResend
  const createToken = deps.createToken ?? createUnsubscribeToken
  // Optional internal canary guard target (never from HTTP; see DeliveryWorkerDeps).
  const expectedRecipientId = deps.expectedRecipientId

  // Build the service-role client ONLY after the kill switch passed.
  let supabase: MarketingRpcClient
  try {
    supabase = getClient()
  } catch {
    result.status = 'error'
    result.reason = 'service_client_unavailable'
    console.log(`${LOG_PREFIX} error: service_client_unavailable`)
    return result
  }

  // STEP 1 — RECOVER EXPIRED LEASES (fail closed on any problem).
  {
    const { data, error } = await supabase.rpc('recover_expired_marketing_delivery_claims', {
      p_limit: RECOVERY_LIMIT,
    })
    if (error || !isPlainObject(data) || data.status !== 'ok') {
      result.status = 'error'
      result.reason = 'recovery_failed'
      console.log(`${LOG_PREFIX} error: recovery_failed`)
      return result
    }
    const recovered = data.recoveredRecipients
    result.recoveredClaims = typeof recovered === 'number' && Number.isFinite(recovered) ? recovered : 0
  }

  // STEP 2 — CLAIM a bounded batch (fixed limits; never HTTP-overridable).
  const claimResp = await supabase.rpc('claim_marketing_delivery_batch', {
    p_limit: CLAIM_LIMIT,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  })
  if (claimResp.error || !isPlainObject(claimResp.data)) {
    result.status = 'error'
    result.reason = 'claim_failed'
    console.log(`${LOG_PREFIX} error: claim_failed`)
    return result
  }

  const claimData = claimResp.data
  const claimStatus = typeof claimData.status === 'string' ? claimData.status : 'unknown'
  result.claimStatus = claimStatus

  // Non-ok claim statuses => safe blocked summary, provider never called.
  if (claimStatus !== 'ok') {
    result.status = 'blocked'
    result.reason = NON_WORK_CLAIM_STATUSES.has(claimStatus) ? claimStatus : 'claim_not_ok'
    console.log(`${LOG_PREFIX} blocked: ${result.reason}`)
    return result
  }

  const claims = Array.isArray(claimData.claims) ? claimData.claims : []
  result.claimed = claims.length

  if (claims.length === 0) {
    result.status = 'no_work'
    console.log(`${LOG_PREFIX} no_work: 0 claims`)
    return result
  }

  // STEP 2.5 — OPTIONAL Stage 032 CANARY GUARD (additive; no-op when omitted).
  //
  // Only runs when an internal expectedRecipientId was supplied. It gates the
  // transition from "claimed" to "about to send": if the batch is anything
  // other than exactly one claim for the expected recipient, we abort BEFORE
  // JIT authorization / the provider, call NO failure finalizer, and leave the
  // lease(s) for the existing recovery mechanism. Normal (non-canary) delivery
  // never enters this block.
  if (expectedRecipientId !== undefined) {
    if (claims.length !== 1) {
      result.status = 'blocked'
      result.reason = 'canary_multiple_claims'
      console.log(`${LOG_PREFIX} blocked: canary_multiple_claims claimed=${claims.length}`)
      return result
    }
    const only = claims[0]
    const onlyRecipientId = isPlainObject(only) ? only.recipientId : undefined
    if (onlyRecipientId !== expectedRecipientId) {
      result.status = 'blocked'
      result.reason = 'canary_recipient_mismatch'
      // Never log either recipient id — only the safe machine reason.
      console.log(`${LOG_PREFIX} blocked: canary_recipient_mismatch`)
      return result
    }
  }

  // STEP 3 — process SEQUENTIALLY (never in parallel), capped at CLAIM_LIMIT.
  const bounded = claims.slice(0, CLAIM_LIMIT)
  for (const rawClaim of bounded) {
    // 1. Validate untrusted claim structure.
    const claim = validateClaim(rawClaim)
    if (!claim) {
      result.malformedClaims += 1
      // Do NOT log the malformed payload — only a safe counter increment.
      continue
    }

    // 2 + 3. Mint unsubscribe token and build the canonical one-click URL.
    let unsubscribeUrl: string
    try {
      unsubscribeUrl = buildUnsubscribeUrl(claim.userId, claim.emailLc, createToken)
    } catch {
      // No provider attempt occurred — lease recovery handles this claim later.
      result.preProviderRejected += 1
      continue
    }

    // 4. JIT authorization (Stage 027) with the EXACT original claim token.
    const authResp = await supabase.rpc('authorize_marketing_delivery_claim', {
      p_recipient_id: claim.recipientId,
      p_claim_token: claim.claimToken,
    })
    const authData = authResp.data
    const authorized = !authResp.error && isPlainObject(authData) && authData.authorized === true

    // 5. Only authorized === true may proceed. Anything else: no provider, no
    //    finalizer, no synthetic attempt — lease recovery reclaims it.
    if (!authorized) {
      result.authorizationRejected += 1
      continue
    }
    result.authorized += 1

    // 6. IMMEDIATELY call the provider (no unrelated awaited op in between).
    const providerResult = await sendProvider({
      emailLc: claim.emailLc,
      idempotencyKey: claim.idempotencyKey,
      templateSnapshot: claim.templateSnapshot,
      contextSnapshot: claim.contextSnapshot,
      unsubscribeUrl,
    })

    // 7A. Provider success -> success finalizer (Stage 028).
    if (providerResult.ok) {
      result.providerSucceeded += 1
      const finResp = await supabase.rpc('finalize_marketing_delivery_success', {
        p_recipient_id: claim.recipientId,
        p_claim_token: claim.claimToken,
        p_provider_email_id: providerResult.providerEmailId,
      })
      const finData = finResp.data
      const finalizedOk =
        !finResp.error &&
        isPlainObject(finData) &&
        finData.finalized === true &&
        finData.status === 'sent_recorded'

      if (finalizedOk) {
        result.successFinalized += 1
      } else {
        // CRITICAL: email may be delivered. NEVER resend, NEVER call the failure
        // finalizer, NEVER write tables directly. Recovery + provider idempotency
        // key protect the eventual reconciliation.
        result.providerSucceededFinalizeFailed += 1
      }
      continue
    }

    // 7B. Provider failure -> failure finalizer (Stage 028) with fixed 300s delay.
    result.providerFailed += 1
    const failResp = await supabase.rpc('finalize_marketing_delivery_failure', {
      p_recipient_id: claim.recipientId,
      p_claim_token: claim.claimToken,
      p_error_code: providerResult.errorCode,
      p_retryable: providerResult.retryable,
      p_retry_after_seconds: RETRY_AFTER_SECONDS,
    })
    const failData = failResp.data
    const failureFinalizedOk =
      !failResp.error &&
      isPlainObject(failData) &&
      failData.finalized === true &&
      (failData.status === 'retry_scheduled' || failData.status === 'failed_terminal')

    if (failureFinalizedOk) {
      result.failureFinalized += 1
    } else {
      result.providerFailedFinalizeFailed += 1
    }
  }

  // Aggregate status: clean run => ok; any per-claim anomaly => partial.
  const anomalies =
    result.malformedClaims +
    result.preProviderRejected +
    result.authorizationRejected +
    result.providerSucceededFinalizeFailed +
    result.providerFailedFinalizeFailed

  result.status = anomalies === 0 ? 'ok' : 'partial'

  console.log(
    `${LOG_PREFIX} ${result.status}: claimed=${result.claimed} authorized=${result.authorized} ` +
      `sent=${result.successFinalized} failed=${result.failureFinalized} ` +
      `malformed=${result.malformedClaims} preProviderRejected=${result.preProviderRejected} ` +
      `authRejected=${result.authorizationRejected} ` +
      `succFinalizeFailed=${result.providerSucceededFinalizeFailed} ` +
      `failFinalizeFailed=${result.providerFailedFinalizeFailed} recovered=${result.recoveredClaims}`,
  )

  return result
}
