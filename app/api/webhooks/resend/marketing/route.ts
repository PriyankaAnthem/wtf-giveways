import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { getMarketingServiceClient } from '@/lib/marketing/service'

/**
 * WTF Marketing — Stage 031B STRICT RESEND MARKETING WEBHOOK ROUTE (isolated).
 *
 * This is the ONLY production consumer of the Stage 031A database boundary
 * function `record_marketing_resend_event`. It converts an authenticated Resend
 * webhook event into exactly one service-role RPC call, and does nothing else.
 *
 * HARD INVARIANTS (enforced here, not merely documented):
 *   - POST only. No GET. Node runtime (svix needs Node crypto).
 *   - Fail closed with 503 when RESEND_WEBHOOK_SECRET is absent/blank — before
 *     any header read, body parse, Supabase client, or RPC.
 *   - The RAW request text is verified by svix BEFORE any JSON parsing. We never
 *     call request.json() and never JSON.parse the body before verification.
 *   - The authoritative event id is the `svix-id` HEADER, never a payload field.
 *   - MARKETING-ONLY: only events explicitly tagged email_type=marketing (the
 *     exact Stage 029 tag) may enter the pipeline. WTF's existing transactional
 *     Resend email carries NO tags, so it can never leak into marketing.
 *   - Only the four supported lifecycle events reach the RPC; everything else
 *     is a safe 200 ignore.
 *   - Stage 031A RPC is the SOLE mutation boundary — no direct table writes.
 *   - No PII (recipient, subject, click url/ip/ua, bounce text, message ids) is
 *     ever passed to the RPC, stored, logged, or returned.
 *   - The sending kill switch does NOT gate this route: a signed provider
 *     lifecycle event (e.g. a bounce/complaint) must still be processed even if
 *     sending is later disabled. Authentication is the Resend signature only —
 *     it is neither a cron nor a scheduled task and takes no shared job secret.
 *   - Importing this module performs no side effects (no client, no network).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const LOG_PREFIX = '[webhooks/resend/marketing]'
const NO_STORE = { 'Cache-Control': 'private, no-store' }

const MAX_EVENT_ID_LEN = 500
const MAX_EMAIL_ID_LEN = 500

// The four lifecycle events Stage 031A supports. Anything else is ignored.
const SUPPORTED_EVENT_TYPES = new Set<string>([
  'email.delivered',
  'email.clicked',
  'email.bounced',
  'email.complained',
])

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status, headers: NO_STORE })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A bounded, single-line, non-empty string. */
function isBoundedLine(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes('\r') &&
    !value.includes('\n')
  )
}

/**
 * Determine whether the VERIFIED event is explicitly tagged as marketing.
 *
 * Resend accepts send-time tags as an array of { name, value } (see the Stage
 * 029 provider), but the WEBHOOK payload delivers them under `data.tags` as an
 * object map, e.g. { email_type: "marketing", opportunity: "..." }. We accept
 * ONLY an exact email_type === "marketing" match. We defensively also handle
 * the array form. Missing/malformed tags are treated as NON-marketing (safe).
 *
 * Marketing status is derived ONLY from this explicit tag — never from
 * recipient, sender, subject, campaign, route, or email address.
 */
function isMarketingEvent(data: Record<string, unknown>): boolean {
  const tags = data.tags

  // Object-map form (the Resend webhook shape).
  if (isPlainObject(tags)) {
    return tags.email_type === 'marketing'
  }

  // Defensive array form ({ name, value }[]).
  if (Array.isArray(tags)) {
    return tags.some(
      (t) => isPlainObject(t) && t.name === 'email_type' && t.value === 'marketing',
    )
  }

  // No tags, or an unexpected type => not marketing.
  return false
}

