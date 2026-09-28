import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getMarketingPreferenceState,
  setMarketingEmailPreference,
} from '@/lib/marketing/service'
import { MARKETING_CONSENT_SOURCE, MARKETING_CONSENT_VERSION } from '@/lib/marketing/consent'
import { rateLimit } from '@/lib/marketing/rate-limit'

export const runtime = 'nodejs'

/**
 * Authenticated marketing-preference API.
 *
 *   GET   -> { enabled, canEnable }
 *   PATCH -> { enabled }               (body: { enabled: boolean })
 *
 * The user id + email are resolved from the authenticated Supabase session and
 * normalised server-side. A browser-supplied id or email is never trusted. The
 * service-role client is only constructed AFTER authentication succeeds. Errors
 * are stable and generic — no suppression reasons, raw SQL, or provider ids leak.
 */

/** Resolve the authenticated user, or null. */
async function getSessionUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user || !user.email) return null
  return { id: user.id, email: user.email }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const state = await getMarketingPreferenceState(user.id, user.email)
  return NextResponse.json(state)
}

export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Conservative per-user rate limit on updates.
  const limit = rateLimit(`marketing-pref:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const enabled = body.enabled

  // When enabling, respect blocking (non-unsubscribe) suppressions. We never
  // tell the browser WHY it is blocked — only that it cannot be enabled.
  if (enabled) {
    const current = await getMarketingPreferenceState(user.id, user.email)
    if (!current.canEnable) {
      return NextResponse.json({ error: 'cannot_enable' }, { status: 409 })
    }
  }

  const result = await setMarketingEmailPreference({
    userId: user.id,
    emailLc: user.email,
    enabled,
    source: MARKETING_CONSENT_SOURCE.accountSettings,
    consentVersion: enabled ? MARKETING_CONSENT_VERSION : undefined,
  })

  if (!result.ok) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  // Return the fresh, authoritative state after the write.
  const state = await getMarketingPreferenceState(user.id, user.email)
  return NextResponse.json(state)
}
