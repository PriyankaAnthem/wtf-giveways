import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { setMarketingEmailPreference } from '@/lib/marketing/service'
import { MARKETING_CONSENT_SOURCE } from '@/lib/marketing/consent'
import { safeInternalPath } from '@/lib/auth/safe-redirect'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  // Validate to a safe internal path so a crafted absolute/protocol-relative
  // `next` cannot turn this into an open redirect. Falls back to the homepage.
  const next = safeInternalPath(searchParams.get('next')) ?? '/'

  if (!code) {
    return NextResponse.redirect(new URL('/auth/login?error=missing_code', request.url))
  }

  let supabaseResponse = NextResponse.redirect(new URL(next, request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // keep request + response in sync (same pattern as lib/supabase/proxy.ts)
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

          supabaseResponse = NextResponse.redirect(new URL(next, request.url))

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message)
    return NextResponse.redirect(new URL('/auth/login?error=confirm_failed', request.url))
  }

  // A valid authenticated user now exists. If they ticked the optional marketing
  // consent box at signup (carried on the signUp request as user metadata), turn
  // it into a real, gated marketing preference now. This is best-effort: if it
  // fails, the account is still confirmed and the user simply remains ineligible
  // (we never silently retry or opt them in later). We log only a safe message,
  // never the full email address.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user?.email && user.user_metadata?.marketing_opt_in === true) {
      const result = await setMarketingEmailPreference({
        userId: user.id,
        emailLc: user.email,
        enabled: true,
        source: MARKETING_CONSENT_SOURCE.signup,
      })
      if (result.ok) {
        // Clear the one-shot flag so re-visiting the link cannot re-apply it.
        await supabase.auth.updateUser({ data: { marketing_opt_in: null } })
      } else {
        console.error('[auth/callback] marketing consent apply failed for user', user.id)
      }
    }
  } catch (consentErr) {
    console.error(
      '[auth/callback] marketing consent step threw:',
      consentErr instanceof Error ? consentErr.message : 'unknown_error',
    )
  }

  return supabaseResponse
}
