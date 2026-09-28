import 'server-only'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  type AdminRole,
  normalizeRole,
} from '@/lib/admin/permissions'

// Re-export shared, client-safe utilities so existing server-side imports
// from '@/lib/admin/auth' keep working.
export {
  type AdminRole,
  ADMIN_ROLES,
  ROLE_LABELS,
  HOST_ROLE,
  HOST_ALLOWED_ROUTES,
  normalizeRole,
  canAccessRoute,
  canAccessAdmin,
} from '@/lib/admin/permissions'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export interface AdminContext {
  user: User
  role: AdminRole
}

/**
 * Reads the current authenticated user + their admin role from the
 * (user-scoped, RLS-respecting) server Supabase client.
 *
 * Returns null when there is no logged-in user, no admin_users row,
 * the row is disabled, or the role is unknown.
 */
export async function getAdminContext(
  supabaseClient?: SupabaseServerClient,
): Promise<AdminContext | null> {
  const supabase = supabaseClient ?? (await createClient())

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()

  if (authErr || !user) return null

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('role,is_enabled')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!adminRow || adminRow.is_enabled !== true) return null

  const role = normalizeRole(adminRow.role)
  if (!role) return null

  return { user, role }
}

/**
 * Server-side route guard for /admin pages.
 *
 * - Not authenticated  => redirect to login (with redirect back).
 * - Not an enabled/known admin, or role not allowed => redirect to /auth/unauthorized.
 *
 * Defaults to admin-only when no roles are supplied.
 */
export async function requireAdmin(opts?: {
  roles?: AdminRole[]
  redirectTo?: string
}): Promise<AdminContext> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()

  if (authErr || !user) {
    redirect(`/auth/login?redirect=${encodeURIComponent(opts?.redirectTo ?? '/admin')}`)
  }

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('role,is_enabled')
    .eq('user_id', user.id)
    .maybeSingle()

  const role = adminRow && adminRow.is_enabled === true ? normalizeRole(adminRow.role) : null

  const allowed = opts?.roles ?? ['admin']
  if (!role || !allowed.includes(role)) {
    redirect('/auth/unauthorized')
  }

  return { user, role }
}

/**
 * API-route authorization guard.
 *
 * Keeps the historical `{ user, error }` shape used by existing routes, and
 * adds `role`. Defaults to admin-only when no roles are supplied.
 */
export async function authorizeAdminApi(
  supabase: SupabaseServerClient,
  opts?: { roles?: AdminRole[] },
): Promise<{ user: User | null; role: AdminRole | null; error: string | null }> {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()

  if (authErr || !user) return { user: null, role: null, error: 'Not authenticated' }

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('role,is_enabled')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!adminRow || adminRow.is_enabled !== true) {
    return { user: null, role: null, error: 'Not authorized' }
  }

  const role = normalizeRole(adminRow.role)
  const allowed = opts?.roles ?? ['admin']

  if (!role || !allowed.includes(role)) {
    return { user: null, role, error: 'Not authorized' }
  }

  return { user, role, error: null }
}
