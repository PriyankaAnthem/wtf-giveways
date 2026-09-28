import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// server-only is a runtime guard; neutralise it for node tests.
vi.mock('server-only', () => ({}))

// Mock the THREE external effects at the module boundary so the DEFAULT worker
// wiring (no injected deps) is what gets exercised — proving the real module
// names are used — while nothing real (Supabase/Resend/email) ever runs.
const rpcMock = vi.fn()
const getMarketingServiceClient = vi.fn(() => ({ rpc: rpcMock }))
const sendMarketingEmailViaResend = vi.fn()
const createUnsubscribeToken = vi.fn()

vi.mock('../service', () => ({ getMarketingServiceClient: () => getMarketingServiceClient() }))
vi.mock('../resend-provider', () => ({
  sendMarketingEmailViaResend: (...args: unknown[]) => sendMarketingEmailViaResend(...args),
}))
vi.mock('../unsubscribe-token', () => ({
  createUnsubscribeToken: (...args: unknown[]) => createUnsubscribeToken(...args),
}))

import { runMarketingDeliveryBatch } from '../delivery-worker'

const REPO_ROOT = process.cwd()

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const VALID_CLAIM = {
  recipientId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-9222-222222222222',
  opportunityId: '33333333-3333-4333-a333-333333333333',
  userId: '44444444-4444-4444-b444-444444444444',
  emailLc: 'person@example.com',
  idempotencyKey: 'idem-key-123',
  claimToken: '2026-01-01T00:00:00.000+00:00',
  lockedUntil: '2026-01-01T00:02:00.000+00:00',
  templateSnapshot: { subject: 'hello' },
  contextSnapshot: { firstName: 'A' },
  discountSnapshot: null,
}

type RpcResult = { data: unknown; error: unknown }
type Handlers = Record<string, RpcResult | ((params: Record<string, unknown>) => RpcResult)>

let callOrder: Array<{ fn: string; params: Record<string, unknown> }> = []

function setupClient(handlers: Handlers) {
  rpcMock.mockImplementation(async (fn: string, params: Record<string, unknown>) => {
    callOrder.push({ fn, params })
    const h = handlers[fn]
    if (typeof h === 'function') return h(params)
    return h ?? { data: null, error: null }
  })
}

const OK_RECOVER: RpcResult = { data: { status: 'ok', recoveredRecipients: 2, runsRequeued: 1 }, error: null }
const OK_CLAIM = (claims: unknown[]): RpcResult => ({
  data: { status: 'ok', claimedCount: claims.length, claims },
  error: null,
})
const OK_AUTH: RpcResult = {
  data: { authorized: true, claimActive: true, blockerReasons: [] },
  error: null,
}
const OK_SUCCESS_FIN: RpcResult = {
  data: { status: 'sent_recorded', finalized: true, recipientStatus: 'sent', attempts: 1 },
  error: null,
}
const OK_FAILURE_FIN: RpcResult = {
  data: { status: 'retry_scheduled', finalized: true, willRetry: true, attempts: 1 },
  error: null,
}

function happyPath(claims: unknown[] = [VALID_CLAIM]) {
  setupClient({
    recover_expired_marketing_delivery_claims: OK_RECOVER,
    claim_marketing_delivery_batch: OK_CLAIM(claims),
    authorize_marketing_delivery_claim: OK_AUTH,
    finalize_marketing_delivery_success: OK_SUCCESS_FIN,
    finalize_marketing_delivery_failure: OK_FAILURE_FIN,
  })
}

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  callOrder = []
  process.env.MARKETING_DELIVERY_WORKER_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://wtf.example'
  createUnsubscribeToken.mockReturnValue('raw tok+en/with=special')
  sendMarketingEmailViaResend.mockResolvedValue({ ok: true, providerEmailId: 'prov_abc123' })
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// APP KILL SWITCH (1-7)
// ---------------------------------------------------------------------------

