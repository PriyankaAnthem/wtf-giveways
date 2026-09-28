import { describe, it, expect } from 'vitest'
import {
  PLACEMENTS,
  getPlacement,
  placementNeedsPlatform,
  resolvePlacement,
  wtfUrlToInternalPath,
  describeDestination,
  competitionPath,
  HOMEPAGE_PATH,
  GIVEAWAYS_PATH,
} from '@/lib/marketing/linkDestinations'
import { CHANNELS } from '@/lib/marketing/attribution'

describe('linkDestinations — placement taxonomy resolution', () => {
  // The seven canonical staff choices and the exact controlled values each
  // MUST derive. If any of these change, attribution history silently breaks.
  const cases: Array<{
    name: string
    placement: string
    platform: string | undefined
    channel: string
    source: string
    medium: string
  }> = [
    { name: 'Organic Social + Facebook',  placement: 'organic_social', platform: 'facebook',   channel: 'organic_social', source: 'facebook',   medium: 'social_organic' },
    { name: 'Organic Social + Instagram', placement: 'organic_social', platform: 'instagram',  channel: 'organic_social', source: 'instagram',  medium: 'social_organic' },
    { name: 'Organic Social + TikTok',    placement: 'organic_social', platform: 'tiktok',     channel: 'organic_social', source: 'tiktok',     medium: 'social_organic' },
    { name: 'Paid Social + Facebook',     placement: 'paid_social',    platform: 'facebook',   channel: 'paid_social',    source: 'facebook',   medium: 'social_paid' },
    { name: 'Paid Social + Instagram',    placement: 'paid_social',    platform: 'instagram',  channel: 'paid_social',    source: 'instagram',  medium: 'social_paid' },
    { name: 'Paid Social + TikTok',       placement: 'paid_social',    platform: 'tiktok_ads', channel: 'paid_social',    source: 'tiktok_ads', medium: 'social_paid' },
    { name: 'TikTok Live',                placement: 'tiktok_live',    platform: undefined,    channel: 'tiktok_live',    source: 'tiktok',     medium: 'live' },
  ]

  for (const c of cases) {
    it(`${c.name} -> ${c.channel} / ${c.source} / ${c.medium}`, () => {
      expect(resolvePlacement(c.placement, c.platform)).toEqual({
        channel: c.channel,
        source: c.source,
        medium: c.medium,
      })
    })
  }

  it('separates PAID from ORGANIC: same platform, different channel + medium', () => {
    const organicFb = resolvePlacement('organic_social', 'facebook')
    const paidFb = resolvePlacement('paid_social', 'facebook')
    // Facebook organic and Facebook paid share a source but must never collapse.
    expect(organicFb?.source).toBe('facebook')
    expect(paidFb?.source).toBe('facebook')
    expect(organicFb?.channel).not.toBe(paidFb?.channel)
    expect(organicFb?.medium).not.toBe(paidFb?.medium)
  })

  it('TikTok paid vs organic differ in source AND channel', () => {
    const organicTt = resolvePlacement('organic_social', 'tiktok')
    const paidTt = resolvePlacement('paid_social', 'tiktok_ads')
    expect(organicTt).toEqual({ channel: 'organic_social', source: 'tiktok', medium: 'social_organic' })
    expect(paidTt).toEqual({ channel: 'paid_social', source: 'tiktok_ads', medium: 'social_paid' })
    expect(organicTt?.source).not.toBe(paidTt?.source)
    expect(organicTt?.channel).not.toBe(paidTt?.channel)
  })

  it('TikTok Live is its own channel, distinct from organic/paid TikTok', () => {
    const live = resolvePlacement('tiktok_live', undefined)
    expect(live?.channel).toBe('tiktok_live')
    expect(live?.channel).not.toBe('organic_social')
    expect(live?.channel).not.toBe('paid_social')
  })

  it('every (channel + source) pair the picker can produce is unique', () => {
    const seen = new Set<string>()
    for (const c of cases) {
      const key = `${c.channel}::${c.source}`
      expect(seen.has(key), `duplicate ${key}`).toBe(false)
      seen.add(key)
    }
  })
})

