import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { parseUnsubscribeToken } from '@/lib/marketing/unsubscribe-token'
import { unsubscribeMarketingEmail } from '@/lib/marketing/service'
import { MARKETING_CONSENT_SOURCE } from '@/lib/marketing/consent'
import { rateLimit, getClientIp } from '@/lib/marketing/rate-limit'

export const runtime = 'nodejs'

/**
 * Public marketing unsubscribe endpoint. Supports TWO request shapes that both
 * resolve to the SAME opaque-token → idempotent-unsubscribe flow:
 *
 *   MODE A — human confirmation (unchanged):
 *     POST application/json  body { token }             (token from JSON body)
 *
 *   MODE B — RFC 8058 mailbox one-click (additive):
 *     POST application/x-www-form-urlencoded            (token from ?token=…)
 *     ?token=<opaque>  body "List-Unsubscribe=One-Click"
 *
 * The only accepted credential is the opaque, encrypted token — the caller
 * never sends a user id or email. We validate + decrypt server-side, then call
 * the idempotent unsubscribe function. It never requires login/cookies/CSRF, is
 * safe to call repeatedly (repeat calls still return success), and never reveals
 * whether an account exists. Rate limiting is PER MODE: Mode A uses the caller's
 * IP (browser), Mode B uses a SHA-256 digest of the opaque token (mailbox
 * provider IPs are shared across unrelated recipients, so an IP bucket would
 * wrongly throttle legitimate one-click unsubscribes).
 *
 * GET never mutates — the human confirmation page lives at /unsubscribe and is
 * a separate concern; this route only mutates via POST.
 */
export async function POST(req: Request) {
  // Route strictly by media type (ignoring parameters like "; charset=utf-8").
  // We never parse a form body as JSON or vice versa, and never mix token
  // sources between the two modes. Rate limiting is applied PER MODE (see below)
  // because the two flows have fundamentally different callers.
  const mediaType = (req.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()

  let token: unknown

  if (mediaType === 'application/json') {
    // MODE A — human confirmation flow (unchanged). Rate limited by the caller's
    // IP: this is a browser fetch from the /unsubscribe page. Key + thresholds
    // are byte-for-byte the original Stage 029.5 contract.
    const ip = getClientIp(req)
    const limit = rateLimit(`unsub:${ip}`, { limit: 10, windowMs: 60_000 })
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      )
    }

    // Token comes ONLY from the JSON body.
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null
    token = body?.token
  } else if (mediaType === 'application/x-www-form-urlencoded') {
    // MODE B — RFC 8058 one-click. The caller is a mailbox provider's server, so
    // its IP is shared across unrelated recipients: an IP bucket would falsely
    // throttle legitimate unsubscribes. Instead we validate the request, then
    // rate-limit on a privacy-safe, deterministic ONE-WAY digest of the opaque
    // query token — never the raw token, never the user id/email, and without
    // decrypting the token to build the key.
    const queryToken = new URL(req.url).searchParams.get('token')
    if (!queryToken) {
      // Missing or empty ?token= — reveal nothing, mutate nothing.
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }

    const rawBody = await req.text().catch(() => '')
    const form = new URLSearchParams(rawBody)
    if (form.get('List-Unsubscribe') !== 'One-Click') {
      return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
    }

    // SHA-256 the OPAQUE query token (not the decrypted identity) for the key.
    const tokenDigest = createHash('sha256').update(queryToken).digest('hex')
    const limit = rateLimit(`unsub-one-click:${tokenDigest}`, {
      limit: 5,
      windowMs: 5 * 60_000,
    })
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      )
    }

    token = queryToken
  } else {
    // Unknown/unsupported media type — fail closed, no mutation.
    return NextResponse.json({ ok: false, error: 'unsupported_media_type' }, { status: 415 })
  }

  const payload = parseUnsubscribeToken(token)

  // Invalid/tampered/expired token — reveal nothing about any account.
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const result = await unsubscribeMarketingEmail({
    userId: payload.userId,
    emailLc: payload.emailLc,
    source: MARKETING_CONSENT_SOURCE.unsubscribeLink,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'unsubscribe_failed' }, { status: 500 })
  }

  // Same success response whether this was the first unsubscribe or a repeat.
  return NextResponse.json({ ok: true })
}
