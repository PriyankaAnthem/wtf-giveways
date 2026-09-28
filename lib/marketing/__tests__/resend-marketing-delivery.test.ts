import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Both Stage 029 modules begin with `import 'server-only'`; neutralise the
// guard so they load under the node test environment.
vi.mock('server-only', () => ({}))

import { renderMarketingEmail, MarketingRenderError } from '../delivery-email'
import { sendMarketingEmailViaResend } from '../resend-provider'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validTemplateSnapshot() {
  return {
    schemaVersion: 1 as const,
    templateKey: 'abandoned_checkout_v1',
    templateVersion: 1,
    subject: 'You left something behind',
    previewText: 'Your entry was not completed.',
    heading: 'Still thinking it over?',
    bodyText: 'Your checkout was not completed.\nPick up where you left off.',
    ctaLabel: 'Finish my entry',
  }
}

function validContextSnapshot() {
  return {
    schemaVersion: 1 as const,
    opportunityType: 'abandoned_checkout',
    campaign: {
      title: 'The £20k Blowout',
      url: 'https://wtf.example/giveaways/blowout',
    },
  }
}

const VALID_UNSUB = 'https://wtf.example/unsubscribe?t=abc123'

function validRender() {
  return renderMarketingEmail({
    templateSnapshot: validTemplateSnapshot(),
    contextSnapshot: validContextSnapshot(),
    unsubscribeUrl: VALID_UNSUB,
  })
}

