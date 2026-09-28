import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the worker so route tests never touch Supabase / Resend / the real worker.
const runMarketingDeliveryBatch = vi.fn()
vi.mock('@/lib/marketing/delivery-worker', () => ({
  runMarketingDeliveryBatch: (...args: unknown[]) => runMarketingDeliveryBatch(...args),
}))

import { GET } from '../route'

const URL_STR = 'https://app.example/api/cron/marketing-delivery'

function makeRequest(headers: Record<string, string> = {}, search = ''): NextRequest {
  return new NextRequest(URL_STR + search, { method: 'GET', headers })
}

// The worker's already-safe aggregate summary — contains NO identity/financial
// fields (no email, recipient id, token, or provider payload).
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

describe('Marketing delivery cron route (GET /api/cron/marketing-delivery)', () => {
  it('503 when CRON_SECRET is missing/blank; worker NOT called', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest({ authorization: 'Bearer whatever' }))
    expect(res.status).toBe(503)
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('503 when CRON_SECRET is an empty string; worker NOT called', async () => {
    process.env.CRON_SECRET = ''
    const res = await GET(makeRequest({ authorization: 'Bearer ' }))
    expect(res.status).toBe(503)
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('401 when Authorization header is missing; worker NOT called', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('401 when Authorization is wrong; worker NOT called', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('401 when secret is passed as a query param instead of Bearer; worker NOT called', async () => {
    const res = await GET(makeRequest({}, '?token=top-secret'))
    expect(res.status).toBe(401)
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('correct Bearer secret invokes the worker exactly once', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(200)
    expect(runMarketingDeliveryBatch).toHaveBeenCalledTimes(1)
  })

  it('returns the worker safe aggregate summary', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, ...SAFE_SUMMARY })
  })

  it('passes NO arguments to the worker (query params cannot override behaviour)', async () => {
    await GET(
      makeRequest(
        { authorization: 'Bearer top-secret' },
        '?recipientId=x&batchSize=999&sending=true&rollout=50&automationId=abc',
      ),
    )
    expect(runMarketingDeliveryBatch).toHaveBeenCalledTimes(1)
    expect(runMarketingDeliveryBatch.mock.calls[0]).toHaveLength(0)
  })

  it('disabled worker => 200 with the safe blocked summary (kill switch honoured)', async () => {
    runMarketingDeliveryBatch.mockResolvedValue({
      ...SAFE_SUMMARY,
      status: 'blocked',
      reason: 'worker_disabled',
    })
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('blocked')
    expect(json.reason).toBe('worker_disabled')
  })

  it('response is no-store and never echoes the CRON_SECRET', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('top-secret')
  })

  it('unauthorized responses never echo the CRON_SECRET', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong' }))
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('top-secret')
  })

  it('POST is not exported (GET-only cron route)', async () => {
    const mod = await import('../route')
    expect((mod as Record<string, unknown>).POST).toBeUndefined()
  })
})
