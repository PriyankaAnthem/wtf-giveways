import { describe, it, expect } from 'vitest'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_COOKIE_NAME_V2,
  ATTRIBUTION_MAX_AGE_SECONDS,
  ATTRIBUTION_PRODUCTION_DOMAIN,
  ATTRIBUTION_SCHEMA_VERSION,
  CHANNELS,
  attributionCookieDomain,
  buildSnapshot,
  generateShortCode,
  isChannel,
  isSafeInternalPath,
  isSourceAllowedForChannel,
  isValidShortCode,
  mediumForChannel,
  normalizeCampaignSlug,
  parseAttributionCookie,
  pickAttributionCookieValue,
  sanitizeDestinationPath,
  serializeAttribution,
  toCheckoutAttributionColumns,
  type ResolvedTrackingLink,
} from '@/lib/marketing/attribution'

describe('v2 attribution cookie: names + domain scoping', () => {
  it('v2 uses a distinct cookie name from the legacy cookie', () => {
    expect(ATTRIBUTION_COOKIE_NAME).toBe('wtf_attribution')
    expect(ATTRIBUTION_COOKIE_NAME_V2).toBe('wtf_attribution_v2')
    expect(ATTRIBUTION_COOKIE_NAME_V2).not.toBe(ATTRIBUTION_COOKIE_NAME)
  })

  it('production apex host -> Domain wtf-giveaways.co.uk', () => {
    expect(attributionCookieDomain('wtf-giveaways.co.uk')).toBe(ATTRIBUTION_PRODUCTION_DOMAIN)
    expect(attributionCookieDomain('wtf-giveaways.co.uk')).toBe('wtf-giveaways.co.uk')
  })

  it('production www host -> same Domain wtf-giveaways.co.uk (shared across apex + www)', () => {
    expect(attributionCookieDomain('www.wtf-giveaways.co.uk')).toBe('wtf-giveaways.co.uk')
  })

  it('production host with a port is still scoped (port ignored)', () => {
    expect(attributionCookieDomain('www.wtf-giveaways.co.uk:443')).toBe('wtf-giveaways.co.uk')
    expect(attributionCookieDomain('staging.wtf-giveaways.co.uk')).toBe('wtf-giveaways.co.uk')
  })

  it('localhost -> no Domain (host-only)', () => {
    expect(attributionCookieDomain('localhost')).toBeUndefined()
    expect(attributionCookieDomain('localhost:3000')).toBeUndefined()
    expect(attributionCookieDomain('127.0.0.1')).toBeUndefined()
  })

  it('Vercel preview host -> no production Domain (host-only)', () => {
    expect(attributionCookieDomain('wtfcompetitions-git-branch.vercel.app')).toBeUndefined()
    expect(attributionCookieDomain('some-preview.vercel.app')).toBeUndefined()
  })

  it('unrelated / lookalike hosts never get the production Domain', () => {
    // A different domain that merely contains the string must NOT match.
    expect(attributionCookieDomain('wtf-giveaways.co.uk.evil.com')).toBeUndefined()
    expect(attributionCookieDomain('notwtf-giveaways.co.uk')).toBeUndefined()
    expect(attributionCookieDomain('example.com')).toBeUndefined()
    expect(attributionCookieDomain('')).toBeUndefined()
    expect(attributionCookieDomain(null)).toBeUndefined()
    expect(attributionCookieDomain(undefined)).toBeUndefined()
  })
})

describe('checkout cookie selection: prefer v2, fall back to legacy', () => {
  it('prefers the v2 cookie when present', () => {
    expect(pickAttributionCookieValue('v2-value', 'legacy-value')).toBe('v2-value')
  })

  it('falls back to the legacy cookie when v2 is absent', () => {
    expect(pickAttributionCookieValue(undefined, 'legacy-value')).toBe('legacy-value')
    expect(pickAttributionCookieValue(null, 'legacy-value')).toBe('legacy-value')
    // An empty-string v2 counts as absent.
    expect(pickAttributionCookieValue('', 'legacy-value')).toBe('legacy-value')
  })

  it('returns null when neither cookie is present', () => {
    expect(pickAttributionCookieValue(undefined, undefined)).toBeNull()
    expect(pickAttributionCookieValue('', '')).toBeNull()
  })

  it('a present-but-malformed v2 is preferred and parses to null WITHOUT throwing (checkout stays safe)', () => {
    const picked = pickAttributionCookieValue('not-json{', 'legacy-value')
    expect(picked).toBe('not-json{')
    // parse must be defensive: malformed -> null, never a throw.
    expect(() => parseAttributionCookie(picked, Date.now())).not.toThrow()
    expect(parseAttributionCookie(picked, Date.now())).toBeNull()
    // And that null maps to "no attribution columns", so checkout is unaffected.
    expect(toCheckoutAttributionColumns(parseAttributionCookie(picked, Date.now()))).toBeNull()
  })

  it('a valid legacy cookie still attributes when v2 is absent (pre-rollout clicks)', () => {
    const link: ResolvedTrackingLink = {
      id: 'link-legacy-1',
      source: 'brevo',
      medium: 'email',
      channel: 'email',
      campaign: 'legacy-campaign',
      content: null,
      ref: 'dan',
      provider_id: null,
    }
    const now = Date.now()
    const legacyValue = serializeAttribution(buildSnapshot(link, '/win/legacy', now))
    const picked = pickAttributionCookieValue(undefined, legacyValue)
    const cols = toCheckoutAttributionColumns(parseAttributionCookie(picked, now), now)
    expect(cols?.attribution_tracking_link_id).toBe('link-legacy-1')
    expect(cols?.attribution_channel).toBe('email')
    expect(cols?.attribution_ref).toBe('dan')
  })
})

