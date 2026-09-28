import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Opaque, authenticated unsubscribe tokens (AES-256-GCM).
 *
 * A token carries the identity needed to unsubscribe a user WITHOUT exposing it:
 * the payload is encrypted and authenticated, so an attacker cannot read the
 * user id / email out of the token, and cannot tamper with it (the GCM auth tag
 * fails closed on any modification).
 *
 * Design:
 *   - Built entirely on Node's built-in crypto (no package installed).
 *   - Key comes from MARKETING_UNSUBSCRIBE_TOKEN_SECRET (base64, 32 bytes).
 *   - Wire format: base64url( iv(12) || ciphertext || authTag(16) ).
 *   - Parsing failures reveal NO customer information — callers get null.
 *   - The token and the decrypted email are NEVER logged.
 *
 * This utility is deliberately marketing-only. It will later be embedded in
 * marketing emails. It is NOT added to transactional checkout confirmation
 * emails, and no email is sent during Stage 0.
 */

const SECRET_ENV = 'MARKETING_UNSUBSCRIBE_TOKEN_SECRET'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const TOKEN_VERSION = 1

export interface UnsubscribeTokenPayload {
  version: number
  userId: string
  emailLc: string
  issuedAt: string
}

/**
 * Resolve + validate the 32-byte key. Fails closed with a generic error if the
 * secret is missing or the wrong length/encoding, so misconfiguration cannot
 * silently produce weak or unverifiable tokens.
 */
function getKey(): Buffer {
  const raw = process.env[SECRET_ENV]
  if (!raw) {
    throw new Error('marketing_unsubscribe_secret_missing')
  }
  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('marketing_unsubscribe_secret_invalid')
  }
  if (key.length !== KEY_BYTES) {
    throw new Error('marketing_unsubscribe_secret_invalid')
  }
  return key
}

/** True when the secret is present and valid — lets routes fail closed early. */
export function isUnsubscribeTokenSecretConfigured(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/**
 * Create an opaque, URL-safe unsubscribe token for a user + normalised email.
 * Throws only on misconfiguration (bad secret); never leaks token material.
 */
export function createUnsubscribeToken(userId: string, emailLc: string): string {
  const key = getKey()
  const payload: UnsubscribeTokenPayload = {
    version: TOKEN_VERSION,
    userId,
    emailLc: emailLc.trim().toLowerCase(),
    issuedAt: new Date().toISOString(),
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, ciphertext, tag]).toString('base64url')
}

/**
 * Validate + decrypt a token. Returns the payload, or null for ANY problem
 * (missing/short token, bad base64, tampering, wrong version, malformed JSON).
 * Never throws on bad input and never logs the token or decrypted email.
 */
export function parseUnsubscribeToken(token: unknown): UnsubscribeTokenPayload | null {
  if (typeof token !== 'string' || token.length === 0) return null

  let key: Buffer
  try {
    key = getKey()
  } catch {
    // Misconfiguration must fail closed, not reveal anything.
    return null
  }

  let raw: Buffer
  try {
    raw = Buffer.from(token, 'base64url')
  } catch {
    return null
  }
  if (raw.length <= IV_BYTES + TAG_BYTES) return null

  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(raw.length - TAG_BYTES)
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext) as unknown

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as UnsubscribeTokenPayload).version !== TOKEN_VERSION ||
      typeof (parsed as UnsubscribeTokenPayload).userId !== 'string' ||
      typeof (parsed as UnsubscribeTokenPayload).emailLc !== 'string' ||
      typeof (parsed as UnsubscribeTokenPayload).issuedAt !== 'string' ||
      (parsed as UnsubscribeTokenPayload).userId.length === 0 ||
      (parsed as UnsubscribeTokenPayload).emailLc.length === 0
    ) {
      return null
    }

    return parsed as UnsubscribeTokenPayload
  } catch {
    // Authentication/tag failure or malformed payload — reveal nothing.
    return null
  }
}

/**
 * Mask an email for safe display on the public unsubscribe page, e.g.
 * "b***@example.com". Never renders the full local part.
 */
export function maskEmail(emailLc: string): string {
  const trimmed = emailLc.trim().toLowerCase()
  const at = trimmed.indexOf('@')
  if (at <= 0) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const first = local.charAt(0)
  return `${first}***@${domain}`
}
