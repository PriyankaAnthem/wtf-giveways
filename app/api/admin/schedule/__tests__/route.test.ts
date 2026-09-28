import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

/**
 * Chainable Supabase mock that records every table touched and every mutation
 * payload, so the isolation guarantee can be asserted rather than assumed.
 */
const tableResults: Record<string, any> = {}
const fromSpy = vi.fn()
const insertSpy = vi.fn()
const updateSpy = vi.fn()
const deleteSpy = vi.fn()
const eqSpy = vi.fn()
const gteSpy = vi.fn()
const lteSpy = vi.fn()
const rpcSpy = vi.fn()

function makeBuilder(table: string) {
  const result = () => tableResults[table] ?? { data: null, error: null }
  const builder: any = {
    select: vi.fn(() => builder),
    insert: vi.fn((payload: unknown) => {
      insertSpy(table, payload)
      return builder
    }),
    update: vi.fn((payload: unknown) => {
      updateSpy(table, payload)
      return builder
    }),
    delete: vi.fn(() => {
      deleteSpy(table)
      return builder
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqSpy(table, col, val)
      return builder
    }),
    gte: vi.fn((col: string, val: unknown) => {
      gteSpy(table, col, val)
      return builder
    }),
    lte: vi.fn((col: string, val: unknown) => {
      lteSpy(table, col, val)
      return builder
    }),
    order: vi.fn(() => builder),
    single: vi.fn(async () => result()),
    maybeSingle: vi.fn(async () => result()),
    then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      fromSpy(table)
      return makeBuilder(table)
    },
    rpc: (...a: unknown[]) => rpcSpy(...a),
  })),
}))

import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[id]/route'

const EVENT_ID = '3f4a1d2e-1b2c-4d5e-8f90-1a2b3c4d5e6f'
const ADMIN = { id: 'admin-user-1' }

const DB_ROW = {
  id: EVENT_ID,
  title: 'Cho Balloon Pop',
  event_type: 'balloon_pop',
  scheduled_date: '2026-09-12',
  // Postgres hands back HH:MM:SS.
  scheduled_time: '20:00:00',
  all_day: false,
  status: 'confirmed',
  notes: null,
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
}

const VALID_BODY = {
  title: 'Cho Balloon Pop',
  eventType: 'balloon_pop',
  scheduledDate: '2026-09-12',
  scheduledTime: '20:00',
  allDay: false,
  status: 'confirmed',
  notes: null,
}

function getReq(qs: string) {
  return { url: `http://x/api/admin/schedule?${qs}` } as unknown as Request
}
function bodyReq(body: unknown, malformed = false) {
  return {
    json: async () => {
      if (malformed) throw new Error('bad json')
      return body
    },
  } as unknown as Request
}
function ctx(id = EVENT_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(tableResults)) delete tableResults[k]
  authorizeAdminApi.mockResolvedValue({ user: ADMIN, error: null })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
})

describe('authorization — both admin and operations_admin may plan', () => {
  it('allows exactly admin and operations_admin on every verb', async () => {
    tableResults.admin_schedule_events = { data: [], error: null }
    await GET(getReq('from=2026-09-01&to=2026-09-30'))
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    await POST(bodyReq(VALID_BODY))
    await PATCH(bodyReq(VALID_BODY), ctx())
    tableResults.admin_schedule_events = { data: { id: EVENT_ID }, error: null }
    await DELETE({} as Request, ctx())

    expect(authorizeAdminApi).toHaveBeenCalledTimes(4)
    for (const call of authorizeAdminApi.mock.calls) {
      expect(call[1]).toEqual({ roles: ['admin', 'operations_admin'] })
    }
  })

  it('returns 401 when unauthenticated', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, error: 'Not authenticated' })
    for (const res of [
      await GET(getReq('from=2026-09-01&to=2026-09-30')),
      await POST(bodyReq(VALID_BODY)),
      await PATCH(bodyReq(VALID_BODY), ctx()),
      await DELETE({} as Request, ctx()),
    ]) {
      expect(res.status).toBe(401)
    }
  })

  it('returns 403 when authenticated but not permitted', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, error: 'Forbidden' })
    for (const res of [
      await GET(getReq('from=2026-09-01&to=2026-09-30')),
      await POST(bodyReq(VALID_BODY)),
      await PATCH(bodyReq(VALID_BODY), ctx()),
      await DELETE({} as Request, ctx()),
    ]) {
      expect(res.status).toBe(403)
    }
  })

  it('never touches the database when authorization fails', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, error: 'Forbidden' })
    await GET(getReq('from=2026-09-01&to=2026-09-30'))
    await POST(bodyReq(VALID_BODY))
    await PATCH(bodyReq(VALID_BODY), ctx())
    await DELETE({} as Request, ctx())
    expect(fromSpy).not.toHaveBeenCalled()
  })
})

