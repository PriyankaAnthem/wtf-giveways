import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const authorizeAdminApi = vi.fn()
vi.mock('@/lib/admin/auth', () => ({
  authorizeAdminApi: (...args: unknown[]) => authorizeAdminApi(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ __userScoped: true })),
}))

const refreshWinnerDownstream = vi.fn()
vi.mock('@/lib/server/winner-draw-refresh', () => ({
  refreshWinnerDownstream: (...args: unknown[]) => refreshWinnerDownstream(...args),
}))

/**
 * Table-aware chainable Supabase mock. Every builder method returns `this`, and
 * the object is awaitable so both `.maybeSingle()` and a bare `await` on a
 * `{ count, head }` select resolve correctly.
 */
const tableResults: Record<string, any> = {}
const rpc = vi.fn()
const fromSpy = vi.fn()

function makeBuilder(table: string) {
  const result = () => tableResults[table] ?? { data: null, error: null, count: 0 }
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
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
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}))

import { POST } from '../route'

const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'

function ctx(id = CAMPAIGN_ID) {
  return { params: Promise.resolve({ id }) }
}
function req() {
  const url = `http://x/api/admin/campaigns/${CAMPAIGN_ID}/draw`
  // Route handlers receive a NextRequest, which exposes `nextUrl`. A plain
  // Request does not, so provide it for the origin lookup.
  return {
    method: 'POST',
    url,
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as Parameters<typeof POST>[0]
}

/** Happy-path fixture: closed manual campaign, tickets issued, no winner yet. */
function setupDrawable() {
  tableResults.campaigns = {
    data: { id: CAMPAIGN_ID, slug: 'c', title: 'C', status: 'ended', end_draw_mode: 'manual' },
    error: null,
  }
  tableResults.ticket_allocations = { count: 500, error: null }
  tableResults.winner_records = { data: null, error: null }
  rpc.mockResolvedValue({
    data: {
      ok: true,
      already_drawn: false,
      winner_record_id: 'wr-1',
      user_id: 'user-1',
      winning_ticket: 42,
      total_tickets: 500,
      prize_title: 'Car',
    },
    error: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(tableResults)) delete tableResults[k]
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.CRON_SECRET = 'cron-secret'
  authorizeAdminApi.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin', error: null })
  refreshWinnerDownstream.mockResolvedValue([])
})

describe('POST /api/admin/campaigns/[id]/draw', () => {
  it('rejects unauthenticated with 401 and never draws', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authenticated' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a non-admin with 403 and never draws', async () => {
    authorizeAdminApi.mockResolvedValue({ user: null, role: null, error: 'Not authorized' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a malformed campaign id with 400 and never draws', async () => {
    const res = await POST(req(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 404 when the campaign does not exist', async () => {
    tableResults.campaigns = { data: null, error: null }
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to draw an AUTOMATIC campaign', async () => {
    setupDrawable()
    tableResults.campaigns = {
      data: { id: CAMPAIGN_ID, status: 'ended', end_draw_mode: 'automatic' },
      error: null,
    }
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to draw a manual campaign that is still live', async () => {
    setupDrawable()
    tableResults.campaigns = {
      data: { id: CAMPAIGN_ID, status: 'live', end_draw_mode: 'manual' },
      error: null,
    }
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to draw when no tickets were issued', async () => {
    setupDrawable()
    tableResults.ticket_allocations = { count: 0, error: null }
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('is non-destructive when a main winner already exists', async () => {
    setupDrawable()
    tableResults.winner_records = {
      data: { id: 'wr-existing', user_id: 'u9', prize_title: 'Car', announced_at: 'x' },
      error: null,
    }
    const res = await POST(req(), ctx())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.alreadyDrawn).toBe(true)
    // The critical assertion: no second draw is attempted.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('draws via draw_campaign_winner and returns the winner', async () => {
    setupDrawable()
    const res = await POST(req(), ctx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.alreadyDrawn).toBe(false)
    expect(body.winner).toMatchObject({ user_id: 'user-1', winning_ticket: 42 })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('draw_campaign_winner', { p_campaign_id: CAMPAIGN_ID })
  })

  it('never passes a force/bypass flag to the RPC', async () => {
    setupDrawable()
    await POST(req(), ctx())
    const [, args] = rpc.mock.calls[0]
    expect(Object.keys(args as object)).toEqual(['p_campaign_id'])
  })

  it('refreshes downstream snapshots after a successful draw', async () => {
    setupDrawable()
    await POST(req(), ctx())
    expect(refreshWinnerDownstream).toHaveBeenCalledTimes(1)
  })

  it('still succeeds when the downstream refresh fails', async () => {
    setupDrawable()
    refreshWinnerDownstream.mockResolvedValue(['snapshot boom'])
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
  })

  // draw_campaign_winner RAISES on failure (SQLSTATE P0001); it does not return
  // ok = false. These assert the raised-message translation.
  it.each([
    ['no_tickets_sold', 'no issued tickets'],
    ['winner_allocation_not_found', 'could not be matched to an entry'],
    ['winner_entry_not_found', 'no associated customer'],
  ])('translates raised %s into an actionable 409', async (raised, expected) => {
    setupDrawable()
    rpc.mockResolvedValue({ data: null, error: { message: raised } })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe(raised)
    expect(body.error).toContain(expected)
  })

  it('does not report a winner when the draw raises', async () => {
    setupDrawable()
    rpc.mockResolvedValue({ data: null, error: { message: 'no_tickets_sold' } })
    const body = await (await POST(req(), ctx())).json()
    expect(body.winner).toBeUndefined()
    expect(refreshWinnerDownstream).not.toHaveBeenCalled()
  })

  it('returns 500 for an unrecognised database error', async () => {
    setupDrawable()
    rpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected' } })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
  })

  it('only ever queries the three expected tables', async () => {
    setupDrawable()
    await POST(req(), ctx())
    const tables = new Set(fromSpy.mock.calls.map((c) => c[0]))
    expect(tables).toEqual(new Set(['campaigns', 'ticket_allocations', 'winner_records']))
  })
})
