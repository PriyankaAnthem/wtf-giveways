import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Admin-only Live Balloon Pop board helpers.
 *
 * These utilities are shared by the admin live-board API routes. They never
 * run on the public site and rely on the route-level admin auth guard
 * (`authorizeAdminApi`) — NOT on public RLS policies.
 */

export type LiveBoardItemType = 'standard' | 'vip'

export interface LiveBoardItem {
  id: string
  label: string
  type: LiveBoardItemType
  amountPence: number
  starting: number
  remaining: number
  featured: boolean
  sort: number
}

/** Safe, stable error codes returned to the admin client. */
export type LiveBoardError =
  | 'campaign_not_found'
  | 'not_balloon_pop'
  | 'board_not_found'
  | 'invalid_items'
  | 'invalid_action'
  | 'item_not_found'
  | 'item_already_zero'
  | 'item_already_at_starting'
  | 'nothing_to_undo'
  | 'invalid_takeover'
  | 'invalid_takeover_url'
  | 'live_board_action_failed'

export const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache, no-store' } }

export function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('missing_supabase_service_config')
  }
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Validate + normalize a client-provided items array for a SETUP/EDIT save.
 *
 * Never trusts raw JSON: only the 8 known fields are kept, each is coerced and
 * range-checked. For setup, `remaining` may not exceed `starting`.
 */
export function validateItemsForSetup(
  raw: unknown,
): { ok: true; items: LiveBoardItem[] } | { ok: false; error: LiveBoardError } {
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_items' }

  const items: LiveBoardItem[] = []
  const seenIds = new Set<string>()
  let totalStarting = 0

  for (const rawItem of raw) {
    if (!rawItem || typeof rawItem !== 'object') return { ok: false, error: 'invalid_items' }
    const it = rawItem as Record<string, unknown>

    const id = typeof it.id === 'string' ? it.id.trim() : ''
    if (!id) return { ok: false, error: 'invalid_items' }
    if (seenIds.has(id)) return { ok: false, error: 'invalid_items' } // duplicate ids
    seenIds.add(id)

    const label = typeof it.label === 'string' ? it.label.trim() : ''
    if (!label) return { ok: false, error: 'invalid_items' }

    const type = it.type === 'standard' || it.type === 'vip' ? it.type : null
    if (!type) return { ok: false, error: 'invalid_items' }

    if (!isFiniteNumber(it.amountPence) || it.amountPence < 0) return { ok: false, error: 'invalid_items' }
    if (!isFiniteNumber(it.starting) || it.starting < 0) return { ok: false, error: 'invalid_items' }
    if (!isFiniteNumber(it.remaining) || it.remaining < 0) return { ok: false, error: 'invalid_items' }

    const amountPence = Math.floor(it.amountPence)
    const starting = Math.floor(it.starting)
    const remaining = Math.floor(it.remaining)

    // For setup, remaining must not exceed starting.
    if (remaining > starting) return { ok: false, error: 'invalid_items' }

    if (!isFiniteNumber(it.sort)) return { ok: false, error: 'invalid_items' }
    const sort = Math.floor(it.sort)

    const featured = it.featured === true

    totalStarting += starting

    items.push({ id, label, type, amountPence, starting, remaining, featured, sort })
  }

  // Total starting quantity must be greater than 0.
  if (totalStarting <= 0) return { ok: false, error: 'invalid_items' }

  return { ok: true, items }
}

/** Coerce a stored items value (jsonb) into a typed, defensive array. */
export function normalizeStoredItems(raw: unknown): LiveBoardItem[] {
  if (!Array.isArray(raw)) return []
  const out: LiveBoardItem[] = []
  for (const rawItem of raw) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const it = rawItem as Record<string, unknown>
    const id = typeof it.id === 'string' ? it.id : ''
    if (!id) continue
    out.push({
      id,
      label: typeof it.label === 'string' ? it.label : '',
      type: it.type === 'vip' ? 'vip' : 'standard',
      amountPence: isFiniteNumber(it.amountPence) ? Math.floor(it.amountPence) : 0,
      starting: isFiniteNumber(it.starting) ? Math.floor(it.starting) : 0,
      remaining: isFiniteNumber(it.remaining) ? Math.floor(it.remaining) : 0,
      featured: it.featured === true,
      sort: isFiniteNumber(it.sort) ? Math.floor(it.sort) : 0,
    })
  }
  return out
}

/** Shape an event DB row into the camelCase response object. */
export function mapEventRow(e: Record<string, any>) {
  return {
    id: e.id as string,
    actionType: e.action_type as string,
    itemId: (e.item_id ?? null) as string | null,
    label: (e.label ?? null) as string | null,
    delta: (e.delta ?? null) as number | null,
    beforeRemaining: (e.before_remaining ?? null) as number | null,
    afterRemaining: (e.after_remaining ?? null) as number | null,
    createdAt: e.created_at as string,
  }
}
