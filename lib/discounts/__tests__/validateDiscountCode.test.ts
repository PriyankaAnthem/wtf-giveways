import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Focused tests for the server-only `validateDiscountCode` wrapper.
 *
 * The pure decision logic is covered by discountCalc.test.ts. Here we verify the
 * DB-wiring contract:
 *   - it reads via a SERVICE-ROLE client (RLS bypass) using the exact column
 *     names + normalized code that production uses,
 *   - a clean "no row" is an unknown code -> discount_code_invalid,
 *   - an unexpected DB error/throw -> discount_code_validation_failed (never a
 *     raw error, never mislabelled as invalid),
 *   - no-code and malformed-code paths short-circuit BEFORE any query.
 */

// --- Mock `server-only` (no-op in tests) and the supabase factory. ----------
vi.mock('server-only', () => ({}))

const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))
const createClient = vi.fn((_url: string, _key: string, _opts?: unknown) => ({ from }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts?: unknown) => createClient(url, key, opts),
}))

import { validateDiscountCode } from '../validateDiscountCode'

const CAMPAIGN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateDiscountCode (server wrapper)', () => {
  it('returns a no-discount result WITHOUT querying when no code is supplied', async () => {
    const r = await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000 })
    expect(r).toEqual({ ok: true, discount: null, subtotalPence: 1000, totalPence: 1000 })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a malformed code BEFORE querying', async () => {
    const r = await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000, submittedCode: 'a b!' })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_invalid', status: 400 })
    expect(from).not.toHaveBeenCalled()
  })

  it('queries discount_codes with the normalized (trimmed+uppercased) code', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000, submittedCode: '  save10 ' })
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role-key',
      expect.objectContaining({ auth: { persistSession: false } }),
    )
    expect(from).toHaveBeenCalledWith('discount_codes')
    expect(eq).toHaveBeenCalledWith('code', 'SAVE10')
  })

  it('treats a clean "no row" as an unknown code -> discount_code_invalid', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const r = await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000, submittedCode: 'NOPE10' })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_invalid' })
  })

  it('maps an unexpected DB error to discount_code_validation_failed (not invalid)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    const r = await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000, submittedCode: 'SAVE10' })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_validation_failed', status: 500 })
  })

  it('maps a thrown lookup (e.g. missing config) to discount_code_validation_failed', async () => {
    maybeSingle.mockRejectedValue(new Error('boom'))
    const r = await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000, submittedCode: 'SAVE10' })
    expect(r).toMatchObject({ ok: false, code: 'discount_code_validation_failed', status: 500 })
  })

  it('applies a valid code returned by the service-role lookup', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'd1',
        code: 'SAVE10',
        discount_type: 'fixed',
        discount_value: 300,
        scope: 'site_wide',
        campaign_id: null,
        is_active: true,
        starts_at: null,
        expires_at: null,
      },
      error: null,
    })
    const r = await validateDiscountCode({ campaignId: CAMPAIGN, subtotalPence: 1000, submittedCode: 'save10' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.discount).toMatchObject({ id: 'd1', discountPence: 300, discountType: 'fixed', scope: 'site_wide' })
    expect(r.totalPence).toBe(700)
  })
})
