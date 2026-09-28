import 'server-only'
import { renderMarketingEmail } from './delivery-email'

/**
 * WTF Marketing — Stage 029 SAFE RESEND PROVIDER ADAPTER (isolated).
 *
 * This is ONLY step 3 of the established DB delivery architecture (claim ->
 * authorize -> PROVIDER CALL -> finalize success/failure). It knows nothing
 * about the database: a FUTURE worker (Stage 030) passes everything in as
 * arguments and persists the structured result. This module:
 *
 *   - performs NO database access (no Supabase import, no SQL, no RPC),
 *   - is NOT referenced by any production route/cron/page/action after Stage 029,
 *   - never returns raw provider bodies, API keys, customer emails, rendered
 *     content, or unsubscribe URLs to callers,
 *   - converts every network/timeout error into a structured result (never
 *     throws to the caller),
 *   - uses the SAME raw-fetch Resend approach already used elsewhere in the repo
 *     (no new dependency), with process.env.RESEND_API_KEY / RESEND_FROM.
 *
 * Idempotency: the DB claim token is the PRIMARY worker-ownership guard. The
 * provider `Idempotency-Key` header is SECONDARY duplicate protection using the
 * recipient's existing database idempotency key, passed in unchanged.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_IDEMPOTENCY_KEY_LEN = 256
const MAX_EMAIL_LEN = 320

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface MarketingProviderSuccess {
  ok: true
  providerEmailId: string
}

export interface MarketingProviderFailure {
  ok: false
  /** True only for transient conditions the worker may safely retry. */
  retryable: boolean
  /** Bounded, safe code compatible with the Stage 028 finalizer regex. */
  errorCode: string
}

export type MarketingProviderResult = MarketingProviderSuccess | MarketingProviderFailure

export interface SendMarketingEmailInput {
  emailLc: unknown
  idempotencyKey: unknown
  templateSnapshot: unknown
  contextSnapshot: unknown
  unsubscribeUrl: unknown
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function failure(retryable: boolean, errorCode: string): MarketingProviderFailure {
  return { ok: false, retryable, errorCode }
}

/**
 * Normalise + validate the recipient. The authoritative identity/permission
 * check already happened in the DB, so this is a defensive shape check only
 * (NOT a broad email regex).
 */
function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length === 0 || email.length > MAX_EMAIL_LEN) return null
  if (email.includes('\r') || email.includes('\n')) return null
  // Minimal structural sanity: exactly the presence of a single @ with content
  // on both sides. Authoritative validation is upstream in the database.
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return null
  return email
}

/**
 * Validate the idempotency key WITHOUT ever silently substituting or generating
 * a different value. Returns the trimmed key, or null when unusable.
 */
function validateIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LEN) return null
  if (key.includes('\r') || key.includes('\n')) return null
  return key
}

/**
 * Sanitise a value for use as a Resend tag. Resend only allows ASCII letters,
 * numbers, underscores and dashes. Anything else is replaced with '_'.
 */
function sanitiseTagValue(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50)
  return cleaned.length > 0 ? cleaned : 'unknown'
}

/** Map a non-OK HTTP status to a bounded, safe error code + retry class. */
function classifyHttpStatus(status: number): MarketingProviderFailure {
  if (status === 429) return failure(true, 'resend_rate_limited')
  if (status >= 500 && status <= 599) return failure(true, 'resend_server_error')
  // All other 4xx (400/401/403/404/422, ...) are permanent from our side.
  return failure(false, `resend_http_${status}`)
}

// ---------------------------------------------------------------------------
// Provider call
// ---------------------------------------------------------------------------

/**
 * Send a PREPARED marketing email through Resend. Returns a structured result;
 * never throws. Intended to be called ONLY by a future delivery worker.
 */
export async function sendMarketingEmailViaResend(
  input: SendMarketingEmailInput,
): Promise<MarketingProviderResult> {
  // 1. Configuration (fail closed, no fetch).
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || apiKey.trim().length === 0 || !from || from.trim().length === 0) {
    return failure(false, 'resend_config_missing')
  }

  // 2. Recipient (no fetch on failure).
  const emailLc = normaliseEmail(input.emailLc)
  if (emailLc === null) {
    return failure(false, 'invalid_recipient')
  }

  // 3. Idempotency key (no fetch on failure, never replaced).
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  if (idempotencyKey === null) {
    return failure(false, 'invalid_idempotency_key')
  }

  // 4. Render prepared content (no fetch on failure). The renderer re-validates
  //    the snapshots AND the unsubscribe URL (http(s) only), failing closed.
  let rendered
  try {
    rendered = renderMarketingEmail({
      templateSnapshot: input.templateSnapshot,
      contextSnapshot: input.contextSnapshot,
      unsubscribeUrl: input.unsubscribeUrl,
    })
  } catch {
    // Any render problem is a permanent, non-retryable content error.
    return failure(false, 'marketing_render_invalid')
  }

  // The renderer already proved the unsubscribe URL is a valid http(s) URL, so
  // re-parse it into a canonical form for the header. This strips any control
  // characters and prevents CRLF/header injection — we NEVER manufacture a
  // different URL, only normalise the one that was supplied.
  const safeUnsubscribeUrl = new URL(String(input.unsubscribeUrl).trim()).toString()

  // 5. Build the provider request. Unsubscribe headers use ONLY the supplied
  //    unsubscribeUrl. Tags are conservative and carry NO identity/financial data.
  const body = {
    from,
    to: [emailLc],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      'List-Unsubscribe': `<${safeUnsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [
      { name: 'email_type', value: 'marketing' },
      { name: 'opportunity', value: sanitiseTagValue(rendered.opportunityType) },
    ],
  }

  // 6. Fire with a hard 15s timeout. All network/abort errors become results.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return failure(true, 'resend_timeout')
    }
    return failure(true, 'resend_network_error')
  } finally {
    clearTimeout(timer)
  }

  // 7. Classify the response WITHOUT leaking provider bodies.
  if (!res.ok) {
    return classifyHttpStatus(res.status)
  }

  let providerEmailId: string | null = null
  try {
    const json = (await res.json()) as { id?: unknown } | null
    if (json && typeof json.id === 'string' && json.id.trim().length > 0) {
      providerEmailId = json.id.trim()
    }
  } catch {
    providerEmailId = null
  }

  // A 2xx WITHOUT a usable id is not a real success — let the worker retry.
  if (providerEmailId === null) {
    return failure(true, 'resend_success_without_id')
  }

  return { ok: true, providerEmailId }
}
