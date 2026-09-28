/**
 * Route-level tests for the Acquired checkout PAYMENT-NAME GATE.
 *
 * Scope is deliberately narrow: the name resolution / persistence behaviour of
 * `POST /api/payments/acquired/create-checkout`. Wallet, discount, quantity and
 * Acquired-reference logic are only asserted as *unchanged side-effects* (i.e.
 * that this gate does not release a reservation or create a session).
 *
 * Everything external is mocked — no network, no Supabase, no migrations.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Safe as a static import: the `vi.mock` factories below are hoisted above it,
// matching the convention used by the other route tests in this repo.
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Mock state (re-initialised per test)
// ---------------------------------------------------------------------------

interface AuthUserFixture {
  id: string
  email?: string
  user_metadata: Record<string, unknown>
}

let authUser: AuthUserFixture
let intentRow: Record<string, unknown> | null
/** Every table the route touched, with the operation performed. */
let tableOps: Array<{ table: string; op: 'select' | 'update' }>
/** Service-role RPCs (wallet release shows up here). */
let rpcCalls: string[]
/** user_metadata payloads passed to updateUserById. */
let metadataWrites: Array<Record<string, unknown>>
/** Forced failure for the metadata write. */
let metadataUpdateError: { code?: string; message?: string } | null
/** Session user id returned by the authed client (ownership check). */
let sessionUserId: string | null
/** Acquired endpoints hit, in order. */
let fetchedPaths: string[]

/**
 * Chainable Supabase query-builder stub.
 *
 * A Proxy is used so ANY filter/modifier the route calls (eq, neq, not, gt, in,
 * order, limit, ...) returns the same builder — the test never has to track the
 * route's exact chain shape. Only `select`/`update` are recorded (that is what
 * the profiles_private assertions rely on), and the terminal methods resolve
 * the fixture row.
 */
function makeQuery(table: string, rowFor: (t: string) => unknown) {
  const terminal = {
    single: async () => {
      const row = rowFor(table)
      return { data: row, error: row ? null : { message: 'not found' } }
    },
    maybeSingle: async () => ({ data: rowFor(table), error: null }),
    // `await`ing the builder directly (an update with no .select()) resolves.
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  } as Record<string, unknown>

  const builder: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(builder, {
    get(_target, prop: string) {
      if (prop in terminal) return terminal[prop]
      return (..._args: unknown[]) => {
        if (prop === 'select') tableOps.push({ table, op: 'select' })
        if (prop === 'update') tableOps.push({ table, op: 'update' })
        return proxy
      }
    },
  })
  return proxy
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) =>
      makeQuery(table, (t) => {
        if (t === 'checkout_intents') return intentRow
        // No stored provider_customer_id -> the route resolves a name.
        if (t === 'acquired_customers' || t === 'payment_customers') return null
        return null
      }),
    rpc: vi.fn(async (name: string) => {
      rpcCalls.push(name)
      return { data: null, error: null }
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: authUser }, error: null })),
        updateUserById: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
          if (metadataUpdateError) return { data: null, error: metadataUpdateError }
          metadataWrites.push(payload.user_metadata as Record<string, unknown>)
          authUser.user_metadata = payload.user_metadata as Record<string, unknown>
          return { data: { user: authUser }, error: null }
        }),
      },
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: sessionUserId ? { id: sessionUserId } : null },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/account-restrictions', () => ({
  isUserPurchaseRestricted: async () => false,
  ACCOUNT_SELF_EXCLUDED_ERROR: 'account_self_excluded',
  ACCOUNT_SELF_EXCLUDED_MESSAGE: 'blocked',
}))

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://wtf.test/api/payments/acquired/create-checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  process.env.ACQUIRED_APP_ID = 'app-id'
  process.env.ACQUIRED_APP_KEY = 'app-key'
  process.env.ACQUIRED_COMPANY_ID = 'company-id'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

  authUser = { id: 'user-1', email: 'a@b.test', user_metadata: {} }
  intentRow = {
    id: 'intent-1',
    ref: 'ref-1',
    user_id: 'user-1',
    total_pence: 1000,
    currency: 'GBP',
    state: 'pending',
    campaign_id: 'camp-1',
    provider_customer_id: null,
    // Echoed back by the terminal `update().select().maybeSingle()` so the
    // route's own success check passes. Not read by the name gate.
    provider_session_id: 'link-1',
    wallet_credit_requested: false,
    wallet_credit_pence: 0,
    external_payment_pence: 1000,
  }
  tableOps = []
  rpcCalls = []
  metadataWrites = []
  metadataUpdateError = null
  sessionUserId = 'user-1'
  fetchedPaths = []

  // Acquired stub: login succeeds; customer + payment-link succeed so an
  // accepted name runs all the way to a checkout_url.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(String(url)).pathname
      fetchedPaths.push(path)
      if (path.endsWith('/v1/login')) {
        return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 })
      }
      if (path.endsWith('/v1/customers')) {
        return new Response(JSON.stringify({ customer_id: 'cust-1' }), { status: 200 })
      }
      if (path.endsWith('/v1/payment-links')) {
        return new Response(JSON.stringify({ link_id: 'link-1' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }),
  )
})

