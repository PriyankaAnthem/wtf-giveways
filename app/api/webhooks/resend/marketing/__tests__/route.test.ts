import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Webhook } from 'svix'

/**
 * Stage 031B — strict Resend marketing webhook route tests.
 *
 * NO real Resend, NO live Supabase, NO SQL, NO webhook registration. The
 * service-role RPC is mocked; signature mechanics use the real svix library
 * with a TEST-ONLY secret and locally generated signed payloads.
 */

// --- Mock the service-role client (never touch live Supabase) ---------------
const rpcMock = vi.fn()
const getClientMock = vi.fn(() => ({ rpc: rpcMock }))
vi.mock('@/lib/marketing/service', () => ({
  getMarketingServiceClient: () => getClientMock(),
}))

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

// A valid svix secret must be base64 and is conventionally prefixed `whsec_`.
const TEST_SECRET = 'whsec_' + Buffer.from('stage-031b-test-only-secret-key!!').toString('base64')

let route: typeof import('../route')

async function loadRoute() {
  vi.resetModules()
  route = await import('../route')
}

/** Sign a raw JSON string with the real svix library, returning headers. */
function sign(rawBody: string, secret = TEST_SECRET, id = 'msg_stage031b_0001') {
  const wh = new Webhook(secret)
  const timestamp = new Date()
  const signature = wh.sign(id, timestamp, rawBody)
  return {
    'svix-id': id,
    'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'svix-signature': signature,
  }
}

