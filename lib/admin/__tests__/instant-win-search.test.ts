import { describe, expect, it } from 'vitest'
import {
  dedupe,
  escapeLike,
  isValidUuid,
  IW_MAX_QUERY_LEN,
  IW_MIN_QUERY_LEN,
  normalizeSearchQuery,
  parseTicketNumber,
} from '../instant-win-search'

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('isValidUuid', () => {
  it('accepts a well-formed UUID (any case, surrounding space)', () => {
    expect(isValidUuid(UUID)).toBe(true)
    expect(isValidUuid(UUID.toUpperCase())).toBe(true)
    expect(isValidUuid(`  ${UUID}  `)).toBe(true)
  })

  it('rejects malformed / non-UUID values', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false)
    expect(isValidUuid('123')).toBe(false)
    expect(isValidUuid(`${UUID}extra`)).toBe(false)
    expect(isValidUuid('')).toBe(false)
  })
})

describe('escapeLike', () => {
  it('escapes LIKE wildcards so they are treated literally', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('%_%')).toBe('\\%\\_\\%')
  })

  it('escapes backslashes without double-processing the escapes it adds', () => {
    // A single input backslash becomes a single escaped backslash; the `%`/`_`
    // escapes it introduces must not themselves be re-escaped.
    expect(escapeLike('a\\b')).toBe('a\\\\b')
    expect(escapeLike('50%_off')).toBe('50\\%\\_off')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('john smith')).toBe('john smith')
    expect(escapeLike('REF-ABC123')).toBe('REF-ABC123')
  })
})

describe('parseTicketNumber', () => {
  it('parses a bare run of digits', () => {
    expect(parseTicketNumber('333')).toBe(333)
    expect(parseTicketNumber('0')).toBe(0)
  })

  it('strips a single leading # and trims whitespace', () => {
    expect(parseTicketNumber('#333')).toBe(333)
    expect(parseTicketNumber('  #12  ')).toBe(12)
    expect(parseTicketNumber('  9 ')).toBe(9)
  })

  it('rejects non-numeric, mixed, or double-hash values', () => {
    expect(parseTicketNumber('12a')).toBeNull()
    expect(parseTicketNumber('##12')).toBeNull()
    expect(parseTicketNumber('12.5')).toBeNull()
    expect(parseTicketNumber('-4')).toBeNull()
    expect(parseTicketNumber('')).toBeNull()
    expect(parseTicketNumber('#')).toBeNull()
  })

  it('rejects numbers beyond the safe-integer range', () => {
    expect(parseTicketNumber('999999999999999999999')).toBeNull()
  })
})

describe('dedupe', () => {
  it('removes duplicates preserving first-seen order', () => {
    expect(dedupe(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
    expect(dedupe([1, 1, 2, 3, 3, 3])).toEqual([1, 2, 3])
    expect(dedupe<string>([])).toEqual([])
  })
})

describe('normalizeSearchQuery', () => {
  it('treats null/undefined/blank as blank (return recent winners)', () => {
    expect(normalizeSearchQuery(null).kind).toBe('blank')
    expect(normalizeSearchQuery(undefined).kind).toBe('blank')
    expect(normalizeSearchQuery('   ').kind).toBe('blank')
  })

  it('rejects control characters as invalid_query', () => {
    const res = normalizeSearchQuery('john\u0000smith')
    expect(res).toEqual({ kind: 'error', error: 'invalid_query' })
    expect(normalizeSearchQuery('a\tb').kind).toBe('error')
    expect(normalizeSearchQuery('a\nb').kind).toBe('error')
  })

  it('rejects an over-long query as query_too_long', () => {
    const res = normalizeSearchQuery('x'.repeat(IW_MAX_QUERY_LEN + 1))
    expect(res).toEqual({ kind: 'error', error: 'query_too_long' })
  })

  it('rejects a short non-uuid, non-ticket term as query_too_short', () => {
    expect(normalizeSearchQuery('ab')).toEqual({ kind: 'error', error: 'query_too_short' })
    expect(IW_MIN_QUERY_LEN).toBe(3)
  })

  it('accepts a short ticket-shaped term but skips identity search below min length', () => {
    const res = normalizeSearchQuery('12')
    expect(res.kind).toBe('search')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.ticketNumber).toBe(12)
    // Too short for identity/text sources, so only the ticket lookup runs.
    expect(res.runIdentitySearch).toBe(false)
  })

  it('runs both identity and ticket search for a long bare-digit term', () => {
    const res = normalizeSearchQuery('1107')
    expect(res.kind).toBe('search')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.ticketNumber).toBe(1107)
    // >= min length and not #-prefixed, so identity search also runs.
    expect(res.runIdentitySearch).toBe(true)
  })

  it('treats a UUID as a valid search regardless of length rule', () => {
    const res = normalizeSearchQuery(UUID)
    expect(res.kind).toBe('search')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.isUuid).toBe(true)
    expect(res.runIdentitySearch).toBe(true)
    expect(res.ticketNumber).toBeNull()
  })

  it('makes an explicit #-prefixed ticket query ticket-only', () => {
    const res = normalizeSearchQuery('#333')
    expect(res.kind).toBe('search')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.ticketNumber).toBe(333)
    // Never sent to the identity RPC (which would treat "#..." as invalid).
    expect(res.runIdentitySearch).toBe(false)
  })

  it('builds a wildcard-escaped ILIKE pattern from ordinary text', () => {
    const res = normalizeSearchQuery('john smith')
    expect(res.kind).toBe('search')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.raw).toBe('john smith')
    expect(res.likePattern).toBe('%john smith%')
    expect(res.runIdentitySearch).toBe(true)
  })

  it('escapes wildcards inside the ILIKE pattern', () => {
    const res = normalizeSearchQuery('50%_off')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.likePattern).toBe('%50\\%\\_off%')
  })

  it('trims surrounding whitespace into the raw term', () => {
    const res = normalizeSearchQuery('   REF-ABC   ')
    if (res.kind !== 'search') throw new Error('expected search')
    expect(res.raw).toBe('REF-ABC')
    expect(res.likePattern).toBe('%REF-ABC%')
  })
})
