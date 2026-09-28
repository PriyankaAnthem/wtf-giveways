import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * True only for the expected stale-refresh-token conditions:
 *   - refresh_token_not_found  ("Invalid Refresh Token: Refresh Token Not Found")
 *   - refresh_token_already_used ("Invalid Refresh Token: Already Used")
 * These are normal after a deploy or a duplicate refresh and must be handled
 * silently. All other auth errors are intentionally excluded.
 */
export function isStaleRefreshTokenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  if (code === 'refresh_token_not_found' || code === 'refresh_token_already_used') {
    return true
  }
  const message = String((err as { message?: string }).message ?? '')
  return (
    /refresh token not found/i.test(message) ||
    /invalid refresh token: already used/i.test(message)
  )
}

/**
 * Expire the Supabase auth cookies (default naming: `sb-<ref>-auth-token`,
 * optionally chunked `.0`, `.1`, …) on the outgoing response, using the same
 * cookie names present on the request. This stops the browser from replaying
 * a stale token without triggering another refresh attempt.
 */
export function clearStaleAuthCookies(request: NextRequest, response: NextResponse) {
  for (const cookie of request.cookies.getAll()) {
    if (/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) {
      response.cookies.set(cookie.name, '', { maxAge: 0, path: '/' })
    }
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getUser() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  try {
    const { error } = await supabase.auth.getUser()
    if (error && isStaleRefreshTokenError(error)) {
      // Expected condition: the browser holds a rotated/expired refresh token
      // (e.g. after a deploy or a duplicate refresh). Treat the request as
      // logged out and clear the stale Supabase auth cookies so the client
      // stops replaying them. Do NOT retry the refresh, throw, or log as an
      // error. Public routes then continue as logged out; protected routes
      // (/me, /admin) still redirect via their own server-side getUser().
      clearStaleAuthCookies(request, supabaseResponse)
    }
    // All other auth errors preserve the previous behaviour (ignored here;
    // the session cookie is simply left as-is).
  } catch (err) {
    // getUser() can reject on a stale refresh token depending on the client
    // internals. Handle the same expected condition safely; never 500.
    if (isStaleRefreshTokenError(err)) {
      clearStaleAuthCookies(request, supabaseResponse)
    }
    // Non-stale-token failures: swallow so middleware never breaks the request.
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
