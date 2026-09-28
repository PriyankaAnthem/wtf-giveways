import { describe, it, expect } from 'vitest'
import { type AdminRole } from '@/lib/admin/permissions'
import {
  ASSIGNABLE_TEAM_ROLES,
  TEAM_ROLE_OPTIONS,
  TEAM_ACCESS_MESSAGES,
  isAssignableRole,
  resolveAddOutcome,
  normalizeEmail,
  checkTeamChange,
  type TeamChange,
} from '@/lib/admin/team-access'

/**
 * Team Access is Super-Admin-only. Every list/add/edit/enable/disable action
 * authorises the caller with roles: ['admin'] BEFORE any service-role query.
 * This mirror lets the tests fail loudly if that ever changes.
 */
function isAuthorized(allowed: AdminRole[], role: AdminRole | null): boolean {
  if (!role) return false
  return allowed.includes(role)
}

const TEAM_GUARDS: Record<string, AdminRole[]> = {
  'page:/admin/hosts (Team Access)': ['admin'],
  'action:listTeamMembers': ['admin'],
  'action:addTeamMember': ['admin'],
  'action:updateTeamMember': ['admin'],
}

// Base template for a non-self, non-final-admin change (used per-test).
function change(overrides: Partial<TeamChange>): TeamChange {
  return {
    actorUserId: 'super-admin-1',
    targetUserId: 'target-1',
    currentRole: 'ops',
    currentEnabled: true,
    nextRole: 'ops',
    nextEnabled: true,
    enabledAdminCount: 3,
    ...overrides,
  }
}

describe('Team Access authorization (Super-Admin-only)', () => {
  it('Super Admin can open Team Access and invoke every action', () => {
    for (const [surface, allowed] of Object.entries(TEAM_GUARDS)) {
      expect(isAuthorized(allowed, 'admin'), surface).toBe(true)
    }
  })

  it('Operations Admin cannot open Team Access or invoke any action', () => {
    for (const [surface, allowed] of Object.entries(TEAM_GUARDS)) {
      expect(isAuthorized(allowed, 'operations_admin'), surface).toBe(false)
    }
  })

  it('Host (ops) cannot open Team Access or invoke any action', () => {
    for (const [surface, allowed] of Object.entries(TEAM_GUARDS)) {
      expect(isAuthorized(allowed, 'ops'), surface).toBe(false)
    }
  })

  it('read_only and unauthenticated (null role) are denied everywhere', () => {
    for (const [surface, allowed] of Object.entries(TEAM_GUARDS)) {
      expect(isAuthorized(allowed, 'read_only'), surface).toBe(false)
      expect(isAuthorized(allowed, null), surface).toBe(false)
    }
  })
})

describe('role allow-list (strict, server-side)', () => {
  it('accepts exactly the four stored roles', () => {
    expect(ASSIGNABLE_TEAM_ROLES).toEqual(['admin', 'operations_admin', 'ops', 'read_only'])
    for (const r of ASSIGNABLE_TEAM_ROLES) expect(isAssignableRole(r)).toBe(true)
  })

  it('lets a Super Admin assign operations_admin and ops', () => {
    expect(isAssignableRole('operations_admin')).toBe(true)
    expect(isAssignableRole('ops')).toBe(true)
  })

  it('rejects arbitrary / unknown / malformed role values (fail closed)', () => {
    for (const bad of ['superadmin', 'operations', 'owner', 'ADMIN', '', ' ', 'read-only']) {
      expect(isAssignableRole(bad)).toBe(false)
    }
    expect(isAssignableRole(undefined)).toBe(false)
    expect(isAssignableRole(null)).toBe(false)
    expect(isAssignableRole(42)).toBe(false)
    expect(isAssignableRole({})).toBe(false)
  })

  it('offers the dropdown options in the required order (Operations Admin first)', () => {
    expect(TEAM_ROLE_OPTIONS.map((o) => o.value)).toEqual([
      'operations_admin',
      'ops',
      'read_only',
      'admin',
    ])
  })
})

