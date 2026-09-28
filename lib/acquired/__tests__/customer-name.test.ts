import { describe, it, expect } from 'vitest'
import {
  ACQUIRED_NAME_MAX_LENGTH,
  ACQUIRED_NAME_PATTERN,
  classifyAcquiredCustomerError,
  collectKnownCustomerName,
  combineNameErrorCode,
  deriveCustomerName,
  findCustomerNameProblems,
  normalizeCustomerName,
  resolveCustomerName,
  validateCustomerName,
} from '@/lib/acquired/customer-name'

/**
 * These tests are the authoritative coverage for the Acquired customer-name
 * fix. The checkout route (app/api/payments/acquired/create-checkout/route.ts)
 * delegates ALL name decisions to these pure functions, so the HTTP behaviour
 * required by the spec is expressed here as:
 *   - resolveCustomerName(...) not ok  => route returns 422 BEFORE calling
 *     Acquired (customer_name_required / customer_name_invalid).
 *   - classifyAcquiredCustomerError(...) === 'name_validation' => route maps a
 *     provider 400 to 422; 'reference_conflict' => unchanged recovery;
 *     'upstream' => unchanged 502.
 */

describe('normalizeCustomerName', () => {
  it('preserves a normal name unchanged', () => {
    const r = normalizeCustomerName('Edward')
    expect(r.value).toBe('Edward')
    expect(r.wasNormalised).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    const r = normalizeCustomerName('  Edward  ')
    expect(r.value).toBe('Edward')
    expect(r.wasNormalised).toBe(true)
  })

  it('collapses repeated internal spaces', () => {
    expect(normalizeCustomerName('Mary   Jane').value).toBe('Mary Jane')
  })

  it('collapses tabs/newlines to a single space', () => {
    expect(normalizeCustomerName('Mary\t\nJane').value).toBe('Mary Jane')
  })

  it('keeps a hyphenated surname', () => {
    const r = normalizeCustomerName('Smith-Jones')
    expect(r.value).toBe('Smith-Jones')
    expect(ACQUIRED_NAME_PATTERN.test(r.value)).toBe(true)
  })

  it('keeps an apostrophe surname', () => {
    const r = normalizeCustomerName("O'Brien")
    expect(r.value).toBe("O'Brien")
    expect(ACQUIRED_NAME_PATTERN.test(r.value)).toBe(true)
  })

  it('folds accented characters to base ASCII (José -> Jose)', () => {
    const r = normalizeCustomerName('José')
    expect(r.value).toBe('Jose')
    expect(r.wasNormalised).toBe(true)
    expect(ACQUIRED_NAME_PATTERN.test(r.value)).toBe(true)
  })

  it('folds precomposed and decomposed accents identically', () => {
    // U+00F1 (ñ) vs n + U+0303 (combining tilde) both fold to "n".
    expect(normalizeCustomerName('Pe\u00f1a').value).toBe('Pena')
    expect(normalizeCustomerName('Pen\u0303a').value).toBe('Pena')
  })

  it('folds smart apostrophes and unicode dashes to ASCII', () => {
    expect(normalizeCustomerName('O\u2019Brien').value).toBe("O'Brien")
    expect(normalizeCustomerName('Smith\u2013Jones').value).toBe('Smith-Jones')
  })

  it('does not throw on non-string input', () => {
    expect(normalizeCustomerName(undefined).value).toBe('')
    expect(normalizeCustomerName(null).value).toBe('')
    expect(normalizeCustomerName(42 as unknown).value).toBe('')
  })
})