function makeRequest(rawBody: string, headers: Record<string, string>) {
  return new Request('https://wtf.test/api/webhooks/resend/marketing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  })
}

function marketingEvent(type: string, extraData: Record<string, unknown> = {}) {
  return JSON.stringify({
    type,
    created_at: '2026-08-17T10:00:00.000Z',
    data: {
      email_id: 'resend-email-id-abc123',
      tags: { email_type: 'marketing', opportunity: 'welcome' },
      ...extraData,
    },
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET
  // Default: RPC succeeds.
  rpcMock.mockResolvedValue({
    data: { status: 'processed', processed: true, duplicate: false, eventType: 'email.delivered', suppressionAdded: false },
    error: null,
  })
  await loadRoute()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// SECRET / HEADERS
// ===========================================================================
describe('secret / headers', () => {
  it('1. missing RESEND_WEBHOOK_SECRET => 503', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    await loadRoute()
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(503)
  })

  it('2. missing secret => no Supabase client', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    await loadRoute()
    const body = marketingEvent('email.delivered')
    await route.POST(makeRequest(body, sign(body)))
    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('3. missing svix-id => 400', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    delete (h as Record<string, string>)['svix-id']
    const res = await route.POST(makeRequest(body, h))
    expect(res.status).toBe(400)
  })

  it('4. missing svix-timestamp => 400', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    delete (h as Record<string, string>)['svix-timestamp']
    const res = await route.POST(makeRequest(body, h))
    expect(res.status).toBe(400)
  })

  it('5. missing svix-signature => 400', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    delete (h as Record<string, string>)['svix-signature']
    const res = await route.POST(makeRequest(body, h))
    expect(res.status).toBe(400)
  })

  it('6. missing signature header => no Supabase', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    delete (h as Record<string, string>)['svix-signature']
    await route.POST(makeRequest(body, h))
    expect(getClientMock).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// SIGNATURE
// ===========================================================================
describe('signature', () => {
  it('7. invalid signature => 400', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    h['svix-signature'] = 'v1,invalidsignaturevalue'
    const res = await route.POST(makeRequest(body, h))
    expect(res.status).toBe(400)
  })

  it('8. invalid signature => no Supabase', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    h['svix-signature'] = 'v1,invalidsignaturevalue'
    await route.POST(makeRequest(body, h))
    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('9. valid signature permits processing', async () => {
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('10. tampered body (raw body used for verification) => 400', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    // Body signed above, but we send a DIFFERENT body with the same headers.
    const tampered = marketingEvent('email.delivered', { email_id: 'tampered-id' })
    const res = await route.POST(makeRequest(tampered, h))
    expect(res.status).toBe(400)
    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('11. payload is not JSON-parsed before verification (bad signature never reaches RPC)', async () => {
    const body = marketingEvent('email.delivered')
    const h = sign(body)
    h['svix-signature'] = 'v1,nope'
    await route.POST(makeRequest(body, h))
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// MARKETING ISOLATION
// ===========================================================================
describe('marketing isolation', () => {
  it('12. valid signed non-marketing event => 200 ignored', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'txn-id', tags: { email_type: 'transactional' } },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'ignored_non_marketing' })
  })

  it('13. non-marketing event => no Supabase client', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'txn-id' }, // transactional: no tags at all
    })
    await route.POST(makeRequest(body, sign(body)))
    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('14. missing tags => ignored non-marketing', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'no-tags' },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect((await res.json()).status).toBe('ignored_non_marketing')
  })

  it('15. malformed tags => ignored non-marketing', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'bad-tags', tags: 'email_type=marketing' },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect((await res.json()).status).toBe('ignored_non_marketing')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('16. explicit email_type=marketing required (array form also accepted)', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'arr', tags: [{ name: 'email_type', value: 'marketing' }] },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('processed')
  })

  it('17. existing transactional email code untouched (no tags => ignored)', async () => {
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'txn-bounce' },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect((await res.json()).status).toBe('ignored_non_marketing')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// EVENT FILTER
// ===========================================================================
describe('event filter', () => {
  for (const t of ['email.delivered', 'email.clicked', 'email.bounced', 'email.complained']) {
    it(`accepts marketing ${t}`, async () => {
      const body = marketingEvent(t)
      const res = await route.POST(makeRequest(body, sign(body)))
      expect(res.status).toBe(200)
      expect(rpcMock).toHaveBeenCalledTimes(1)
      expect(rpcMock.mock.calls[0][1].p_event_type).toBe(t)
    })
  }

  for (const t of [
    'email.opened',
    'email.sent',
    'email.failed',
    'email.delivery_delayed',
    'email.suppressed',
    'email.scheduled',
  ]) {
    it(`ignores marketing ${t} => 200, no RPC`, async () => {
      const body = marketingEvent(t)
      const res = await route.POST(makeRequest(body, sign(body)))
      expect(res.status).toBe(200)
      expect((await res.json()).status).toBe('ignored_event_type')
      expect(rpcMock).not.toHaveBeenCalled()
    })
  }
})

// ===========================================================================
// VALIDATION
// ===========================================================================
describe('validation', () => {
  it('26. missing top-level type => ignored_event_type (signed marketing)', async () => {
    const body = JSON.stringify({
      created_at: '2026-08-17T10:00:00.000Z',
      data: { email_id: 'x', tags: { email_type: 'marketing' } },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ignored_event_type')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('27. malformed created_at => 400', async () => {
    const body = marketingEvent('email.delivered', {})
    const parsed = JSON.parse(body)
    parsed.created_at = 'not-a-date'
    const raw = JSON.stringify(parsed)
    const res = await route.POST(makeRequest(raw, sign(raw)))
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('28. missing data => 400', async () => {
    const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-08-17T10:00:00.000Z' })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(400)
  })

  it('29. missing data.email_id => 400', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      data: { tags: { email_type: 'marketing' } },
    })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('30. empty email_id => 400', async () => {
    const body = marketingEvent('email.delivered', { email_id: '' })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(400)
  })

  it('31. oversized email_id => 400', async () => {
    const body = marketingEvent('email.delivered', { email_id: 'a'.repeat(501) })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(400)
  })

  it('32. CR/LF email_id => 400', async () => {
    const body = marketingEvent('email.delivered', { email_id: 'abc\r\ndef' })
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(400)
  })

  it('33. valid created_at passed unchanged to RPC', async () => {
    const body = marketingEvent('email.delivered')
    await route.POST(makeRequest(body, sign(body)))
    expect(rpcMock.mock.calls[0][1].p_event_created_at).toBe('2026-08-17T10:00:00.000Z')
  })

  it('34. exact svix-id passed to RPC (header, not payload)', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-17T10:00:00.000Z',
      // A DIFFERENT id in the payload must be ignored.
      id: 'payload-event-id-should-be-ignored',
      data: { email_id: 'e1', tags: { email_type: 'marketing' } },
    })
    const h = sign(body, TEST_SECRET, 'msg_header_authoritative')
    await route.POST(makeRequest(body, h))
    expect(rpcMock.mock.calls[0][1].p_event_id).toBe('msg_header_authoritative')
  })

  it('35. exact data.email_id passed to RPC', async () => {
    const body = marketingEvent('email.delivered', { email_id: 'exact-provider-id-999' })
    await route.POST(makeRequest(body, sign(body)))
    expect(rpcMock.mock.calls[0][1].p_provider_email_id).toBe('exact-provider-id-999')
  })
})

// ===========================================================================
// PRIVACY
// ===========================================================================
describe('privacy', () => {
  it('36-41. no PII fields passed to RPC', async () => {
    const body = marketingEvent('email.clicked', {
      email_id: 'privacy-id',
      to: 'victim@example.com',
      subject: 'Secret subject',
      click: { link: 'https://tracker.example/x', ipAddress: '1.2.3.4', userAgent: 'Mozilla/5.0' },
      bounce: { message: 'diagnostic bounce text' },
      message_id: 'mid-123',
      broadcast_id: 'bid-456',
    })
    await route.POST(makeRequest(body, sign(body)))
    const params = rpcMock.mock.calls[0][1]
    expect(Object.keys(params).sort()).toEqual(
      ['p_event_created_at', 'p_event_id', 'p_event_type', 'p_provider_email_id'].sort(),
    )
    const serialised = JSON.stringify(params)
    expect(serialised).not.toContain('victim@example.com')
    expect(serialised).not.toContain('Secret subject')
    expect(serialised).not.toContain('tracker.example')
    expect(serialised).not.toContain('1.2.3.4')
    expect(serialised).not.toContain('Mozilla')
    expect(serialised).not.toContain('diagnostic bounce text')
    expect(serialised).not.toContain('mid-123')
    expect(serialised).not.toContain('bid-456')
  })

  it('42-46. logs never contain raw body, signature, secret, or svix-id; response has no PII', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // Force an RPC error to exercise the logging path.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom', details: 'secret-detail' } })
    const body = marketingEvent('email.delivered', { to: 'pii@example.com' })
    const h = sign(body, TEST_SECRET, 'msg_secretid_9')
    const res = await route.POST(makeRequest(body, h))
    const allLogs = [...errSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ')
    expect(allLogs).not.toContain(body)
    expect(allLogs).not.toContain(h['svix-signature'])
    expect(allLogs).not.toContain(TEST_SECRET)
    expect(allLogs).not.toContain('msg_secretid_9')
    expect(allLogs).not.toContain('secret-detail')
    const payload = JSON.stringify(await res.json())
    expect(payload).not.toContain('pii@example.com')
    expect(payload).not.toContain('boom')
    errSpy.mockRestore()
    logSpy.mockRestore()
  })
})

// ===========================================================================
// RPC RESPONSE MAPPING
// ===========================================================================
describe('rpc response mapping', () => {
  it('47. only record_marketing_resend_event RPC used', async () => {
    const body = marketingEvent('email.delivered')
    await route.POST(makeRequest(body, sign(body)))
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0][0]).toBe('record_marketing_resend_event')
  })

  it('48. processed => HTTP 200', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'processed', processed: true }, error: null })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'processed' })
  })

  it('49. duplicate => HTTP 200', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'duplicate', processed: true, duplicate: true }, error: null })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'duplicate' })
  })

  it('50. recipient_not_found retryable => HTTP 503 retry_later', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'recipient_not_found', processed: false, retryable: true }, error: null })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, status: 'retry_later' })
  })

  it('51. recipient_ambiguous retryable => HTTP 503', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'recipient_ambiguous', processed: false, retryable: true }, error: null })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe('retry_later')
  })

  it('52. recipient_state_invalid retryable => HTTP 503', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'recipient_state_invalid', processed: false, retryable: true }, error: null })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe('retry_later')
  })

  it('53. Supabase RPC error => HTTP 503', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe('processing_failed')
  })

  it('54. unexpected RPC response => HTTP 503', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'invalid_event_id', processed: false }, error: null })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe('processing_failed')
  })

  it('55. raw Supabase error not returned in body', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'super-secret-db-internal' } })
    const body = marketingEvent('email.delivered')
    const res = await route.POST(makeRequest(body, sign(body)))
    expect(JSON.stringify(await res.json())).not.toContain('super-secret-db-internal')
  })
})