describe('GET — bounded range', () => {
  it('returns serialized events for a valid month range', async () => {
    tableResults.admin_schedule_events = { data: [DB_ROW], error: null }
    const res = await GET(getReq('from=2026-09-01&to=2026-09-30'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.items).toHaveLength(1)
    // Serialized to camelCase with seconds stripped.
    expect(json.items[0]).toEqual({
      id: EVENT_ID,
      title: 'Cho Balloon Pop',
      eventType: 'balloon_pop',
      scheduledDate: '2026-09-12',
      scheduledTime: '20:00',
      allDay: false,
      status: 'confirmed',
      notes: null,
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
    })
    // The query is bounded by the requested range.
    expect(gteSpy).toHaveBeenCalledWith('admin_schedule_events', 'scheduled_date', '2026-09-01')
    expect(lteSpy).toHaveBeenCalledWith('admin_schedule_events', 'scheduled_date', '2026-09-30')
  })

  it('rejects a missing, malformed or impossible range', async () => {
    for (const qs of [
      '',
      'from=2026-09-01',
      'to=2026-09-30',
      'from=2026-9-1&to=2026-09-30',
      'from=2026-02-31&to=2026-03-05',
      'from=01/09/2026&to=30/09/2026',
    ]) {
      const res = await GET(getReq(qs))
      expect(res.status, qs).toBe(400)
      expect((await res.json()).error, qs).toBe('invalid_range')
    }
    // Nothing was queried for any rejected range.
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('rejects an inverted range', async () => {
    const res = await GET(getReq('from=2026-09-30&to=2026-09-01'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_range')
  })

  it('rejects a range wider than the cap so the table cannot be dumped', async () => {
    const res = await GET(getReq('from=2026-01-01&to=2026-12-31'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('range_too_large')
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('accepts a padded six-week grid range', async () => {
    tableResults.admin_schedule_events = { data: [], error: null }
    const res = await GET(getReq('from=2026-08-31&to=2026-10-11'))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('maps a database failure to a friendly code, not a raw error', async () => {
    tableResults.admin_schedule_events = { data: null, error: { message: 'connection reset' } }
    const res = await GET(getReq('from=2026-09-01&to=2026-09-30'))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('load_failed')
    expect(JSON.stringify(json)).not.toContain('connection reset')
  })

  it('sets no-store so planning data is never cached', async () => {
    tableResults.admin_schedule_events = { data: [], error: null }
    const res = await GET(getReq('from=2026-09-01&to=2026-09-30'))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('POST — create and duplicate', () => {
  it('creates an event and stamps created_by from the session', async () => {
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    const res = await POST(bodyReq(VALID_BODY))

    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    const [, payload] = insertSpy.mock.calls[0]
    expect(payload).toMatchObject({
      title: 'Cho Balloon Pop',
      event_type: 'balloon_pop',
      scheduled_date: '2026-09-12',
      scheduled_time: '20:00',
      all_day: false,
      status: 'confirmed',
      created_by: ADMIN.id,
    })
  })

  it('ignores a client-supplied created_by (audit fields are server-derived)', async () => {
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    await POST(bodyReq({ ...VALID_BODY, created_by: 'attacker', createdBy: 'attacker' }))
    const [, payload] = insertSpy.mock.calls[0]
    expect(payload.created_by).toBe(ADMIN.id)
  })

  it('ignores client-supplied id and timestamps', async () => {
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    await POST(
      bodyReq({
        ...VALID_BODY,
        id: 'forced-id',
        created_at: '1999-01-01T00:00:00Z',
        updated_at: '1999-01-01T00:00:00Z',
      }),
    )
    const [, payload] = insertSpy.mock.calls[0]
    expect(payload.id).toBeUndefined()
    expect(payload.created_at).toBeUndefined()
    expect(payload.updated_at).toBeUndefined()
  })

  it('clears the time for an all-day event so the DB CHECK cannot fire', async () => {
    tableResults.admin_schedule_events = { data: { ...DB_ROW, all_day: true, scheduled_time: null }, error: null }
    await POST(bodyReq({ ...VALID_BODY, allDay: true, scheduledTime: '20:00' }))
    const [, payload] = insertSpy.mock.calls[0]
    expect(payload.all_day).toBe(true)
    expect(payload.scheduled_time).toBeNull()
  })

  it('rejects malformed JSON', async () => {
    const res = await POST(bodyReq(null, true))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_payload')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['blank title', { ...VALID_BODY, title: '  ' }, 'title_required'],
    ['bad type', { ...VALID_BODY, eventType: 'nope' }, 'invalid_event_type'],
    ['bad status', { ...VALID_BODY, status: 'live' }, 'invalid_status'],
    ['impossible date', { ...VALID_BODY, scheduledDate: '2026-02-31' }, 'invalid_date'],
    ['timed with no time', { ...VALID_BODY, scheduledTime: null }, 'time_required'],
  ])('rejects %s without writing', async (_l, body, code) => {
    const res = await POST(bodyReq(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(code)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('maps an insert failure to save_failed without leaking details', async () => {
    tableResults.admin_schedule_events = { data: null, error: { message: 'constraint x violated' } }
    const res = await POST(bodyReq(VALID_BODY))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('save_failed')
    expect(JSON.stringify(json)).not.toContain('constraint x')
  })
})

describe('PATCH — edit one row', () => {
  it('updates only the target row and never rewrites created_by/created_at', async () => {
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    const res = await PATCH(bodyReq({ ...VALID_BODY, title: 'Renamed' }), ctx())

    expect(res.status).toBe(200)
    const [, payload] = updateSpy.mock.calls[0]
    expect(payload.title).toBe('Renamed')
    expect(payload.created_by).toBeUndefined()
    expect(payload.created_at).toBeUndefined()
    expect(payload.updated_at).toBeTruthy()
    // Scoped by primary key.
    expect(eqSpy).toHaveBeenCalledWith('admin_schedule_events', 'id', EVENT_ID)
  })

  it('rejects a non-uuid id without writing', async () => {
    const res = await PATCH(bodyReq(VALID_BODY), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_identifier')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns 404 when the row was deleted by someone else', async () => {
    tableResults.admin_schedule_events = { data: null, error: null }
    const res = await PATCH(bodyReq(VALID_BODY), ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('validates the body just like create', async () => {
    const res = await PATCH(bodyReq({ ...VALID_BODY, eventType: 'nope' }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_event_type')
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe('DELETE — remove one row', () => {
  it('deletes exactly the target row', async () => {
    tableResults.admin_schedule_events = { data: { id: EVENT_ID }, error: null }
    const res = await DELETE({} as Request, ctx())
    expect(res.status).toBe(200)
    expect((await res.json())).toEqual({ ok: true, id: EVENT_ID })
    expect(deleteSpy).toHaveBeenCalledWith('admin_schedule_events')
    expect(eqSpy).toHaveBeenCalledWith('admin_schedule_events', 'id', EVENT_ID)
  })

  it('rejects a non-uuid id without deleting', async () => {
    const res = await DELETE({} as Request, ctx('../../campaigns'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_identifier')
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('returns 404 when already gone', async () => {
    tableResults.admin_schedule_events = { data: null, error: null }
    const res = await DELETE({} as Request, ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('maps a delete failure to delete_failed', async () => {
    tableResults.admin_schedule_events = { data: null, error: { message: 'fk violation' } }
    const res = await DELETE({} as Request, ctx())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('delete_failed')
  })
})

/**
 * The core promise of this feature: the Schedule is additive and inert. These
 * tests fail loudly if any future edit makes a schedule route read or write a
 * live WTF table, or call an RPC.
 */
describe('ISOLATION — the Schedule touches nothing else in WTF', () => {
  const FORBIDDEN = [
    'campaigns',
    'competitions',
    'tickets',
    'entries',
    'orders',
    'payments',
    'instant_wins',
    'instant_win_prizes',
    'draws',
    'winners',
    'hosts',
    'host_earnings',
    'wallets',
    'wallet_transactions',
    'payouts',
    'profiles',
    'users',
    'discount_codes',
    'marketing_campaigns',
    'homepage_settings',
    'audit_logs',
  ]

  it('only ever queries admin_schedule_events across every verb', async () => {
    tableResults.admin_schedule_events = { data: [DB_ROW], error: null }
    await GET(getReq('from=2026-09-01&to=2026-09-30'))
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    await POST(bodyReq(VALID_BODY))
    await PATCH(bodyReq(VALID_BODY), ctx())
    tableResults.admin_schedule_events = { data: { id: EVENT_ID }, error: null }
    await DELETE({} as Request, ctx())

    const touched = [...new Set(fromSpy.mock.calls.map((c) => c[0]))]
    expect(touched).toEqual(['admin_schedule_events'])
    for (const t of FORBIDDEN) {
      expect(touched, t).not.toContain(t)
    }
  })

  it('never invokes an RPC (no draw, payout or wallet side effects)', async () => {
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    await POST(bodyReq(VALID_BODY))
    await PATCH(bodyReq(VALID_BODY), ctx())
    tableResults.admin_schedule_events = { data: { id: EVENT_ID }, error: null }
    await DELETE({} as Request, ctx())
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('only ever mutates admin_schedule_events', async () => {
    tableResults.admin_schedule_events = { data: DB_ROW, error: null }
    await POST(bodyReq(VALID_BODY))
    await PATCH(bodyReq(VALID_BODY), ctx())
    tableResults.admin_schedule_events = { data: { id: EVENT_ID }, error: null }
    await DELETE({} as Request, ctx())

    for (const spy of [insertSpy, updateSpy]) {
      for (const [table] of spy.mock.calls) expect(table).toBe('admin_schedule_events')
    }
    for (const [table] of deleteSpy.mock.calls) expect(table).toBe('admin_schedule_events')
  })
})
