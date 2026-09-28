'use client'

import type { OpsSummaryResponse } from './types'

/**
 * Client-side fetch helpers for the operations console. Every call hits a
 * protected admin server route (never Supabase directly). These are invoked
 * only on deliberate operator actions — there is no polling or timer.
 */

export type MutationResult = { ok: true } | { ok: false; error: string }

async function postJson(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<MutationResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? 'save_failed' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

/** Deliberately re-fetch the full authoritative snapshot. */
export async function refreshSummary(): Promise<OpsSummaryResponse | null> {
  try {
    const res = await fetch('/api/admin/marketing/ops/summary', { cache: 'no-store' })
    const json = (await res.json().catch(() => null)) as OpsSummaryResponse | null
    if (!res.ok || !json?.ok) return null
    return json
  } catch {
    return null
  }
}

export function setSending(enabled: boolean): Promise<MutationResult> {
  return postJson('/api/admin/marketing/ops/control', 'POST', { target: 'sending', enabled })
}

export function setDiscovery(enabled: boolean): Promise<MutationResult> {
  return postJson('/api/admin/marketing/ops/control', 'POST', { target: 'discovery', enabled })
}

export function setRollout(rolloutLimit: number): Promise<MutationResult> {
  return postJson('/api/admin/marketing/ops/control', 'POST', { target: 'rollout', rolloutLimit })
}

export function setAutomationEnabled(automationKey: string, enabled: boolean): Promise<MutationResult> {
  return postJson('/api/admin/marketing/ops/automation', 'PATCH', { automationKey, enabled })
}

export function setDefinitionEnabled(opportunityKey: string, enabled: boolean): Promise<MutationResult> {
  return postJson('/api/admin/marketing/ops/definition', 'PATCH', { opportunityKey, enabled })
}