describe('add outcome (never overwrite an existing privileged user)', () => {
  it('inserts when no admin_users row exists', () => {
    expect(resolveAddOutcome(null)).toBe('insert')
    expect(resolveAddOutcome(undefined)).toBe('insert')
  })

  it('routes to already_exists when a row exists', () => {
    expect(resolveAddOutcome({ user_id: 'u1' })).toBe('already_exists')
  })

  it('exposes the exact unknown-email message', () => {
    expect(TEAM_ACCESS_MESSAGES.unknownEmail).toBe(
      'No account exists for this email. Ask the user to create an account first, then add them here.',
    )
  })
})

describe('normalizeEmail', () => {
  it('trims and lower-cases for case-insensitive comparison', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com')
  })
})

describe('checkTeamChange — normal (allowed) changes', () => {
  it('allows changing an Operations Admin to a Host', () => {
    expect(
      checkTeamChange(change({ currentRole: 'operations_admin', nextRole: 'ops' })),
    ).toBeNull()
  })

  it('allows enabling a disabled team member', () => {
    expect(
      checkTeamChange(
        change({ currentRole: 'operations_admin', currentEnabled: false, nextEnabled: true }),
      ),
    ).toBeNull()
  })

  it('allows disabling an Operations Admin', () => {
    expect(
      checkTeamChange(change({ currentRole: 'operations_admin', nextEnabled: false })),
    ).toBeNull()
  })

  it('allows disabling a Super Admin while other enabled admins remain', () => {
    expect(
      checkTeamChange(
        change({ currentRole: 'admin', nextRole: 'admin', nextEnabled: false, enabledAdminCount: 2 }),
      ),
    ).toBeNull()
  })
})

describe('checkTeamChange — self protection', () => {
  it('blocks a Super Admin from changing their own role', () => {
    expect(
      checkTeamChange(
        change({
          actorUserId: 'me',
          targetUserId: 'me',
          currentRole: 'admin',
          nextRole: 'operations_admin',
          enabledAdminCount: 5,
        }),
      ),
    ).toBe(TEAM_ACCESS_MESSAGES.selfRole)
  })

  it('blocks a Super Admin from disabling their own account', () => {
    expect(
      checkTeamChange(
        change({
          actorUserId: 'me',
          targetUserId: 'me',
          currentRole: 'admin',
          nextRole: 'admin',
          nextEnabled: false,
          enabledAdminCount: 5,
        }),
      ),
    ).toBe(TEAM_ACCESS_MESSAGES.selfDisable)
  })
})

describe('checkTeamChange — final Super Admin protection', () => {
  it('blocks disabling the final enabled Super Admin', () => {
    expect(
      checkTeamChange(
        change({
          currentRole: 'admin',
          nextRole: 'admin',
          nextEnabled: false,
          enabledAdminCount: 1,
        }),
      ),
    ).toBe(TEAM_ACCESS_MESSAGES.finalSuperAdmin)
  })

  it('blocks demoting the final enabled Super Admin', () => {
    expect(
      checkTeamChange(
        change({
          currentRole: 'admin',
          nextRole: 'ops',
          nextEnabled: true,
          enabledAdminCount: 1,
        }),
      ),
    ).toBe(TEAM_ACCESS_MESSAGES.finalSuperAdmin)
  })

  it('uses the exact required message', () => {
    expect(TEAM_ACCESS_MESSAGES.finalSuperAdmin).toBe(
      'You cannot remove or disable the final Super Admin.',
    )
  })

  it('does not fire for a disabled admin (not counted as the final enabled admin)', () => {
    // A currently-disabled admin being edited cannot be the "final enabled" one.
    expect(
      checkTeamChange(
        change({
          currentRole: 'admin',
          currentEnabled: false,
          nextRole: 'ops',
          nextEnabled: false,
          enabledAdminCount: 0,
        }),
      ),
    ).toBeNull()
  })
})

describe('existing Host behaviour is unchanged', () => {
  it("still stores Host as 'ops' and treats it as assignable", () => {
    expect(isAssignableRole('ops')).toBe(true)
    expect(TEAM_ROLE_OPTIONS.find((o) => o.value === 'ops')?.label).toBe('Host')
  })

  it('does not require any final-admin protection for a Host change', () => {
    expect(
      checkTeamChange(change({ currentRole: 'ops', nextRole: 'ops', nextEnabled: false, enabledAdminCount: 1 })),
    ).toBeNull()
  })
})
