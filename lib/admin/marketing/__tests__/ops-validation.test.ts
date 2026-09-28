import { describe, it, expect } from 'vitest'
import {
  ALLOWED_ROLLOUT_LIMITS,
  AUTOMATION_KEYS,
  canEnableSending,
  isAllowedRolloutLimit,
  maskEmail,
  validateAutomationToggle,
  validateControlAction,
  validateDefinitionToggle,
  validateRolloutAgainstBatch,
} from '@/lib/admin/marketing/ops-validation'

describe('maskEmail', () => {
  it('keeps up to two local chars and the domain', () => {
    expect(maskEmail('joanne@example.com')).toBe('jo***@example.com')
  })
  it('handles a single-char local part', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
  })
  it('never throws and masks garbage/empty/non-string input', () => {
    expect(maskEmail('   ')).toBe('***')
    expect(maskEmail('no-at-sign')).toBe('***')
    expect(maskEmail(null)).toBe('***')
    expect(maskEmail(123 as unknown)).toBe('***')
    expect(maskEmail('@example.com')).toBe('***')
  })
  it('never returns the full original address', () => {
    const raw = 'verylonglocalpart@customer-domain.co.uk'
    const masked = maskEmail(raw)
    expect(masked).not.toBe(raw)
    expect(masked.startsWith('ve***@')).toBe(true)
  })
})

describe('rollout limit constraints', () => {
  it('only accepts the fixed option set', () => {
    for (const n of ALLOWED_ROLLOUT_LIMITS) expect(isAllowedRolloutLimit(n)).toBe(true)
    for (const bad of [-1, 2, 7, 11, 99, 1000, 3.5, NaN, '5' as unknown]) {
      expect(isAllowedRolloutLimit(bad)).toBe(false)
    }
  })

  it('rejects a rollout that exceeds the authoritative batch size', () => {
    const r = validateRolloutAgainstBatch(50, 25)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('rollout_exceeds_batch')
  })

  it('accepts a rollout within the batch size', () => {
    const r = validateRolloutAgainstBatch(25, 50)
    expect(r.ok).toBe(true)
  })
})

describe('validateControlAction', () => {
  it('accepts sending/discovery boolean transitions', () => {
    expect(validateControlAction({ target: 'sending', enabled: true })).toEqual({
      ok: true,
      value: { target: 'sending', enabled: true },
    })
    expect(validateControlAction({ target: 'discovery', enabled: false })).toEqual({
      ok: true,
      value: { target: 'discovery', enabled: false },
    })
  })

  it('accepts an allowed rollout value only', () => {
    expect(validateControlAction({ target: 'rollout', rolloutLimit: 10 }).ok).toBe(true)
    const bad = validateControlAction({ target: 'rollout', rolloutLimit: 7 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('invalid_rollout_limit')
  })

  it('rejects a non-boolean enabled', () => {
    const r = validateControlAction({ target: 'sending', enabled: 'yes' as unknown })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_enabled')
  })

  it('rejects an unknown/arbitrary target (no arbitrary column mutation)', () => {
    for (const target of ['maximum_batch_size', 'updated_by', 'foo', '', undefined]) {
      const r = validateControlAction({ target } as Record<string, unknown>)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('invalid_target')
    }
  })
})

describe('canEnableSending — fail closed', () => {
  const base = { rolloutLimit: 5, enabledAutomationCount: 1, enabledDefinitionCount: 1 }

  it('blocks when rollout is 0', () => {
    const r = canEnableSending({ ...base, rolloutLimit: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sending_requires_rollout')
  })

  it('blocks when zero automations are enabled', () => {
    const r = canEnableSending({ ...base, enabledAutomationCount: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sending_requires_automation')
  })

  it('blocks when zero definitions are enabled', () => {
    const r = canEnableSending({ ...base, enabledDefinitionCount: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sending_requires_definition')
  })

  it('allows only when all preconditions hold', () => {
    expect(canEnableSending(base).ok).toBe(true)
  })
})

describe('validateAutomationToggle — narrow to one known key', () => {
  it('accepts a known automation key with a boolean', () => {
    const r = validateAutomationToggle({ automationKey: AUTOMATION_KEYS[0], enabled: true })
    expect(r.ok).toBe(true)
  })
  it('rejects an unknown automation key', () => {
    const r = validateAutomationToggle({ automationKey: 'not_real', enabled: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_automation_key')
  })
  it('rejects a non-boolean enabled', () => {
    const r = validateAutomationToggle({ automationKey: AUTOMATION_KEYS[0], enabled: 1 as unknown })
    expect(r.ok).toBe(false)
  })
})

describe('validateDefinitionToggle — narrow to one key', () => {
  it('accepts a valid opportunity_key token', () => {
    expect(validateDefinitionToggle({ opportunityKey: 'lapsed_14_days', enabled: false }).ok).toBe(true)
  })
  it('rejects invalid tokens (spaces, symbols, empty, too long)', () => {
    for (const key of ['', ' ', 'Has Space', 'UPPER', 'semi;colon', 'a'.repeat(101)]) {
      const r = validateDefinitionToggle({ opportunityKey: key, enabled: true })
      expect(r.ok, key).toBe(false)
      if (!r.ok) expect(r.error).toBe('invalid_opportunity_key')
    }
  })
  it('rejects a non-boolean enabled', () => {
    const r = validateDefinitionToggle({ opportunityKey: 'valid_key', enabled: 'x' as unknown })
    expect(r.ok).toBe(false)
  })
})
