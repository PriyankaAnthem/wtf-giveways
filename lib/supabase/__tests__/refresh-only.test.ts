import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * These tests assert NETWORK BEHAVIOUR, not return values.
 *
 * `@supabase/auth-js` resolves fetch lazily as `(...args) => fetch(...args)`
 * (lib/helpers.js:107-112), so stubbing `globalThis.fetch` captures every real
 * Auth HTTP call the SDK would make. We then count them by URL:
 *   - `POST /auth/v1/token?grant_type=refresh_token` → refresh
 *   - `GET  /auth/v1/user`                           → verified-user call
 */

const SUPABASE_URL = 'https://test-project.supabase.co'
const AUTH_COOKIE = 'sb-test-project-auth-token'

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

type Call = { url: string; method: string }
let calls: Call[] = []

/** Requests made to the refresh-token endpoint. */
const refreshCalls = () => calls.filter((c) => c.url.includes('/auth/v1/token'))
/** Requests made to the verified-user endpoint. */
const userCalls = () => calls.filter((c) => /\/auth\/v1\/user/.test(c.url))

function encodeSessionCookie(session: Record<string, unknown>): string {
  // @supabase/ssr 0.5.x default cookieEncoding is base64url with this prefix.
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
}

/** A session whose access token expires `secondsFromNow` from now. */
function makeSession(secondsFromNow: number, refreshToken = 'refresh-token-1') {
  return {
    access_token: 'access-token-1',
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: secondsFromNow,
    expires_at: Math.floor(Date.now() / 1000) + secondsFromNow,
    user: { id: 'user-123', aud: 'authenticated', created_at: '2024-01-01T00:00:00Z' },
  }
}

function requestFor(path: string, cookie?: string) {
  const req = new NextRequest(`https://wtf.test${path}`)
  if (cookie) req.cookies.set(AUTH_COOKIE, cookie)
  return req
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET' })
      if (url.includes('/auth/v1/token')) {
        return jsonResponse({ ...makeSession(3600, 'refresh-token-2') })
      }
      if (/\/auth\/v1\/user/.test(url)) {
        return jsonResponse({ id: 'user-123' })
      }
      return jsonResponse({})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/* ------------------------------------------------------------------ */
/*  1. Anonymous public request — zero Auth work                       */
/* ------------------------------------------------------------------ */
describe('anonymous public requests', () => {
  for (const path of ['/', '/winners', '/giveaways/spring-draw']) {
    it(`${path}: no auth cookie → zero Auth calls, no Set-Cookie`, async () => {
      const { middleware } = await import('@/middleware')
      const res = await middleware(requestFor(path))

      expect(refreshCalls()).toHaveLength(0)
      expect(userCalls()).toHaveLength(0)
      expect(calls).toHaveLength(0)
      expect(res.cookies.getAll()).toHaveLength(0)
      expect(res.headers.get('x-next-pathname')).toBe(path)
    })
  }
})

/* ------------------------------------------------------------------ */
/*  2. Fresh logged-in session — zero Auth work from middleware        */
/* ------------------------------------------------------------------ */
describe('fresh logged-in session', () => {
  it('/: token with >90s remaining → no refresh, no GET /user, no rotation', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(3600))
    const res = await middleware(requestFor('/', cookie))

    expect(refreshCalls()).toHaveLength(0)
    expect(userCalls()).toHaveLength(0)
    expect(calls).toHaveLength(0)
    // No cookie rotation: nothing written onto the response.
    expect(res.cookies.getAll()).toHaveLength(0)
  })

  it('/winners and /giveaways/[slug] behave identically', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(3600))

    await middleware(requestFor('/winners', cookie))
    await middleware(requestFor('/giveaways/spring-draw', cookie))

    expect(calls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/*  3. Near-expiry / expired session — exactly one refresh, persisted  */
/* ------------------------------------------------------------------ */
describe('expired session', () => {
  it('/: performs exactly one refresh POST and zero GET /user', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(-10))
    await middleware(requestFor('/', cookie))

    expect(refreshCalls()).toHaveLength(1)
    expect(refreshCalls()[0].method).toBe('POST')
    expect(userCalls()).toHaveLength(0)
  })

  it('/: writes the refreshed auth cookie onto the response', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(-10))
    const res = await middleware(requestFor('/', cookie))

    const authCookies = res.cookies
      .getAll()
      .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    expect(authCookies.length).toBeGreaterThan(0)
    // Rotated value, not the stale one we sent.
    expect(authCookies.map((c) => c.value).join('')).not.toBe(cookie)
  })

  it('a token inside the 90s expiry margin also refreshes', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(30))
    await middleware(requestFor('/', cookie))

    expect(refreshCalls()).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/*  4. Two sequential requests — KEY REGRESSION TEST                   */
