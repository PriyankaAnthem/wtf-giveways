'use client'

/**
 * Shared client helpers for the Marketing Hub admin panels.
 *
 * A single GET fetcher (used as the SWR fetcher) and a single mutating-request
 * helper. Both send `accept: application/json`, parse defensively and surface a
 * stable error code string on failure so panels can map it to friendly copy.
 * Nothing here can send email — these only talk to the admin-only config APIs.
 */

export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error ?? `request_failed_${res.status}`)
  }
  return json as T
}

export type MutationMethod = 'POST' | 'PUT' | 'PATCH'

export interface MutationResult<T> {
  ok: boolean
  error?: string
  data?: T
}

export async function sendMutation<T = Record<string, unknown>>(
  url: string,
  method: MutationMethod,
  body: unknown,
): Promise<MutationResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? `request_failed_${res.status}` }
    }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

/** Convert an integer pence value to a plain GBP string for an input field. */
export function penceToGbpInput(pence: number | null): string {
  if (pence === null || pence === undefined) return ''
  return (pence / 100).toFixed(2)
}