describe('validateCustomerName', () => {
  it('accepts a normal first and last name', () => {
    expect(validateCustomerName('Edward', 'first_name')).toMatchObject({ ok: true, value: 'Edward' })
    expect(validateCustomerName('Johnson', 'last_name')).toMatchObject({ ok: true, value: 'Johnson' })
  })

  it('accepts a name after trimming surrounding whitespace', () => {
    expect(validateCustomerName('  Edward ', 'first_name')).toMatchObject({ ok: true, value: 'Edward' })
  })

  it('accepts a name after collapsing repeated internal spaces', () => {
    expect(validateCustomerName('Mary   Jane', 'first_name')).toMatchObject({
      ok: true,
      value: 'Mary Jane',
    })
  })

  it('accepts a hyphenated surname', () => {
    expect(validateCustomerName('Smith-Jones', 'last_name')).toMatchObject({ ok: true })
  })

  it('accepts a surname containing an apostrophe', () => {
    expect(validateCustomerName("O'Brien", 'last_name')).toMatchObject({ ok: true })
  })

  it('accepts accented characters by folding them', () => {
    expect(validateCustomerName('José', 'first_name')).toMatchObject({ ok: true, value: 'Jose' })
  })

  it('accepts a compound surname containing spaces', () => {
    expect(validateCustomerName('van der Berg', 'last_name')).toMatchObject({
      ok: true,
      value: 'van der Berg',
    })
  })

  it('rejects a missing first name as customer_name_required', () => {
    expect(validateCustomerName('', 'first_name')).toMatchObject({
      ok: false,
      error: 'customer_name_required',
      field: 'first_name',
    })
  })

  it('rejects a missing surname as customer_name_required', () => {
    expect(validateCustomerName(undefined, 'last_name')).toMatchObject({
      ok: false,
      error: 'customer_name_required',
      field: 'last_name',
    })
  })

  it('rejects a whitespace-only surname as customer_name_required', () => {
    expect(validateCustomerName('   ', 'last_name')).toMatchObject({
      ok: false,
      error: 'customer_name_required',
    })
  })

  it('rejects names with digits or symbols as customer_name_invalid', () => {
    expect(validateCustomerName('Edward3', 'first_name')).toMatchObject({
      ok: false,
      error: 'customer_name_invalid',
    })
    expect(validateCustomerName('a@b', 'last_name')).toMatchObject({
      ok: false,
      error: 'customer_name_invalid',
    })
  })

  it('rejects characters that cannot fold to ASCII (e.g. œ, ß)', () => {
    expect(validateCustomerName('œlan', 'first_name')).toMatchObject({
      ok: false,
      error: 'customer_name_invalid',
    })
    expect(validateCustomerName('Straße', 'last_name')).toMatchObject({
      ok: false,
      error: 'customer_name_invalid',
    })
  })

  it('accepts the provider-confirmed maximum length (50)', () => {
    const fifty = 'a'.repeat(ACQUIRED_NAME_MAX_LENGTH)
    expect(fifty.length).toBe(50)
    expect(validateCustomerName(fifty, 'last_name')).toMatchObject({ ok: true })
  })

  it('rejects a name longer than the provider maximum (51)', () => {
    const fiftyOne = 'a'.repeat(ACQUIRED_NAME_MAX_LENGTH + 1)
    expect(validateCustomerName(fiftyOne, 'last_name')).toMatchObject({
      ok: false,
      error: 'customer_name_invalid',
    })
  })
})

describe('deriveCustomerName (no inference from legacy display fields)', () => {
  it('uses only explicit user_metadata first/last name', () => {
    expect(deriveCustomerName({ metaFirstName: 'Edward', metaLastName: 'Johnson' })).toEqual({
      firstName: 'Edward',
      lastName: 'Johnson',
    })
  })

  it('never infers a payment name from a single-word real_name (bengovier case)', () => {
    // The production regression: real_name "bengovier" must NOT become a
    // payment first name, and must not be treated as a known name at all.
    expect(deriveCustomerName({ realName: 'bengovier' } as any)).toEqual({
      firstName: '',
      lastName: '',
    })
    expect(collectKnownCustomerName({ realName: 'bengovier' } as any)).toEqual({})
  })

  it('never infers a payment name from a two-word real_name', () => {
    expect(deriveCustomerName({ realName: 'Ben Govier' } as any)).toEqual({
      firstName: '',
      lastName: '',
    })
    expect(collectKnownCustomerName({ realName: 'Ben Govier' } as any)).toEqual({})
  })

  it('never infers a payment name from display_name', () => {
    expect(deriveCustomerName({ metaDisplayName: 'Ben Govier' } as any)).toEqual({
      firstName: '',
      lastName: '',
    })
    expect(collectKnownCustomerName({ metaDisplayName: 'Ben Govier' } as any)).toEqual({})
  })

  it('trims stored metadata values', () => {
    expect(deriveCustomerName({ metaFirstName: '  Ada  ', metaLastName: ' Lovelace ' })).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })
})