describe('Stage 030 — app kill switch', () => {
  it('1. missing MARKETING_DELIVERY_WORKER_ENABLED => blocked', async () => {
    delete process.env.MARKETING_DELIVERY_WORKER_ENABLED
    const r = await runMarketingDeliveryBatch()
    expect(r.status).toBe('blocked')
    expect(r.reason).toBe('worker_disabled')
  })

  it('2. "false" => blocked', async () => {
    process.env.MARKETING_DELIVERY_WORKER_ENABLED = 'false'
    expect((await runMarketingDeliveryBatch()).status).toBe('blocked')
  })

  it('3. "TRUE" (wrong case) => blocked', async () => {
    process.env.MARKETING_DELIVERY_WORKER_ENABLED = 'TRUE'
    expect((await runMarketingDeliveryBatch()).status).toBe('blocked')
  })

  it('4. "1" => blocked', async () => {
    process.env.MARKETING_DELIVERY_WORKER_ENABLED = '1'
    expect((await runMarketingDeliveryBatch()).status).toBe('blocked')
  })

  it('5. exact "true" permits the worker to proceed', async () => {
    happyPath()
    const r = await runMarketingDeliveryBatch()
    expect(r.status).not.toBe('blocked')
    expect(rpcMock).toHaveBeenCalled()
  })

  it('6. disabled worker makes ZERO Supabase calls', async () => {
    process.env.MARKETING_DELIVERY_WORKER_ENABLED = 'false'
    await runMarketingDeliveryBatch()
    expect(getMarketingServiceClient).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('7. disabled worker makes ZERO provider calls', async () => {
    process.env.MARKETING_DELIVERY_WORKER_ENABLED = 'false'
    await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
    expect(createUnsubscribeToken).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// RECOVERY (14-16)
// ---------------------------------------------------------------------------

describe('Stage 030 — recovery', () => {
  it('14. recovery is called before claim', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const recoverIdx = callOrder.findIndex((c) => c.fn === 'recover_expired_marketing_delivery_claims')
    const claimIdx = callOrder.findIndex((c) => c.fn === 'claim_marketing_delivery_batch')
    expect(recoverIdx).toBeGreaterThanOrEqual(0)
    expect(claimIdx).toBeGreaterThan(recoverIdx)
    expect(callOrder[recoverIdx].params).toEqual({ p_limit: 100 })
  })

  it('15. recovery failure (rpc error) => no claim', async () => {
    setupClient({ recover_expired_marketing_delivery_claims: { data: null, error: { message: 'boom' } } })
    const r = await runMarketingDeliveryBatch()
    expect(r.status).toBe('error')
    expect(r.reason).toBe('recovery_failed')
    expect(callOrder.some((c) => c.fn === 'claim_marketing_delivery_batch')).toBe(false)
  })

  it('15b. recovery non-ok status => fail closed, no claim', async () => {
    setupClient({ recover_expired_marketing_delivery_claims: { data: { status: 'degraded' }, error: null } })
    const r = await runMarketingDeliveryBatch()
    expect(r.status).toBe('error')
    expect(callOrder.some((c) => c.fn === 'claim_marketing_delivery_batch')).toBe(false)
  })

  it('16. recovery failure => no provider', async () => {
    setupClient({ recover_expired_marketing_delivery_claims: { data: null, error: { message: 'x' } } })
    await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// CLAIM (17-23)
// ---------------------------------------------------------------------------

describe('Stage 030 — claim', () => {
  it('17/18. claim uses hard limit 10 and lease 120', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const claim = callOrder.find((c) => c.fn === 'claim_marketing_delivery_batch')
    expect(claim?.params).toEqual({ p_limit: 10, p_lease_seconds: 120 })
  })

  it('19. sending_disabled => no provider', async () => {
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: { data: { status: 'sending_disabled', claimedCount: 0, claims: [] }, error: null },
    })
    const r = await runMarketingDeliveryBatch()
    expect(r.status).toBe('blocked')
    expect(r.reason).toBe('sending_disabled')
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })

  it('20. rollout_disabled => no provider', async () => {
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: { data: { status: 'rollout_disabled', claimedCount: 0, claims: [] }, error: null },
    })
    const r = await runMarketingDeliveryBatch()
    expect(r.reason).toBe('rollout_disabled')
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })

  it('21. zero claims => no provider (no_work)', async () => {
    happyPath([])
    const r = await runMarketingDeliveryBatch()
    expect(r.status).toBe('no_work')
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })

  it('22. malformed claim => no provider', async () => {
    happyPath([{ ...VALID_CLAIM, recipientId: 'not-a-uuid' }])
    const r = await runMarketingDeliveryBatch()
    expect(r.malformedClaims).toBe(1)
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })

  it('22b. non-null discountSnapshot => malformed, no provider', async () => {
    happyPath([{ ...VALID_CLAIM, discountSnapshot: { amount: 5 } }])
    const r = await runMarketingDeliveryBatch()
    expect(r.malformedClaims).toBe(1)
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })

  it('23. malformed claim => no raw payload logging', async () => {
    happyPath([{ ...VALID_CLAIM, emailLc: 'secret@leak.example', recipientId: 'bad' }])
    await runMarketingDeliveryBatch()
    const logged = logSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('secret@leak.example')
  })
})

// ---------------------------------------------------------------------------
// UNSUBSCRIBE (24-29)
// ---------------------------------------------------------------------------

describe('Stage 030 — unsubscribe URL', () => {
  it('24. uses the existing createUnsubscribeToken helper with (userId, emailLc)', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    expect(createUnsubscribeToken).toHaveBeenCalledWith(VALID_CLAIM.userId, VALID_CLAIM.emailLc)
  })

  it('25/26/27. token is URL-encoded, path is exact, token only in query', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const url = new URL(sendMarketingEmailViaResend.mock.calls[0][0].unsubscribeUrl)
    expect(url.pathname).toBe('/api/marketing/unsubscribe')
    expect(url.searchParams.get('token')).toBe('raw tok+en/with=special')
    // raw special chars must be percent-encoded in the actual string
    const raw = sendMarketingEmailViaResend.mock.calls[0][0].unsubscribeUrl as string
    expect(raw).toContain('token=')
    expect(raw).not.toContain('with=special')
    expect(raw).toContain('%2F')
    // token must not appear in the path segment
    expect(url.pathname).not.toContain('token')
  })

  it('28/29. raw token and unsubscribe URL are never logged', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const logged = logSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('raw tok+en')
    expect(logged).not.toContain('/api/marketing/unsubscribe')
  })

  it('token mint failure => preProviderRejected, no provider, no finalizer', async () => {
    happyPath()
    createUnsubscribeToken.mockImplementation(() => {
      throw new Error('secret_missing')
    })
    const r = await runMarketingDeliveryBatch()
    expect(r.preProviderRejected).toBe(1)
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
    expect(callOrder.some((c) => c.fn.startsWith('finalize_'))).toBe(false)
  })

  it('non-https site origin => preProviderRejected, no provider', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://insecure.example'
    happyPath()
    const r = await runMarketingDeliveryBatch()
    expect(r.preProviderRejected).toBe(1)
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// JIT AUTH (30-35)
// ---------------------------------------------------------------------------

describe('Stage 030 — JIT authorization', () => {
  it('30/31/32. JIT auth called with exact recipientId + original claimToken', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const auth = callOrder.find((c) => c.fn === 'authorize_marketing_delivery_claim')
    expect(auth?.params).toEqual({
      p_recipient_id: VALID_CLAIM.recipientId,
      p_claim_token: VALID_CLAIM.claimToken,
    })
  })

  it('33/34/35. authorization false => no provider, no failure finalizer, no attempt', async () => {
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: OK_CLAIM([VALID_CLAIM]),
      authorize_marketing_delivery_claim: { data: { authorized: false, blockerReasons: ['claim_expired'] }, error: null },
    })
    const r = await runMarketingDeliveryBatch()
    expect(r.authorizationRejected).toBe(1)
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
    expect(callOrder.some((c) => c.fn === 'finalize_marketing_delivery_failure')).toBe(false)
    expect(callOrder.some((c) => c.fn === 'finalize_marketing_delivery_success')).toBe(false)
  })

  it('authorization RPC error => treated as not authorized', async () => {
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: OK_CLAIM([VALID_CLAIM]),
      authorize_marketing_delivery_claim: { data: null, error: { message: 'boom' } },
    })
    const r = await runMarketingDeliveryBatch()
    expect(r.authorizationRejected).toBe(1)
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// PROVIDER (36-40)
// ---------------------------------------------------------------------------

describe('Stage 030 — provider call', () => {
  it('36. authorization true => provider called exactly once', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(1)
  })

  it('37/38/39/40. exact idempotencyKey, snapshots, and minted URL supplied', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const arg = sendMarketingEmailViaResend.mock.calls[0][0]
    expect(arg.emailLc).toBe(VALID_CLAIM.emailLc)
    expect(arg.idempotencyKey).toBe(VALID_CLAIM.idempotencyKey)
    expect(arg.templateSnapshot).toEqual(VALID_CLAIM.templateSnapshot)
    expect(arg.contextSnapshot).toEqual(VALID_CLAIM.contextSnapshot)
    expect(new URL(arg.unsubscribeUrl).pathname).toBe('/api/marketing/unsubscribe')
  })

  it('provider is called immediately after authorization (no intervening rpc)', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    // The rpc immediately before the first provider call must be the auth rpc.
    const authIdx = callOrder.findIndex((c) => c.fn === 'authorize_marketing_delivery_claim')
    // Next rpc after auth is a finalizer (success), proving provider ran between.
    expect(callOrder[authIdx + 1].fn).toBe('finalize_marketing_delivery_success')
  })
})