describe('taxonomy', () => {
  it('every source of every channel satisfies the DB source CHECK list', () => {
    const allowedSources = new Set([
      'brevo', 'resend', 'tiktok', 'facebook', 'instagram', 'meta',
      'tiktok_ads', 'sms', 'influencer', 'referral',
    ])
    const allowedMediums = new Set([
      'email', 'sms', 'social_organic', 'social_paid', 'live', 'referral',
    ])
    for (const channel of Object.keys(CHANNELS)) {
      const cfg = CHANNELS[channel as keyof typeof CHANNELS]
      expect(allowedMediums.has(cfg.medium)).toBe(true)
      for (const s of cfg.sources) {
        expect(allowedSources.has(s.value)).toBe(true)
      }
    }
  })

  it('isChannel + mediumForChannel', () => {
    expect(isChannel('email')).toBe(true)
    expect(isChannel('nope')).toBe(false)
    expect(mediumForChannel('tiktok_live')).toBe('live')
    expect(mediumForChannel('bogus')).toBeNull()
  })

  it('isSourceAllowedForChannel enforces the mapping', () => {
    expect(isSourceAllowedForChannel('email', 'resend')).toBe(true)
    expect(isSourceAllowedForChannel('email', 'tiktok')).toBe(false)
    expect(isSourceAllowedForChannel('paid_social', 'tiktok_ads')).toBe(true)
    expect(isSourceAllowedForChannel('bogus', 'resend')).toBe(false)
  })
})

describe('normalizeCampaignSlug', () => {
  it('lowercases, hyphenates and trims', () => {
    expect(normalizeCampaignSlug('  July Launch! ')).toBe('july-launch')
    expect(normalizeCampaignSlug('easyOdds #1')).toBe('easyodds-1')
  })
  it('collapses repeated separators and trims hyphens', () => {
    expect(normalizeCampaignSlug('a   --  b')).toBe('a-b')
    expect(normalizeCampaignSlug('---x---')).toBe('x')
  })
  it('rejects empty / all-invalid input', () => {
    expect(normalizeCampaignSlug('   ')).toBeNull()
    expect(normalizeCampaignSlug('!!!')).toBeNull()
    expect(normalizeCampaignSlug(123 as unknown)).toBeNull()
  })
  it('caps length at 80 without trailing hyphen', () => {
    const slug = normalizeCampaignSlug('a'.repeat(90))
    expect(slug && slug.length).toBe(80)
    expect(slug?.endsWith('-')).toBe(false)
  })
})

describe('generateShortCode + isValidShortCode', () => {
  it('produces DB-legal codes of the requested length', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode()
      expect(isValidShortCode(code)).toBe(true)
      expect(code).toHaveLength(8)
    }
  })
  it('never contains ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(/[0O1Il]/.test(generateShortCode())).toBe(false)
    }
  })
  it('clamps length into 5..16', () => {
    expect(generateShortCode(2)).toHaveLength(5)
    expect(generateShortCode(999)).toHaveLength(16)
  })
})

