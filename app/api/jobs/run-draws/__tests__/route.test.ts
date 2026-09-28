import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const refreshWinnerDownstream = vi.fn()
vi.mock('@/lib/server/winner-draw-refresh', () => ({
  refreshWinnerDownstream: (...args: unknown[]) => refreshWinnerDownstream(...args),
}))

/**
 * Chainable Supabase mock.
 *
 * `campaignBatches` is a queue: the worker drains batches until one comes back
 * empty, so every test pushes its batch followed by an implicit empty batch.
 * `updateSpy` records each campaigns UPDATE so tests can assert exactly which
 * status transition happened (or that none did).
 */
let campaignBatches: any[][] = []
let entriesResult: any = { data: [], error: null }
let campaignUpdateResult: any = { error: null }
const updateSpy = vi.fn()
const rpc = vi.fn()

function makeBuilder(table: string) {
  const state = { isUpdate: false }
  const b: any = {
    select: vi.fn(() => b),
    or: vi.fn(() => b),
    not: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    eq: vi.fn(() => b),
    update: vi.fn((payload: any) => {
      state.isUpdate = true
      updateSpy(table, payload)
      return b
    }),
    then: (resolve: any, reject: any) => {
      let result: any
      if (table === 'campaigns' && state.isUpdate) {
        result = campaignUpdateResult
      } else if (table === 'campaigns') {
        result = { data: campaignBatches.shift() ?? [], error: null }
      } else if (table === 'entries') {
        result = entriesResult
      } else {
        result = { data: null, error: null }
      }
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => makeBuilder(table),
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}))

import { GET } from '../route'

const PAST = new Date(Date.now() - 60_000).toISOString()

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'camp-1',
    title: 'Campaign',
    slug: 'campaign',
    status: 'live',
    end_at: PAST,
    main_prize_title: 'Car',
    max_tickets_total: 1000,
    end_draw_mode: 'automatic',
    ...overrides,
  }
}

function req() {
  const url = 'http://x/api/jobs/run-draws?token=cron-secret'
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as Parameters<typeof GET>[0]
}

/** Statuses written to the campaigns table during the run. */
function statusUpdates() {
  return updateSpy.mock.calls.filter((c) => c[0] === 'campaigns' && 'status' in c[1]).map((c) => c[1].status)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.CRON_SECRET = 'cron-secret'
  campaignBatches = []
  entriesResult = { data: [{ qty: 5 }, { qty: 3 }], error: null }
  campaignUpdateResult = { error: null }
  refreshWinnerDownstream.mockResolvedValue([])
  rpc.mockResolvedValue({
    data: { ok: true, already_drawn: false, user_id: 'u1', winning_ticket: 3 },
    error: null,
  })
})

