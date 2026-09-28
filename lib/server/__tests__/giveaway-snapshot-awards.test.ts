import { describe, it, expect, vi } from 'vitest'
import {
  loadCampaignAwardCounts,
  AWARD_PAGE_SIZE,
} from '@/lib/server/giveaway-snapshot-awards'

/**
 * Build a fake Supabase query builder that mimics the exact chain the helper
 * uses: .from().select().order().eq().range(from, to) -> Promise<{ data, error }>.
 *
 * `rows` is the COMPLETE ordered result set for the campaign. `.range(from, to)`
 * returns rows.slice(from, to + 1) — inclusive indexes — which is precisely how
 * PostgREST behaves. `errorAtFrom` optionally injects an error when a page whose
 * starting offset equals that value is requested.
 */
function makeFakeSupabase(
  rows: Array<{ id: string; prize_id: string | null }>,
  opts?: { errorAtFrom?: number },
) {
  const rangeCalls: Array<{ from: number; to: number }> = []

  const builder: any = {
    _from: null as number | null,
    _to: null as number | null,
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      rangeCalls.push({ from, to })
      if (opts?.errorAtFrom !== undefined && from === opts.errorAtFrom) {
        return Promise.resolve({
          data: null,
          error: { message: `injected failure at range ${from}-${to}` },
        })
      }
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    }),
  }

  return { supabase: builder, rangeCalls }
}

/** Generate `n` award rows spread deterministically across `prizeIds`. */
function makeRows(n: number, prizeIds: string[] = ['prize-a']) {
  return Array.from({ length: n }, (_, i) => ({
    id: `award-${String(i).padStart(6, '0')}`,
    prize_id: prizeIds[i % prizeIds.length],
  }))
}