const createdCustomer = () => fetchedPaths.some((p) => p.endsWith('/v1/customers'))
const createdSession = () => fetchedPaths.some((p) => p.endsWith('/v1/payment-links'))
const touched = (table: string, op: 'select' | 'update') =>
  tableOps.some((t) => t.table === table && t.op === op)

// ---------------------------------------------------------------------------

describe('stored-name gate (no inference from legacy display fields)', () => {
  it('1) proceeds to Acquired when first + last are both in auth metadata', async () => {
    authUser.user_metadata = { first_name: 'Ada', last_name: 'Lovelace' }
    const res = await post({ ref: 'ref-1' })
    expect(res.status).toBe(200)
    expect(createdCustomer()).toBe(true)
    expect(createdSession()).toBe(true)
  })

  it('2) requires ONLY last_name when the first name is stored, and returns it for prefill', async () => {
    authUser.user_metadata = { first_name: 'Ada' }
    const res = await post({ ref: 'ref-1' })
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toBe('customer_name_required')
    expect(json.requiredFields).toEqual(['last_name'])
    expect(json.knownFields).toEqual({ first_name: 'Ada' })
  })

  it('3) requires ONLY first_name when the surname is stored', async () => {
    authUser.user_metadata = { last_name: 'Lovelace' }
    const res = await post({ ref: 'ref-1' })
    const json = await res.json()
    expect(json.requiredFields).toEqual(['first_name'])
    expect(json.knownFields).toEqual({ last_name: 'Lovelace' })
  })

  it('4) requires BOTH when the account has no explicit name', async () => {
    authUser.user_metadata = {}
    const res = await post({ ref: 'ref-1' })
    const json = await res.json()
    expect(json.requiredFields).toEqual(['first_name', 'last_name'])
    expect(json.knownFields).toEqual({})
  })

  it('5+6) never turns real_name into a payment name (single OR two word)', async () => {
    for (const realName of ['bengovier', 'Ben Govier']) {
      tableOps = []
      fetchedPaths = []
      authUser.user_metadata = {}
      // Even if the legacy column existed, it is never read...
      const res = await post({ ref: 'ref-1', __realName: realName })
      const json = await res.json()
      expect(res.status).toBe(422)
      expect(json.requiredFields).toEqual(['first_name', 'last_name'])
      expect(json.knownFields).toEqual({})
      expect(createdCustomer()).toBe(false)
      // ...and profiles_private is not consulted as a name source at all.
      expect(touched('profiles_private', 'select')).toBe(false)
    }
  })

  it('7) never turns display_name into a payment name', async () => {
    authUser.user_metadata = { display_name: 'Ben Govier' }
    const res = await post({ ref: 'ref-1' })
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.requiredFields).toEqual(['first_name', 'last_name'])
    expect(json.knownFields).toEqual({})
    expect(createdCustomer()).toBe(false)
  })

  it('10) never reads or writes profiles_private on the 422 path', async () => {
    authUser.user_metadata = {}
    await post({ ref: 'ref-1' })
    expect(touched('profiles_private', 'select')).toBe(false)
    expect(touched('profiles_private', 'update')).toBe(false)
  })

  it('16+17) keeps the wallet reservation and creates no Acquired session', async () => {
    authUser.user_metadata = {}
    await post({ ref: 'ref-1' })
    // No wallet release RPC, and no customer/payment-link created.
    expect(rpcCalls).not.toContain('wallet_release_checkout_reservation')
    expect(createdCustomer()).toBe(false)
    expect(createdSession()).toBe(false)
  })
})

