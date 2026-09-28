import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The route module transitively imports server-only modules; neutralise the
// guard so it can be imported under the node test environment.
vi.mock('server-only', () => ({}))

// Mock the token parser + service so nothing touches cryptography or a database.
const parseUnsubscribeToken = vi.fn()
const unsubscribeMarketingEmail = vi.fn()

vi.mock('@/lib/marketing/unsubscribe-token', () => ({
  parseUnsubscribeToken: (t: unknown) => parseUnsubscribeToken(t),
}))
vi.mock('@/lib/marketing/service', () => ({
  unsubscribeMarketingEmail: (a: unknown) => unsubscribeMarketingEmail(a),
}))

import { POST } from '../route'
import * as routeModule from '../route'
import { MARKETING_CONSENT_SOURCE } from '@/lib/marketing/consent'

const REPO_ROOT = process.cwd()
const VALID_PAYLOAD = {
  userId: 'user-1',
  emailLc: 'person@example.com',
  version: 1,
  issuedAt: new Date().toISOString(),
}

let ipCounter = 0
/** Unique IP per call so the fixed-window rate limiter never interferes. */
function freshIp(): string {
  ipCounter += 1
  return `198.51.100.${ipCounter % 250}`
}

function jsonReq(token: unknown, contentType = 'application/json') {
  return new Request('http://localhost/api/marketing/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-forwarded-for': freshIp() },
    body: JSON.stringify({ token }),
  })
}

function formReq(opts: {
  queryToken?: string | null
  body?: string
  contentType?: string
}) {
  const { queryToken, body = 'List-Unsubscribe=One-Click', contentType = 'application/x-www-form-urlencoded' } = opts
  const url =
    queryToken === undefined || queryToken === null
      ? 'http://localhost/api/marketing/unsubscribe'
      : `http://localhost/api/marketing/unsubscribe?token=${encodeURIComponent(queryToken)}`
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-forwarded-for': freshIp() },
    body,
  })
}

beforeEach(() => {
  parseUnsubscribeToken.mockReset()
  unsubscribeMarketingEmail.mockReset()
})

