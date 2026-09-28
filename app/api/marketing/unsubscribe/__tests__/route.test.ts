import { describe, it, expect, beforeEach, vi } from 'vitest'

// The route module transitively imports server-only modules; neutralise the
// guard so it can be imported under the node test environment.
vi.mock('server-only', () => ({}))

// Mock the token parser so we can drive a valid decrypted payload without a
// real secret, and the service so nothing touches a database.
const parseUnsubscribeToken = vi.fn()
const unsubscribeMarketingEmail = vi.fn()

vi.mock('@/lib/marketing/unsubscribe-token', () => ({
  parseUnsubscribeToken: (t: unknown) => parseUnsubscribeToken(t),
}))
vi.mock('@/lib/marketing/service', () => ({
  unsubscribeMarketingEmail: (a: unknown) => unsubscribeMarketingEmail(a),
}))

import { POST } from '../route'
import { MARKETING_CONSENT_SOURCE } from '@/lib/marketing/consent'

function makeRequest(token: unknown, ip: string) {
  return new Request('http://localhost/api/marketing/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ token }),
  })
}

beforeEach(() => {
  parseUnsubscribeToken.mockReset()
  unsubscribeMarketingEmail.mockReset()
})

describe('POST /api/marketing/unsubscribe — repeated calls', () => {
  it('returns the same 200 { ok: true } on repeat and invokes the idempotent fn each time', async () => {
    parseUnsubscribeToken.mockReturnValue({
      userId: 'user-1',
      emailLc: 'person@example.com',
      version: 1,
      issuedAt: new Date().toISOString(),
    })
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })

    // Unique IP so the fixed-window rate limiter (10/min) never interferes.
    const ip = '203.0.113.10'
    const first = await POST(makeRequest('valid-token', ip))
    const second = await POST(makeRequest('valid-token', ip))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ ok: true })
    await expect(second.json()).resolves.toEqual({ ok: true })

    expect(unsubscribeMarketingEmail).toHaveBeenCalledTimes(2)
    for (const call of unsubscribeMarketingEmail.mock.calls) {
      expect(call[0]).toEqual({
        userId: 'user-1',
        emailLc: 'person@example.com',
        source: MARKETING_CONSENT_SOURCE.unsubscribeLink,
      })
    }
  })

  it('rejects an invalid/tampered token with 400 and never calls the service', async () => {
    parseUnsubscribeToken.mockReturnValue(null)

    const res = await POST(makeRequest('garbage', '203.0.113.20'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_token' })
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('rate-limits a burst from one IP with 429 after the window budget', async () => {
    parseUnsubscribeToken.mockReturnValue({
      userId: 'user-9',
      emailLc: 'burst@example.com',
      version: 1,
      issuedAt: new Date().toISOString(),
    })
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })

    const ip = '203.0.113.30'
    const statuses: number[] = []
    // Limit is 10 per 60s window; the 11th from the same IP must be blocked.
    for (let i = 0; i < 11; i++) {
      const res = await POST(makeRequest('valid-token', ip))
      statuses.push(res.status)
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })
})
