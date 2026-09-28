'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi, HOST_ROLE, type AdminRole, normalizeRole } from '@/lib/admin/auth'
import {
  checkTeamChange,
  isAssignableRole,
  resolveAddOutcome,
  TEAM_ACCESS_MESSAGES,
} from '@/lib/admin/team-access'

export interface HostRow {
  user_id: string
  email: string | null
  is_enabled: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Full-admin-only guard for every Host management action. */
async function requireFullAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { user, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return { ok: false, error: error === 'Not authenticated' ? 'Not authenticated' : 'Not authorized' }
  }
  return { ok: true }
}

/**
 * Look up an auth user id by email using the service client.
 * Scans listUsers pages (bounded) since admin API has no direct email filter.
 */
async function findUserIdByEmail(
  svc: ReturnType<typeof getServiceClient>,
  email: string,
): Promise<string | null> {
  if (!svc) return null
  const target = email.trim().toLowerCase()
  const perPage = 200
  const maxPages = 25 // safety cap (up to 5000 users scanned)

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error('[hosts/actions] listUsers error:', error.message)
      return null
    }
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < perPage) break // last page reached
  }
  return null
}

/** List all Host (ops) users with their email + enabled status. */
export async function listHosts(): Promise<{ ok: boolean; hosts?: HostRow[]; error?: string }> {
  const auth = await requireFullAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  const { data: rows, error } = await svc
    .from('admin_users')
    .select('user_id, is_enabled')
    .eq('role', HOST_ROLE)

  if (error) {
    console.error('[hosts/actions] list error:', error.message)
    return { ok: false, error: 'Failed to load hosts' }
  }

  const hosts: HostRow[] = await Promise.all(
    (rows ?? []).map(async (row) => {
      let email: string | null = null
      try {
        const { data } = await svc.auth.admin.getUserById(row.user_id)
        email = data?.user?.email ?? null
      } catch {
        email = null
      }
      return { user_id: row.user_id, email, is_enabled: row.is_enabled === true }
    }),
  )

  hosts.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))

  return { ok: true, hosts }
}

/** Add a Host by email. Saves role='ops' internally (UI shows "Host"). */
export async function addHostByEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFullAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return { ok: false, error: 'Please enter a valid email address' }
  }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  const userId = await findUserIdByEmail(svc, email)
  if (!userId) {
    return { ok: false, error: 'No account found with that email. The user must register first.' }
  }

  // Don't override an existing admin/role row unless it's already a host.
  const { data: existing, error: existingErr } = await svc
    .from('admin_users')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()

  if (existingErr) {
    console.error('[hosts/actions] existing lookup error:', existingErr.message)
    return { ok: false, error: 'Failed to verify existing access' }
  }

  if (existing && existing.role && existing.role !== HOST_ROLE) {
    return { ok: false, error: 'This user already has a different admin role and cannot be set as a Host here.' }
  }

  const { error: upsertErr } = await svc
    .from('admin_users')
    .upsert(
      { user_id: userId, role: HOST_ROLE, is_enabled: true },
      { onConflict: 'user_id' },
    )

  if (upsertErr) {
    console.error('[hosts/actions] upsert error:', upsertErr.message)
    return { ok: false, error: 'Failed to add host' }
  }

  revalidatePath('/admin/hosts')
  return { ok: true }
}

/** Enable or disable a Host. Only affects rows whose role is 'ops'. */
export async function setHostEnabled(
  userId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFullAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'Invalid user' }
  }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  const { error } = await svc
    .from('admin_users')
    .update({ is_enabled: enabled })
    .eq('user_id', userId)
    .eq('role', HOST_ROLE) // safety: never touch full admins

  if (error) {
    console.error('[hosts/actions] setHostEnabled error:', error.message)
    return { ok: false, error: 'Failed to update host' }
  }

  revalidatePath('/admin/hosts')
  return { ok: true }
}

/** Remove a Host entirely. Only deletes rows whose role is 'ops'. */
export async function removeHost(userId: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFullAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'Invalid user' }
  }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  const { error } = await svc
    .from('admin_users')
    .delete()
    .eq('user_id', userId)
    .eq('role', HOST_ROLE) // safety: never delete full admins

  if (error) {
    console.error('[hosts/actions] removeHost error:', error.message)
    return { ok: false, error: 'Failed to remove host' }
  }

  revalidatePath('/admin/hosts')
  return { ok: true }
}

/* ------------------------------------------------------------------------- *
 * Team Access (Super-Admin-only) — unified admin + host management.
 *
 * Every action below authorises the caller as a Super Admin (role='admin')
 * BEFORE constructing the service-role client, so a service-role query is only
 * ever issued for an authenticated, enabled Super Admin. Operations Admins,
 * Hosts, Read Only, disabled and unauthenticated users all fail closed.
 * ------------------------------------------------------------------------- */

export interface TeamMemberRow {
  user_id: string
  email: string | null
  role: AdminRole
  is_enabled: boolean
  created_at: string | null
  created_by_email: string | null
}

/**
 * Super-Admin-only guard that also returns the actor's user id (needed for the
 * self-change and final-admin safeguards). Mirrors requireFullAdmin but keeps
 * the identity so callers never have to re-fetch it.
 */
async function requireFullAdminContext(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { user, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return {
      ok: false,
      error: error === 'Not authenticated' ? 'Not authenticated' : 'Not authorized',
    }
  }
  return { ok: true, userId: user.id }
}