describe('collectKnownCustomerName (drives inline-form prefill)', () => {
  it('returns both fields when both are stored and valid', () => {
    expect(collectKnownCustomerName({ metaFirstName: 'Ada', metaLastName: 'Lovelace' })).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
    })
  })

  it('returns only the first name when the surname is missing', () => {
    expect(collectKnownCustomerName({ metaFirstName: 'Ada', metaLastName: '' })).toEqual({
      first_name: 'Ada',
    })
  })

  it('returns only the surname when the first name is missing', () => {
    expect(collectKnownCustomerName({ metaFirstName: '', metaLastName: 'Lovelace' })).toEqual({
      last_name: 'Lovelace',
    })
  })

  it('omits an invalid stored value rather than echoing junk back', () => {
    expect(collectKnownCustomerName({ metaFirstName: 'Ada', metaLastName: '12345' })).toEqual({
      first_name: 'Ada',
    })
  })

  it('returns nothing when the account has no explicit name', () => {
    expect(collectKnownCustomerName({})).toEqual({})
  })

  it('normalises the value it prefills', () => {
    expect(collectKnownCustomerName({ metaFirstName: 'José', metaLastName: 'Peña' })).toEqual({
      first_name: 'Jose',
      last_name: 'Pena',
    })
  })
})

describe('resolveCustomerName', () => {
  it('resolves and normalises a full valid name', () => {
    expect(resolveCustomerName({ metaFirstName: '  José ', metaLastName: 'Peña' })).toEqual({
      ok: true,
      firstName: 'Jose',
      lastName: 'Pena',
      wasNormalised: true,
    })
  })

  it('returns customer_name_required when only the first name is stored', () => {
    expect(resolveCustomerName({ metaFirstName: 'Cher' })).toMatchObject({
      ok: false,
      error: 'customer_name_required',
      field: 'last_name',
    })
  })

  it('requires a name even when a legacy real_name/display_name exists', () => {
    // Legacy display fields are no longer a payment-name source, so an account
    // with ONLY those must still be asked for both fields.
    expect(
      resolveCustomerName({ realName: 'Ben Govier', metaDisplayName: 'Ben Govier' } as any),
    ).toMatchObject({
      ok: false,
      error: 'customer_name_required',
      field: 'first_name',
    })
  })

  it('returns customer_name_required when the first name is missing', () => {
    expect(resolveCustomerName({ metaLastName: 'Johnson' })).toMatchObject({
      ok: false,
      error: 'customer_name_required',
      field: 'first_name',
    })
  })

  it('returns customer_name_invalid for a bad surname and reports its length', () => {
    const r = resolveCustomerName({ metaFirstName: 'Edward', metaLastName: 'Johnson99' })
    expect(r).toMatchObject({
      ok: false,
      error: 'customer_name_invalid',
      field: 'last_name',
    })
    if (!r.ok) expect(r.nameLength).toBe('Johnson99'.length)
  })

  it('checks the first name before the last name', () => {
    // both invalid -> first_name reported first
    expect(resolveCustomerName({ metaFirstName: 'Bad1', metaLastName: 'Bad2' })).toMatchObject({
      field: 'first_name',
    })
  })
})

