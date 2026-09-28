import { describe, it, expect } from 'vitest'
import {
  MARKETING_CONSENT_VERSION,
  MARKETING_CONSENT_LABEL,
  MARKETING_CONSENT_SOURCE,
} from '../consent'

describe('marketing consent constants', () => {
  it('has a non-empty, stable version string', () => {
    expect(typeof MARKETING_CONSENT_VERSION).toBe('string')
    expect(MARKETING_CONSENT_VERSION.length).toBeGreaterThan(0)
  })

  it('has customer-facing label copy that mentions unsubscribing', () => {
    expect(MARKETING_CONSENT_LABEL.length).toBeGreaterThan(0)
    expect(MARKETING_CONSENT_LABEL.toLowerCase()).toContain('unsubscribe')
  })

  it('exposes exactly the three known consent sources', () => {
    expect(MARKETING_CONSENT_SOURCE).toEqual({
      signup: 'signup',
      accountSettings: 'account_settings',
      unsubscribeLink: 'unsubscribe_link',
    })
  })
})
