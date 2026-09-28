/**
 * Client-safe helpers + security logic for the Team Access surface.
 *
 * This file MUST NOT import server-only modules (next/headers,
 * lib/supabase/server, etc.) so it can be imported by both the Team Access
 * client component and the server actions, and unit-tested in isolation.
 *
 * The pure decision helpers here (isAssignableRole, resolveAddOutcome,
 * checkTeamChange) are the single source of truth for the Team Access
 * safeguards. The server actions in app/admin/hosts/actions.ts call them AFTER
 * the authoritative admin authorization + service-role guard, never instead of
 * it.
 */
import { type AdminRole, ADMIN_ROLES, ROLE_LABELS, normalizeRole } from '@/lib/admin/permissions'

/**
 * Strict server-side allow-list of roles a Super Admin may assign through Team
 * Access. Mirrors the four stored roles exactly — any value outside this set is
 * rejected before it can reach the database.
 */
export const ASSIGNABLE_TEAM_ROLES: AdminRole[] = ['admin', 'operations_admin', 'ops', 'read_only']

/** Type guard: true only for a known, assignable role string. Fails closed. */
export function isAssignableRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ASSIGNABLE_TEAM_ROLES as string[]).includes(value)
}

/**
 * Role options for the Add / Edit dropdowns, in the required display order:
 * Operations Admin first, then Host, Read Only, and Super Admin last.
 */
export const TEAM_ROLE_OPTIONS: ReadonlyArray<{ value: AdminRole; label: string }> = [
  { value: 'operations_admin', label: ROLE_LABELS.operations_admin },
  { value: 'ops', label: ROLE_LABELS.ops },
  { value: 'read_only', label: ROLE_LABELS.read_only },
  { value: 'admin', label: ROLE_LABELS.admin },
]

/** Canonical, user-facing messages so UI and server stay in exact sync. */
export const TEAM_ACCESS_MESSAGES = {
  unknownEmail:
    'No account exists for this email. Ask the user to create an account first, then add them here.',
  alreadyExists: 'This user already has privileged access. Edit their role or status below instead.',
  invalidRole: 'That role is not allowed.',
  finalSuperAdmin: 'You cannot remove or disable the final Super Admin.',
  selfRole: 'You cannot change your own role.',
  selfDisable: 'You cannot disable your own account.',
  notAuthorized: 'You do not have permission to manage team access.',
  notAuthenticated: 'Your session has expired. Please sign in again.',
} as const

/** Normalise an email for case-insensitive comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Decide what the Add form should do given the existing admin_users row (if
 * any). Never overwrites an existing privileged user — an existing row always
 * routes the Super Admin to the edit flow instead.
 */
export function resolveAddOutcome(existingRow: unknown): 'insert' | 'already_exists' {
  return existingRow ? 'already_exists' : 'insert'
}

export interface TeamChange {
  /** The authenticated Super Admin performing the change. */
  actorUserId: string
  /** The admin_users row being changed. */
  targetUserId: string
  currentRole: AdminRole
  currentEnabled: boolean
  nextRole: AdminRole
  nextEnabled: boolean
  /** Count of currently enabled rows whose role === 'admin' (system-wide). */
  enabledAdminCount: number
}

/**
 * Evaluate a role/status change against every Team Access safeguard.
 *
 * Returns a human-readable error message when the change must be rejected, or
 * null when it is allowed. Fails closed — the caller must reject on any
 * non-null result before touching the database.
 *
 * Safeguards enforced (in priority order):
 *  4. A Super Admin cannot disable their own account.
 *  5. A Super Admin cannot change their own role.
 *  6. The final enabled Super Admin cannot be demoted or disabled.
 */
export function checkTeamChange(change: TeamChange): string | null {
  const isSelf = change.actorUserId === change.targetUserId
  const roleChanging = change.nextRole !== change.currentRole
  const disabling = change.currentEnabled && !change.nextEnabled

  if (isSelf && roleChanging) return TEAM_ACCESS_MESSAGES.selfRole
  if (isSelf && disabling) return TEAM_ACCESS_MESSAGES.selfDisable

  // Final-Super-Admin protection: block any change that removes admin power
  // (demotion or disable) from an enabled admin when they are the last one.
  const targetIsEnabledAdmin = change.currentRole === 'admin' && change.currentEnabled
  const losesAdminPower = targetIsEnabledAdmin && (change.nextRole !== 'admin' || !change.nextEnabled)
  if (losesAdminPower && change.enabledAdminCount <= 1) {
    return TEAM_ACCESS_MESSAGES.finalSuperAdmin
  }

  return null
}

/** Convenience: normalise a stored role value or return null (fail closed). */
export function toAdminRole(value: unknown): AdminRole | null {
  return normalizeRole(value)
}

/** Re-export for UI convenience so components import from one place. */
export { type AdminRole, ADMIN_ROLES, ROLE_LABELS }
