import { describe, it, expect } from 'vitest'
import {
  isUuid,
  resolveTaxonomy,
  validateCreateInput,
  validateDestination,
  validateEditInput,
  validateLabel,
} from '@/lib/marketing/linkValidation'

const baseCreate = {
  label: 'July TikTok live',
  channel: 'tiktok_live',
  source: 'tiktok',
  campaign: 'July Launch',
  destinationPath: '/competitions/easyodds',
}

describe('validateLabel', () => {
  it('accepts a trimmed 1..120 char label', () => {
    const r = validateLabel('  hello  ')
    expect(r.ok && r.value).toBe('hello')
  })
  it('rejects empty and overlong', () => {
    expect(validateLabel('   ').ok).toBe(false)
    expect(validateLabel('a'.repeat(121)).ok).toBe(false)
    expect(validateLabel(42 as unknown).ok).toBe(false)
  })
})

describe('resolveTaxonomy', () => {
  it('derives medium and accepts an allowed source', () => {
    const r = resolveTaxonomy('email', 'resend')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.medium).toBe('email')
      expect(r.value.source).toBe('resend')
    }
  })
  it('rejects an unknown channel', () => {
    const r = resolveTaxonomy('carrier_pigeon', 'resend')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_channel')
  })
  it('rejects a source not allowed for the channel', () => {
    const r = resolveTaxonomy('email', 'tiktok')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_source')
  })
})

describe('validateDestination', () => {
  it('accepts safe internal paths', () => {
    expect(validateDestination('/x').ok).toBe(true)
  })
  it('rejects open-redirect vectors', () => {
    expect(validateDestination('//evil.com').ok).toBe(false)
    expect(validateDestination('https://evil.com').ok).toBe(false)
    expect(validateDestination('').ok).toBe(false)
  })
})

describe('validateCreateInput', () => {
  it('validates a full payload into DB column shape', () => {
    const r = validateCreateInput({ ...baseCreate })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.channel).toBe('tiktok_live')
      expect(r.value.source).toBe('tiktok')
      expect(r.value.medium).toBe('live')
      expect(r.value.campaign_slug).toBe('july-launch')
      expect(r.value.destination_path).toBe('/competitions/easyodds')
      expect(r.value.is_active).toBe(true)
      expect(r.value.content).toBeNull()
    }
  })

  it('normalises optional fields and honours isActive=false', () => {
    const r = validateCreateInput({
      ...baseCreate,
      content: ' variant-a ',
      ref: 'host9',
      providerId: 'p_123',
      isActive: false,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.content).toBe('variant-a')
      expect(r.value.ref).toBe('host9')
      expect(r.value.provider_id).toBe('p_123')
      expect(r.value.is_active).toBe(false)
    }
  })

  it('rejects invalid campaign', () => {
    const r = validateCreateInput({ ...baseCreate, campaign: '!!!' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_campaign')
  })

  it('rejects a mismatched source/channel', () => {
    const r = validateCreateInput({ ...baseCreate, channel: 'email', source: 'tiktok' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_source')
  })

  it('rejects an unsafe destination', () => {
    const r = validateCreateInput({ ...baseCreate, destinationPath: 'https://evil.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_destination')
  })
})

describe('validateEditInput (immutable attribution fields ignored)', () => {
  it('only returns editable fields and never channel/source/campaign', () => {
    const r = validateEditInput({
      id: 'ignored-here',
      label: 'Renamed',
      destinationPath: '/new',
      content: 'v2',
      ref: null,
      providerId: null,
      // These attribution-defining fields must be ignored, not accepted:
      channel: 'email',
      source: 'resend',
      campaign: 'something-else',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        label: 'Renamed',
        destination_path: '/new',
        content: 'v2',
        ref: null,
        provider_id: null,
      })
      expect('channel' in r.value).toBe(false)
      expect('campaign_slug' in r.value).toBe(false)
    }
  })

  it('rejects an unsafe destination on edit', () => {
    const r = validateEditInput({ label: 'x', destinationPath: '//evil.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_destination')
  })
})

describe('isUuid', () => {
  it('accepts a canonical uuid and rejects junk', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(123 as unknown)).toBe(false)
  })
})