describe('linkDestinations — the picker shape', () => {
  it('no longer offers bare Facebook / Instagram / TikTok top-level placements', () => {
    const values = PLACEMENTS.map((p) => p.value)
    expect(values).not.toContain('facebook')
    expect(values).not.toContain('instagram')
    expect(values).not.toContain('tiktok')
  })

  it('offers both Organic social and Paid social parents, each with a platform question', () => {
    for (const value of ['organic_social', 'paid_social']) {
      const p = getPlacement(value)
      expect(p, value).not.toBeNull()
      expect(placementNeedsPlatform(p)).toBe(true)
    }
  })

  it('both social parents ask the SAME three platforms (Facebook, Instagram, TikTok)', () => {
    const organic = getPlacement('organic_social')!
    const paid = getPlacement('paid_social')!
    expect(organic.platforms?.map((p) => p.label)).toEqual(['Facebook', 'Instagram', 'TikTok'])
    // Paid additionally keeps a "Meta Ads (other)" catch-all, but leads with the same three.
    expect(paid.platforms?.slice(0, 3).map((p) => p.label)).toEqual(['Facebook', 'Instagram', 'TikTok'])
  })

  it('placementNeedsPlatform is true for Email / Organic social / Paid social only', () => {
    expect(placementNeedsPlatform(getPlacement('email'))).toBe(true)
    expect(placementNeedsPlatform(getPlacement('organic_social'))).toBe(true)
    expect(placementNeedsPlatform(getPlacement('paid_social'))).toBe(true)
    expect(placementNeedsPlatform(getPlacement('sms'))).toBe(false)
    expect(placementNeedsPlatform(getPlacement('tiktok_live'))).toBe(false)
    expect(placementNeedsPlatform(getPlacement('influencer'))).toBe(false)
    expect(placementNeedsPlatform(getPlacement('referral'))).toBe(false)
  })

  it('missing / invalid platform on a platform-required placement resolves to null', () => {
    expect(resolvePlacement('organic_social', undefined)).toBeNull()
    expect(resolvePlacement('organic_social', 'not-a-platform')).toBeNull()
    expect(resolvePlacement('paid_social', undefined)).toBeNull()
    // A paid-only source must not be valid under organic and vice-versa.
    expect(resolvePlacement('organic_social', 'tiktok_ads')).toBeNull()
    expect(resolvePlacement('paid_social', 'tiktok')).toBeNull()
  })

  it('unknown placement resolves to null', () => {
    expect(resolvePlacement('nope', undefined)).toBeNull()
    expect(getPlacement('nope')).toBeNull()
    expect(getPlacement(42)).toBeNull()
  })

  it('DB-safety guard: every derivable source is allowed by its channel taxonomy', () => {
    // Guarantees the picker can never write a (channel, source) pair the DB
    // CHECK constraint would reject.
    for (const p of PLACEMENTS) {
      // CHANNELS[channel].sources is SourceOption[] ({ value, label }); compare on value.
      const allowed = CHANNELS[p.channel].sources.map((s) => s.value)
      if (placementNeedsPlatform(p)) {
        for (const platform of p.platforms!) {
          expect(allowed, `${p.channel} / ${platform.value}`).toContain(platform.value)
        }
      } else {
        expect(allowed, `${p.channel} / ${p.source}`).toContain(p.source!)
      }
    }
  })
})

describe('linkDestinations — destination path helpers', () => {
  it('accepts an already-internal path and sanitises it', () => {
    expect(wtfUrlToInternalPath('/giveaways/win-a-car')).toBe('/giveaways/win-a-car')
  })

  it('accepts a full WTF url (apex + subdomain) and strips to the path', () => {
    expect(wtfUrlToInternalPath('https://www.wtf-giveaways.co.uk/giveaways/x')).toBe('/giveaways/x')
    expect(wtfUrlToInternalPath('https://wtf-giveaways.co.uk/giveaways/y')).toBe('/giveaways/y')
  })

  it('rejects external hosts and non-http protocols', () => {
    expect(wtfUrlToInternalPath('https://evil.example.com/giveaways/x')).toBeNull()
    expect(wtfUrlToInternalPath('javascript:alert(1)')).toBeNull()
    expect(wtfUrlToInternalPath('')).toBeNull()
    expect(wtfUrlToInternalPath(null)).toBeNull()
  })

  it('honours extraHosts (e.g. the preview origin)', () => {
    expect(wtfUrlToInternalPath('https://preview.vercel.app/giveaways/z', ['preview.vercel.app'])).toBe(
      '/giveaways/z',
    )
  })

  it('describeDestination labels home, giveaways, competitions and custom paths', () => {
    expect(describeDestination(HOMEPAGE_PATH).kind).toBe('home')
    expect(describeDestination(GIVEAWAYS_PATH).kind).toBe('giveaways')

    const known = describeDestination(competitionPath('big-cash'), { 'big-cash': '£15,000 INSTANT CASH' })
    expect(known).toEqual({ kind: 'competition', title: '£15,000 INSTANT CASH', path: '/giveaways/big-cash' })

    // No title known -> prettified slug fallback.
    expect(describeDestination(competitionPath('win-a-car')).title).toBe('Win A Car')

    expect(describeDestination('/some/custom/page').kind).toBe('custom')
  })
})
