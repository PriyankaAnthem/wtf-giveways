import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'

// Neutralise the server-only guard for the node test environment.
vi.mock('server-only', () => ({}))

// Mock token parser + service so nothing touches crypto or a database.
const parseUnsubscribeToken = vi.fn()
const unsubscribeMarketingEmail = vi.fn()

vi.mock('@/lib/marketing/unsubscribe-token', () => ({
  parseUnsubscribeToken: (t: unknown) => parseUnsubscribeToken(t),
}))
vi.mock('@/lib/marketing/service', () => ({
  unsubscribeMarketingEmail: (a: unknown) => unsubscribeMarketingEmail(a),
}))

// Mock the rate limiter so we can capture the EXACT key + options each mode uses.
type RateLimitCall = { key: string; opts: { limit: number; windowMs: number } }
const rateLimitCalls: RateLimitCall[] = []
let rateLimitAllowed = true

vi.mock('@/lib/marketing/rate-limit', () => ({
  getClientIp: (_req: Request) => '203.0.113.7',
  rateLimit: (key: string, opts: { limit: number; windowMs: number }) => {
    rateLimitCalls.push({ key, opts })
    return rateLimitAllowed
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: 42 }
  },
}))

import { POST } from '../route'

const VALID_PAYLOAD = {
  userId: 'user-1',
  emailLc: 'person@example.com',
  version: 1,
  issuedAt: new Date().toISOString(),
}

function jsonReq(token: unknown) {
  return new Request('http://localhost/api/marketing/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

function formReq(queryToken: string, body = 'List-Unsubscribe=One-Click') {
  return new Request(
    `http://localhost/api/marketing/unsubscribe?token=${encodeURIComponent(queryToken)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
}

beforeEach(() => {
  parseUnsubscribeToken.mockReset()
  unsubscribeMarketingEmail.mockReset()
  rateLimitCalls.length = 0
  rateLimitAllowed = true
  parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
  unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
})

describe('029.5A — per-mode rate-limit safety', () => {
  it('A1. JSON (Mode A) uses the EXACT existing IP key + 10/min window', async () => {
    await POST(jsonReq('body-token'))
    expect(rateLimitCalls).toHaveLength(1)
    expect(rateLimitCalls[0].key).toBe('unsub:203.0.113.7')
    expect(rateLimitCalls[0].opts).toEqual({ limit: 10, windowMs: 60_000 })
  })

  it('A2. JSON rate-limit key is IP-based (never token-derived)', async () => {
    await POST(jsonReq('body-token'))
    expect(rateLimitCalls[0].key.startsWith('unsub:')).toBe(true)
    expect(rateLimitCalls[0].key).not.toContain('one-click')
    expect(rateLimitCalls[0].key).not.toContain('body-token')
  })

  it('A3. JSON over-limit returns 429 with Retry-After and no mutation', async () => {
    rateLimitAllowed = false
    const res = await POST(jsonReq('body-token'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'rate_limited' })
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('B1. one-click (Mode B) uses a SHA-256 token-derived key + 5 / 5-min window', async () => {
    const rawToken = 'opaque-token-abc123'
    await POST(formReq(rawToken))
    const expectedDigest = createHash('sha256').update(rawToken).digest('hex')
    expect(rateLimitCalls).toHaveLength(1)
    expect(rateLimitCalls[0].key).toBe(`unsub-one-click:${expectedDigest}`)
    expect(rateLimitCalls[0].opts).toEqual({ limit: 5, windowMs: 5 * 60_000 })
  })

  it('B2. one-click rate-limit key NEVER contains the raw token', async () => {
    const rawToken = 'super-secret-raw-token'
    await POST(formReq(rawToken))
    expect(rateLimitCalls[0].key).not.toContain(rawToken)
  })

  it('B3. one-click rate-limit key NEVER contains user id or email', async () => {
    await POST(formReq('opaque-token'))
    expect(rateLimitCalls[0].key).not.toContain(VALID_PAYLOAD.userId)
    expect(rateLimitCalls[0].key).not.toContain(VALID_PAYLOAD.emailLc)
  })

  it('B4. one-click key is deterministic for the same token, distinct across tokens', async () => {
    await POST(formReq('token-A'))
    await POST(formReq('token-A'))
    await POST(formReq('token-B'))
    expect(rateLimitCalls[0].key).toBe(rateLimitCalls[1].key)
    expect(rateLimitCalls[0].key).not.toBe(rateLimitCalls[2].key)
  })

  it('B5. one-click does NOT consult getClientIp for its key (IP-independent)', async () => {
    await POST(formReq('opaque-token'))
    expect(rateLimitCalls[0].key).not.toContain('203.0.113.7')
  })

  it('B6. one-click over-limit returns 429 with Retry-After and no mutation', async () => {
    rateLimitAllowed = false
    const res = await POST(formReq('opaque-token'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'rate_limited' })
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('B7. one-click rate limit runs only AFTER request validation (bad request never rate-limits)', async () => {
    // Wrong List-Unsubscribe value: rejected before any rate-limit call.
    const res = await POST(formReq('opaque-token', 'List-Unsubscribe=Nope'))
    expect(res.status).toBe(400)
    expect(rateLimitCalls).toHaveLength(0)
  })

  it('B8. missing query token never reaches the rate limiter', async () => {
    const req = new Request('http://localhost/api/marketing/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(rateLimitCalls).toHaveLength(0)
  })
})
