import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

// Chainable stub recording every .eq() filter and .update() payload, so we can
// prove the mutation is scoped to exactly one opportunity_key.
const eqCalls: Array<[string, unknown]> = []
const updatePayloads: Array<Record<string, unknown>> = []
const fromCalls: string[] = []
let updateResult: { data: unknown; error: unknown } = {
  data: {
    opportunity_key: 'abandoned_checkout',
    display_name: 'Abandoned checkout',
    family: 'commerce',
    default_priority: 2,
    default_score: 50,
    default_expiry_hours: 72,
    enabled: false,
  },
  error: null,
}

function makeServiceClient() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn((t: string) => {
    fromCalls.push(t)
    return chain
  })
  chain.select = vi.fn(() => chain)
  chain.update = (payload: Record<string, unknown>) => {
    updatePayloads.push(payload)
    return chain
  }
  chain.eq = (col: string, val: unknown) => {
    eqCalls.push([col, val])
    return chain
  }
  chain.maybeSingle = vi.fn(async () => updateResult)
  return chain
}
let serviceClient = makeServiceClient()

vi.mock('@/lib/admin/marketing/ops-queries', () => ({
  getServiceSupabase: () => serviceClient,
  serializeOpsDefinition: (row: Record<string, unknown>) => ({
    opportunityKey: row.opportunity_key,
    enabled: row.enabled,
  }),
}))

import { PATCH } from '../route'

function req(body: unknown) {
  return new Request('http://test/api/admin/marketing/ops/definition', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authorizeAdminApi.mockReset()
  eqCalls.length = 0
  updatePayloads.length = 0
  fromCalls.length = 0
  updateResult = {
    data: {
      opportunity_key: 'abandoned_checkout',
      display_name: 'Abandoned checkout',
      family: 'commerce',
      default_priority: 2,
      default_score: 50,
      default_expiry_hours: 72,
      enabled: false,
    },
    error: null,
  }
  serviceClient = makeServiceClient()
  authorizeAdminApi.mockResolvedValue({ user: { id: 'u1' }, role: 'admin', error: null })
})

describe('authorization', () => {
  it('rejects unauthenticated with 401 and never mutates', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await PATCH(req({ opportunityKey: 'abandoned_checkout', enabled: true }))
    expect(res.status).toBe(401)
    expect(updatePayloads.length).toBe(0)
  })
  it('rejects a non-admin with 403', async () => {
    authorizeAdminApi.mockResolvedValue({ user: { id: 'x' }, role: 'operations_admin', error: 'Not authorized' })
    const res = await PATCH(req({ opportunityKey: 'abandoned_checkout', enabled: true }))
    expect(res.status).toBe(403)
    expect(updatePayloads.length).toBe(0)
  })
})

describe('narrow scoping + no delivery side effects', () => {
  // opportunity_key is data-driven (not a fixed enum like automations), so the
  // route validates its TOKEN FORMAT: a malformed key is rejected outright with
  // 400 and no mutation, while a well-formed-but-nonexistent key is a 404 (see
  // the "returns 404" case below).
  it('rejects a MALFORMED opportunity key with 400 and no mutation', async () => {
    const res = await PATCH(req({ opportunityKey: 'Not A Real Key!', enabled: true }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_opportunity_key' })
    expect(updatePayloads.length).toBe(0)
  })

  it('toggles exactly the requested opportunity_key, writing only enabled/updated_at', async () => {
    const res = await PATCH(req({ opportunityKey: 'abandoned_checkout', enabled: true }))
    expect(res.status).toBe(200)
    expect(updatePayloads.length).toBe(1)
    expect(updatePayloads[0].enabled).toBe(true)
    expect(eqCalls).toContainEqual(['opportunity_key', 'abandoned_checkout'])
    expect(Object.keys(updatePayloads[0]).sort()).toEqual(['enabled', 'updated_at'])
  })

  it('only ever touches the definitions table — never recipients/opportunities/control', async () => {
    await PATCH(req({ opportunityKey: 'abandoned_checkout', enabled: true }))
    expect(fromCalls).toEqual(['marketing_opportunity_definitions'])
    expect(fromCalls).not.toContain('marketing_recipients')
    expect(fromCalls).not.toContain('marketing_opportunities')
    expect(fromCalls).not.toContain('marketing_control_state')
  })

  it('returns 404 when the key validates but no row matched', async () => {
    updateResult = { data: null, error: null }
    const res = await PATCH(req({ opportunityKey: 'abandoned_checkout', enabled: false }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
