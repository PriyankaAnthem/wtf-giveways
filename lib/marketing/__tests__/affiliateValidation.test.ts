import { describe, it, expect } from 'vitest'
import {
  validateAffiliateName,
  validateAffiliateNotes,
  validateCommission,
  generateAffiliateSlug,
  validateAffiliateCreateInput,
  validateAffiliateEditInput,
  isUuid,
} from '@/lib/marketing/affiliateValidation'

describe('validateAffiliateName', () => {
  it('trims and accepts 1..120 chars', () => {
    const r = validateAffiliateName('  Dan  ')
    expect(r.ok && r.value).toBe('Dan')
  })
  it('rejects empty, overlong, and non-strings', () => {
    expect(validateAffiliateName('   ').ok).toBe(false)
    expect(validateAffiliateName('a'.repeat(121)).ok).toBe(false)
    expect(validateAffiliateName(42 as unknown).ok).toBe(false)
  })
})

describe('validateCommission (percent -> basis points)', () => {
  it('converts whole and fractional percents', () => {
    expect(validateCommission(10)).toEqual({ ok: true, value: 1000 })
    expect(validateCommission('12.5')).toEqual({ ok: true, value: 1250 })
    expect(validateCommission(100)).toEqual({ ok: true, value: 10000 })
  })
  it('treats 0 as a VALID, distinct rate (0%), not null', () => {
    expect(validateCommission(0)).toEqual({ ok: true, value: 0 })
    expect(validateCommission('0')).toEqual({ ok: true, value: 0 })
  })
  it('treats null/undefined/blank as "no rate" (null)', () => {
    expect(validateCommission(null)).toEqual({ ok: true, value: null })
    expect(validateCommission(undefined)).toEqual({ ok: true, value: null })
    expect(validateCommission('')).toEqual({ ok: true, value: null })
    expect(validateCommission('   ')).toEqual({ ok: true, value: null })
  })
  it('rejects out-of-range and non-numeric', () => {
    expect(validateCommission(-1).ok).toBe(false)
    expect(validateCommission(100.01).ok).toBe(false)
    expect(validateCommission('abc').ok).toBe(false)
    expect(validateCommission({} as unknown).ok).toBe(false)
  })
})

describe('validateAffiliateNotes', () => {
  it('blank => null; trims; bounds at 2000', () => {
    expect(validateAffiliateNotes('')).toEqual({ ok: true, value: null })
    expect(validateAffiliateNotes('  hi  ')).toEqual({ ok: true, value: 'hi' })
    expect(validateAffiliateNotes('x'.repeat(2001)).ok).toBe(false)
  })
})

describe('generateAffiliateSlug', () => {
  it('derives a lowercase hyphen slug from the name', () => {
    expect(generateAffiliateSlug('Dan')).toBe('dan')
    expect(generateAffiliateSlug('JP Munches!!')).toBe('jp-munches')
  })
  it('returns null when there are no usable alphanumerics', () => {
    expect(generateAffiliateSlug('!!!')).toBeNull()
  })
})

describe('validateAffiliateCreateInput', () => {
  it('produces a DB-shaped row with an auto slug and bps commission', () => {
    const r = validateAffiliateCreateInput({ name: 'Dan', commission: '10', notes: ' vip ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        name: 'Dan',
        slug: 'dan',
        commission_bps: 1000,
        notes: 'vip',
        is_active: true,
      })
    }
  })
  it('defaults commission/notes to null and is_active to true', () => {
    const r = validateAffiliateCreateInput({ name: 'Solo' })
    expect(r.ok && r.value.commission_bps).toBeNull()
    expect(r.ok && r.value.notes).toBeNull()
    expect(r.ok && r.value.is_active).toBe(true)
  })
  it('rejects a name with no slug-able characters', () => {
    const r = validateAffiliateCreateInput({ name: '###' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toBe('invalid_slug')
  })
  it('propagates a bad commission', () => {
    const r = validateAffiliateCreateInput({ name: 'Dan', commission: '250' })
    expect(!r.ok && r.error).toBe('invalid_commission')
  })
})

describe('validateAffiliateEditInput', () => {
  it('does NOT return a slug (identity is immutable on edit)', () => {
    const r = validateAffiliateEditInput({ name: 'Dan Renamed', commission: 15 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({ name: 'Dan Renamed', commission_bps: 1500, notes: null })
      expect('slug' in r.value).toBe(false)
    }
  })
})

describe('isUuid', () => {
  it('accepts a canonical uuid and rejects junk', () => {
    expect(isUuid('4b1e2c3d-1234-4a56-89ab-cdef01234567')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(123 as unknown)).toBe(false)
  })
})