describe('submitted-name path', () => {
  it('8) accepts a manually supplied valid name and continues to payment', async () => {
    authUser.user_metadata = {}
    const res = await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })
    expect(res.status).toBe(200)
    expect(createdSession()).toBe(true)
  })

  it('9+11) persists the name while preserving unrelated metadata', async () => {
    authUser.user_metadata = { display_name: 'bengovier', mobile: '07000 000000' }
    const res = await post({ ref: 'ref-1', firstName: 'Ben', lastName: 'Govier' })
    expect(res.status).toBe(200)
    expect(metadataWrites).toHaveLength(1)
    expect(metadataWrites[0]).toEqual({
      display_name: 'bengovier',
      mobile: '07000 000000',
      first_name: 'Ben',
      last_name: 'Govier',
    })
  })

  it('10) does not write profiles_private when saving the name', async () => {
    authUser.user_metadata = {}
    await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })
    expect(touched('profiles_private', 'update')).toBe(false)
  })

  it('12) continues the payment when the metadata write FAILS', async () => {
    authUser.user_metadata = {}
    metadataUpdateError = { code: 'unexpected_failure', message: 'db unavailable' }
    const res = await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })
    expect(res.status).toBe(200)
    expect(createdSession()).toBe(true)
    // Nothing persisted, but the validated submitted name was still used.
    expect(metadataWrites).toHaveLength(0)
    const customerCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).endsWith('/v1/customers'),
    )
    const sent = JSON.parse(String((customerCall?.[1] as RequestInit)?.body))
    expect(sent.first_name).toBe('Ada')
    expect(sent.last_name).toBe('Lovelace')
  })

  it('13) rejects an invalid submitted name without creating a customer', async () => {
    authUser.user_metadata = {}
    const res = await post({ ref: 'ref-1', firstName: 'Ada', lastName: '12345' })
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toBe('customer_name_invalid')
    expect(json.requiredFields).toEqual(['last_name'])
    // The valid half is echoed back so the customer does not retype it.
    expect(json.knownFields).toEqual({ first_name: 'Ada' })
    expect(createdCustomer()).toBe(false)
    expect(metadataWrites).toHaveLength(0)
  })

  it('14) rejects an ownership mismatch with no write and no customer', async () => {
    authUser.user_metadata = {}
    sessionUserId = 'someone-else'
    const res = await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })
    expect(res.status).toBe(403)
    expect(metadataWrites).toHaveLength(0)
    expect(createdCustomer()).toBe(false)
    expect(createdSession()).toBe(false)
  })

  it('14b) rejects an unauthenticated name submission', async () => {
    sessionUserId = null
    const res = await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })
    expect(res.status).toBe(401)
    expect(metadataWrites).toHaveLength(0)
    expect(createdCustomer()).toBe(false)
  })

  it('15) leaves existing intent validation (idempotency) intact', async () => {
    // A non-pending intent is still refused with 409 before any name handling.
    intentRow = { ...(intentRow as Record<string, unknown>), state: 'paid' }
    const res = await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })
    expect(res.status).toBe(409)
    expect(createdCustomer()).toBe(false)
    expect(metadataWrites).toHaveLength(0)
  })
})

describe('logging safety', () => {
  it('never serialises sessions, tokens, cookies or raw metadata on persist failure', async () => {
    authUser.user_metadata = { display_name: 'bengovier', mobile: '07000 000000' }
    metadataUpdateError = { code: 'unexpected_failure', message: 'db unavailable' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await post({ ref: 'ref-1', firstName: 'Ada', lastName: 'Lovelace' })

    const serialised = warn.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(serialised).toContain('checkout_payment_name_persist_failed')
    for (const secret of [
      'access_token',
      'refresh_token',
      'cookie',
      'authorization',
      'service-key',
      'token',
      '07000 000000',
      'bengovier',
      'a@b.test',
      'Ada',
      'Lovelace',
    ]) {
      expect(serialised.toLowerCase()).not.toContain(secret.toLowerCase())
    }
  })
})