export async function POST(request: Request) {
  // 1. SECRET — fail closed before touching anything else.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (!webhookSecret || webhookSecret.trim().length === 0) {
    console.error(`${LOG_PREFIX} not configured`)
    return json(503, { ok: false, status: 'not_configured' })
  }

  // 2. REQUIRED SVIX HEADERS — all three must be present and non-blank.
  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')
  if (
    !svixId ||
    svixId.trim().length === 0 ||
    !svixTimestamp ||
    svixTimestamp.trim().length === 0 ||
    !svixSignature ||
    svixSignature.trim().length === 0
  ) {
    return json(400, { ok: false, status: 'missing_headers' })
  }

  // 3. RAW BODY — exact text, never json()/JSON.parse before verification.
  const rawBody = await request.text()

  // 4. SIGNATURE VERIFICATION — svix verifies the RAW body with the three
  //    headers. Only the value it returns may be inspected. Never log the raw
  //    body, signature, secret, or svix-id, and never expose verifier errors.
  let verified: unknown
  try {
    const wh = new Webhook(webhookSecret)
    verified = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
  } catch {
    return json(400, { ok: false, status: 'invalid_signature' })
  }

  // 5. VERIFIED PAYLOAD is still untrusted data — validate structure.
  if (!isPlainObject(verified)) {
    return json(400, { ok: false, status: 'invalid_payload' })
  }

  const eventType = verified.type
  const data = verified.data
  if (!isPlainObject(data)) {
    return json(400, { ok: false, status: 'invalid_payload' })
  }

  // 6. MARKETING-ONLY FILTER — before creating any Supabase client. Non-marketing
  //    (including all transactional email, which sends no tags) is a safe 200.
  if (!isMarketingEvent(data)) {
    return json(200, { ok: true, status: 'ignored_non_marketing' })
  }

  // 7. SUPPORTED EVENT FILTER — signed + marketing, but out of scope => 200.
  if (typeof eventType !== 'string' || !SUPPORTED_EVENT_TYPES.has(eventType)) {
    return json(200, { ok: true, status: 'ignored_event_type' })
  }

  // 8. FIELD VALIDATION for the supported marketing event. `created_at` must be
  //    a parseable timestamp, but we retain the ORIGINAL string unchanged.
  if (!isBoundedLine(svixId, MAX_EVENT_ID_LEN)) {
    return json(400, { ok: false, status: 'invalid_event_id' })
  }

  const createdAt = verified.created_at
  if (typeof createdAt !== 'string' || createdAt.length === 0 || Number.isNaN(Date.parse(createdAt))) {
    return json(400, { ok: false, status: 'invalid_created_at' })
  }

  // The provider identifier used by Stage 031A for matching is data.email_id
  // (the id returned by the Resend send API). Never message_id/broadcast_id.
  const emailId = data.email_id
  if (!isBoundedLine(emailId, MAX_EMAIL_ID_LEN)) {
    return json(400, { ok: false, status: 'invalid_email_id' })
  }

  // 9. SERVICE-ROLE CLIENT — constructed ONLY now that signature, payload,
  //    marketing tag, event type, and all fields are validated.
  let supabase
  try {
    supabase = getMarketingServiceClient()
  } catch {
    return json(503, { ok: false, status: 'processing_failed' })
  }

  // 10. STAGE 031A RPC — the ONLY mutation boundary. We pass ONLY the four
  //     non-PII fields it needs: the svix-id header, the verified type, the
  //     provider email id, and the original created_at string.
  const { data: rpcData, error: rpcError } = await supabase.rpc('record_marketing_resend_event', {
    p_event_id: svixId,
    p_event_type: eventType,
    p_provider_email_id: emailId,
    p_event_created_at: createdAt,
  })

  if (rpcError) {
    // Never log or expose the raw Supabase error object.
    console.error(`${LOG_PREFIX} rpc error`)
    return json(503, { ok: false, status: 'processing_failed' })
  }

  // 11. RESPONSE MAPPING — treat the RPC response as untrusted.
  if (!isPlainObject(rpcData)) {
    return json(503, { ok: false, status: 'processing_failed' })
  }

  const status = rpcData.status
  const processed = rpcData.processed === true
  const retryable = rpcData.retryable === true

  // Successful processing.
  if (status === 'processed' && processed) {
    return json(200, { ok: true, status: 'processed' })
  }

  // Idempotent duplicate.
  if (status === 'duplicate' && processed) {
    return json(200, { ok: true, status: 'duplicate' })
  }

  // Retryable recipient race/state — return non-200 so Resend retries later
  // (e.g. the webhook beat Stage 028 provider-success finalisation). Never
  // expose the internal recipient reason.
  if (!processed && retryable) {
    return json(503, { ok: false, status: 'retry_later' })
  }

  // Any other unexpected/non-success result => fail closed. Never expose detail.
  return json(503, { ok: false, status: 'processing_failed' })
}
