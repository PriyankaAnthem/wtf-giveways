import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Supabase mock -----------------------------------------------------------
const rpc = vi.fn()
const createClient = vi.fn(() => ({ rpc }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

// Guard: the readiness route must NEVER pull in the delivery worker.
const runMarketingDeliveryBatch = vi.fn()
vi.mock('@/lib/marketing/delivery-worker', () => ({
  runMarketingDeliveryBatch: (...a: unknown[]) => runMarketingDeliveryBatch(...a),
}))

import { GET } from '../route'

const URL_STR = 'https://app.example/api/cron/marketing-readiness'

function makeRequest(headers: Record<string, string> = {}, search = ''): NextRequest {
  return new NextRequest(URL_STR + search, { method: 'GET', headers })
}

const SAFE_STATS = {
  status: 'ok',
  runsConsidered: 2,
  runsMarkedReady: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'top-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  rpc.mockResolvedValue({ data: SAFE_STATS, error: null })
})

afterEach(() => {
  process.env.CRON_SECRET = 'top-secret'
})

describe('Marketing readiness cron route (GET /api/cron/marketing-readiness)', () => {
  it('503 when CRON_SECRET is missing; RPC + client NOT touched', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest({ authorization: 'Bearer whatever' }))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'cron_not_configured' })
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('503 when CRON_SECRET is blank; RPC + client NOT touched', async () => {
    process.env.CRON_SECRET = ''
    const res = await GET(makeRequest({ authorization: 'Bearer ' }))
    expect(res.status).toBe(503)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('401 when Authorization header is missing; RPC + client NOT touched', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('401 when Authorization is wrong; RPC + client NOT touched', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('401 when secret is passed as a query param instead of Bearer; RPC NOT called', async () => {
    const res = await GET(makeRequest({}, '?token=top-secret'))
    expect(res.status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('valid Bearer secret invokes the readiness RPC exactly once', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(200)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('invokes exactly queue_prepared_marketing_runs with p_limit = 100', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(rpc).toHaveBeenCalledWith('queue_prepared_marketing_runs', { p_limit: 100 })
  })

  it('query params cannot override p_limit (fixed at 100)', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }, '?p_limit=99999&limit=5'))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('queue_prepared_marketing_runs', { p_limit: 100 })
  })

  it('never invokes the delivery worker', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('never invokes delivery, preparation, materialisation, or any other RPC', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    const rpcNames = rpc.mock.calls.map((c) => c[0])
    expect(rpcNames).toEqual(['queue_prepared_marketing_runs'])
    expect(rpcNames).not.toContain('claim_marketing_delivery_batch')
    expect(rpcNames).not.toContain('prepare_marketing_recipient_content')
    expect(rpcNames).not.toContain('materialize_marketing_recipients')
  })

  it('returns only the safe identity-free RPC stats', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, ...SAFE_STATS })
    const body = JSON.stringify(json)
    expect(body).not.toContain('@')
    expect(body).not.toContain('top-secret')
  })

  it('fails closed with a stable code on RPC error (no raw message leaked)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for schema secret' } })
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual({ ok: false, error: 'readiness_failed' })
    expect(JSON.stringify(json)).not.toContain('permission denied')
  })

  it('response is no-store and never echoes the CRON_SECRET', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(JSON.stringify(await res.json())).not.toContain('top-secret')
  })

  it('POST is not exported (GET-only cron route)', async () => {
    const mod = await import('../route')
    expect((mod as Record<string, unknown>).POST).toBeUndefined()
  })
})

describe('vercel.json readiness cron configuration', () => {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    crons: Array<{ path: string; schedule: string }>
  }
  const byPath = new Map(cfg.crons.map((c) => [c.path, c.schedule]))

  it('contains exactly one readiness cron, staggered after preparation', () => {
    const ready = cfg.crons.filter((c) => c.path === '/api/cron/marketing-readiness')
    expect(ready).toHaveLength(1)
    expect(byPath.get('/api/cron/marketing-readiness')).toBe('4-59/10 * * * *')
  })

  it('readiness (4-59/10) runs after preparation (2-59/10) within each window', () => {
    expect(byPath.get('/api/cron/marketing-preparation')).toBe('2-59/10 * * * *')
    expect(byPath.get('/api/cron/marketing-readiness')).toBe('4-59/10 * * * *')
  })

  it('leaves every pre-existing cron entry untouched', () => {
    expect(byPath.get('/api/cron/marketing-delivery')).toBe('*/10 * * * *')
    expect(byPath.get('/api/cron/marketing-discovery')).toBe('*/10 * * * *')
    expect(byPath.get('/api/cron/marketing-materialisation')).toBe('*/10 * * * *')
    expect(byPath.get('/api/jobs/run')).toBe('* * * * *')
    expect(byPath.get('/api/jobs/run-draws')).toBe('*/5 * * * *')
    expect(byPath.get('/api/jobs/refresh-reporting')).toBe('* * * * *')
    expect(byPath.get('/api/jobs/refresh-marketing-profiles')).toBe('*/5 * * * *')
  })
})
