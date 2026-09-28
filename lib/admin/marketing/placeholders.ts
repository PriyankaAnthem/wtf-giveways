/**
 * WTF Marketing Hub — Stage 3B controlled placeholder engine (PURE).
 *
 * No server-only / React imports so it is shared by the API routes, the client
 * editor AND the node test environment. It defines the ONLY placeholders a
 * marketing template may contain and provides safe extraction + preview
 * substitution. It never sends anything and never touches the database.
 *
 * Templates are STRUCTURED content slots, not HTML: raw markup is rejected
 * (see hub-validation) and preview substitution HTML-escapes every value, so a
 * template can never smuggle markup or script into the rendered email.
 */

/** The exhaustive, controlled placeholder allowlist. Nothing else is permitted. */
export const ALLOWED_PLACEHOLDERS = [
  'first_name',
  'campaign_title',
  'campaign_url',
  'credit_balance',
  'discount_code',
  'unsubscribe_url',
] as const

export type AllowedPlaceholder = (typeof ALLOWED_PLACEHOLDERS)[number]

const ALLOWED_SET = new Set<string>(ALLOWED_PLACEHOLDERS)

/** Matches any `{{ ... }}` token, capturing whatever is inside the braces. */
const ANY_PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g

/** Returns true if a token (already trimmed) is a permitted placeholder. */
export function isAllowedPlaceholder(token: string): token is AllowedPlaceholder {
  return ALLOWED_SET.has(token)
}

/**
 * Extract every `{{ token }}` inner value (trimmed) found in a string, in order
 * of appearance. Non-string input yields an empty list.
 */
export function extractPlaceholders(text: unknown): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const out: string[] = []
  for (const match of text.matchAll(ANY_PLACEHOLDER_RE)) {
    out.push((match[1] ?? '').trim())
  }
  return out
}

/**
 * Given any number of content strings, return the sorted, de-duplicated list of
 * placeholder tokens that are NOT in the allowlist (including malformed/empty
 * tokens such as `{{}}`). Empty result => every placeholder used is permitted.
 */
export function findUnknownPlaceholders(texts: Array<string | null | undefined>): string[] {
  const unknown = new Set<string>()
  for (const text of texts) {
    for (const token of extractPlaceholders(text)) {
      if (!isAllowedPlaceholder(token)) {
        // Represent an empty/whitespace token distinctly so the error is useful.
        unknown.add(token.length === 0 ? '(empty)' : token)
      }
    }
  }
  return [...unknown].sort()
}

/** HTML-escape a value so substituted content can never inject markup/script. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Sample context used to render a representative preview in the admin editor. */
export const PLACEHOLDER_PREVIEW_SAMPLE: Record<AllowedPlaceholder, string> = {
  first_name: 'Alex',
  campaign_title: 'The £20k Summer Blowout',
  campaign_url: 'https://wtfgiveaways.example/c/summer',
  credit_balance: '£12.50',
  discount_code: 'WTF10',
  unsubscribe_url: 'https://wtfgiveaways.example/unsubscribe?t=sample',
}

/**
 * Replace allowed `{{ token }}` placeholders with values from `context`.
 * Unknown tokens are left untouched (validation rejects them before save, so
 * they should never reach preview). When `escape` is true (default) each
 * substituted value is HTML-escaped for safe rendering into the email layout.
 */
export function substitutePlaceholders(
  text: string | null | undefined,
  context: Partial<Record<AllowedPlaceholder, string>>,
  escape = true,
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  return text.replace(ANY_PLACEHOLDER_RE, (whole, inner: string) => {
    const token = (inner ?? '').trim()
    if (!isAllowedPlaceholder(token)) return whole
    const value = context[token] ?? ''
    return escape ? escapeHtml(value) : value
  })
}
