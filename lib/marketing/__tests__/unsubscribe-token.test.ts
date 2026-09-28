import { describe, it, expect, beforeAll, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

// `server-only` throws when imported outside a Server Component; make it a no-op
// in tests (same approach as lib/discounts/__tests__/validateDiscountCode.test.ts).
vi.mock('server-only', () => ({}))

// A valid 32-byte base64 key MUST be present before the module resolves its key
// (getKey reads process.env at call time, so setting it here is sufficient).
beforeAll(() => {
  process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET = randomBytes(32).toString('base64')
})

// Imported after the env contract is documented above. The module reads the
// secret lazily per call, so a normal top-level import is safe.
import {
  createUnsubscribeToken,
  parseUnsubscribeToken,
  isUnsubscribeTokenSecretConfigured,
  maskEmail,
} from '../unsubscribe-token'

describe('unsubscribe token', () => {
  it('round-trips a user id + normalised email', () => {
    const token = createUnsubscribeToken('user-123', 'Person@Example.com')
    const parsed = parseUnsubscribeToken(token)
    expect(parsed).not.toBeNull()
    expect(parsed!.userId).toBe('user-123')
    // Email is normalised (trim + lowercase) inside the token.
    expect(parsed!.emailLc).toBe('person@example.com')
    expect(parsed!.version).toBe(1)
    expect(typeof parsed!.issuedAt).toBe('string')
  })

  it('produces opaque tokens that do not leak the email or user id', () => {
    const token = createUnsubscribeToken('user-abc', 'secret@example.com')
    expect(token).not.toContain('secret@example.com')
    expect(token).not.toContain('user-abc')
  })

  it('produces a distinct token each call (random IV) that still decrypts', () => {
    const a = createUnsubscribeToken('user-1', 'a@example.com')
    const b = createUnsubscribeToken('user-1', 'a@example.com')
    expect(a).not.toBe(b)
    expect(parseUnsubscribeToken(a)!.emailLc).toBe('a@example.com')
    expect(parseUnsubscribeToken(b)!.emailLc).toBe('a@example.com')
  })

  it('rejects a tampered token (GCM auth tag fails closed)', () => {
    const token = createUnsubscribeToken('user-9', 'z@example.com')
    // Flip a character in the middle of the token.
    const mid = Math.floor(token.length / 2)
    const flipped = token[mid] === 'A' ? 'B' : 'A'
    const tampered = token.slice(0, mid) + flipped + token.slice(mid + 1)
    // Either it no longer decodes/authenticates (null) or, in the astronomically
    // unlikely case the flip is a no-op, it still equals the original payload.
    const parsed = parseUnsubscribeToken(tampered)
    if (parsed !== null) {
      expect(tampered).toBe(token)
    } else {
      expect(parsed).toBeNull()
    }
  })

  it('rejects a token created under a different secret', () => {
    const token = createUnsubscribeToken('user-5', 'x@example.com')
    const original = process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET
    try {
      process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET = randomBytes(32).toString('base64')
      expect(parseUnsubscribeToken(token)).toBeNull()
    } finally {
      process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET = original
    }
  })

  it('returns null for missing / malformed / non-string input', () => {
    expect(parseUnsubscribeToken(undefined)).toBeNull()
    expect(parseUnsubscribeToken('')).toBeNull()
    expect(parseUnsubscribeToken('not-a-real-token')).toBeNull()
    expect(parseUnsubscribeToken(12345 as unknown)).toBeNull()
    expect(parseUnsubscribeToken('AAAA')).toBeNull() // too short to hold iv+tag
  })

  it('fails closed when the secret is missing or the wrong length', () => {
    const original = process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET
    try {
      delete process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET
      expect(isUnsubscribeTokenSecretConfigured()).toBe(false)
      expect(() => createUnsubscribeToken('u', 'a@example.com')).toThrow()
      expect(parseUnsubscribeToken('anything')).toBeNull()

      process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET = Buffer.from('too-short').toString('base64')
      expect(isUnsubscribeTokenSecretConfigured()).toBe(false)
    } finally {
      process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET = original
      expect(isUnsubscribeTokenSecretConfigured()).toBe(true)
    }
  })
})

describe('maskEmail', () => {
  it('shows only the first local char and the full domain', () => {
    expect(maskEmail('benjamin@example.com')).toBe('b***@example.com')
    expect(maskEmail('A@Domain.CO.UK')).toBe('a***@domain.co.uk')
  })

  it('never returns the full local part', () => {
    const masked = maskEmail('longlocalpart@wtf.com')
    expect(masked).toBe('l***@wtf.com')
    expect(masked).not.toContain('longlocalpart')
  })

  it('degrades safely for malformed values', () => {
    expect(maskEmail('no-at-sign')).toBe('***')
    expect(maskEmail('@nolocal.com')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })
})
