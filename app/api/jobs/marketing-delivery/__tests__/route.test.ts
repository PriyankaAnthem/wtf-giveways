import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the worker so route tests never touch Supabase/Resend.
const runMarketingDeliveryBatch = vi.fn()
vi.mock('@/lib/marketing/delivery-worker', () => ({
  runMarketingDeliveryBatch: (...args: unknown[]) => runMarketingDeliveryBatch(...args),
}))

import { POST } from '../route'

const URL_STR = 'https://app.example/api/jobs/marketing-delivery'

function makeRequest(headers: Record<string, string> = {}, body?: unknown): NextRequest {
  return new NextRequest(URL_STR, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const SAFE_SUMMARY = {
  status: 'no_work',
  recoveredClaims: 0,
  claimStatus: 'ok',
  claimed: 0,
  malformedClaims: 0,
  preProviderRejected: 0,
  authorized: 0,
  authorizationRejected: 0,
  providerSucceeded: 0,
  providerFailed: 0,
  successFinalized: 0,
  failureFinalized: 0,
  providerSucceededFinalizeFailed: 0,
  providerFailedFinalizeFailed: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'top-secret'
  runMarketingDeliveryBatch.mockResolvedValue(SAFE_SUMMARY)
})

afterEach(() => {
  process.env.CRON_SECRET = 'top-secret'
})

describe('Stage 030 — marketing-delivery job route', () => {
  it('503 when CRON_SECRET is not configured; worker not called', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ authorization: 'Bearer whatever' }))
    expect(res.status).toBe(503)
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('8. no auth header => 401', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('9. invalid secret => 401', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('10. unauthorized request does not invoke the worker', async () => {
    await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('11. valid auth invokes the worker exactly once', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(200)
    expect(runMarketingDeliveryBatch).toHaveBeenCalledTimes(1)
  })

  it('12. valid auth + disabled worker => 200 with safe blocked summary', async () => {
    runMarketingDeliveryBatch.mockResolvedValue({ ...SAFE_SUMMARY, status: 'blocked', reason: 'worker_disabled' })
    const res = await POST(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('blocked')
    expect(json.reason).toBe('worker_disabled')
  })

  it('13. route passes NO overrides to the worker (called with zero args)', async () => {
    await POST(
      makeRequest(
        { authorization: 'Bearer top-secret', 'content-type': 'application/json' },
        { recipientId: 'x', batchSize: 999, sending: true, rollout: 50 },
      ),
    )
    expect(runMarketingDeliveryBatch).toHaveBeenCalledTimes(1)
    expect(runMarketingDeliveryBatch.mock.calls[0]).toHaveLength(0)
  })

  it('response is marked no-store and never echoes the secret', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(JSON.stringify(await res.json())).not.toContain('top-secret')
  })

  it('GET is not exported (POST-only route)', async () => {
    const mod = await import('../route')
    expect((mod as Record<string, unknown>).GET).toBeUndefined()
  })
})
