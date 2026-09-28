import { updateSession } from '@/lib/supabase/proxy'
import { hasSupabaseAuthCookie, refreshSessionOnly } from '@/lib/supabase/refresh-only'
import { NextResponse, type NextRequest } from 'next/server'

/* ------------------------------------------------------------------ */
/*  Maintenance-mode allow-list                                       */
/* ------------------------------------------------------------------ */
const MAINTENANCE_ALLOWED_PATHS = new Set([
  '/pre-register',
  '/api/pre-register',
  '/terms',
  '/privacy',
])

const MAINTENANCE_ALLOWED_PREFIXES = ['/_next/']

const MAINTENANCE_ALLOWED_ASSETS = new Set([
  '/og.jpg',
  '/favicon.ico',
  '/icon.svg',
  '/icon-dark-32x32.png',
  '/icon-light-32x32.png',
  '/apple-icon.png',
  '/robots.txt',
  '/sitemap.xml',
])

function isMaintenanceAllowed(pathname: string): boolean {
  if (MAINTENANCE_ALLOWED_PATHS.has(pathname)) return true
  if (MAINTENANCE_ALLOWED_ASSETS.has(pathname)) return true
  if (pathname.startsWith('/images/')) return true
  for (const prefix of MAINTENANCE_ALLOWED_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/*  Session bypass for hot public routes                               */
/* ------------------------------------------------------------------ */
/**
 * Hot public HTML routes that get the REFRESH-ONLY middleware path.
 *
 * These were previously in `shouldBypassSession`, which meant a logged-in
 * visitor's expired token was refreshed by the header inside an RSC — where the
 * rotated cookie cannot be persisted — so the same stale token was replayed on
 * every single pageview. They now run `refreshSessionOnly`, which persists the
 * refresh and clears poisoned cookies, WITHOUT performing any verified-user
 * (`GET /auth/v1/user`) call. Identity still comes only from the unchanged
 * `getUser()` in components/site-header.tsx.
 *
 * Exact-match or `/`-delimited prefix, so `/giveaways-foo` or `/winnerscircle`
 * do NOT match (the old `startsWith('/giveaways')` would have matched them).
 */
function isRefreshOnlyPublicRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/winners' ||
    pathname.startsWith('/winners/') ||
    pathname === '/giveaways' ||
    pathname.startsWith('/giveaways/')
  )
}

function shouldBypassSession(pathname: string): boolean {
  return (
    pathname === '/pre-register' ||
    pathname.startsWith('/about') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/auth/login') ||
    pathname.startsWith('/auth/sign-up') ||
    pathname.startsWith('/auth/forgot-password') ||
    pathname.startsWith('/api/checkout/create') ||
    pathname.startsWith('/api/checkout/confirm') ||
    pathname.startsWith('/api/admin/live-feed') ||
    // Public, read-only live endpoints (service-role, no auth). Bypass ONLY the
    // two exact shapes below, with campaignId occupying exactly one path
    // segment. Any other /api/giveaways/* route (admin, create, future
    // protected routes) still runs the normal session refresh.
    PUBLIC_LIVE_ROUTE.test(pathname)
  )
}

/**
 * Matches exactly:
 *   /api/giveaways/<single-segment-campaignId>/live-count
 *   /api/giveaways/<single-segment-campaignId>/live-board
 * (optional trailing slash). The campaignId segment may not contain a slash,
 * so nested paths like /api/giveaways/anything/other-action never match.
 */
const PUBLIC_LIVE_ROUTE = /^\/api\/giveaways\/[^/]+\/(?:live-count|live-board)\/?$/

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */
export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  /* ---- Bypass for Vercel cron and /api/jobs/* routes ---- */
  const userAgent = request.headers.get('user-agent') ?? ''
  if (pathname.startsWith('/api/jobs/') || userAgent.includes('vercel-cron')) {
    return NextResponse.next()
  }

  const maintenanceMode = process.env.MAINTENANCE_MODE === 'true'

  /* ---- Maintenance-mode gate ---- */
  if (maintenanceMode) {
    const bypassToken = process.env.MAINTENANCE_BYPASS_TOKEN ?? ''

    // Handle ?bypass=<token> — set cookie and strip the param
    const bypassParam = searchParams.get('bypass')
    if (bypassParam && bypassToken && bypassParam === bypassToken) {
      const cleanUrl = request.nextUrl.clone()
      cleanUrl.searchParams.delete('bypass')
      const res = NextResponse.redirect(cleanUrl)
      res.cookies.set('maintenance_bypass', bypassToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })
      return res
    }

    // Check bypass cookie
    const bypassCookie = request.cookies.get('maintenance_bypass')?.value
    const hasBypass = bypassToken && bypassCookie === bypassToken

    // If no bypass and path is not in the allow-list, redirect to /pre-register
    if (!hasBypass && !isMaintenanceAllowed(pathname)) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/pre-register'
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl, 307)
    }
  }

  /* ---- Redirect /legal/terms to /terms ---- */
  if (pathname === '/legal/terms') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/terms'
    return NextResponse.redirect(redirectUrl, 301)
  }

  /* ---- Redirect /legal/privacy to /privacy ---- */
  if (pathname === '/legal/privacy') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/privacy'
    return NextResponse.redirect(redirectUrl, 301)
  }

  /* ---- Existing behaviour (unchanged) ---- */

  // Intercept email confirmation codes landing on / and route to auth callback
  if (pathname === '/' && searchParams.has('code')) {
    const callbackUrl = new URL('/auth/callback', request.url)
    callbackUrl.search = request.nextUrl.search
    return NextResponse.redirect(callbackUrl)
  }

  // Hot public HTML routes: refresh-only session maintenance.
  // Anonymous visitors (no Supabase auth cookie) short-circuit here with ZERO
  // Auth network cost. Logged-in visitors get at most one refresh POST per
  // token lifecycle, persisted onto the response — and never a GET /user.
  if (isRefreshOnlyPublicRoute(pathname)) {
    const response = hasSupabaseAuthCookie(request)
      ? await refreshSessionOnly(request)
      : NextResponse.next()
    response.headers.set('x-next-pathname', pathname)
    return response
  }

  // Bypass expensive session refresh on hot public/API routes
  if (shouldBypassSession(pathname)) {
    const response = NextResponse.next()
    response.headers.set('x-next-pathname', pathname)
    return response
  }

  const response = await updateSession(request)
  response.headers.set('x-next-pathname', pathname)
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets: images, fonts, CSS, JS, icons, and text/xml
     *   (e.g. .svg .png .jpg .jpeg .gif .webp .ico .css .js .woff .woff2
     *   .ttf .otf .txt .xml .map) — these must never run auth middleware.
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf|txt|xml|map)$).*)',
  ],
}