describe('classifyAcquiredCustomerError', () => {
  it('maps a 400 naming last_name to name_validation/last_name', () => {
    const body = { invalid_parameters: [{ parameter: 'last_name', reason: 'invalid' }] }
    expect(classifyAcquiredCustomerError(400, body)).toEqual({
      kind: 'name_validation',
      field: 'last_name',
    })
  })

  it('maps a 400 naming first_name to name_validation/first_name', () => {
    const body = { invalid_parameters: [{ parameter: 'first_name' }] }
    expect(classifyAcquiredCustomerError(400, body)).toEqual({
      kind: 'name_validation',
      field: 'first_name',
    })
  })

  it('detects the field from free-text bodies as a fallback', () => {
    expect(classifyAcquiredCustomerError(400, { message: 'last_name validation failed' })).toEqual({
      kind: 'name_validation',
      field: 'last_name',
    })
  })

  it('maps a 409 reference conflict to reference_conflict (recovery unchanged)', () => {
    const body = { invalid_parameters: [{ parameter: 'reference' }] }
    expect(classifyAcquiredCustomerError(409, body)).toEqual({ kind: 'reference_conflict' })
  })

  it('treats a 400 with no name/field info as upstream (stays 502)', () => {
    expect(classifyAcquiredCustomerError(400, { message: 'bad request' })).toEqual({
      kind: 'upstream',
    })
  })

  it('treats 5xx / auth / empty bodies as upstream (stays 502)', () => {
    expect(classifyAcquiredCustomerError(500, null)).toEqual({ kind: 'upstream' })
    expect(classifyAcquiredCustomerError(401, {})).toEqual({ kind: 'upstream' })
    expect(classifyAcquiredCustomerError(503, 'gateway error')).toEqual({ kind: 'upstream' })
  })

  it('does not misclassify a 409 that names first_name as a name error', () => {
    // Only 400 is a deterministic name-validation status; a 409 is a conflict.
    const body = { invalid_parameters: [{ parameter: 'first_name' }] }
    expect(classifyAcquiredCustomerError(409, body)).toEqual({ kind: 'upstream' })
  })
})

describe('findCustomerNameProblems (drives the inline form requiredFields)', () => {
  it('returns no problems for a fully valid stored name', () => {
    const problems = findCustomerNameProblems({
      metaFirstName: 'Ada',
      metaLastName: 'Lovelace',
    })
    expect(problems).toEqual([])
  })

  it('flags both fields when the account has no name at all', () => {
    const problems = findCustomerNameProblems({ metaFirstName: '', metaLastName: '' })
    expect(problems.map((p) => p.field)).toEqual(['first_name', 'last_name'])
    expect(problems.every((p) => p.error === 'customer_name_required')).toBe(true)
  })

  it('flags only the missing surname when the first name is stored', () => {
    const problems = findCustomerNameProblems({ metaFirstName: 'Ada', metaLastName: '' })
    expect(problems.map((p) => p.field)).toEqual(['last_name'])
  })

  it('flags only the missing first name when the surname is stored', () => {
    const problems = findCustomerNameProblems({ metaFirstName: '', metaLastName: 'Lovelace' })
    expect(problems.map((p) => p.field)).toEqual(['first_name'])
  })

  it('flags both fields when only a legacy real_name exists', () => {
    const problems = findCustomerNameProblems({ realName: 'bengovier' } as any)
    expect(problems.map((p) => p.field)).toEqual(['first_name', 'last_name'])
  })

  it('flags a present-but-unnormalisable field as invalid, not required', () => {
    const problems = findCustomerNameProblems({
      metaFirstName: 'Ada',
      metaLastName: '12345', // digits survive normalisation but fail the pattern
    })
    expect(problems).toEqual([{ field: 'last_name', error: 'customer_name_invalid' }])
  })
})

describe('combineNameErrorCode (route 422 error code)', () => {
  it('is customer_name_required only when every problem is a missing value', () => {
    expect(
      combineNameErrorCode([
        { field: 'first_name', error: 'customer_name_required' },
        { field: 'last_name', error: 'customer_name_required' },
      ]),
    ).toBe('customer_name_required')
  })

  it('is customer_name_invalid when any problem is a present invalid value', () => {
    expect(
      combineNameErrorCode([
        { field: 'first_name', error: 'customer_name_required' },
        { field: 'last_name', error: 'customer_name_invalid' },
      ]),
    ).toBe('customer_name_invalid')
  })

  it('defaults to customer_name_invalid for an empty problem list', () => {
    // Never used by the route on the ok path, but must be well-defined.
    expect(combineNameErrorCode([])).toBe('customer_name_invalid')
  })
})
