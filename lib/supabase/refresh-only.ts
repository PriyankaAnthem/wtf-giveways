import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { clearStaleAuthCookies, isStaleRefreshTokenError } from '@/lib/supabase/proxy'

/**
 * Supabase auth cookie names: `sb-<ref>-auth-token`, optionally chunked
 * (`.0`, `.1`, …). Kept in sync with `clearStaleAuthCookies` in proxy.ts.
 */
const SUPABASE_AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/

/** Shape @supabase/ssr passes to `setAll`. */
type CookieToSet = {
  name: string
  value: string
  options?: Parameters<NextResponse['cookies']['set']>[2]
}

/**
 * True when the request carries any Supabase auth cookie.
 *
 * This is a pure string check on cookie NAMES only — it never decodes, trusts,
 * or derives identity from the cookie value. It exists solely to keep
 * anonymous traffic on a zero-Auth fast path.
 */
export function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => SUPABASE_AUTH_COOKIE.test(cookie.name))
}

/**
 * REFRESH-ONLY session maintenance for hot public HTML routes
 * (`/`, `/winners*`, `/giveaways*`).
 *
 * ## What this does
 *
 * Exactly three things, and nothing else:
 *   1. Refreshes the access token *only if* the SDK decides it is stale.
 *   2. Persists the refreshed cookies onto the outgoing response.
 *   3. Clears unusable (`refresh_token_not_found` / `already_used`) auth cookies.
 *
 * ## Why `getSession()` and not `getUser()`
 *
 * Verified against the installed @supabase/auth-js 2.95.3:
 *   - `getSession()` → `_useSession` → `__loadSession`. When the token is NOT
 *     within the 90s expiry margin it returns the session straight from cookie
 *     storage and performs **zero** network requests (GoTrueClient.js:42-64).
 *   - When it IS stale it calls `_callRefreshToken` — a single
 *     `POST /auth/v1/token?grant_type=refresh_token` — deduped per client
 *     instance via `refreshingDeferred` (GoTrueClient.js:66, :1971-1973).
 *   - `__loadSession` never calls `_getUser`, so this path issues **no**
 *     `GET /auth/v1/user`. `getUser()`, by contrast, ALWAYS performs that
 *     round-trip when a session exists — which is why using it here would
 *     double verified-user Auth traffic on our highest-volume routes.
 *   - On a successful refresh, `_callRefreshToken` emits `TOKEN_REFRESHED`,
 *     which @supabase/ssr 0.5.2 handles by calling `applyServerStorage` →
 *     our `setAll` below (createServerClient.js:36-54), so refreshed cookies
 *     reach the response.
 *   - On a non-retryable refresh error it calls `_removeSession()` and RETURNS
 *     the error (does not throw), so stale tokens are detectable.
 *
 * ## SECURITY — READ BEFORE MODIFYING
 *
 * The session returned by `getSession()` here is **UNVERIFIED**. It is decoded
 * from a cookie and is NOT validated against the Auth server. This function
 * therefore deliberately **discards** it: it is never returned, never attached
 * to the request, and never used to make a decision.
 *
 * This path performs NO authentication and NO authorisation. It must never be
 * used to derive a user id, wallet balance, permissions, admin status,
 * self-exclusion state, account data, or checkout eligibility. All identity
 * decisions remain with the authoritative server-side `auth.getUser()` calls
 * in `components/site-header.tsx`, `/me`, checkout, and `lib/admin/auth.ts`,
 * which are intentionally left unchanged.
 */
export async function refreshSessionOnly(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  // With Fluid compute, never hoist this client into a module/global scope.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  try {
    // Return value intentionally ignored except for its error — see SECURITY.
    const { error } = await supabase.auth.getSession()
    if (error && isStaleRefreshTokenError(error)) {
      // Rotated/expired refresh token (common after a deploy). Expire the
      // cookies so the browser stops replaying them on every pageview. Do not
      // retry, do not throw, do not log. The request continues as anonymous.
      clearStaleAuthCookies(request, response)
    }
  } catch (err) {
    // Defensive: depending on internals a stale token can reject rather than
    // resolve with an error. Same handling; middleware must never 500.
    if (isStaleRefreshTokenError(err)) {
      clearStaleAuthCookies(request, response)
    }
  }

  // Must be returned as-is so the refreshed cookies survive.
  return response
}