// ===========================================================================
// ISOLATION (static source assertions)
// ===========================================================================
describe('isolation', () => {
  const ROUTE_REL = 'app/api/webhooks/resend/marketing/route.ts'
  const routeSrc = () => readFileSync(join(REPO_ROOT, ROUTE_REL), 'utf8')

  it('56. no direct marketing table write in route', () => {
    const src = routeSrc()
    expect(/insert|update|delete|from\(['"]marketing/i.test(src)).toBe(false)
    for (const t of [
      'marketing_recipients',
      'marketing_suppressions',
      'marketing_provider_webhook_events',
      'marketing_preferences',
      'customer_marketing_profiles',
    ]) {
      expect(src).not.toContain(t)
    }
  })

  it('57-62. no checkout/payment/ticket/wallet/instant-win/auth code IMPORTED or called', () => {
    // Only import/require statements can create real coupling — prose comments
    // (e.g. "authenticated") must not trip this. Assert no import pulls any of
    // these domains, and no obvious module path to them is referenced.
    const src = routeSrc()
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l))
    const importBlob = importLines.join('\n').toLowerCase()
    for (const domain of [
      'checkout',
      'payment',
      'ticket',
      'wallet',
      'instant-win',
      'instant_win',
      'stripe',
      'sumup',
      'acquired',
      '/auth',
      'auth/',
    ]) {
      expect(importBlob).not.toContain(domain)
    }
    // The route's only non-Next imports are svix + the marketing service.
    expect(importBlob).toContain('svix')
    expect(importBlob).toContain('@/lib/marketing/service')
  })

  it('63-66. Stage 029 provider / Stage 030 worker / unsubscribe not referenced', () => {
    const src = routeSrc()
    expect(src).not.toContain('resend-provider')
    expect(src).not.toContain('delivery-worker')
    expect(src).not.toContain('unsubscribe-token')
    expect(src).not.toContain('sendMarketingEmailViaResend')
    expect(src).not.toContain('runMarketingDeliveryBatch')
  })

  it('67. no cron/scheduler added; not a job route', () => {
    // The route must not use the cron secret, and vercel.json must register NO
    // cron for this webhook path (webhooks are provider-driven, not scheduled).
    expect(routeSrc()).not.toContain('CRON_SECRET')
    const vercelJson = existsSync(join(REPO_ROOT, 'vercel.json'))
      ? readFileSync(join(REPO_ROOT, 'vercel.json'), 'utf8')
      : ''
    expect(vercelJson).not.toContain('resend/marketing')
    expect(vercelJson).not.toContain('webhooks/resend')
  })

  it('68. route does not read/gate on MARKETING_DELIVERY_WORKER_ENABLED', () => {
    // The sending kill switch must not gate lifecycle processing. Assert the
    // env var is never READ (process.env.MARKETING_DELIVERY_WORKER_ENABLED),
    // rather than banning the words in prose that documents this guarantee.
    const src = routeSrc()
    expect(src).not.toContain('process.env.MARKETING_DELIVERY_WORKER_ENABLED')
    expect(/MARKETING_DELIVERY_WORKER_ENABLED\s*(===|!==|==)/.test(src)).toBe(false)
  })

  it('69. uses RESEND_WEBHOOK_SECRET, never RESEND_API_KEY as the webhook secret', () => {
    const src = routeSrc()
    expect(src).toContain('RESEND_WEBHOOK_SECRET')
    expect(src).not.toContain('RESEND_API_KEY')
  })

  it('70. POST only, Node runtime, no GET export', () => {
    const src = routeSrc()
    expect(src).toContain("runtime = 'nodejs'")
    expect(/export\s+async\s+function\s+GET/.test(src)).toBe(false)
    expect(/export\s+async\s+function\s+POST/.test(src)).toBe(true)
  })
})