describe('GET /api/jobs/run-draws', () => {
  it('rejects an unauthorized caller', async () => {
    const res = await GET({ headers: new Headers(), nextUrl: new URL('http://x/api/jobs/run-draws') } as any)
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  describe('automatic mode', () => {
    it('draws via the RPC and then ends the campaign', async () => {
      campaignBatches = [[campaign()]]
      const res = await GET(req())
      const body = await res.json()

      expect(rpc).toHaveBeenCalledWith('draw_campaign_winner', { p_campaign_id: 'camp-1' })
      expect(statusUpdates()).toEqual(['ended'])
      expect(body.drawn).toBe(1)
      expect(body.ended).toBe(1)
      expect(body.awaitingManualDraw).toBe(0)
    })

    it('treats a null end_draw_mode as automatic (legacy campaigns)', async () => {
      campaignBatches = [[campaign({ end_draw_mode: null })]]
      const body = await (await GET(req())).json()
      expect(rpc).toHaveBeenCalledTimes(1)
      expect(body.drawn).toBe(1)
    })

    it('does NOT end the campaign when the draw fails, so it retries next run', async () => {
      campaignBatches = [[campaign()]]
      rpc.mockResolvedValue({ data: null, error: { message: 'deadlock' } })

      const body = await (await GET(req())).json()

      // The critical regression guard: never mark ended without a resolved draw,
      // because the eligibility query permanently excludes ended campaigns.
      expect(statusUpdates()).not.toContain('ended')
      expect(body.ended).toBe(0)
      expect(body.errors.join(' ')).toContain('draw rpc failed')
    })

    // The function RAISES these (SQLSTATE P0001) rather than returning
    // ok = false, so they arrive as a Postgres error, not as data.
    it.each(['no_tickets_sold', 'winner_allocation_not_found', 'winner_entry_not_found'])(
      'does NOT end the campaign when the draw raises %s',
      async (raised) => {
        campaignBatches = [[campaign()]]
        rpc.mockResolvedValue({ data: null, error: { message: raised } })

        const body = await (await GET(req())).json()
        expect(statusUpdates()).not.toContain('ended')
        expect(body.ended).toBe(0)
        expect(body.drawn).toBe(0)
        expect(body.errors.join(' ')).toContain(raised)
      },
    )

    it('does NOT end the campaign if the contract ever returns ok = false', async () => {
      campaignBatches = [[campaign()]]
      rpc.mockResolvedValue({ data: { ok: false, error: 'unexpected' }, error: null })

      const body = await (await GET(req())).json()
      expect(statusUpdates()).not.toContain('ended')
      expect(body.ended).toBe(0)
    })

    it('ends the campaign but does not double-count an already-drawn winner', async () => {
      campaignBatches = [[campaign()]]
      rpc.mockResolvedValue({ data: { ok: true, already_drawn: true }, error: null })

      const body = await (await GET(req())).json()
      expect(statusUpdates()).toEqual(['ended'])
      expect(body.ended).toBe(1)
      expect(body.drawn).toBe(0)
    })
  })

  describe('manual mode', () => {
    it('ends the campaign WITHOUT drawing a winner', async () => {
      campaignBatches = [[campaign({ end_draw_mode: 'manual' })]]
      const body = await (await GET(req())).json()

      // The whole point of the feature: no automatic winner selection.
      expect(rpc).not.toHaveBeenCalled()
      expect(statusUpdates()).toEqual(['ended'])
      expect(body.ended).toBe(1)
      expect(body.awaitingManualDraw).toBe(1)
      expect(body.drawn).toBe(0)
    })

    it('still refreshes snapshots so the closed state is published', async () => {
      campaignBatches = [[campaign({ end_draw_mode: 'manual' })]]
      await GET(req())
      expect(refreshWinnerDownstream).toHaveBeenCalledTimes(1)
    })

    it('does not count the campaign as ended when the close fails', async () => {
      campaignBatches = [[campaign({ end_draw_mode: 'manual' })]]
      campaignUpdateResult = { error: { message: 'write conflict' } }

      const body = await (await GET(req())).json()
      expect(rpc).not.toHaveBeenCalled()
      expect(body.awaitingManualDraw).toBe(0)
    })

    it('is applied to sold-out campaigns too, not just past-end ones', async () => {
      campaignBatches = [
        [
          campaign({
            end_draw_mode: 'manual',
            status: 'sold_out',
            end_at: new Date(Date.now() + 86_400_000).toISOString(),
          }),
        ],
      ]
      const body = await (await GET(req())).json()
      expect(rpc).not.toHaveBeenCalled()
      expect(body.awaitingManualDraw).toBe(1)
    })
  })

  describe('shared guards (unchanged by draw mode)', () => {
    it('extends a zero-sales campaign instead of drawing it', async () => {
      campaignBatches = [[campaign()]]
      entriesResult = { data: [], error: null }

      const body = await (await GET(req())).json()
      expect(rpc).not.toHaveBeenCalled()
      expect(body.extended).toBe(1)
      expect(body.ended).toBe(0)
    })

    it('extends a zero-sales manual campaign too', async () => {
      campaignBatches = [[campaign({ end_draw_mode: 'manual' })]]
      entriesResult = { data: [], error: null }

      const body = await (await GET(req())).json()
      expect(rpc).not.toHaveBeenCalled()
      expect(body.extended).toBe(1)
      expect(body.awaitingManualDraw).toBe(0)
    })

    it('skips a campaign that is not yet eligible', async () => {
      campaignBatches = [
        [campaign({ end_at: new Date(Date.now() + 86_400_000).toISOString(), status: 'live' })],
      ]
      const body = await (await GET(req())).json()
      expect(rpc).not.toHaveBeenCalled()
      expect(body.ended).toBe(0)
    })

    it('marks a hard-capped campaign sold_out before drawing', async () => {
      campaignBatches = [[campaign({ max_tickets_total: 8 })]]
      const body = await (await GET(req())).json()
      expect(statusUpdates()).toEqual(['sold_out', 'ended'])
      expect(body.drawn).toBe(1)
    })
  })
})
