import { describe, it, expect, vi, beforeEach } from 'vitest'

// The helper imports `server-only`; stub it so it can load in node.
vi.mock('server-only', () => ({}))

import {
  isUserPurchaseRestricted,
  ACCOUNT_SELF_EXCLUDED_ERROR,
  ACCOUNT_SELF_EXCLUDED_MESSAGE,
} from '@/lib/account-restrictions'

/** Build a Supabase-like client whose `.rpc` resolves to the given payload. */
function clientReturning(payload: { data: unknown; error: { message?: string } | null }) {
  const rpc = vi.fn(async () => payload)
  return { client: { rpc }, rpc }
}

const USER = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('isUserPurchaseRestricted — authoritative results', () => {
  it('returns TRUE when the RPC returns boolean true (restricted)', async () => {
    const { client } = clientReturning({ data: true, error: null })
    expect(await isUserPurchaseRestricted(client, USER)).toBe(true)
  })

  it('returns FALSE when the RPC returns boolean false (allowed)', async () => {
    const { client } = clientReturning({ data: false, error: null })
    expect(await isUserPurchaseRestricted(client, USER)).toBe(false)
  })

  it('normalises a single-row array result ([true] / [false])', async () => {
    expect(await isUserPurchaseRestricted(clientReturning({ data: [true], error: null }).client, USER)).toBe(true)
    expect(await isUserPurchaseRestricted(clientReturning({ data: [false], error: null }).client, USER)).toBe(false)
  })

  it('normalises an object result keyed by the function name', async () => {
    const restricted = clientReturning({ data: { is_user_purchase_restricted: true }, error: null }).client
    const allowed = clientReturning({ data: { is_user_purchase_restricted: false }, error: null }).client
    expect(await isUserPurchaseRestricted(restricted, USER)).toBe(true)
    expect(await isUserPurchaseRestricted(allowed, USER)).toBe(false)
  })

  it('calls the correct RPC name with p_user_id', async () => {
    const { client, rpc } = clientReturning({ data: false, error: null })
    await isUserPurchaseRestricted(client, USER)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('is_user_purchase_restricted', { p_user_id: USER })
  })
})

describe('isUserPurchaseRestricted — fail-closed policy', () => {
  it('fails CLOSED (true) when the RPC returns an error', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'boom' } })
    expect(await isUserPurchaseRestricted(client, USER)).toBe(true)
  })

  it('fails CLOSED (true) when the function does not exist', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'function public.is_user_purchase_restricted(uuid) does not exist' },
    })
    expect(await isUserPurchaseRestricted(client, USER)).toBe(true)
  })

  it('fails CLOSED (true) when the RPC throws', async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error('network down')
      }),
    }
    expect(await isUserPurchaseRestricted(client, USER)).toBe(true)
  })

  it('fails CLOSED (true) on an unreadable result (null / string / number)', async () => {
    expect(await isUserPurchaseRestricted(clientReturning({ data: null, error: null }).client, USER)).toBe(true)
    expect(await isUserPurchaseRestricted(clientReturning({ data: 'nope', error: null }).client, USER)).toBe(true)
    expect(await isUserPurchaseRestricted(clientReturning({ data: 1, error: null }).client, USER)).toBe(true)
  })

  it('fails CLOSED (true) for a missing/blank userId WITHOUT calling the RPC', async () => {
    const { client, rpc } = clientReturning({ data: false, error: null })
    expect(await isUserPurchaseRestricted(client, null)).toBe(true)
    expect(await isUserPurchaseRestricted(client, undefined)).toBe(true)
    expect(await isUserPurchaseRestricted(client, '')).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never throws — always resolves to a boolean', async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error('unexpected')
      }),
    }
    await expect(isUserPurchaseRestricted(client, USER)).resolves.toBe(true)
  })
})

describe('exported contract constants', () => {
  it('exposes the stable client-safe error code and message', () => {
    expect(ACCOUNT_SELF_EXCLUDED_ERROR).toBe('ACCOUNT_SELF_EXCLUDED')
    expect(ACCOUNT_SELF_EXCLUDED_MESSAGE).toBe('Purchasing has been disabled on this account.')
  })
})