// ===========================================================================
// RENDERER (tests 1–18)
// ===========================================================================
describe('Stage 029 — renderMarketingEmail', () => {
  it('1. valid Version-1 snapshots render', () => {
    const out = validRender()
    expect(out.subject).toBe('You left something behind')
    expect(out.templateKey).toBe('abandoned_checkout_v1')
    expect(out.templateVersion).toBe(1)
    expect(out.opportunityType).toBe('abandoned_checkout')
    expect(out.html).toContain('<!DOCTYPE html>')
    expect(out.text.length).toBeGreaterThan(0)
  })

  it('2. schemaVersion string "1" rejected (template)', () => {
    const t = validTemplateSnapshot() as Record<string, unknown>
    t.schemaVersion = '1'
    expect(() => renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('3. templateVersion string rejected', () => {
    const t = validTemplateSnapshot() as Record<string, unknown>
    t.templateVersion = '1'
    expect(() => renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('4. fractional templateVersion rejected', () => {
    const t = validTemplateSnapshot() as Record<string, unknown>
    t.templateVersion = 1.5
    expect(() => renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('5. missing campaign rejected', () => {
    const c = validContextSnapshot() as Record<string, unknown>
    delete c.campaign
    expect(() => renderMarketingEmail({ templateSnapshot: validTemplateSnapshot(), contextSnapshot: c, unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('6. invalid campaign URL rejected', () => {
    const c = validContextSnapshot()
    c.campaign.url = 'not a url'
    expect(() => renderMarketingEmail({ templateSnapshot: validTemplateSnapshot(), contextSnapshot: c, unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('7. javascript: campaign URL rejected', () => {
    const c = validContextSnapshot()
    c.campaign.url = 'javascript:alert(1)'
    expect(() => renderMarketingEmail({ templateSnapshot: validTemplateSnapshot(), contextSnapshot: c, unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('8. invalid unsubscribe URL rejected', () => {
    expect(() => renderMarketingEmail({ templateSnapshot: validTemplateSnapshot(), contextSnapshot: validContextSnapshot(), unsubscribeUrl: 'nope' })).toThrow(MarketingRenderError)
  })

  it('9. javascript: unsubscribe URL rejected', () => {
    expect(() => renderMarketingEmail({ templateSnapshot: validTemplateSnapshot(), contextSnapshot: validContextSnapshot(), unsubscribeUrl: 'javascript:alert(1)' })).toThrow(MarketingRenderError)
  })

  it('10. unresolved {{campaign_title}} rejected', () => {
    const t = validTemplateSnapshot()
    t.heading = 'Hi {{campaign_title}}'
    expect(() => renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('11. unresolved {{campaign_url}} rejected', () => {
    const t = validTemplateSnapshot()
    t.bodyText = 'Go to {{campaign_url}} now'
    expect(() => renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })).toThrow(MarketingRenderError)
  })

  it('12. HTML in campaign title is escaped', () => {
    const c = validContextSnapshot()
    c.campaign.title = '<script>alert(1)</script>'
    const out = renderMarketingEmail({ templateSnapshot: validTemplateSnapshot(), contextSnapshot: c, unsubscribeUrl: VALID_UNSUB })
    expect(out.html).not.toContain('<script>alert(1)</script>')
    expect(out.html).toContain('&lt;script&gt;')
  })

  it('13. HTML in heading is escaped', () => {
    const t = validTemplateSnapshot()
    t.heading = '<b>hi</b>'
    const out = renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })
    expect(out.html).not.toContain('<b>hi</b>')
    expect(out.html).toContain('&lt;b&gt;hi&lt;/b&gt;')
  })

  it('14. HTML in body is escaped', () => {
    const t = validTemplateSnapshot()
    t.bodyText = '<img src=x onerror=alert(1)>'
    const out = renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })
    expect(out.html).not.toContain('<img src=x')
    expect(out.html).toContain('&lt;img')
  })

  it('15. HTML in CTA is escaped', () => {
    const t = validTemplateSnapshot()
    t.ctaLabel = '<i>go</i>'
    const out = renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })
    expect(out.html).not.toContain('<i>go</i>')
    expect(out.html).toContain('&lt;i&gt;go&lt;/i&gt;')
  })

  it('16. body newlines become safe <br>', () => {
    const t = validTemplateSnapshot()
    t.bodyText = 'line one\nline two'
    const out = renderMarketingEmail({ templateSnapshot: t, contextSnapshot: validContextSnapshot(), unsubscribeUrl: VALID_UNSUB })
    expect(out.html).toContain('line one<br />line two')
  })

  it('17. plain text contains campaign URL', () => {
    const out = validRender()
    expect(out.text).toContain('https://wtf.example/giveaways/blowout')
  })

  it('18. plain text contains unsubscribe URL', () => {
    const out = validRender()
    expect(out.text).toContain(VALID_UNSUB)
  })
})

// ===========================================================================
// PROVIDER (tests 19–38)
// ===========================================================================
const TEST_API_KEY = 're_test_SECRETKEY_should_never_leak_123'
const TEST_FROM = 'WTF Giveaways <no-reply@wtf.example>'
const TEST_EMAIL = 'Customer@Example.com'
const TEST_EMAIL_LC = 'customer@example.com'
const TEST_IDEMPOTENCY = 'recipient-idem-key-0001'

function validProviderInput(overrides: Record<string, unknown> = {}) {
  return {
    emailLc: TEST_EMAIL,
    idempotencyKey: TEST_IDEMPOTENCY,
    templateSnapshot: validTemplateSnapshot(),
    contextSnapshot: validContextSnapshot(),
    unsubscribeUrl: VALID_UNSUB,
    ...overrides,
  }
}

function jsonResponse(status: number, payload: unknown, ok?: boolean): Response {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  process.env.RESEND_API_KEY = TEST_API_KEY
  process.env.RESEND_FROM = TEST_FROM
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  process.env = { ...ORIGINAL_ENV }
})

describe('Stage 029 — sendMarketingEmailViaResend', () => {
  it('19. missing RESEND_API_KEY returns configuration error WITHOUT fetch', async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'resend_config_missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('20. missing RESEND_FROM returns configuration error WITHOUT fetch', async () => {
    delete process.env.RESEND_FROM
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'resend_config_missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('21. invalid email returns non-retryable error WITHOUT fetch', async () => {
    const res = await sendMarketingEmailViaResend(validProviderInput({ emailLc: 'not-an-email' }))
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'invalid_recipient' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('22. invalid idempotency key returns non-retryable error WITHOUT fetch', async () => {
    const res = await sendMarketingEmailViaResend(validProviderInput({ idempotencyKey: 'bad\r\nkey' }))
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'invalid_idempotency_key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('23. renderer failure returns non-retryable marketing_render_invalid', async () => {
    const res = await sendMarketingEmailViaResend(validProviderInput({ unsubscribeUrl: 'javascript:alert(1)' }))
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'marketing_render_invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('24. provider success with ID returns ok=true', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'resend-email-123' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: true, providerEmailId: 'resend-email-123' })
  })

  it('25. success without ID returns retryable resend_success_without_id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: true, errorCode: 'resend_success_without_id' })
  })

  it('26. HTTP 429 retryable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: true, errorCode: 'resend_rate_limited' })
  })

  it('27. HTTP 500 retryable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: true, errorCode: 'resend_server_error' })
  })

  it('28. HTTP 400 non-retryable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'bad' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'resend_http_400' })
  })

  it('29. timeout retryable', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }),
    )
    const p = sendMarketingEmailViaResend(validProviderInput())
    await vi.advanceTimersByTimeAsync(15_000)
    const res = await p
    expect(res).toEqual({ ok: false, retryable: true, errorCode: 'resend_timeout' })
  })

  it('30. network error retryable', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(res).toEqual({ ok: false, retryable: true, errorCode: 'resend_network_error' })
  })

  it('31. request contains Idempotency-Key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'x1' }))
    await sendMarketingEmailViaResend(validProviderInput())
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers['Idempotency-Key']).toBe(TEST_IDEMPOTENCY)
  })

  it('32. request contains List-Unsubscribe header inside email payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'x1' }))
    await sendMarketingEmailViaResend(validProviderInput())
    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.headers['List-Unsubscribe']).toBe(`<${VALID_UNSUB}>`)
  })

  it('33. request contains List-Unsubscribe-Post', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'x1' }))
    await sendMarketingEmailViaResend(validProviderInput())
    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('34. request contains HTML + text', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'x1' }))
    await sendMarketingEmailViaResend(validProviderInput())
    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(typeof body.html).toBe('string')
    expect(body.html).toContain('<!DOCTYPE html>')
    expect(typeof body.text).toBe('string')
    expect(body.text.length).toBeGreaterThan(0)
  })

  it('35. request contains only safe marketing tags', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'x1' }))
    await sendMarketingEmailViaResend(validProviderInput())
    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.tags).toEqual([
      { name: 'email_type', value: 'marketing' },
      { name: 'opportunity', value: 'abandoned_checkout' },
    ])
    const serialisedTags = JSON.stringify(body.tags)
    expect(serialisedTags).not.toContain(TEST_EMAIL_LC)
    expect(serialisedTags.toLowerCase()).not.toContain('wallet')
    expect(serialisedTags).not.toContain(TEST_IDEMPOTENCY)
  })

  it('36. raw provider error text is NOT returned', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'SUPER SECRET PROVIDER DIAGNOSTIC' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(JSON.stringify(res)).not.toContain('SUPER SECRET PROVIDER DIAGNOSTIC')
    expect(res).toEqual({ ok: false, retryable: false, errorCode: 'resend_http_400' })
  })

  it('37. API key is NEVER included in returned errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'x' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    expect(JSON.stringify(res)).not.toContain(TEST_API_KEY)
  })

  it('38. customer email is NEVER included in returned errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'x' }))
    const res = await sendMarketingEmailViaResend(validProviderInput())
    const serialised = JSON.stringify(res).toLowerCase()
    expect(serialised).not.toContain(TEST_EMAIL_LC)
  })
})

