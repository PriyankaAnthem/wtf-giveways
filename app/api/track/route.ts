import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_COOKIE_NAME_V2,
  attributionCookieDomain,
  parseAttributionCookie,
  pickAttributionCookieValue,
} from '@/lib/marketing/attribution'
import {
  WTF_VID_COOKIE,
  WTF_SID_COOKIE,
  VID_MAX_AGE_SECONDS,
  SID_MAX_AGE_SECONDS,
  isUuid,
  resolveTrafficIdentity,
  normalizeTrackPath,
  isTrackablePath,
  parseGiveawaySlug,
  isBotUserAgent,
  referrerHost,
} from '@/lib/analytics/traffic'
import { CONSENT_COOKIE, parseConsent } from '@/lib/analytics/consent'

// Node runtime: uses the service-role client + reads the auth session cookie.
export const runtime = 'nodejs'
// Never cache an ingestion endpoint.
export const dynamic = 'force-dynamic'

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

/**
 * Server-only service-role client. The key is read from the server environment
 * and NEVER leaves this route — no service-role secret is ever sent to the
 * browser (the client tracker only POSTs a tiny JSON body to this endpoint).
 */
function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

/**
 * Best-effort authenticated user id. A logged-out visitor (or any auth hiccup)
 * simply yields `null` — tracking never depends on auth and never throws here.
 */
async function resolveUserId(): Promise<string | null> {
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    return data.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * POST /api/track — first-party page-view ingestion.
 *
 * Contract: this endpoint is NON-CRITICAL. It must never throw to the client
 * and its failures are invisible to the customer. It returns small JSON bodies
 * that the client tracker ignores. It sets/refreshes the anonymous `wtf_vid`
 * (persistent) and `wtf_sid` (sliding 30-min) cookies as HttpOnly, Secure,
 * SameSite=Lax, first-party cookies.
 */
export async function POST(request: Request) {
  // --- TEMPORARILY DISABLED FOR HIGH TRAFFIC EVENT ---
  return NextResponse.json({ ok: true, ignored: 'high_traffic_event_override' }, NO_STORE)
  // --- END TEMPORARY OVERRIDE ---

  try {
    // ---- Parse body (tiny + defensive) ------------------------------------
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400, ...NO_STORE })
    }
    const payload = (body ?? {}) as Record<string, unknown>

    // event_id is the idempotency key — must be a valid UUID (reused on retry).
    const eventId = payload.eventId
    if (!isUuid(eventId)) {
      return NextResponse.json({ ok: false, error: 'invalid_event_id' }, { status: 400, ...NO_STORE })
    }

    // Normalise + gate the path. Non-trackable (admin/api) or unsafe paths are
    // acknowledged but never stored.
    const path = normalizeTrackPath(payload.path)
    if (!path || !isTrackablePath(path)) {
      return NextResponse.json({ ok: true, ignored: true }, NO_STORE)
    }

    const hdrs = await headers()
    const cookieStore = await cookies()

    // ---- Consent gate (server-authoritative) ------------------------------
    // No analytics identifiers are minted and nothing is stored unless the
    // visitor has GRANTED analytics consent. The client tracker already refuses
    // to fire without consent; this is the defense-in-depth backstop so even a
    // hand-crafted POST cannot create `wtf_vid`/`wtf_sid` or a traffic row.
    const consent = parseConsent(cookieStore.get(CONSENT_COOKIE)?.value)
    if (consent !== 'granted') {
      return NextResponse.json({ ok: true, ignored: 'no_consent' }, NO_STORE)
    }

    // ---- Identity: mint/refresh visitor + session -------------------------
    const nowMs = Date.now()
    const identity = resolveTrafficIdentity(
      cookieStore.get(WTF_VID_COOKIE)?.value,
      cookieStore.get(WTF_SID_COOKIE)?.value,
      nowMs,
    )

    // ---- Bot / noise filtering --------------------------------------------
    const isBot = isBotUserAgent(hdrs.get('user-agent'))

    // ---- Attribution reuse (source/medium/channel/campaign/link) ----------
    // Reuses the SAME /t attribution cookie the checkout snapshot uses; a bad
    // cookie parses to null and simply leaves these null.
    const rawAttr = pickAttributionCookieValue(
      cookieStore.get(ATTRIBUTION_COOKIE_NAME_V2)?.value,
      cookieStore.get(ATTRIBUTION_COOKIE_NAME)?.value,
    )
    const attr = parseAttributionCookie(rawAttr, Date.now())

    // ---- Campaign resolution ----------------------------------------------
    const campaignSlug = parseGiveawaySlug(path)
    let campaignId: string | null = null
    const svc = getServiceSupabase()
    if (campaignSlug) {
      try {
        const { data } = await svc
          .from('campaigns')
          .select('id')
          .eq('slug', campaignSlug)
          .maybeSingle()
        campaignId = (data?.id as string | undefined) ?? null
      } catch {
        campaignId = null
      }
    }

    // ---- Resolve auth user (optional) -------------------------------------
    const userId = await resolveUserId()

    // ---- Insert (idempotent on event_id) ----------------------------------
    // occurred_at is intentionally omitted so the DB server timestamp is
    // authoritative. ignoreDuplicates => INSERT ... ON CONFLICT (event_id)
    // DO NOTHING, so a retried event_id is a no-op.
    try {
      await svc
        .from('traffic_events')
        .upsert(
          {
            event_id: eventId,
            visitor_id: identity.visitorId,
            session_id: identity.sessionId,
            user_id: userId,
            event_type: 'page_view',
            path,
            campaign_id: campaignId,
            campaign_slug: campaignSlug,
            // The landing path is the first path of a session: only stamped
            // when we mint a new session id, otherwise null.
            landing_path: identity.isNewSession ? path : null,
            referrer_host: referrerHost(payload.referrer),
            source: attr?.source ?? null,
            medium: attr?.medium ?? null,
            channel: attr?.channel ?? null,
            campaign: attr?.campaign ?? null,
            tracking_link_id: isUuid(attr?.linkId) ? attr?.linkId : null,
            is_bot: isBot,
          },
          { onConflict: 'event_id', ignoreDuplicates: true },
        )
    } catch (err) {
      // Swallow — ingestion failure must never surface to the customer.
      console.error('[track] insert failed (ignored):', err instanceof Error ? err.message : String(err))
    }

    // ---- Set/refresh cookies ----------------------------------------------
    const res = NextResponse.json({ ok: true }, NO_STORE)
    const domain = attributionCookieDomain(hdrs.get('host'))
    const base = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      ...(domain ? { domain } : {}),
    }
    // Refresh the visitor cookie (keeps it alive) and slide the session window.
    // The session cookie stores the structured `"<uuid>.<lastActivityMs>"`
    // value so inactivity is measured from the server, not the browser's clock.
    res.cookies.set(WTF_VID_COOKIE, identity.visitorId, { ...base, maxAge: VID_MAX_AGE_SECONDS })
    res.cookies.set(WTF_SID_COOKIE, identity.sessionCookieValue, { ...base, maxAge: SID_MAX_AGE_SECONDS })
    return res
  } catch (err) {
    // Absolute backstop: never throw to the client.
    console.error('[track] unexpected error (ignored):', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false }, { status: 200, ...NO_STORE })
  }
}
