import { describe, it, expect, beforeEach, vi } from 'vitest'

// `server-only` throws when imported outside a Server Component; make it a no-op
// in tests (same approach as the other marketing tests).
vi.mock('server-only', () => ({}))

/**
 * These tests pin the APPLICATION-BOUNDARY contract around the idempotent
 * database function public.set_marketing_email_preference (see
 * scripts/marketing/002-marketing-preference-idempotency.sql). The actual
 * "don't reset timestamps / don't double-log" guarantee is enforced in SQL and
 * is asserted there by the in-database no-op fast paths; we cannot execute that
 * SQL from vitest. What we CAN and do assert here is that:
 *
 *   1. Repeated enable calls forward identical, deterministic arguments to the
 *      single idempotent RPC and keep returning success (so a double-submit is
 *      safe and cannot diverge into two different writes).
 *   2. Repeated disable calls forward p_enabled:false with a null consent
 *      version and keep returning success.
 *   3. Repeated unsubscribe POSTs return the same 200 { ok: true } and invoke
 *      the idempotent unsubscribe function each time.
 *
 * A fresh mock service-role client is injected via vi.mock so nothing touches a
 * real database.
 */

const rpc = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc })),
}))

// The service module reads these at call time.
beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
})

import { setMarketingEmailPreference, unsubscribeMarketingEmail } from '../service'
import { MARKETING_CONSENT_SOURCE, MARKETING_CONSENT_VERSION } from '../consent'

describe('setMarketingEmailPreference — repeated enable', () => {
  it('forwards identical idempotent arguments on every repeat and stays ok', async () => {
    const args = {
      userId: 'user-1',
      emailLc: 'Person@Example.com',
      enabled: true,
      source: MARKETING_CONSENT_SOURCE.accountSettings,
      consentVersion: MARKETING_CONSENT_VERSION,
    }

    const first = await setMarketingEmailPreference(args)
    const second = await setMarketingEmailPreference(args)
    const third = await setMarketingEmailPreference(args)

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(third).toEqual({ ok: true })

    // Always the same single idempotent function, with a normalised email and a
    // real consent version — the DB then decides enable is a no-op on repeats.
    expect(rpc).toHaveBeenCalledTimes(3)
    const expected = {
      p_user_id: 'user-1',
      p_email_lc: 'person@example.com',
      p_enabled: true,
      p_source: 'account_settings',
      p_consent_version: MARKETING_CONSENT_VERSION,
    }
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('set_marketing_email_preference')
      expect(call[1]).toEqual(expected)
    }
  })
})

describe('setMarketingEmailPreference — repeated disable', () => {
  it('forwards p_enabled:false with a null consent version on every repeat', async () => {
    const args = {
      userId: 'user-2',
      emailLc: 'someone@example.com',
      enabled: false,
      source: MARKETING_CONSENT_SOURCE.accountSettings,
    }

    const first = await setMarketingEmailPreference(args)
    const second = await setMarketingEmailPreference(args)

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })

    expect(rpc).toHaveBeenCalledTimes(2)
    const expected = {
      p_user_id: 'user-2',
      p_email_lc: 'someone@example.com',
      p_enabled: false,
      p_source: 'account_settings',
      p_consent_version: null,
    }
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('set_marketing_email_preference')
      expect(call[1]).toEqual(expected)
    }
  })

  it('surfaces a safe error (and no throw) if the RPC fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const result = await setMarketingEmailPreference({
      userId: 'user-3',
      emailLc: 'x@example.com',
      enabled: false,
      source: MARKETING_CONSENT_SOURCE.accountSettings,
    })
    expect(result).toEqual({ ok: false, error: 'marketing_preference_write_failed' })
  })
})

describe('unsubscribeMarketingEmail — repeated calls', () => {
  it('calls the idempotent unsubscribe function each time and stays ok', async () => {
    const args = {
      userId: 'user-4',
      emailLc: 'Bounce@Example.com',
      source: MARKETING_CONSENT_SOURCE.unsubscribeLink,
    }

    const first = await unsubscribeMarketingEmail(args)
    const second = await unsubscribeMarketingEmail(args)

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })

    expect(rpc).toHaveBeenCalledTimes(2)
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('unsubscribe_marketing_email')
      expect(call[1]).toEqual({
        p_user_id: 'user-4',
        p_email_lc: 'bounce@example.com',
        p_source: 'unsubscribe_link',
      })
    }
  })
})