// ---------------------------------------------------------------------------
// SUCCESS (41-45)
// ---------------------------------------------------------------------------

describe('Stage 030 — provider success', () => {
  it('41/42/43/44/45. success finalizer called with exact args; failure finalizer not called', async () => {
    happyPath()
    const r = await runMarketingDeliveryBatch()
    const fin = callOrder.find((c) => c.fn === 'finalize_marketing_delivery_success')
    expect(fin?.params).toEqual({
      p_recipient_id: VALID_CLAIM.recipientId,
      p_claim_token: VALID_CLAIM.claimToken,
      p_provider_email_id: 'prov_abc123',
    })
    expect(callOrder.some((c) => c.fn === 'finalize_marketing_delivery_failure')).toBe(false)
    expect(r.providerSucceeded).toBe(1)
    expect(r.successFinalized).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// SUCCESS FINALIZER FAILURE (46-48)
// ---------------------------------------------------------------------------

describe('Stage 030 — provider success + finalizer failure', () => {
  it('46/47/48. provider called once, failure finalizer NOT called, counter set', async () => {
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: OK_CLAIM([VALID_CLAIM]),
      authorize_marketing_delivery_claim: OK_AUTH,
      finalize_marketing_delivery_success: { data: { status: 'claim_mismatch', finalized: false }, error: null },
    })
    const r = await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(1)
    expect(callOrder.some((c) => c.fn === 'finalize_marketing_delivery_failure')).toBe(false)
    expect(r.providerSucceeded).toBe(1)
    expect(r.providerSucceededFinalizeFailed).toBe(1)
    expect(r.successFinalized).toBe(0)
  })

  it('48b. success finalizer RPC error also => providerSucceededFinalizeFailed', async () => {
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: OK_CLAIM([VALID_CLAIM]),
      authorize_marketing_delivery_claim: OK_AUTH,
      finalize_marketing_delivery_success: { data: null, error: { message: 'invariant' } },
    })
    const r = await runMarketingDeliveryBatch()
    expect(r.providerSucceededFinalizeFailed).toBe(1)
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// FAILURE (49-52)
// ---------------------------------------------------------------------------

describe('Stage 030 — provider failure', () => {
  it('49/50/51/52. failure finalizer called with exact code, retryable, and 300s delay', async () => {
    sendMarketingEmailViaResend.mockResolvedValue({ ok: false, retryable: true, errorCode: 'resend_rate_limited' })
    happyPath()
    const r = await runMarketingDeliveryBatch()
    const fin = callOrder.find((c) => c.fn === 'finalize_marketing_delivery_failure')
    expect(fin?.params).toEqual({
      p_recipient_id: VALID_CLAIM.recipientId,
      p_claim_token: VALID_CLAIM.claimToken,
      p_error_code: 'resend_rate_limited',
      p_retryable: true,
      p_retry_after_seconds: 300,
    })
    expect(r.providerFailed).toBe(1)
    expect(r.failureFinalized).toBe(1)
  })

  it('51b. non-retryable flag preserved into finalizer', async () => {
    sendMarketingEmailViaResend.mockResolvedValue({ ok: false, retryable: false, errorCode: 'resend_http_422' })
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: OK_CLAIM([VALID_CLAIM]),
      authorize_marketing_delivery_claim: OK_AUTH,
      finalize_marketing_delivery_failure: { data: { status: 'failed_terminal', finalized: true, willRetry: false }, error: null },
    })
    const r = await runMarketingDeliveryBatch()
    const fin = callOrder.find((c) => c.fn === 'finalize_marketing_delivery_failure')
    expect(fin?.params.p_retryable).toBe(false)
    expect(r.failureFinalized).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// FAILURE FINALIZER FAILURE (53-54)
// ---------------------------------------------------------------------------

describe('Stage 030 — provider failure + finalizer failure', () => {
  it('53/54. provider not called again; providerFailedFinalizeFailed incremented', async () => {
    sendMarketingEmailViaResend.mockResolvedValue({ ok: false, retryable: true, errorCode: 'resend_timeout' })
    setupClient({
      recover_expired_marketing_delivery_claims: OK_RECOVER,
      claim_marketing_delivery_batch: OK_CLAIM([VALID_CLAIM]),
      authorize_marketing_delivery_claim: OK_AUTH,
      finalize_marketing_delivery_failure: { data: { status: 'claim_mismatch', finalized: false }, error: null },
    })
    const r = await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(1)
    expect(r.providerFailed).toBe(1)
    expect(r.providerFailedFinalizeFailed).toBe(1)
    expect(r.failureFinalized).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// MULTIPLE CLAIMS (55-57)
// ---------------------------------------------------------------------------

describe('Stage 030 — multiple claims', () => {
  function claimN(i: number) {
    const hex = i.toString(16).padStart(2, '0')
    return {
      ...VALID_CLAIM,
      recipientId: `1111111${hex[0]}-1111-4111-8111-1111111111${hex}`,
      idempotencyKey: `idem-${i}`,
    }
  }

  it('55. processing is sequential (provider calls do not overlap)', async () => {
    happyPath([claimN(1), claimN(2), claimN(3)])
    let active = 0
    let maxActive = 0
    sendMarketingEmailViaResend.mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((res) => setTimeout(res, 1))
      active -= 1
      return { ok: true, providerEmailId: 'p' }
    })
    await runMarketingDeliveryBatch()
    expect(maxActive).toBe(1)
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(3)
  })

  it('56. at most 10 claims processed even if RPC returns more', async () => {
    const many = Array.from({ length: 13 }, (_, i) => claimN(i + 1))
    happyPath(many)
    await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(10)
  })

  it('57. a later claim failure does not resend an earlier success', async () => {
    happyPath([claimN(1), claimN(2)])
    let n = 0
    sendMarketingEmailViaResend.mockImplementation(async () => {
      n += 1
      return n === 1
        ? { ok: true, providerEmailId: 'p1' }
        : { ok: false, retryable: true, errorCode: 'resend_timeout' }
    })
    const r = await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(2)
    expect(r.providerSucceeded).toBe(1)
    expect(r.providerFailed).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// PRIVACY (58-63)
// ---------------------------------------------------------------------------

describe('Stage 030 — privacy', () => {
  it('58-62. aggregate result contains no email/uuid/provider id/token/url', async () => {
    happyPath()
    const r = await runMarketingDeliveryBatch()
    const serialised = JSON.stringify(r)
    expect(serialised).not.toContain('@')
    expect(serialised).not.toContain(VALID_CLAIM.recipientId)
    expect(serialised).not.toContain(VALID_CLAIM.userId)
    expect(serialised).not.toContain('prov_abc123')
    expect(serialised).not.toContain(VALID_CLAIM.claimToken)
    expect(serialised).not.toContain('/api/marketing/unsubscribe')
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(serialised)).toBe(false)
  })

  it('63. logs contain no PII', async () => {
    happyPath()
    await runMarketingDeliveryBatch()
    const logged = logSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('@')
    expect(logged).not.toContain(VALID_CLAIM.recipientId)
    expect(logged).not.toContain(VALID_CLAIM.userId)
    expect(logged).not.toContain('prov_abc123')
  })
})

// ---------------------------------------------------------------------------
// ISOLATION (64-78) — static source guarantees
// ---------------------------------------------------------------------------

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(REPO_ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs)) {
    const relPath = join(dir, entry)
    const absPath = join(REPO_ROOT, relPath)
    if (statSync(absPath).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(relPath, out)
    } else if (/\.[cm]?[jt]sx?$/.test(entry)) {
      out.push(relPath)
    }
  }
  return out
}

function isTestFile(rel: string): boolean {
  return rel.includes('__tests__') || /\.test\.[cm]?[jt]sx?$/.test(rel)
}

describe('Stage 030 — isolation', () => {
  const WORKER_REL = 'lib/marketing/delivery-worker.ts'
  const ROUTE_REL = 'app/api/jobs/marketing-delivery/route.ts'

  it('64. sendMarketingEmailViaResend has exactly ONE production consumer (the worker)', () => {
    const files = [...walk('app'), ...walk('lib')].filter((f) => !isTestFile(f))
    const consumers = files.filter((f) => {
      if (f === 'lib/marketing/resend-provider.ts') return false // definition, not consumer
      const src = readFileSync(join(REPO_ROOT, f), 'utf8')
      return /sendMarketingEmailViaResend|resend-provider/.test(src)
    })
    expect(consumers).toEqual([WORKER_REL])
  })

  it('65. worker adds no direct marketing-table writes', () => {
    const src = read(WORKER_REL)
    expect(/\.from\(\s*['"]marketing_/.test(src)).toBe(false)
    expect(/\.update\(/.test(src)).toBe(false)
    expect(/\.insert\(/.test(src)).toBe(false)
    expect(/\.delete\(/.test(src)).toBe(false)
  })

  it('66. no in-process scheduler, and the manual POST job route is not cron-scheduled', () => {
    // Stage 033 intentionally adds a Vercel Cron for the marketing-delivery
    // WORKER via a dedicated GET route (app/api/cron/marketing-delivery). That
    // is the ONLY marketing-delivery cron. This guard still enforces that:
    //   (a) the worker/POST-route source contains NO in-process scheduler, and
    //   (b) the manual POST job route path itself is never the cron target
    //       (Vercel Cron issues GET; the POST route stays manual-only).
    if (existsSync(join(REPO_ROOT, 'vercel.json'))) {
      const cfg = JSON.parse(read('vercel.json')) as { crons?: Array<{ path?: string }> }
      const paths = (cfg.crons ?? []).map((c) => c.path)
      // The Stage 030 manual POST job route must NOT be scheduled.
      expect(paths).not.toContain('/api/jobs/marketing-delivery')
      // Any marketing-delivery cron must be the dedicated Stage 033 GET route.
      const marketingDeliveryCrons = paths.filter((p) => (p ?? '').includes('marketing-delivery'))
      for (const p of marketingDeliveryCrons) {
        expect(p).toBe('/api/cron/marketing-delivery')
      }
    }
    const src = read(WORKER_REL) + read(ROUTE_REL)
    expect(/setInterval|setTimeout\(|node-cron|@vercel\/cron/.test(src)).toBe(false)
  })

  it('67/68/69. worker changes no controls / definitions / automations', () => {
    const src = read(WORKER_REL)
    expect(/sending_enabled|discovery_enabled|rollout_limit/.test(src)).toBe(false)
    expect(/set_marketing_email_preference|definition|automation/i.test(src)).toBe(false)
    // Only READS the app env flag; never assigns it.
    expect(/MARKETING_DELIVERY_WORKER_ENABLED\s*=/.test(src.replace(/===|!==|==/g, ''))).toBe(false)
  })

  it('70-76. worker/route reference no checkout/payments/tickets/wallet/instant-wins/auth/transactional email', () => {
    const src = read(WORKER_REL) + '\n' + read(ROUTE_REL)
    for (const forbidden of [
      'checkout',
      'payment',
      'ticket',
      'wallet',
      'instant',
      'stripe',
      'sumup',
      'acquired',
      'inbox/email',
    ]) {
      expect(new RegExp(forbidden, 'i').test(src)).toBe(false)
    }
  })

  it('77/78. worker/route do not modify the unsubscribe route or Stage 029 provider', () => {
    // They must not import those modules' internals; provider is used via its
    // public export only, and the unsubscribe route is never imported.
    const src = read(WORKER_REL) + '\n' + read(ROUTE_REL)
    expect(src).not.toContain('app/api/marketing/unsubscribe')
    // Provider imported by name only (public contract), not deep internals.
    expect(read(WORKER_REL)).toContain("from './resend-provider'")
  })
})
