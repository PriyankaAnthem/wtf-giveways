import { describe, it, expect } from 'vitest'
import {
  enquiryTypeLabel,
  isWinnerPayout,
  inboxStatusMeta,
  emailStatusMeta,
  buildMessagePreview,
  maskAccountNumber,
  maskSortCode,
  validateReplyBody,
  resolveStaffName,
} from '../format'
import { REPLY_MAX_LEN } from '../types'

describe('enquiryTypeLabel', () => {
  it('maps known enquiry types to friendly labels', () => {
    expect(enquiryTypeLabel('general')).toBe('General')
    expect(enquiryTypeLabel('winner_payout')).toBe('Winner payout')
    expect(enquiryTypeLabel('ticket_order_problem')).toBe('Ticket / order')
    expect(enquiryTypeLabel('account_login_issue')).toBe('Account / login')
    expect(enquiryTypeLabel('other')).toBe('Other')
  })

  it('title-cases unknown snake_case values instead of rendering blank', () => {
    expect(enquiryTypeLabel('bank_transfer')).toBe('Bank Transfer')
    expect(enquiryTypeLabel('paypal')).toBe('Paypal')
  })

  it('falls back to a generic label for empty/nullish input', () => {
    expect(enquiryTypeLabel('')).toBe('Enquiry')
    expect(enquiryTypeLabel(null)).toBe('Enquiry')
    expect(enquiryTypeLabel(undefined)).toBe('Enquiry')
  })
})

describe('isWinnerPayout', () => {
  it('is true only for the winner_payout type', () => {
    expect(isWinnerPayout('winner_payout')).toBe(true)
    expect(isWinnerPayout('general')).toBe(false)
    expect(isWinnerPayout(null)).toBe(false)
  })
})

describe('inboxStatusMeta', () => {
  it('pairs each status with a label and tone', () => {
    expect(inboxStatusMeta('open')).toEqual({ label: 'Open', tone: 'open' })
    expect(inboxStatusMeta('waiting')).toEqual({ label: 'Waiting', tone: 'waiting' })
    expect(inboxStatusMeta('resolved')).toEqual({ label: 'Resolved', tone: 'resolved' })
  })
})

describe('emailStatusMeta', () => {
  it('describes each delivery state; failed is flagged as a hard failure tone', () => {
    expect(emailStatusMeta('sent').tone).toBe('sent')
    expect(emailStatusMeta('pending').tone).toBe('pending')
    expect(emailStatusMeta('failed')).toEqual({ label: 'Email failed', tone: 'failed' })
    expect(emailStatusMeta('not_required').tone).toBe('muted')
  })
})

describe('buildMessagePreview', () => {
  it('collapses whitespace and newlines into a single line', () => {
    expect(buildMessagePreview('Hello\n\n  there   world')).toBe('Hello there world')
  })

  it('returns a placeholder for empty input', () => {
    expect(buildMessagePreview('')).toBe('No message')
    expect(buildMessagePreview(null)).toBe('No message')
    expect(buildMessagePreview('    \n  ')).toBe('No message')
  })

  it('truncates with an ellipsis beyond the max length', () => {
    const long = 'a'.repeat(200)
    const preview = buildMessagePreview(long, 140)
    expect(preview.length).toBe(140)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('leaves short strings untouched', () => {
    expect(buildMessagePreview('Short and sweet', 140)).toBe('Short and sweet')
  })
})

describe('maskAccountNumber', () => {
  it('shows only the last two digits', () => {
    expect(maskAccountNumber('12345678')).toBe('••••••78')
  })

  it('strips non-digits before masking', () => {
    expect(maskAccountNumber('1234 5678')).toBe('••••••78')
  })

  it('fully masks very short values and returns null for empty', () => {
    expect(maskAccountNumber('7')).toBe('••')
    expect(maskAccountNumber('')).toBeNull()
    expect(maskAccountNumber(null)).toBeNull()
  })
})

describe('maskSortCode', () => {
  it('masks all but the final pair', () => {
    expect(maskSortCode('123456')).toBe('••-••-56')
    expect(maskSortCode('12-34-56')).toBe('••-••-56')
  })

  it('returns a fully masked template for too-short values and null for empty', () => {
    expect(maskSortCode('1')).toBe('••-••-••')
    expect(maskSortCode('')).toBeNull()
    expect(maskSortCode(null)).toBeNull()
  })
})

describe('validateReplyBody', () => {
  it('accepts and trims a normal reply', () => {
    expect(validateReplyBody('  hello  ')).toEqual({ ok: true, body: 'hello' })
  })

  it('rejects empty / whitespace-only / non-string bodies', () => {
    expect(validateReplyBody('')).toEqual({ ok: false, error: 'empty' })
    expect(validateReplyBody('    ')).toEqual({ ok: false, error: 'empty' })
    expect(validateReplyBody(null)).toEqual({ ok: false, error: 'empty' })
    expect(validateReplyBody(123)).toEqual({ ok: false, error: 'empty' })
  })

  it('rejects bodies longer than the DB limit', () => {
    expect(validateReplyBody('a'.repeat(REPLY_MAX_LEN + 1))).toEqual({ ok: false, error: 'too_long' })
  })

  it('accepts a body exactly at the limit', () => {
    const atLimit = 'a'.repeat(REPLY_MAX_LEN)
    expect(validateReplyBody(atLimit)).toEqual({ ok: true, body: atLimit })
  })
})

describe('resolveStaffName', () => {
  it('prefers first + last name', () => {
    expect(
      resolveStaffName({ first_name: 'Ada', last_name: 'Lovelace', display_name: 'ada', email: 'a@x.io' }),
    ).toBe('Ada Lovelace')
  })

  it('falls back through first, last, display_name, then email', () => {
    expect(resolveStaffName({ first_name: 'Ada' })).toBe('Ada')
    expect(resolveStaffName({ last_name: 'Lovelace' })).toBe('Lovelace')
    expect(resolveStaffName({ display_name: 'ada_l' })).toBe('ada_l')
    expect(resolveStaffName({ email: 'ada@x.io' })).toBe('ada@x.io')
  })

  it('never returns a blank; defaults to Unknown', () => {
    expect(resolveStaffName({})).toBe('Unknown')
    expect(resolveStaffName({ first_name: '  ', email: '' })).toBe('Unknown')
  })
})
