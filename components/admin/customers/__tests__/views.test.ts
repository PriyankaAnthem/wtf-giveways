import { describe, it, expect } from 'vitest'
import { normalizeView, DEFAULT_VIEW, CUSTOMER_VIEWS } from '../views'

describe('normalizeView', () => {
  it('accepts each known view verbatim', () => {
    for (const v of CUSTOMER_VIEWS) {
      expect(normalizeView(v)).toBe(v)
    }
  })

  it('falls back to newest for unknown / missing values', () => {
    expect(normalizeView('nonsense')).toBe(DEFAULT_VIEW)
    expect(normalizeView(undefined)).toBe(DEFAULT_VIEW)
    expect(normalizeView(null)).toBe(DEFAULT_VIEW)
    expect(normalizeView(42)).toBe(DEFAULT_VIEW)
    expect(DEFAULT_VIEW).toBe('newest')
  })
})
