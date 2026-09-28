import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Supabase mock -----------------------------------------------------------
// createClient is a spy so we can assert it is NOT called before successful auth,
// and rpc is a spy so route tests never touch a live database / provider.
const rpc = vi.fn()
const createClient = vi.fn(() => ({ rpc }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

// Guard: fail loudly if the route ever imports the delivery worker, recipient
// materialisation, or a mail provider. These modules must NEVER be pulled in.
const runMarketingDeliveryBatch = vi.fn()
vi.mock('@/lib/marketing/delivery-worker', () => ({
  runMarketingDeliveryBatch: (...a: unknown[]) => runMarketingDeliveryBatch(...a),
}))

import { GET } from '../route'

const URL_STR = 'https://app.example/api/cron/marketing-discovery'

function makeRequest(headers: Record<string, string> = {}, search = ''): NextRequest {
  return new NextRequest(URL_STR + search, { method: 'GET', headers })
}

// The RPC's compact, identity-free stats (no email, user id, or provider data).
const SAFE_STATS = {
  ok: true,
  status: 'ok',
  evaluated: 3,
  eligible: 2,
  inserted: 0,
  skippedExisting: 2,
  skippedDisabledDefinition: 0,
  requestedLimit: 100,
  effectiveLimit: 0,
  rolloutLimit: 0,
  maximumBatchSize: 100,
  durationMs: 5,
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

describe('Marketing discovery cron route (GET /api/cron/marketing-discovery)', () => {
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

  it('service client is NOT constructed before successful auth', async () => {
    // Two unauthorized attempts, then confirm zero client construction.
    await GET(makeRequest())
    await GET(makeRequest({ authorization: 'Bearer nope' }))
    expect(createClient).not.toHaveBeenCalled()
  })

  it('valid Bearer secret invokes the discovery RPC exactly once', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(res.status).toBe(200)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('invokes exactly discover_marketing_opportunities with p_limit = 100', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('discover_marketing_opportunities', { p_limit: 100 })
  })

  it('query params cannot override p_limit (fixed at 100)', async () => {
    await GET(
      makeRequest(
        { authorization: 'Bearer top-secret' },
        '?p_limit=99999&limit=5&rollout=50&discovery_enabled=true',
      ),
    )
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('discover_marketing_opportunities', { p_limit: 100 })
  })

  it('never invokes the delivery worker', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    expect(runMarketingDeliveryBatch).not.toHaveBeenCalled()
  })

  it('never invokes recipient materialisation or any other RPC', async () => {
    await GET(makeRequest({ authorization: 'Bearer top-secret' }))
    const rpcNames = rpc.mock.calls.map((c) => c[0])
    expect(rpcNames).toEqual(['discover_marketing_opportunities'])
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
    expect(json).toEqual({ ok: false, error: 'discovery_failed' })
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

describe('vercel.json cron configuration', () => {
  const cfg = JSON.parse(
    readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { crons: Array<{ path: string; schedule: string }> }
  const byPath = new Map(cfg.crons.map((c) => [c.path, c.schedule]))

  it('contains the dedicated discovery cron at */10 * * * *', () => {
    expect(byPath.get('/api/cron/marketing-discovery')).toBe('*/10 * * * *')
  })

  it('there is exactly ONE discovery cron entry', () => {
    const discovery = cfg.crons.filter((c) => c.path === '/api/cron/marketing-discovery')
    expect(discovery).toHaveLength(1)
  })

  it('preserves all pre-existing cron entries exactly (unchanged cadence)', () => {
    expect(byPath.get('/api/jobs/run')).toBe('* * * * *')
    expect(byPath.get('/api/jobs/run-draws')).toBe('*/5 * * * *')
    expect(byPath.get('/api/jobs/refresh-reporting')).toBe('* * * * *')
    expect(byPath.get('/api/jobs/refresh-marketing-profiles')).toBe('*/5 * * * *')
  })

  it('leaves the marketing-delivery cron untouched', () => {
    expect(byPath.get('/api/cron/marketing-delivery')).toBe('*/10 * * * *')
  })
})