// ===========================================================================
// EXISTING HUMAN JSON FLOW (MODE A) — proven still safe.
// ===========================================================================
describe('029.5 — Mode A: existing JSON flow unchanged', () => {
  beforeEach(() => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
  })

  it('1. JSON POST with a valid token still succeeds (200 { ok: true })', async () => {
    const res = await POST(jsonReq('valid-token'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('2. JSON POST reads the token from body.token', async () => {
    await POST(jsonReq('body-token-abc'))
    expect(parseUnsubscribeToken).toHaveBeenCalledWith('body-token-abc')
  })

  it('3. JSON POST does not require a query token', async () => {
    // No ?token= present; body token is enough.
    const res = await POST(jsonReq('json-only'))
    expect(res.status).toBe(200)
  })

  it('4. JSON POST continues using the existing parseUnsubscribeToken', async () => {
    await POST(jsonReq('valid-token'))
    expect(parseUnsubscribeToken).toHaveBeenCalledTimes(1)
  })

  it('5. JSON POST continues using the existing unsubscribe mutation', async () => {
    await POST(jsonReq('valid-token'))
    expect(unsubscribeMarketingEmail).toHaveBeenCalledWith({
      userId: VALID_PAYLOAD.userId,
      emailLc: VALID_PAYLOAD.emailLc,
      source: MARKETING_CONSENT_SOURCE.unsubscribeLink,
    })
  })

  it('6. JSON invalid-token behaviour remains 400 invalid_token with no mutation', async () => {
    parseUnsubscribeToken.mockReturnValue(null)
    const res = await POST(jsonReq('garbage'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_token' })
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// NEW ONE-CLICK FLOW (MODE B).
// ===========================================================================
describe('029.5 — Mode B: RFC 8058 one-click flow', () => {
  it('7. form-urlencoded POST with query token + One-Click body succeeds', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    const res = await POST(formReq({ queryToken: 'q-token' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('8. one-click reads the token from the query string', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    await POST(formReq({ queryToken: 'query-token-xyz' }))
    expect(parseUnsubscribeToken).toHaveBeenCalledWith('query-token-xyz')
  })

  it('9. one-click does NOT read the token from the form body', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    // Body carries a decoy token=… that must be ignored; only ?token= counts.
    await POST(
      formReq({ queryToken: 'query-token', body: 'List-Unsubscribe=One-Click&token=body-decoy' }),
    )
    expect(parseUnsubscribeToken).toHaveBeenCalledWith('query-token')
    expect(parseUnsubscribeToken).not.toHaveBeenCalledWith('body-decoy')
  })

  it('10. missing query token => 400 and no unsubscribe', async () => {
    const res = await POST(formReq({ queryToken: null }))
    expect(res.status).toBe(400)
    expect(parseUnsubscribeToken).not.toHaveBeenCalled()
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('11. empty query token => 400 and no unsubscribe', async () => {
    const res = await POST(formReq({ queryToken: '' }))
    expect(res.status).toBe(400)
    expect(parseUnsubscribeToken).not.toHaveBeenCalled()
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('12. missing List-Unsubscribe form field => 400 and no unsubscribe', async () => {
    const res = await POST(formReq({ queryToken: 'q-token', body: 'foo=bar' }))
    expect(res.status).toBe(400)
    expect(parseUnsubscribeToken).not.toHaveBeenCalled()
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('13. List-Unsubscribe with a wrong value => 400 and no unsubscribe', async () => {
    const res = await POST(formReq({ queryToken: 'q-token', body: 'List-Unsubscribe=Nope' }))
    expect(res.status).toBe(400)
    expect(parseUnsubscribeToken).not.toHaveBeenCalled()
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('14. malformed/invalid opaque token => safe 400 invalid_token, no mutation', async () => {
    parseUnsubscribeToken.mockReturnValue(null)
    const res = await POST(formReq({ queryToken: 'tampered' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_token' })
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })

  it('15. valid one-click uses the existing parseUnsubscribeToken', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    await POST(formReq({ queryToken: 'q-token' }))
    expect(parseUnsubscribeToken).toHaveBeenCalledTimes(1)
  })

  it('16. valid one-click uses the existing unsubscribe mutation', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    await POST(formReq({ queryToken: 'q-token' }))
    expect(unsubscribeMarketingEmail).toHaveBeenCalledWith({
      userId: VALID_PAYLOAD.userId,
      emailLc: VALID_PAYLOAD.emailLc,
      source: MARKETING_CONSENT_SOURCE.unsubscribeLink,
    })
  })

  it('17. repeated valid one-click remains safe/idempotent (same 200 each time)', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    const first = await POST(formReq({ queryToken: 'q-token' }))
    const second = await POST(formReq({ queryToken: 'q-token' }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ ok: true })
    await expect(second.json()).resolves.toEqual({ ok: true })
    expect(unsubscribeMarketingEmail).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// CONTENT-TYPE ROUTING.
// ===========================================================================
describe('029.5 — content-type routing', () => {
  beforeEach(() => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
  })

  it('18. application/json accepted', async () => {
    const res = await POST(jsonReq('t', 'application/json'))
    expect(res.status).toBe(200)
  })

  it('19. application/json; charset=utf-8 accepted', async () => {
    const res = await POST(jsonReq('t', 'application/json; charset=utf-8'))
    expect(res.status).toBe(200)
  })

  it('20. application/x-www-form-urlencoded accepted', async () => {
    const res = await POST(formReq({ queryToken: 'q', contentType: 'application/x-www-form-urlencoded' }))
    expect(res.status).toBe(200)
  })

  it('21. application/x-www-form-urlencoded; charset=utf-8 accepted', async () => {
    const res = await POST(
      formReq({ queryToken: 'q', contentType: 'application/x-www-form-urlencoded; charset=utf-8' }),
    )
    expect(res.status).toBe(200)
  })

  it('22. unsupported content type rejected (415) without mutation', async () => {
    const req = new Request('http://localhost/api/marketing/unsubscribe?token=q', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-forwarded-for': freshIp() },
      body: 'List-Unsubscribe=One-Click',
    })
    const res = await POST(req)
    expect(res.status).toBe(415)
    expect(parseUnsubscribeToken).not.toHaveBeenCalled()
    expect(unsubscribeMarketingEmail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// GET SAFETY.
// ===========================================================================
describe('029.5 — GET never mutates', () => {
  it('23. the route module exports no GET handler', () => {
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined()
  })
})

// ===========================================================================
// PRIVACY.
// ===========================================================================
describe('029.5 — privacy', () => {
  it('24. token never returned in a success response', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    const res = await POST(formReq({ queryToken: 'super-secret-token' }))
    const text = await res.text()
    expect(text).not.toContain('super-secret-token')
    expect(JSON.parse(text)).toEqual({ ok: true })
  })

  it('25. email/user identity never returned in any response', async () => {
    parseUnsubscribeToken.mockReturnValue(VALID_PAYLOAD)
    unsubscribeMarketingEmail.mockResolvedValue({ ok: true })
    const res = await POST(formReq({ queryToken: 'q-token' }))
    const text = await res.text()
    expect(text).not.toContain(VALID_PAYLOAD.emailLc)
    expect(text).not.toContain(VALID_PAYLOAD.userId)
  })

  it('26/27. route source never logs the token or the query string', () => {
    const src = readFileSync(join(REPO_ROOT, 'app/api/marketing/unsubscribe/route.ts'), 'utf8')
    // No console.* logging at all in this route.
    expect(/console\.(log|info|warn|error|debug)/.test(src)).toBe(false)
  })
})

// ===========================================================================
// ISOLATION — file-content freezes proving scope discipline.
// ===========================================================================
describe('029.5 — isolation & scope', () => {
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

  it('28. human page app/unsubscribe/page.tsx does not POST/mutate itself', () => {
    const src = read('app/unsubscribe/page.tsx')
    // The page is a server component that only renders; it must not fetch the API.
    expect(/fetch\(/.test(src)).toBe(false)
  })

  it('29. unsubscribe-confirm still POSTs JSON { token } to the API (unchanged contract)', () => {
    const src = read('app/unsubscribe/unsubscribe-confirm.tsx')
    expect(src.includes('/api/marketing/unsubscribe')).toBe(true)
    expect(/application\/json/.test(src)).toBe(true)
    expect(/JSON\.stringify\(\s*\{\s*token/.test(src)).toBe(true)
  })

  it('30. unsubscribe-token.ts is untouched by this patch (still AES-GCM parser)', () => {
    const src = read('lib/marketing/unsubscribe-token.ts')
    expect(src.includes('parseUnsubscribeToken')).toBe(true)
    expect(/aes-256-gcm/i.test(src)).toBe(true)
  })

  it('31. Stage 029 provider is unchanged and still sends the one-click headers', () => {
    const src = read('lib/marketing/resend-provider.ts')
    expect(src.includes('List-Unsubscribe')).toBe(true)
    expect(src.includes('List-Unsubscribe=One-Click')).toBe(true)
  })

  it('32. the patched route touches no checkout/payment/ticket/wallet/instant-win/auth code', () => {
    const src = read('app/api/marketing/unsubscribe/route.ts')
    for (const forbidden of ['checkout', 'payment', 'ticket', 'wallet', 'instant', 'stripe', 'sumup', 'acquired']) {
      expect(new RegExp(forbidden, 'i').test(src)).toBe(false)
    }
  })

  it('33. no database migration was created for this patch (route uses no SQL/supabase directly)', () => {
    const src = read('app/api/marketing/unsubscribe/route.ts')
    expect(/supabase|createClient|\.rpc\(|CREATE TABLE|ALTER TABLE/i.test(src)).toBe(false)
  })

  it('34/35. Stage 030 delivery worker + job route now exist (introduced after this patch)', () => {
    // This guard originally asserted the worker/route did NOT exist yet. Stage
    // 030 has since introduced both; the one-click patch itself still created
    // neither, and neither of them modifies this unsubscribe route.
    const { existsSync } = require('node:fs') as typeof import('node:fs')
    expect(existsSync(join(REPO_ROOT, 'lib/marketing/delivery-worker.ts'))).toBe(true)
    expect(existsSync(join(REPO_ROOT, 'app/api/jobs/marketing-delivery/route.ts'))).toBe(true)
  })

  it('36. sendMarketingEmailViaResend has exactly ONE production consumer (the Stage 030 worker)', () => {
    // Grep across production code (exclude tests) for any import/call.
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execSync(
      "grep -rnE 'sendMarketingEmailViaResend|resend-provider' --include='*.ts' --include='*.tsx' app lib || true",
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    const offenders = out
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.includes('__tests__') && !/\.test\.[cm]?tsx?:/.test(line))
      // The provider's own declaration file is allowed.
      .filter((line) => !line.startsWith('lib/marketing/resend-provider.ts:'))
      // The Stage 030 worker is the single authorised consumer.
      .filter((line) => !line.startsWith('lib/marketing/delivery-worker.ts:'))
    expect(offenders).toEqual([])
  })
})
