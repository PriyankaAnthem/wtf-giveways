/**
 * Acquired customer-name normalisation and validation.
 *
 * These are PURE functions (no I/O, no Node/DOM APIs beyond String/RegExp) so
 * they can be shared by the server checkout route AND the client sign-up form,
 * and unit-tested in isolation.
 *
 * Acquired's confirmed rules for `first_name` / `last_name`
 * (source: https://docs.acquired.com/reference/create-customer):
 *   - length between 0 and 50
 *   - regex: ^[a-zA-Z\.\- ']*$   (ASCII letters, period, hyphen, space, apostrophe)
 *   - `last_name` is required for MCC 6012 merchants.
 *
 * Acquired's character class does NOT permit accented letters or "smart"
 * punctuation. Rather than REJECT legitimate names that contain them, we
 * normalise them to the closest Acquired-acceptable ASCII form:
 *   - Unicode "smart" apostrophes/quotes -> ASCII apostrophe (')
 *   - Unicode dashes/hyphens             -> ASCII hyphen (-)
 *   - accented letters (via NFD)         -> base ASCII letter (José -> Jose)
 * A name is only rejected when, AFTER this normalisation, it is empty or still
 * contains characters Acquired cannot accept (e.g. œ, ß, digits, symbols).
 */

/** Acquired's documented maximum length for first_name / last_name. */
export const ACQUIRED_NAME_MAX_LENGTH = 50

/**
 * Acquired's documented character class for names. We require at least one
 * character (Acquired allows 0, but for our checkout a present name must be
 * non-empty — absence is handled separately as `customer_name_required`).
 */
