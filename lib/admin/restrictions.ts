import 'server-only'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveCustomerName, type CustomerNameParts } from '@/components/admin/customers/format'

/**
 * Shared, SERVER-ONLY helpers for the admin account-restrictions (self-
 * exclusion) module.
 *
 * The privileged RPCs (`admin_self_exclude_user`, `admin_revoke_restriction`)
 * are executable ONLY by the service role, so every mutation and every
 * authoritative read here runs through a service-role client that is created
 * AFTER the calling route has authorised the admin. The browser never touches
 * these RPCs and never supplies actor IDs — routes pass the authenticated
 * admin's genuine `auth.users` UUID as `p_created_by` / `p_revoked_by`.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Admin restriction APIs must never be cached by shared/proxy caches. */
export const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

/** The only restriction_type in the live contract. */
export const RESTRICTION_TYPE_SELF_EXCLUSION = 'self_exclusion' as const

/** Maximum stored revocation/exclusion reason length (mirrors the apply route). */
export const REASON_MAX = 500

export type RestrictionSource = 'admin' | 'customer' | 'support'

/**
 * Creates a service-role Supabase client, or null when configuration is
 * missing. Callers MUST have authorised the admin before calling this.
 */
export function getServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export type ResolvedUser = CustomerNameParts & { user_id: string; mobile: string | null }

/**
 * Resolves display identity for a set of user IDs using the SAME sources the
 * customer directory + detail views use (`profiles_private` for the real-name
 * handle + mobile, and the auth admin API for email + genuine name metadata).
 *
 * Efficiency: `profiles_private` is read in ONE batched `.in(...)` query, and
 * each DISTINCT auth user is fetched exactly once, in parallel. There is no
 * per-row query inside a render loop and no scan of the whole user table — the
 * only auth lookups are for the (deduplicated) IDs on the current page.
 */
export async function resolveUsers(
  svc: SupabaseClient,
  ids: (string | null | undefined)[],
): Promise<Map<string, ResolvedUser>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))]
  const map = new Map<string, ResolvedUser>()
  if (unique.length === 0) return map

  for (const id of unique) {
    map.set(id, {
      user_id: id,
      first_name: null,
      last_name: null,
      display_name: null,
      real_name: null,
      email: null,
      mobile: null,
    })
  }

  // Batched real-name + mobile from profiles_private (single round-trip).
  try {
    const { data: profiles, error } = await svc
      .from('profiles_private')
      .select('user_id, real_name, mobile')
      .in('user_id', unique)
    if (error) {
      console.error('[admin/restrictions] profiles_private batch error (non-fatal):', error.message)
    } else if (Array.isArray(profiles)) {
      for (const p of profiles as Array<Record<string, unknown>>) {
        const entry = typeof p.user_id === 'string' ? map.get(p.user_id) : undefined
        if (entry) {
          entry.real_name = strOrNull(p.real_name)
          entry.mobile = strOrNull(p.mobile)
        }
      }
    }
  } catch (e) {
    console.error('[admin/restrictions] profiles_private batch threw (non-fatal):', e)
  }

  // Email + genuine name metadata: one auth lookup per DISTINCT id, in parallel.
  await Promise.all(
    unique.map(async (id) => {
      try {
        const { data } = await svc.auth.admin.getUserById(id)
        const u = data?.user
        const entry = map.get(id)
        if (u && entry) {
          entry.email = u.email ?? null
          const meta = (u.user_metadata ?? {}) as Record<string, unknown>
          entry.first_name = strOrNull(meta.first_name)
          entry.last_name = strOrNull(meta.last_name)
          entry.display_name = strOrNull(meta.display_name)
        }
      } catch (e) {
        console.error('[admin/restrictions] auth lookup error (non-fatal):', e)
      }
    }),
  )

  return map
}

/**
 * A display label for an ACTOR (the admin who created or revoked a
 * restriction), reusing the single customer-name resolver. Returns null when
 * no meaningful name is available so the UI can fall back to "—".
 */
export function actorName(u: ResolvedUser | undefined | null): string | null {
  if (!u) return null
  const name = resolveCustomerName(u)
  return name === 'Unknown customer' ? null : name
}

/**
 * Maps a raw restriction-RPC error message to a stable client code + HTTP
 * status. The privileged RPCs raise these tokens as exception messages; we
 * NEVER surface the raw database text to the browser.
 */
export function mapRestrictionRpcError(rawMessage: string): { status: number; code: string } {
  const m = rawMessage || ''
  if (m.includes('NOT_ADMIN_ORIGINATED')) return { status: 409, code: 'not_admin_originated' }
  if (m.includes('ALREADY_REVOKED')) return { status: 409, code: 'already_revoked' }
  if (m.includes('RESTRICTION_NOT_FOUND')) return { status: 404, code: 'restriction_not_found' }
  if (m.includes('RESTRICTION_ID_REQUIRED')) return { status: 400, code: 'restriction_id_required' }
  if (m.includes('REVOKED_BY_REQUIRED')) return { status: 400, code: 'revoked_by_required' }
  if (m.includes('CREATED_BY_REQUIRED')) return { status: 400, code: 'created_by_required' }
  if (m.includes('USER_ID_REQUIRED')) return { status: 400, code: 'user_id_required' }
  if (m.includes('REASON_REQUIRED')) return { status: 400, code: 'reason_required' }
  return { status: 500, code: 'revoke_failed' }
}
