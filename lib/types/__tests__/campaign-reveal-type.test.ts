import { describe, expect, it } from 'vitest'
import { REVEAL_TYPES, normalizeRevealType } from '../campaign'

// normalizeRevealType is the single source of truth for accepted reveal_type
// values. It is used by BOTH the admin campaigns API (create + update coercion)
// and the checkout success reveal router, so these cases pin the safety
// contract for the whole feature.
describe('normalizeRevealType — accepted values', () => {
  it('exposes exactly the four supported values in order', () => {
    expect(REVEAL_TYPES).toEqual(['normal', 'scratch_card', 'treasure_chest', 'dg_football'])
  })

  it('passes through every supported value unchanged', () => {
    expect(normalizeRevealType('normal')).toBe('normal')
    expect(normalizeRevealType('scratch_card')).toBe('scratch_card')
    expect(normalizeRevealType('treasure_chest')).toBe('treasure_chest')
    expect(normalizeRevealType('dg_football')).toBe('dg_football')
  })
})

describe('normalizeRevealType — safe fallback to normal', () => {
  it('falls back to normal for null / undefined', () => {
    expect(normalizeRevealType(null)).toBe('normal')
    expect(normalizeRevealType(undefined)).toBe('normal')
  })

  it('falls back to normal for unknown / arbitrary strings', () => {
    expect(normalizeRevealType('scratchcard')).toBe('normal')
    expect(normalizeRevealType('TREASURE_CHEST')).toBe('normal')
    expect(normalizeRevealType('treasure')).toBe('normal')
    expect(normalizeRevealType('football')).toBe('normal')
    expect(normalizeRevealType('DG_FOOTBALL')).toBe('normal')
    expect(normalizeRevealType('dg-football')).toBe('normal')
    expect(normalizeRevealType('')).toBe('normal')
    expect(normalizeRevealType('normal; drop table')).toBe('normal')
  })

  it('falls back to normal for non-string types', () => {
    expect(normalizeRevealType(0)).toBe('normal')
    expect(normalizeRevealType(1)).toBe('normal')
    expect(normalizeRevealType(true)).toBe('normal')
    expect(normalizeRevealType({})).toBe('normal')
    expect(normalizeRevealType([])).toBe('normal')
  })
})