/** Count currently enabled Super Admins (role='admin', is_enabled=true). */
async function countEnabledSuperAdmins(
  svc: NonNullable<ReturnType<typeof getServiceClient>>,
): Promise<{ count: number } | { error: string }> {
  const { count, error } = await svc
    .from('admin_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_enabled', true)
  if (error) {
    console.error('[hosts/actions] countEnabledSuperAdmins error:', error.message)
    return { error: 'Failed to verify team' }
  }
  return { count: count ?? 0 }
}

/** List every privileged user, resolved against Supabase Auth for emails. */
export async function listTeamMembers(): Promise<{
  ok: boolean
  members?: TeamMemberRow[]
  error?: string
}> {
  const auth = await requireFullAdminContext()
  if (!auth.ok) return { ok: false, error: auth.error }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  // select('*') is resilient to optional columns (created_at / created_by).
  const { data: rows, error } = await svc.from('admin_users').select('*')
  if (error) {
    console.error('[hosts/actions] listTeamMembers error:', error.message)
    return { ok: false, error: 'Failed to load team members' }
  }

  // Cache id -> email so a "created_by" that repeats (or equals a member) is
  // only fetched once.
  const emailCache = new Map<string, string | null>()
  const emailFor = async (id: string | null | undefined): Promise<string | null> => {
    if (!id) return null
    if (emailCache.has(id)) return emailCache.get(id) ?? null
    let email: string | null = null
    try {
      const { data } = await svc.auth.admin.getUserById(id)
      email = data?.user?.email ?? null
    } catch {
      email = null
    }
    emailCache.set(id, email)
    return email
  }

  const members: TeamMemberRow[] = []
  for (const row of rows ?? []) {
    const role = normalizeRole(row.role)
    if (!role) continue // fail closed: never surface an unknown role
    const email = await emailFor(row.user_id)
    const created_by_email = await emailFor(
      typeof row.created_by === 'string' ? row.created_by : null,
    )
    members.push({
      user_id: row.user_id,
      email,
      role,
      is_enabled: row.is_enabled === true,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      created_by_email,
    })
  }

  members.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))
  return { ok: true, members }
}

/**
 * Add an existing Auth user as a privileged team member with the chosen role.
 * Never overwrites an existing privileged user (routes to edit instead).
 */
export async function addTeamMember(
  email: string,
  role: string,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFullAdminContext()
  if (!auth.ok) return { ok: false, error: auth.error }

  // Strict server-side role allow-list — never trust the browser.
  if (!isAssignableRole(role)) return { ok: false, error: TEAM_ACCESS_MESSAGES.invalidRole }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return { ok: false, error: 'Please enter a valid email address' }
  }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  const userId = await findUserIdByEmail(svc, email)
  if (!userId) return { ok: false, error: TEAM_ACCESS_MESSAGES.unknownEmail }

  const { data: existing, error: existingErr } = await svc
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existingErr) {
    console.error('[hosts/actions] addTeamMember lookup error:', existingErr.message)
    return { ok: false, error: 'Failed to verify existing access' }
  }

  if (resolveAddOutcome(existing) === 'already_exists') {
    return { ok: false, error: TEAM_ACCESS_MESSAGES.alreadyExists }
  }

  const { error: insertErr } = await svc.from('admin_users').insert({
    user_id: userId,
    role,
    is_enabled: true,
    created_by: auth.userId,
  })
  if (insertErr) {
    console.error('[hosts/actions] addTeamMember insert error:', insertErr.message)
    return { ok: false, error: 'Failed to add team member' }
  }

  revalidatePath('/admin/hosts')
  return { ok: true }
}

/**
 * Change a team member's role and/or enabled status. Applies every safeguard
 * (strict role allow-list, self-change protection, final-Super-Admin
 * protection) before writing.
 */
export async function updateTeamMember(
  userId: string,
  changes: { role?: string; is_enabled?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFullAdminContext()
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!userId || typeof userId !== 'string') return { ok: false, error: 'Invalid user' }

  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }

  const { data: current, error: curErr } = await svc
    .from('admin_users')
    .select('role, is_enabled')
    .eq('user_id', userId)
    .maybeSingle()
  if (curErr) {
    console.error('[hosts/actions] updateTeamMember load error:', curErr.message)
    return { ok: false, error: 'Failed to load team member' }
  }
  if (!current) return { ok: false, error: 'Team member not found' }

  const currentRole = normalizeRole(current.role)
  if (!currentRole) {
    // Fail closed: never edit a row whose stored role we don't recognise.
    return { ok: false, error: 'This account has an unrecognised role and cannot be edited here.' }
  }

  // Resolve the requested next values, validating any supplied role.
  let nextRole: AdminRole = currentRole
  if (changes.role !== undefined) {
    if (!isAssignableRole(changes.role)) return { ok: false, error: TEAM_ACCESS_MESSAGES.invalidRole }
    nextRole = changes.role
  }
  const nextEnabled =
    changes.is_enabled === undefined ? current.is_enabled === true : changes.is_enabled === true

  const counted = await countEnabledSuperAdmins(svc)
  if ('error' in counted) return { ok: false, error: counted.error }

  const violation = checkTeamChange({
    actorUserId: auth.userId,
    targetUserId: userId,
    currentRole,
    currentEnabled: current.is_enabled === true,
    nextRole,
    nextEnabled,
    enabledAdminCount: counted.count,
  })
  if (violation) return { ok: false, error: violation }

  const { error: updErr } = await svc
    .from('admin_users')
    .update({ role: nextRole, is_enabled: nextEnabled })
    .eq('user_id', userId)
  if (updErr) {
    console.error('[hosts/actions] updateTeamMember update error:', updErr.message)
    return { ok: false, error: 'Failed to update team member' }
  }

  revalidatePath('/admin/hosts')
  return { ok: true }
}