// ===========================================================================
// ISOLATION (tests 39–43)
// ===========================================================================
const REPO_ROOT = process.cwd()
const PROVIDER_REL = 'lib/marketing/resend-provider.ts'
const RENDERER_REL = 'lib/marketing/delivery-email.ts'

const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'coverage'])
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(REPO_ROOT, full)
    if (IGNORED_DIRS.has(entry)) continue
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (CODE_EXT.test(entry)) {
      out.push(rel)
    }
  }
  return out
}

function isTestFile(rel: string): boolean {
  return rel.includes('__tests__') || /\.test\.[cm]?[jt]sx?$/.test(rel)
}

/** Remove block + line comments so code checks ignore explanatory prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('Stage 029 — isolation', () => {
  const allCodeFiles = walk(REPO_ROOT)

  it('39. only the Stage 030 delivery worker consumes sendMarketingEmailViaResend', () => {
    // Stage 029 shipped the provider with ZERO consumers. Stage 030 introduced
    // lib/marketing/delivery-worker.ts as the SINGLE authorised production
    // consumer. No other production module may import the provider.
    const AUTHORISED_CONSUMER = 'lib/marketing/delivery-worker.ts'
    const offenders: string[] = []
    for (const rel of allCodeFiles) {
      if (rel === PROVIDER_REL) continue // its own declaration/export
      if (rel === AUTHORISED_CONSUMER) continue // the Stage 030 worker
      if (isTestFile(rel)) continue // tests may import it
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
      if (src.includes('sendMarketingEmailViaResend') || src.includes('resend-provider')) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('40. no cron created (no vercel.json crons and no cron wiring in the new modules)', () => {
    // The two new modules must not reference cron scheduling (ignore comments).
    const provider = stripComments(readFileSync(join(REPO_ROOT, PROVIDER_REL), 'utf8'))
    const renderer = stripComments(readFileSync(join(REPO_ROOT, RENDERER_REL), 'utf8'))
    expect(/cron/i.test(provider)).toBe(false)
    expect(/cron/i.test(renderer)).toBe(false)
  })

  it('41. no marketing send API route created that imports the provider', () => {
    const offenders: string[] = []
    for (const rel of allCodeFiles) {
      if (!rel.startsWith('app/') || !/route\.[cm]?tsx?$/.test(rel)) continue
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
      if (src.includes('resend-provider') || src.includes('sendMarketingEmailViaResend')) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('42. no database code added to either new module', () => {
    for (const rel of [PROVIDER_REL, RENDERER_REL]) {
      const src = stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8'))
      expect(/supabase/i.test(src)).toBe(false)
      expect(/createClient/.test(src)).toBe(false)
      expect(/\.rpc\(/.test(src)).toBe(false)
      expect(/marketing_recipients/.test(src)).toBe(false)
    }
  })

  it('43. no existing transactional sender changed (inbox email does not import Stage 029)', () => {
    const inbox = readFileSync(join(REPO_ROOT, 'lib/admin/inbox/email.ts'), 'utf8')
    expect(inbox.includes('resend-provider')).toBe(false)
    expect(inbox.includes('delivery-email')).toBe(false)
    expect(inbox.includes('sendMarketingEmailViaResend')).toBe(false)
  })
})
