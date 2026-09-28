import { beforeEach, describe, expect, it, vi } from 'vitest'

// server-only is a runtime guard; neutralise it for node tests.
vi.mock('server-only', () => ({}))

// Mock the THREE external effects at the module boundary, exactly like the
// existing Stage 030 worker test — nothing real (Supabase/Resend/email) runs.
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

const OTHER_RECIPIENT_ID = '99999999-9999-4999-8999-999999999999'

type RpcResult = { data: unknown; error: unknown }
let callOrder: Array<{ fn: string }> = []

function setupClient(handlers: Record<string, RpcResult>) {
  rpcMock.mockImplementation(async (fn: string) => {
    callOrder.push({ fn })
    return handlers[fn] ?? { data: null, error: null }
  })
}

const OK_RECOVER: RpcResult = { data: { status: 'ok', recoveredRecipients: 0, runsRequeued: 0 }, error: null }
const OK_AUTH: RpcResult = { data: { authorized: true, claimActive: true, blockerReasons: [] }, error: null }
const OK_SUCCESS_FIN: RpcResult = { data: { status: 'sent_recorded', finalized: true }, error: null }

function happyPath(claims: unknown[]) {
  setupClient({
    recover_expired_marketing_delivery_claims: OK_RECOVER,
    claim_marketing_delivery_batch: { data: { status: 'ok', claimedCount: claims.length, claims }, error: null },
    authorize_marketing_delivery_claim: OK_AUTH,
    finalize_marketing_delivery_success: OK_SUCCESS_FIN,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  callOrder = []
  process.env.MARKETING_DELIVERY_WORKER_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://wtf.example'
  createUnsubscribeToken.mockReturnValue('raw-token')
  sendMarketingEmailViaResend.mockResolvedValue({ ok: true, providerEmailId: 'prov_abc123' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('Stage 032 — delivery worker canary guard', () => {
  it('13. expectedRecipientId match permits the EXISTING pipeline to continue', async () => {
    happyPath([VALID_CLAIM])
    const r = await runMarketingDeliveryBatch({ expectedRecipientId: VALID_CLAIM.recipientId })
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(1)
    expect(r.providerSucceeded).toBe(1)
  })

  it('11. expectedRecipientId mismatch after claim causes ZERO provider calls', async () => {
    happyPath([VALID_CLAIM])
    const r = await runMarketingDeliveryBatch({ expectedRecipientId: OTHER_RECIPIENT_ID })
    expect(r.status).toBe('blocked')
    expect(r.reason).toBe('canary_recipient_mismatch')
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
    // No failure finalizer on a canary abort — leases recover normally.
    expect(callOrder.some((c) => c.fn.startsWith('finalize_'))).toBe(false)
  })

  it('12. multiple returned claims in canary mode cause ZERO provider calls', async () => {
    happyPath([VALID_CLAIM, { ...VALID_CLAIM, recipientId: OTHER_RECIPIENT_ID }])
    const r = await runMarketingDeliveryBatch({ expectedRecipientId: VALID_CLAIM.recipientId })
    expect(r.status).toBe('blocked')
    expect(r.reason).toBe('canary_multiple_claims')
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
    expect(callOrder.some((c) => c.fn.startsWith('finalize_'))).toBe(false)
  })

  it('canary mode with zero claims => no_work, no provider', async () => {
    happyPath([])
    const r = await runMarketingDeliveryBatch({ expectedRecipientId: VALID_CLAIM.recipientId })
    expect(r.status).toBe('no_work')
    expect(sendMarketingEmailViaResend).not.toHaveBeenCalled()
  })

  it('14. ordinary invocation WITHOUT expectedRecipientId behaves exactly as before', async () => {
    happyPath([VALID_CLAIM])
    const r = await runMarketingDeliveryBatch()
    expect(sendMarketingEmailViaResend).toHaveBeenCalledTimes(1)
    expect(r.providerSucceeded).toBe(1)
    expect(r.reason).toBeUndefined()
  })
})
