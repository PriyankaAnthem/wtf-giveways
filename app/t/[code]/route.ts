import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ATTRIBUTION_COOKIE_NAME_V2,
  ATTRIBUTION_MAX_AGE_SECONDS,
  attributionCookieDomain,
  buildSnapshot,
  isSafeInternalPath,
  isValidShortCode,
  serializeAttribution,
  type ResolvedTrackingLink,
} from '@/lib/marketing/attribution'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Public short-link resolver:  GET /t/<code>
 *
 * Flow (all wrapped so it can NEVER throw a 500 to a visitor):
 *   1. Validate the code shape. Invalid -> redirect home, cookie untouched.
 *   2. Resolve via the SECURITY DEFINER `resolve_tracking_link` RPC (active
 *      links only; no service-role key in this unauthenticated route).
 *   3. Not found / inactive / any error -> redirect home, cookie untouched.
 *      (A dead or disabled link behaves like direct navigation and must NOT
 *      clear an existing valid attribution.)
 *   4. Found -> write the 7-day attribution cookie (last non-direct click wins;
 *      a newer tracked click always overwrites) and redirect to the link's safe
 *      internal destination.
 *
 * Only THIS route ever writes the attribution cookie. No other navigation,
 * including direct visits, reads or clears it — so attribution persists for the
 * full 7-day window unless a newer tracked click replaces it.
 */
function safeHome(request: Request): NextResponse {
  return NextResponse.redirect(new URL('/', request.url), 302)
}

function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0].trim() === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The externally-visible host of this request, used to scope the attribution
 * cookie. Prefer the proxied `x-forwarded-host` (Vercel), then the `Host`
 * header, then the URL. Port is stripped by `attributionCookieDomain`.
 */
function requestHostname(request: Request): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = (forwardedHost?.split(',')[0] || request.headers.get('host') || '').trim()
  if (host) return host
  try {
    return new URL(request.url).hostname
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params

    // 1) Shape check — never query the DB with a malformed code.
    if (!isValidShortCode(code)) {
      return safeHome(request)
    }

    // 2) Resolve (anon client -> SECURITY DEFINER RPC, active links only).
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('resolve_tracking_link', { p_code: code })

    if (error) {
      console.error('[t/code] resolve error:', error.message)
      return safeHome(request)
    }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined
    if (!row || typeof row.id !== 'string' || typeof row.destination_path !== 'string') {
      // Unknown or inactive code — behave like direct nav, do not touch cookie.
      return safeHome(request)
    }

    // 3) Defense-in-depth: re-validate the destination even though the DB
    //    constrains it. An unsafe value falls back to home safely.
    const destination = row.destination_path
    if (!isSafeInternalPath(destination)) {
      console.error('[t/code] unsafe destination for code', code)
      return safeHome(request)
    }

    // 4) Build the snapshot and set the cookie, then redirect to destination.
    const link: ResolvedTrackingLink = {
      id: row.id,
      source: String(row.source ?? ''),
      medium: String(row.medium ?? ''),
      channel: String(row.channel ?? ''),
      campaign: String(row.campaign ?? ''),
      content: typeof row.content === 'string' ? row.content : null,
      ref: typeof row.ref === 'string' ? row.ref : null,
      provider_id: typeof row.provider_id === 'string' ? row.provider_id : null,
      // Affiliate snapshot from resolve_tracking_link. Non-affiliate links (and
      // the pre-affiliate RPC) return these as null. The resolver returns an
      // affiliate for any ACTIVE tracking link regardless of whether the
      // affiliate master record was later deactivated — deactivation only
      // blocks NEW link creation, never an existing live link. buildSnapshot
      // freezes these; checkout never re-looks them up.
      affiliate_id: typeof row.affiliate_id === 'string' ? row.affiliate_id : null,
      affiliate_name: typeof row.affiliate_name === 'string' ? row.affiliate_name : null,
      affiliate_commission_bps:
        typeof row.affiliate_commission_bps === 'number' ? row.affiliate_commission_bps : null,
    }

    const snapshot = buildSnapshot(link, destination, Date.now())
    const value = serializeAttribution(snapshot)

    const res = NextResponse.redirect(new URL(destination, request.url), 302)
    if (value) {
      // On production WTF hosts, scope to the registrable domain so the cookie
      // is shared across apex + www (fixing the host-split attribution loss).
      // Off-production (localhost / *.vercel.app) `domain` is undefined and the
      // cookie stays host-only. All other attributes are preserved from v1.
      const host = requestHostname(request)
      const domain = attributionCookieDomain(host)
      res.cookies.set(ATTRIBUTION_COOKIE_NAME_V2, value, {
        httpOnly: true,
        secure: isSecureRequest(request),
        sameSite: 'lax', // survives top-level navigation from email / social clicks
        path: '/',
        maxAge: ATTRIBUTION_MAX_AGE_SECONDS,
        ...(domain ? { domain } : {}),
      })
      // Temporary diagnostics: host + booleans only. Never the cookie value.
      console.log('[v0][attr] wrote', {
        host,
        domainScoped: Boolean(domain),
        written: true,
      })
    }
    return res
  } catch (err) {
    // Attribution must NEVER break the visitor experience.
    console.error('[t/code] unexpected error:', err instanceof Error ? err.message : String(err))
    return safeHome(request)
  }
}