/* ------------------------------------------------------------------ */
describe('two sequential requests (key regression)', () => {
  it('request 2, using the refreshed cookie, does not refresh again', async () => {
    const { middleware } = await import('@/middleware')

    // Request 1: stale cookie → refresh + persist.
    const res1 = await middleware(requestFor('/', encodeSessionCookie(makeSession(-10))))
    expect(refreshCalls()).toHaveLength(1)

    const rotated = res1.cookies
      .getAll()
      .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    expect(rotated.length).toBeGreaterThan(0)

    // Request 2: replay the cookie the browser would now hold.
    calls = []
    const req2 = new NextRequest('https://wtf.test/')
    for (const c of rotated) req2.cookies.set(c.name, c.value)
    await middleware(req2)

    expect(refreshCalls()).toHaveLength(0)
    expect(userCalls()).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/*  5. Invalid refresh token — cleared, no retry, no 500               */
/* ------------------------------------------------------------------ */
describe('invalid refresh token', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input)
        calls.push({ url, method: init?.method ?? 'GET' })
        if (url.includes('/auth/v1/token')) {
          return jsonResponse(
            { code: 'refresh_token_already_used', error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' },
            400,
          )
        }
        return jsonResponse({})
      }),
    )
  })

  it('expires the stale auth cookies, does not retry, does not 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { middleware } = await import('@/middleware')
    const res = await middleware(requestFor('/', encodeSessionCookie(makeSession(-10))))

    // Exactly one attempt — no retry loop.
    expect(refreshCalls()).toHaveLength(1)
    expect(res.status).toBeLessThan(500)

    const cleared = res.cookies
      .getAll()
      .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    expect(cleared.length).toBeGreaterThan(0)
    // Cleared: empty value and/or immediate expiry.
    for (const c of cleared) {
      expect(c.value === '' || c.maxAge === 0 || Number(c.maxAge) <= 0).toBe(true)
    }

    // Nothing sensitive logged.
    for (const spy of [errorSpy, warnSpy, logSpy]) {
      for (const call of spy.mock.calls) {
        const text = call.map(String).join(' ')
        expect(text).not.toMatch(/access-token|refresh-token|eyJ/)
      }
    }
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/*  6. 429 refresh response — no app retry, no 5xx, cookie not stuck   */
/* ------------------------------------------------------------------ */
describe('429 from Auth', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input)
        calls.push({ url, method: init?.method ?? 'GET' })
        if (url.includes('/auth/v1/token')) {
          return jsonResponse({ code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429)
        }
        return jsonResponse({})
      }),
    )
  })

  it('does not retry, does not 500, does not log secrets', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { middleware } = await import('@/middleware')
    const res = await middleware(requestFor('/', encodeSessionCookie(makeSession(-10))))

    // 429 is non-retryable in auth-js (lib/fetch.js only retries 500-599).
    expect(refreshCalls()).toHaveLength(1)
    expect(res.status).toBeLessThan(500)

    for (const call of errorSpy.mock.calls) {
      expect(call.map(String).join(' ')).not.toMatch(/access-token|refresh-token|eyJ/)
    }
    errorSpy.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/*  7-10. Regression: other route classes keep their existing paths     */
/* ------------------------------------------------------------------ */
describe('route classification regressions', () => {
  it('/me and /checkout/review still use the verified-user updateSession path', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(3600))

    await middleware(requestFor('/me', cookie))
    expect(userCalls()).toHaveLength(1)

    calls = []
    await middleware(requestFor('/checkout/review', cookie))
    expect(userCalls()).toHaveLength(1)
  })

  it('checkout payment API bypass is unchanged (zero middleware Auth work)', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(-10))

    await middleware(requestFor('/api/checkout/create', cookie))
    await middleware(requestFor('/api/checkout/confirm', cookie))

    expect(calls).toHaveLength(0)
  })

  it('live-count and live-board still perform zero Auth work', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(-10))

    await middleware(requestFor('/api/giveaways/abc/live-count', cookie))
    await middleware(requestFor('/api/giveaways/abc/live-board', cookie))

    expect(calls).toHaveLength(0)
  })

  it('admin routes still use the verified-user middleware path', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(3600))

    await middleware(requestFor('/admin', cookie))
    expect(userCalls()).toHaveLength(1)
  })

  it('pre-auth routes are not touched by the refresh-only path', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(-10))

    await middleware(requestFor('/auth/login', cookie))
    expect(calls).toHaveLength(0)
  })

  it('lookalike paths do NOT match the refresh-only routes', async () => {
    const { middleware } = await import('@/middleware')
    const cookie = encodeSessionCookie(makeSession(3600))

    // /giveaways-foo is not a refresh-only route; it falls through to
    // updateSession, which performs the verified-user call.
    await middleware(requestFor('/giveaways-foo', cookie))
    expect(userCalls()).toHaveLength(1)
  })
})