export const ACQUIRED_NAME_PATTERN = /^[a-zA-Z.\-' ]+$/

export type CustomerNameField = 'first_name' | 'last_name'
export type CustomerNameErrorCode = 'customer_name_required' | 'customer_name_invalid'

export interface NormalizedName {
  /** The normalised value (may be an empty string). */
  value: string
  /** True when normalisation changed the input in any way. */
  wasNormalised: boolean
}

// Common non-ASCII apostrophe / single-quote characters mapped to ASCII '.
const APOSTROPHE_LIKE = /[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g
// Common Unicode dashes/hyphens mapped to ASCII -.
const DASH_LIKE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g
// Unicode combining marks (diacritics) left over after NFD decomposition.
const COMBINING_MARKS = /[\u0300-\u036f]/g

/**
 * Normalise a raw name into the closest Acquired-acceptable ASCII form.
 * Deterministic and side-effect free. Never throws.
 */
export function normalizeCustomerName(raw: unknown): NormalizedName {
  const original = typeof raw === 'string' ? raw : ''

  let value = original
    // Fold "smart" punctuation to ASCII equivalents first.
    .replace(APOSTROPHE_LIKE, "'")
    .replace(DASH_LIKE, '-')
    // Canonical composition, then decompose + strip diacritics so accented
    // letters fold to their base ASCII letter (é -> e, ñ -> n).
    .normalize('NFC')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    // Collapse any run of whitespace (incl. tabs/newlines) to a single space.
    .replace(/\s+/g, ' ')
    // Trim leading/trailing whitespace.
    .trim()

  return { value, wasNormalised: value !== original }
}

export type CustomerNameValidation =
  | { ok: true; value: string; wasNormalised: boolean }
  | { ok: false; error: CustomerNameErrorCode; field: CustomerNameField; wasNormalised: boolean }

/**
 * Validate a single name field against Acquired's confirmed rules, after
 * normalisation.
 *   - empty / missing            -> customer_name_required
 *   - too long or bad characters -> customer_name_invalid
 */
export function validateCustomerName(raw: unknown, field: CustomerNameField): CustomerNameValidation {
  const { value, wasNormalised } = normalizeCustomerName(raw)

  if (value.length === 0) {
    return { ok: false, error: 'customer_name_required', field, wasNormalised }
  }
  if (value.length > ACQUIRED_NAME_MAX_LENGTH || !ACQUIRED_NAME_PATTERN.test(value)) {
    return { ok: false, error: 'customer_name_invalid', field, wasNormalised }
  }
  return { ok: true, value, wasNormalised }
}

/**
 * The ONLY legitimate stored sources of a payment name.
 *
 * Deliberately does NOT include `profiles_private.real_name` or
 * `user_metadata.display_name`. Those are legacy display/username fields: for
 * ~3,100 legacy accounts `real_name` is a single word (e.g. "bengovier"), which
 * previously produced either a bogus payment first name or an unfixable missing
 * surname. A payment name must be a name the customer explicitly gave us as
 * their first/last name — never one inferred from a display handle.
 */
export interface CustomerNameInputs {
  /** user_metadata.first_name */
  metaFirstName?: string | null
  /** user_metadata.last_name */
  metaLastName?: string | null
}

/**
 * Read the raw first/last name from the only legitimate stored sources.
 *
 * There is NO inference: a missing field stays missing so the customer is asked
 * for exactly that field. Returns RAW (un-normalised) values.
 */
export function deriveCustomerName(inputs: CustomerNameInputs): {
  firstName: string
  lastName: string
} {
  return {
    firstName: (inputs.metaFirstName ?? '').trim(),
    lastName: (inputs.metaLastName ?? '').trim(),
  }
}

/**
 * Return the subset of stored name fields that are already valid for Acquired,
 * normalised and ready to prefill the inline form. Fields that are missing or
 * unusable are simply absent, so the caller never echoes junk back to the user
 * and never asks them to retype a field we already legitimately hold.
 */
export function collectKnownCustomerName(inputs: CustomerNameInputs): {
  first_name?: string
  last_name?: string
} {
  const { firstName, lastName } = deriveCustomerName(inputs)
  const known: { first_name?: string; last_name?: string } = {}
  const first = validateCustomerName(firstName, 'first_name')
  if (first.ok) known.first_name = first.value
  const last = validateCustomerName(lastName, 'last_name')
  if (last.ok) known.last_name = last.value
  return known
}

export type ResolveCustomerNameResult =
  | { ok: true; firstName: string; lastName: string; wasNormalised: boolean }
  | {
      ok: false
      error: CustomerNameErrorCode
      field: CustomerNameField
      /** Length of the offending normalised value (safe to log — never the value). */
      nameLength: number
      wasNormalised: boolean
    }

/**
 * Derive + validate both names for an Acquired customer payload. Both a first
 * AND last name are required for our checkout (a missing surname is itself a
 * latent Acquired failure and MCC-6012 merchants require it). Returns the
 * normalised names ready to send, or the first validation error encountered
 * (first name checked before last name).
 */
export function resolveCustomerName(inputs: CustomerNameInputs): ResolveCustomerNameResult {
  const { firstName, lastName } = deriveCustomerName(inputs)

  const firstResult = validateCustomerName(firstName, 'first_name')
  if (!firstResult.ok) {
    const { value } = normalizeCustomerName(firstName)
    return {
      ok: false,
      error: firstResult.error,
      field: 'first_name',
      nameLength: value.length,
      wasNormalised: firstResult.wasNormalised,
    }
  }

  const lastResult = validateCustomerName(lastName, 'last_name')
  if (!lastResult.ok) {
    const { value } = normalizeCustomerName(lastName)
    return {
      ok: false,
      error: lastResult.error,
      field: 'last_name',
      nameLength: value.length,
      wasNormalised: lastResult.wasNormalised,
    }
  }

  return {
    ok: true,
    firstName: firstResult.value,
    lastName: lastResult.value,
    wasNormalised: firstResult.wasNormalised || lastResult.wasNormalised,
  }
}

export interface CustomerNameProblem {
  field: CustomerNameField
  error: CustomerNameErrorCode
}

/**
 * Return every name field that is missing or invalid, after deriving from the
 * best available source. An empty array means both names are acceptable.
 * Used to build the checkout `requiredFields` payload so the inline form can ask
 * for exactly the fields that need attention (both, when both are missing).
 */
export function findCustomerNameProblems(inputs: CustomerNameInputs): CustomerNameProblem[] {
  const { firstName, lastName } = deriveCustomerName(inputs)
  const problems: CustomerNameProblem[] = []
  const first = validateCustomerName(firstName, 'first_name')
  if (!first.ok) problems.push({ field: 'first_name', error: first.error })
  const last = validateCustomerName(lastName, 'last_name')
  if (!last.ok) problems.push({ field: 'last_name', error: last.error })
  return problems
}

/**
 * Collapse a set of field problems into a single response error code: only
 * `customer_name_required` when EVERY problem is a missing value, otherwise
 * `customer_name_invalid` (a present-but-unnormalisable value takes precedence).
 */
export function combineNameErrorCode(problems: CustomerNameProblem[]): CustomerNameErrorCode {
  return problems.length > 0 && problems.every((p) => p.error === 'customer_name_required')
    ? 'customer_name_required'
    : 'customer_name_invalid'
}

export type AcquiredCustomerErrorClass =
  | { kind: 'reference_conflict' }
  | { kind: 'name_validation'; field: CustomerNameField }
  | { kind: 'upstream' }

/**
 * Classify an Acquired non-2xx response to `POST /v1/customers`.
 *
 *   - 409 whose invalid_parameters names `reference` -> reference_conflict
 *     (the customer already exists; recover by reference — unchanged behaviour).
 *   - 400 that identifies `first_name` / `last_name`  -> name_validation
 *     (deterministic bad customer data -> map to HTTP 422 for the user).
 *   - everything else                                  -> upstream
 *     (genuine provider/outage failure -> keep HTTP 502).
 *
 * Pure: inspects only the parsed body object. Never throws.
 */
export function classifyAcquiredCustomerError(
  status: number,
  body: unknown,
): AcquiredCustomerErrorClass {
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const invalidParameters = obj && Array.isArray(obj.invalid_parameters) ? obj.invalid_parameters : []

  const mentions = (needle: string): boolean =>
    invalidParameters.some(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof (p as Record<string, unknown>).parameter === 'string' &&
        (p as Record<string, unknown>).parameter === needle,
    )

  if (status === 409 && mentions('reference')) {
    return { kind: 'reference_conflict' }
  }

  if (status === 400) {
    if (mentions('last_name')) return { kind: 'name_validation', field: 'last_name' }
    if (mentions('first_name')) return { kind: 'name_validation', field: 'first_name' }
    // Some Acquired errors describe the field only in free-text; fall back to a
    // conservative scan of the serialised body for an explicit name parameter.
    const serialised = safeSerialise(obj).toLowerCase()
    if (/\blast_name\b/.test(serialised)) return { kind: 'name_validation', field: 'last_name' }
    if (/\bfirst_name\b/.test(serialised)) return { kind: 'name_validation', field: 'first_name' }
  }

  return { kind: 'upstream' }
}

function safeSerialise(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}