describe('isSafeInternalPath (open-redirect prevention)', () => {
  it('accepts safe internal paths', () => {
    expect(isSafeInternalPath('/')).toBe(true)
    expect(isSafeInternalPath('/competitions/easyodds')).toBe(true)
    expect(isSafeInternalPath('/x?y=1&z=2')).toBe(true)
  })
  it('rejects external / protocol-relative / scheme / backslash / whitespace', () => {
    expect(isSafeInternalPath('//evil.com')).toBe(false)
    expect(isSafeInternalPath('https://evil.com')).toBe(false)
    expect(isSafeInternalPath('http://evil.com')).toBe(false)
    expect(isSafeInternalPath('javascript:alert(1)')).toBe(false)
    expect(isSafeInternalPath('/path\\evil')).toBe(false)
    expect(isSafeInternalPath('/a b')).toBe(false)
    expect(isSafeInternalPath('/a\nb')).toBe(false)
    expect(isSafeInternalPath('relative')).toBe(false)
    expect(isSafeInternalPath('')).toBe(false)
  })
  it('sanitizeDestinationPath adds a leading slash or rejects', () => {
    expect(sanitizeDestinationPath('competitions')).toBe('/competitions')
    expect(sanitizeDestinationPath('  /x  ')).toBe('/x')
    expect(sanitizeDestinationPath('//evil.com')).toBeNull()
    expect(sanitizeDestinationPath('https://evil.com')).toBeNull()
  })
})

const LINK: ResolvedTrackingLink = {
  id: 'a1b2',
  source: 'resend',
  medium: 'email',
  channel: 'email',
  campaign: 'july-launch',
  content: 'variant-a',
  ref: 'host9',
  provider_id: null,
}

describe('cookie round-trip + defensive parsing', () => {
  it('build -> serialize -> parse yields the same snapshot', () => {
    const now = 1_000_000_000_000
    const snap = buildSnapshot(LINK, '/competitions/easyodds', now)
    const parsed = parseAttributionCookie(serializeAttribution(snap), now)
    expect(parsed).not.toBeNull()
    expect(parsed?.linkId).toBe('a1b2')
    expect(parsed?.campaign).toBe('july-launch')
    expect(parsed?.landingPath).toBe('/competitions/easyodds')
    expect(parsed?.clickedAt).toBe(now)
  })

  it('drops an unsafe landing path at build time', () => {
    const now = Date.now()
    const snap = buildSnapshot(LINK, '//evil.com', now)
    expect(snap.landingPath).toBeNull()
  })

  it('returns null for malformed / non-JSON / wrong-version cookies', () => {
    expect(parseAttributionCookie(undefined)).toBeNull()
    expect(parseAttributionCookie('')).toBeNull()
    expect(parseAttributionCookie('not json')).toBeNull()
    expect(parseAttributionCookie('[]')).toBeNull()
    expect(parseAttributionCookie(JSON.stringify({ v: 999, linkId: 'x' }))).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    const now = Date.now()
    const bad = JSON.stringify({ v: ATTRIBUTION_SCHEMA_VERSION, linkId: 'x', clickedAt: now })
    expect(parseAttributionCookie(bad, now)).toBeNull()
  })

  it('expires clicks older than 7 days', () => {
    const now = 2_000_000_000_000
    const snap = buildSnapshot(LINK, '/x', now - ATTRIBUTION_MAX_AGE_SECONDS * 1000 - 1000)
    expect(parseAttributionCookie(serializeAttribution(snap), now)).toBeNull()
  })

  it('accepts a click just inside the 7-day window', () => {
    const now = 2_000_000_000_000
    const snap = buildSnapshot(LINK, '/x', now - (ATTRIBUTION_MAX_AGE_SECONDS - 60) * 1000)
    expect(parseAttributionCookie(serializeAttribution(snap), now)).not.toBeNull()
  })

  it('rejects an implausible future timestamp', () => {
    const now = 2_000_000_000_000
    const snap = buildSnapshot(LINK, '/x', now + 5 * 60 * 1000)
    expect(parseAttributionCookie(serializeAttribution(snap), now)).toBeNull()
  })
})

describe('toCheckoutAttributionColumns', () => {
  it('maps a snapshot to nullable snake_case columns', () => {
    const now = 1_700_000_000_000
    const snap = buildSnapshot(LINK, '/x', now)
    const cols = toCheckoutAttributionColumns(snap, now)
    expect(cols).not.toBeNull()
    expect(cols?.attribution_tracking_link_id).toBe('a1b2')
    expect(cols?.attribution_source).toBe('resend')
    expect(cols?.attribution_channel).toBe('email')
    expect(cols?.attribution_campaign).toBe('july-launch')
    expect(cols?.attribution_provider_id).toBeNull()
    expect(typeof cols?.attribution_clicked_at).toBe('string')
    expect(typeof cols?.attribution_captured_at).toBe('string')
  })

  it('returns null when there is no snapshot', () => {
    expect(toCheckoutAttributionColumns(null)).toBeNull()
  })
})