describe('loadCampaignAwardCounts — pagination correctness', () => {
  it('returns zero counts when there are no awards (single empty page)', async () => {
    const { supabase, rangeCalls } = makeFakeSupabase([])
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')

    expect(result.totalAwards).toBe(0)
    expect(result.prizeIdCount).toBe(0)
    expect(result.awardCountByPrize).toEqual({})
    expect(result.pageCount).toBe(1)
    expect(rangeCalls).toEqual([{ from: 0, to: AWARD_PAGE_SIZE - 1 }])
  })

  it('handles fewer than one page of awards in a single request', async () => {
    const { supabase, rangeCalls } = makeFakeSupabase(makeRows(500))
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')

    expect(result.totalAwards).toBe(500)
    expect(result.awardCountByPrize).toEqual({ 'prize-a': 500 })
    expect(result.pageCount).toBe(1)
    expect(rangeCalls.length).toBe(1)
  })

  it('fetches a trailing empty page when the total is exactly one page', async () => {
    const { supabase, rangeCalls } = makeFakeSupabase(makeRows(1000))
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')

    expect(result.totalAwards).toBe(1000)
    // 1000 == pageSize, so the loop must request a second (empty) page to stop.
    expect(result.pageCount).toBe(2)
    expect(rangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ])
  })

  it('fetches a second partial page for 1001 awards', async () => {
    const { supabase, rangeCalls } = makeFakeSupabase(makeRows(1001))
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')

    expect(result.totalAwards).toBe(1001)
    expect(result.pageCount).toBe(2)
    expect(rangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ])
  })

  it('loads exactly 10,000 awards across the correct number of pages', async () => {
    const { supabase, rangeCalls } = makeFakeSupabase(makeRows(10000))
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')

    expect(result.totalAwards).toBe(10000)
    expect(result.awardCountByPrize).toEqual({ 'prize-a': 10000 })
    // 10 full pages + 1 trailing empty page (10000 is an exact multiple).
    expect(result.pageCount).toBe(11)
    expect(rangeCalls.length).toBe(11)
    expect(rangeCalls[0]).toEqual({ from: 0, to: 999 })
    expect(rangeCalls[9]).toEqual({ from: 9000, to: 9999 })
    expect(rangeCalls[10]).toEqual({ from: 10000, to: 10999 })
  })

  it('aggregates awards distributed across multiple prize ids', async () => {
    const rows = makeRows(3005, ['p1', 'p2', 'p3', 'p4', 'p5'])
    const { supabase } = makeFakeSupabase(rows)
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')

    expect(result.totalAwards).toBe(3005)
    expect(result.prizeIdCount).toBe(5)
    // 3005 / 5 = 601 each. i % 5: indexes 0..3004 -> p1 gets the extra (index 3000).
    const sum = Object.values(result.awardCountByPrize).reduce((a, b) => a + b, 0)
    expect(sum).toBe(3005)
    // p1 (index%5===0): ceil, p2..p5 floor for the +5 remainder distribution.
    expect(result.awardCountByPrize.p1).toBe(601)
    expect(result.awardCountByPrize.p5).toBe(601)
  })

  it('does not duplicate or skip rows at page boundaries', async () => {
    // Small page size + prime-ish count forces multiple boundaries.
    const rows = makeRows(7, ['x', 'y'])
    const { supabase, rangeCalls } = makeFakeSupabase(rows)
    const result = await loadCampaignAwardCounts(supabase, 'camp-1', { pageSize: 3 })

    // 7 rows @ pageSize 3 => pages [0-2],[3-5],[6-8] (last returns 1 row < 3, stop).
    expect(rangeCalls).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 8 },
    ])
    expect(result.pageCount).toBe(3)
    expect(result.totalAwards).toBe(7)
    // x at indexes 0,2,4,6 => 4 ; y at 1,3,5 => 3. Total 7, none double-counted.
    expect(result.awardCountByPrize).toEqual({ x: 4, y: 3 })
  })

  it('clamps an oversized page size down to the PostgREST cap', async () => {
    const { supabase, rangeCalls } = makeFakeSupabase(makeRows(10))
    await loadCampaignAwardCounts(supabase, 'camp-1', { pageSize: 999999 })
    expect(rangeCalls[0]).toEqual({ from: 0, to: AWARD_PAGE_SIZE - 1 })
  })

  it('ignores award rows with a null prize_id defensively', async () => {
    const rows = [
      { id: 'a1', prize_id: 'p1' },
      { id: 'a2', prize_id: null },
      { id: 'a3', prize_id: 'p1' },
    ]
    const { supabase } = makeFakeSupabase(rows)
    const result = await loadCampaignAwardCounts(supabase, 'camp-1')
    expect(result.totalAwards).toBe(2)
    expect(result.awardCountByPrize).toEqual({ p1: 2 })
  })
})

describe('loadCampaignAwardCounts — error handling (fail closed)', () => {
  it('throws when the first page errors', async () => {
    const { supabase } = makeFakeSupabase(makeRows(10), { errorAtFrom: 0 })
    await expect(loadCampaignAwardCounts(supabase, 'camp-1')).rejects.toThrow(
      /Failed to load instant-win awards for campaign camp-1/,
    )
  })

  it('throws when a later page errors (partial data is never returned)', async () => {
    // 2500 rows @ pageSize 1000 -> pages start at 0, 1000, 2000. Fail on page 2.
    const { supabase } = makeFakeSupabase(makeRows(2500), { errorAtFrom: 1000 })
    await expect(loadCampaignAwardCounts(supabase, 'camp-1')).rejects.toThrow(
      /range 1000-1999/,
    )
  })

  it('a later-page error prevents a snapshot from being written', async () => {
    // Mimic the writer contract: compute counts, THEN write. If the helper
    // throws, the write must never run.
    const { supabase } = makeFakeSupabase(makeRows(2500), { errorAtFrom: 1000 })
    const writeSnapshot = vi.fn()

    const runWriter = async () => {
      const counts = await loadCampaignAwardCounts(supabase, 'camp-1')
      writeSnapshot(counts) // only reached on success
    }

    await expect(runWriter()).rejects.toThrow()
    expect(writeSnapshot).not.toHaveBeenCalled()
  })
})
