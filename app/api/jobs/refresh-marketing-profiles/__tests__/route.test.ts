import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the Supabase client factory so we can (a) assert it is only constructed
// after authentication and (b) drive RPC results without a database.
const rpc = vi.fn()
const createClient = vi.fn((..._args: unknown[]) => ({ rpc }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

import { GET, POST } from '../route'

const SECRET = 'test-cron-secret'

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
  rpc.mockResolvedValue({
    data: {
      ok: true,
      mode: 'incremental',
      skippedBecauseLocked: false,
      processedUsers: 3,
      backfillComplete: true,
      lastSuccessAt: '2026-01-01T00:00:00.000Z',
      durationMs: 5,
    },
    error: null,
  })
  process.env.CRON_SECRET = SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
})

function req(init?: { auth?: string; token?: string; batch?: string }) {
  const url = new URL('http://localhost/api/jobs/refresh-marketing-profiles')
  if (init?.token) url.searchParams.set('token', init.token)
  if (init?.batch) url.searchParams.set('batch_size', init.batch)
  const headers = new Headers()
  if (init?.auth) headers.set('authorization', init.auth)
  return new NextRequest(url, { headers })
}

describe('refresh-marketing-profiles cron auth', () => {
  it('rejects a missing secret with 401 and never builds a client or calls the RPC', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret with 401', async () => {
    const res = await GET(req({ auth: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects the spoofable x-vercel-cron header alone (no secret => 401)', async () => {
    const url = new URL('http://localhost/api/jobs/refresh-marketing-profiles')
    const headers = new Headers({ 'x-vercel-cron': '1' })
    const res = await GET(new NextRequest(url, { headers }))
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts a correct Bearer secret and calls the RPC exactly once', async () => {
    const res = await GET(req({ auth: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('refresh_customer_marketing_profiles')
  })

  it('accepts a correct ?token= secret (manual trigger)', async () => {
    const res = await POST(req({ token: SECRET }))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req({ auth: 'Bearer anything' }))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'cron_not_configured' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('refresh-marketing-profiles response contract', () => {
  it('passes through the advisory-lock skip response', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        mode: 'skipped',
        skippedBecauseLocked: true,
        processedUsers: 0,
        backfillComplete: null,
        lastSuccessAt: null,
      },
      error: null,
    })
    const res = await GET(req({ auth: `Bearer ${SECRET}` }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.skippedBecauseLocked).toBe(true)
    expect(body.processedUsers).toBe(0)
  })

  it('returns a stable public error code (not the raw SQL message) on RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "secret" does not exist' } })
    const res = await GET(req({ auth: `Bearer ${SECRET}` }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'refresh_failed' })
    expect(JSON.stringify(body)).not.toContain('relation')
  })

  it('never leaks identity fields — response has only whitelisted keys', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        mode: 'incremental',
        skippedBecauseLocked: false,
        processedUsers: 2,
        backfillComplete: true,
        lastSuccessAt: '2026-01-01T00:00:00.000Z',
        // Hostile extras that must NOT be forwarded:
        email: 'person@example.com',
        userId: 'user-123',
        userIds: ['a', 'b'],
      },
      error: null,
    })
    const res = await GET(req({ auth: `Bearer ${SECRET}` }))
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['backfillComplete', 'durationMs', 'lastSuccessAt', 'mode', 'ok', 'processedUsers', 'skippedBecauseLocked'].sort(),
    )
    expect(body.email).toBeUndefined()
    expect(body.userId).toBeUndefined()
    expect(body.userIds).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('person@example.com')
    expect(JSON.stringify(body)).not.toContain('user-123')
  })

  it('forwards a manual batch_size override (floored) to the RPC', async () => {
    await GET(req({ auth: `Bearer ${SECRET}`, batch: '750.9' }))
    expect(rpc.mock.calls[0][1]).toEqual({ p_backfill_batch_size: 750 })
  })

  it('omits the batch arg when none is provided (RPC default applies)', async () => {
    await GET(req({ auth: `Bearer ${SECRET}` }))
    expect(rpc.mock.calls[0][1]).toEqual({})
  })
})
