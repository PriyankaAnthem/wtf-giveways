import { describe, it, expect } from 'vitest'
import {
  ENQUIRY_TYPES,
  INBOX_ENQUIRY_TYPES,
  INBOX_EXCLUDED_ENQUIRY_TYPES,
  isInboxEnquiryType,
  buildInboxExclusionOrFilter,
} from '@/lib/admin/inbox/types'

describe('Inbox enquiry-type exclusion (winner_payout owned by Payouts module)', () => {
  it('excludes winner_payout from the Inbox-eligible set', () => {
    expect(INBOX_ENQUIRY_TYPES).not.toContain('winner_payout')
    expect(INBOX_EXCLUDED_ENQUIRY_TYPES).toContain('winner_payout')
  })

  it('keeps every support enquiry type', () => {
    expect(INBOX_ENQUIRY_TYPES).toEqual([
      'general',
      'ticket_order_problem',
      'account_login_issue',
      'other',
    ])
  })

  it('is exactly ENQUIRY_TYPES minus the excluded types (no invented/missing types)', () => {
    const expected = ENQUIRY_TYPES.filter(
      (t) => !INBOX_EXCLUDED_ENQUIRY_TYPES.includes(t),
    )
    expect([...INBOX_ENQUIRY_TYPES]).toEqual([...expected])
  })

  it('isInboxEnquiryType: true for support types, false for winner_payout', () => {
    expect(isInboxEnquiryType('general')).toBe(true)
    expect(isInboxEnquiryType('ticket_order_problem')).toBe(true)
    expect(isInboxEnquiryType('account_login_issue')).toBe(true)
    expect(isInboxEnquiryType('other')).toBe(true)
    expect(isInboxEnquiryType('winner_payout')).toBe(false)
  })

  it('isInboxEnquiryType: unknown types are not treated as excluded (default eligible)', () => {
    expect(isInboxEnquiryType('some_future_type')).toBe(true)
  })
})

describe('buildInboxExclusionOrFilter (NULL-safe payout exclusion for the list query)', () => {
  const filter = buildInboxExclusionOrFilter()

  it('produces the exact NULL-safe PostgREST or() condition (no redundant and() wrapper)', () => {
    // Effective SQL: enquiry_type IS NULL OR enquiry_type <> 'winner_payout'
    expect(filter).toBe('enquiry_type.is.null,enquiry_type.neq.winner_payout')
  })

  it('does NOT wrap a single excluded type in an and() group', () => {
    // Guards against regressing back to the redundant `and(...)` form while
    // there is exactly one excluded type.
    if (INBOX_EXCLUDED_ENQUIRY_TYPES.length === 1) {
      expect(filter).not.toContain('and(')
    }
  })

  it('keeps the is.null branch so legacy/null-type support rows are NOT hidden', () => {
    // This is the whole point of the change vs a plain NOT IN / <> (which drops
    // NULL rows). The condition must include an explicit null-matching branch.
    expect(filter.startsWith('enquiry_type.is.null,')).toBe(true)
  })

  it('still excludes every configured payout type (exclusion not loosened)', () => {
    for (const excluded of INBOX_EXCLUDED_ENQUIRY_TYPES) {
      expect(filter).toContain(`enquiry_type.neq.${excluded}`)
    }
  })

  it('emits one neq clause per excluded type', () => {
    const neqCount = (filter.match(/enquiry_type\.neq\./g) ?? []).length
    expect(neqCount).toBe(INBOX_EXCLUDED_ENQUIRY_TYPES.length)
  })
})
