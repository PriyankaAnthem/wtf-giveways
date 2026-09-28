import { describe, it, expect, vi } from 'vitest'

// `server-only` throws when imported outside a Server Component; make it a no-op
// so the module under test can be imported in the node test environment.
vi.mock('server-only', () => ({}))

import {
  isMissingVideoColumnError,
  normaliseVideoUrl,
  normaliseVideoDurationS,
  loadCampaignVideoMap,
  videoFieldsFor,
} from '@/lib/media/campaign-video'

describe('isMissingVideoColumnError', () => {
  it('detects Postgres undefined_column (42703) mentioning the column', () => {
    expect(
      isMissingVideoColumnError({ code: '42703', message: 'column campaigns.promo_video_url does not exist' }),
    ).toBe(true)
  })

  it('detects PostgREST schema-cache miss (PGRST204)', () => {
    expect(
      isMissingVideoColumnError({ code: 'PGRST204', message: "Could not find the 'promo_video_url' column in the schema cache" }),
    ).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isMissingVideoColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false)
    expect(isMissingVideoColumnError({ code: '42703', message: 'column foo does not exist' })).toBe(false)
    expect(isMissingVideoColumnError(null)).toBe(false)
    expect(isMissingVideoColumnError(undefined)).toBe(false)
  })
})

describe('normaliseVideoUrl', () => {
  it('trims and keeps non-empty strings', () => {
    expect(normaliseVideoUrl('  https://x/v.mp4 ')).toBe('https://x/v.mp4')
  })
  it('returns null for empty / non-string', () => {
    expect(normaliseVideoUrl('')).toBeNull()
    expect(normaliseVideoUrl('   ')).toBeNull()
    expect(normaliseVideoUrl(null)).toBeNull()
    expect(normaliseVideoUrl(123)).toBeNull()
  })
})

describe('normaliseVideoDurationS', () => {
  it('rounds valid positive durations and caps at 15', () => {
    expect(normaliseVideoDurationS(8.4)).toBe(8)
    expect(normaliseVideoDurationS(9.6)).toBe(10)
    expect(normaliseVideoDurationS(99)).toBe(15)
  })
  it('returns null for non-positive / invalid', () => {
    expect(normaliseVideoDurationS(0)).toBeNull()
    expect(normaliseVideoDurationS(-3)).toBeNull()
    expect(normaliseVideoDurationS('x')).toBeNull()
    expect(normaliseVideoDurationS(null)).toBeNull()
  })
})

// Build a minimal Supabase stub whose `.from().select().in()` resolves to a
// fixed { data, error }.
function stub(result: { data: any[] | null; error: any }) {
  return {
    from: () => ({
      select: () => ({
        in: async () => result,
      }),
    }),
  }
}

describe('loadCampaignVideoMap', () => {
  it('maps rows keyed by id with normalised fields', async () => {
    const supabase = stub({
      data: [
        { id: 'a', promo_video_url: ' https://x/a.mp4 ', promo_video_duration_s: 8.7 },
        { id: 'b', promo_video_url: '', promo_video_duration_s: null },
      ],
      error: null,
    })
    const map = await loadCampaignVideoMap(supabase as any, ['a', 'b'])
    expect(map.get('a')).toEqual({ promo_video_url: 'https://x/a.mp4', promo_video_duration_s: 9 })
    expect(map.get('b')).toEqual({ promo_video_url: null, promo_video_duration_s: null })
  })

  it('returns an empty map (poster-only) when the columns are missing', async () => {
    const supabase = stub({
      data: null,
      error: { code: '42703', message: 'column campaigns.promo_video_url does not exist' },
    })
    const map = await loadCampaignVideoMap(supabase as any, ['a'])
    expect(map.size).toBe(0)
  })

  it('returns an empty map on any other read error (fail soft)', async () => {
    const supabase = stub({ data: null, error: { code: '500', message: 'boom' } })
    const map = await loadCampaignVideoMap(supabase as any, ['a'])
    expect(map.size).toBe(0)
  })

  it('short-circuits with no ids', async () => {
    let called = false
    const supabase = {
      from: () => {
        called = true
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
      },
    }
    const map = await loadCampaignVideoMap(supabase as any, [])
    expect(map.size).toBe(0)
    expect(called).toBe(false)
  })
})

describe('videoFieldsFor', () => {
  it('returns the empty (poster-only) shape when absent', () => {
    const map = new Map()
    expect(videoFieldsFor(map, 'missing')).toEqual({ promo_video_url: null, promo_video_duration_s: null })
  })
})
