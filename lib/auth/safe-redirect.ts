/**
 * Returns `value` only when it is a safe, internal application path; otherwise
 * `null`. Used to prevent open-redirect vulnerabilities when a post-auth
 * destination is supplied through a URL parameter (e.g. `?redirect=` on login /
 * sign-up, or `?next=` on the auth callback).
 *
 * A value is considered safe only when it:
 *  - is a non-empty string,
 *  - begins with a single "/" (an internal, host-relative path), and
 *  - is NOT protocol-relative ("//host") or a backslash variant ("/\\host"),
 *    both of which browsers resolve to an external origin.
 *
 * Callers should pass an already once-decoded value (as produced by
 * `URLSearchParams.get()` / `NextRequest.nextUrl.searchParams.get()`), which is
 * how every current call site obtains it.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  return value
}
