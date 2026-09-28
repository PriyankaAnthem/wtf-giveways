import { describe, it, expect } from 'vitest'
import {
  type AdminRole,
  ADMIN_ROLES,
  ROLE_LABELS,
  HOST_ROLE,
  HOST_ALLOWED_ROUTES,
  OPERATIONS_ADMIN_ALLOWED_ROUTES,
  OPERATIONS_ADMIN_EXACT_ROUTES,
  normalizeRole,
  canAccessRoute,
  canAccessAdmin,
} from '@/lib/admin/permissions'

/**
 * Authorization matrix for the /admin surface.
 *
 * `permissions.ts` is the single, client-safe source of truth that every
 * server guard (requireAdmin / authorizeAdminApi) and the navigation consult.
 * The `GUARDS` map below mirrors the exact role arrays passed to those guards
 * in the codebase, so these tests fail loudly if a campaign / report / host /
 * prize / delete guard is ever accidentally widened to operations_admin.
 */

// Access decision as performed by requireAdmin / authorizeAdminApi:
// the caller must have an enabled, known role that is in the allowed set.
function isAuthorized(allowed: AdminRole[], role: AdminRole | null): boolean {
  if (!role) return false
  return allowed.includes(role)
}

// Mirror of every guard's role array in the codebase, keyed by surface.
const GUARDS: Record<string, AdminRole[]> = {
  // Shell entry (app/admin/layout.tsx) — entry only; child pages re-guard.
  'layout:/admin': ['admin', 'operations_admin', 'ops'],

  // Allowed pages
  'page:/admin/payouts': ['admin', 'operations_admin'],
  'page:/admin/instant-wins': ['admin', 'operations_admin'],
  'page:/admin/discount-codes': ['admin', 'operations_admin'],
  'page:/admin/entries': ['admin', 'operations_admin'],
  'page:/admin/wallets': ['admin', 'operations_admin'],
  'page:/admin/wallets/[userId]': ['admin', 'operations_admin'],
  'page:/admin/live-feed': ['admin', 'operations_admin', 'ops'],
  'page:/admin/live-feed/[id]': ['admin', 'operations_admin', 'ops'],

  // Allowed APIs
  'api:GET /api/admin/instant-winners': ['admin', 'operations_admin'],
  'api:POST /api/admin/instant-winners': ['admin', 'operations_admin'],
  'api:GET /api/admin/discount-codes': ['admin', 'operations_admin'],
  'api:GET /api/admin/entries': ['admin', 'operations_admin'],
  'api:GET /api/admin/wallets/search': ['admin', 'operations_admin'],
  'api:GET /api/admin/wallets/[userId]': ['admin', 'operations_admin'],
  'api:POST /api/admin/wallets/[userId]/credit': ['admin', 'operations_admin'],
  'api:GET /api/admin/live-feed': ['admin', 'operations_admin', 'ops'],
  'api:GET /api/admin/live-feed/campaigns': ['admin', 'operations_admin', 'ops'],
  'api:GET /api/admin/live-feed/[id]': ['admin', 'operations_admin', 'ops'],

  // The marketing shell (Overview + Automations) is Super Admin only. Tracking
  // Links lives on its own dedicated page that both admin roles may reach.
  'page:/admin/marketing (shell)': ['admin'],
  'page:/admin/marketing/links': ['admin', 'operations_admin'],
  // Marketing Performance is a dedicated read-only reporting page/API that both
  // admins may reach (exact-route grant — never widens the admin-only shell).
  'page:/admin/marketing/performance': ['admin', 'operations_admin'],
  'api:GET /api/admin/marketing/performance': ['admin', 'operations_admin'],
  // Affiliates: dedicated page + CRUD API, both admin + operations_admin (no DELETE).
  'page:/admin/marketing/affiliates': ['admin', 'operations_admin'],
  'api:GET /api/admin/marketing/affiliates': ['admin', 'operations_admin'],
  'api:POST /api/admin/marketing/affiliates': ['admin', 'operations_admin'],
  'api:PUT /api/admin/marketing/affiliates': ['admin', 'operations_admin'],
  'api:PATCH /api/admin/marketing/affiliates': ['admin', 'operations_admin'],
  'api:GET /api/admin/marketing/links': ['admin', 'operations_admin'],
  'api:POST /api/admin/marketing/links': ['admin', 'operations_admin'],
  'api:PUT /api/admin/marketing/links': ['admin', 'operations_admin'],
  'api:PATCH /api/admin/marketing/links': ['admin', 'operations_admin'],
  // Read-only destination lookup feeding the Links create/edit dialog. Must
  // match the Links CRUD roles so the competition picker works for both.
  'api:GET /api/admin/marketing/link-destinations': ['admin', 'operations_admin'],

  // Allowed server actions (app/admin/payouts/actions.ts)
  'action:updatePayoutStatus': ['admin', 'operations_admin'],
  'action:bulkUpdatePayoutStatus': ['admin', 'operations_admin'],

  // Blocked — Super Admin only
  'page:/admin (dashboard)': ['admin'],
  'page:/admin/campaigns': ['admin'],
  'page:/admin/campaigns/[id]': ['admin'],
  'page:/admin/campaigns/[id]/tickets': ['admin'],
  'page:/admin/reports': ['admin'],
  'page:/admin/hosts': ['admin'],
  'page:/admin/audit-logs': ['admin'],
  'api:POST /api/admin/campaigns': ['admin'],
  'api:POST /api/admin/campaigns/duplicate': ['admin'],
  'api:GET /api/admin/campaigns/[id]/tickets': ['admin'],
  'api:instant-win-prizes': ['admin'],
  'api:instant-win-prizes/quantity': ['admin'],
  'api:POST /api/admin/discount-codes': ['admin'],
  'api:PUT /api/admin/discount-codes': ['admin'],
  'api:PATCH /api/admin/discount-codes': ['admin'],
  'api:GET /api/admin/reports': ['admin'],
  'api:GET /api/admin/reports/export': ['admin'],
  'action:deletePayout': ['admin'],

  // Blocked — every marketing surface EXCEPT Links stays Super Admin only.
  'api:GET /api/admin/marketing/analytics': ['admin'],
  'api:POST /api/admin/marketing/automations': ['admin'],
  'api:POST /api/admin/marketing/control': ['admin'],
  'api:GET /api/admin/marketing/audiences': ['admin'],
  'api:POST /api/admin/marketing/templates': ['admin'],
  'api:POST /api/admin/marketing/promotions': ['admin'],
  'api:GET /api/admin/marketing/ops/summary': ['admin'],
  'api:POST /api/admin/marketing/ops/control': ['admin'],
  'api:POST /api/admin/marketing/ops/automation': ['admin'],
  'api:GET /api/admin/marketing/ops/definition': ['admin'],

  // Blocked — campaign live-board stays admin + Host only (unchanged)
  'page:/admin/campaigns/[id]/live-board': ['admin'],
  'api:POST /api/admin/campaigns/[id]/live-board/action': ['admin', 'ops'],
}

describe('role model', () => {
  it('recognises exactly the four stored roles', () => {
    expect(ADMIN_ROLES).toEqual(['admin', 'operations_admin', 'ops', 'read_only'])
  })

  it('uses the approved display labels', () => {
    expect(ROLE_LABELS.admin).toBe('Super Admin')
    expect(ROLE_LABELS.operations_admin).toBe('Operations Admin')
    expect(ROLE_LABELS.ops).toBe('Host')
    expect(ROLE_LABELS.read_only).toBe('Read Only')
  })

  it('keeps Host mapped to the stored "ops" value', () => {
    expect(HOST_ROLE).toBe('ops')
  })
})

describe('normalizeRole (fail closed)', () => {
  it('accepts every known role', () => {
    for (const r of ADMIN_ROLES) expect(normalizeRole(r)).toBe(r)
  })

  it('rejects unknown / empty / nullish values', () => {
    expect(normalizeRole('operationsadmin')).toBeNull()
    expect(normalizeRole('superadmin')).toBeNull()
    expect(normalizeRole('')).toBeNull()
    expect(normalizeRole(undefined)).toBeNull()
    expect(normalizeRole(null)).toBeNull()
    expect(normalizeRole(42)).toBeNull()
  })
})

describe('canAccessAdmin (shell entry)', () => {
  it('admits admin, operations_admin, and ops', () => {
    expect(canAccessAdmin('admin')).toBe(true)
    expect(canAccessAdmin('operations_admin')).toBe(true)
    expect(canAccessAdmin('ops')).toBe(true)
  })

  it('rejects read_only and unknown', () => {
    expect(canAccessAdmin('read_only')).toBe(false)
    expect(canAccessAdmin(null)).toBe(false)
  })
})

describe('canAccessRoute (navigation visibility)', () => {
  const opsAdminAllows = [
    '/admin/payouts',
    '/admin/instant-wins',
    '/admin/discount-codes',
    '/admin/entries',
    '/admin/wallets',
    '/admin/wallets/abc-123',
    '/admin/live-feed',
    '/admin/live-feed/some-id',
  ]
  const opsAdminDenies = [
    '/admin',
    '/admin/campaigns',
    '/admin/campaigns/123',
    '/admin/reports',
    '/admin/reports/export',
    '/admin/hosts',
    '/admin/audit-logs',
  ]

  it('admin sees everything', () => {
    for (const p of [...opsAdminAllows, ...opsAdminDenies]) {
      expect(canAccessRoute('admin', p)).toBe(true)
    }
  })

  it('operations_admin sees only its allow-list (incl. descendants)', () => {
    for (const p of opsAdminAllows) expect(canAccessRoute('operations_admin', p)).toBe(true)
    for (const p of opsAdminDenies) expect(canAccessRoute('operations_admin', p)).toBe(false)
  })

  it('operations_admin allow-list does not leak to the /admin dashboard', () => {
    // '/admin' must never be granted via a prefix match of an allowed route.
    expect(canAccessRoute('operations_admin', '/admin')).toBe(false)
    expect(OPERATIONS_ADMIN_ALLOWED_ROUTES).not.toContain('/admin')
  })

  it('ops (Host) sees only the host area and the live feed', () => {
    expect(canAccessRoute('ops', '/admin/live-feed')).toBe(true)
    expect(canAccessRoute('ops', '/admin/live-feed/xyz')).toBe(true)
    // The host area was added alongside the Host pages; hosts reach their own
    // dashboard and the live feed, and nothing else.
    expect(canAccessRoute('ops', '/admin/host')).toBe(true)
    expect(canAccessRoute('ops', '/admin/host/earnings')).toBe(true)
    expect(HOST_ALLOWED_ROUTES).toEqual(['/admin/host', '/admin/live-feed'])
    for (const p of [
      '/admin',
      '/admin/payouts',
      '/admin/entries',
      '/admin/wallets',
      '/admin/campaigns',
      '/admin/schedule',
    ]) {
      expect(canAccessRoute('ops', p)).toBe(false)
    }
  })

  it('the Schedule is reachable by admin and operations_admin only', () => {
    // Both plan together; hosts and read-only users never see it.
    expect(canAccessRoute('admin', '/admin/schedule')).toBe(true)
    expect(canAccessRoute('operations_admin', '/admin/schedule')).toBe(true)
    for (const role of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(canAccessRoute(role, '/admin/schedule'), `${role}`).toBe(false)
    }
  })

  it('read_only and unknown see nothing', () => {
    for (const p of [...opsAdminAllows, ...opsAdminDenies]) {
      expect(canAccessRoute('read_only', p)).toBe(false)
      expect(canAccessRoute(null, p)).toBe(false)
    }
  })
})

describe('Marketing → Links access model (dedicated page, exact-route)', () => {
  it('operations_admin may reach /admin/marketing/links EXACTLY (not the shell)', () => {
    expect(canAccessRoute('operations_admin', '/admin/marketing/links')).toBe(true)
    expect(OPERATIONS_ADMIN_EXACT_ROUTES).toContain('/admin/marketing/links')
    // The admin-only marketing shell is NOT reachable by operations_admin.
    expect(canAccessRoute('operations_admin', '/admin/marketing')).toBe(false)
    expect(OPERATIONS_ADMIN_EXACT_ROUTES).not.toContain('/admin/marketing')
  })

  it('the exact grant does NOT leak to the shell or other marketing descendants', () => {
    // Only /admin/marketing/links is granted — exactly, with no descendants.
    // The shell and every other descendant (e.g. the email preview) stay Super
    // Admin only. This is why the links page uses the exact-route list rather
    // than a broad /admin/marketing/* prefix.
    for (const p of [
      '/admin/marketing',
      '/admin/marketing/preview',
      '/admin/marketing/anything',
      '/admin/marketing/links/extra', // descendant of Links must not be granted
    ]) {
      expect(canAccessRoute('operations_admin', p), p).toBe(false)
    }
    expect(OPERATIONS_ADMIN_ALLOWED_ROUTES).not.toContain('/admin/marketing')
    expect(OPERATIONS_ADMIN_ALLOWED_ROUTES).not.toContain('/admin/marketing/links')
  })

  it('operations_admin may reach /admin/marketing/performance EXACTLY (not the shell)', () => {
    expect(canAccessRoute('operations_admin', '/admin/marketing/performance')).toBe(true)
    expect(OPERATIONS_ADMIN_EXACT_ROUTES).toContain('/admin/marketing/performance')
    // Still exact-only: neither the shell nor a descendant of Performance leaks.
    expect(canAccessRoute('operations_admin', '/admin/marketing')).toBe(false)
    expect(canAccessRoute('operations_admin', '/admin/marketing/performance/extra')).toBe(false)
    expect(OPERATIONS_ADMIN_ALLOWED_ROUTES).not.toContain('/admin/marketing/performance')
  })

  it('the Performance grant does NOT imply broad /admin/marketing/* access', () => {
    // Two independent exact grants (links + performance) must never combine into
    // a prefix grant over the admin-only marketing shell or its other children.
    for (const p of [
      '/admin/marketing',
      '/admin/marketing/preview',
      '/admin/marketing/anything',
      '/admin/marketing/performance/extra',
    ]) {
      expect(canAccessRoute('operations_admin', p), p).toBe(false)
    }
  })

  it('host / read_only / null never reach Performance', () => {
    for (const role of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(canAccessRoute(role, '/admin/marketing/performance'), `${role}`).toBe(false)
    }
  })

  it('operations_admin may reach /admin/marketing/affiliates EXACTLY (not the shell)', () => {
    expect(canAccessRoute('operations_admin', '/admin/marketing/affiliates')).toBe(true)
    expect(OPERATIONS_ADMIN_EXACT_ROUTES).toContain('/admin/marketing/affiliates')
    // Exact-only: neither the shell nor a descendant of Affiliates leaks.
    expect(canAccessRoute('operations_admin', '/admin/marketing')).toBe(false)
    expect(canAccessRoute('operations_admin', '/admin/marketing/affiliates/extra')).toBe(false)
    expect(OPERATIONS_ADMIN_ALLOWED_ROUTES).not.toContain('/admin/marketing/affiliates')
  })

  it('the three marketing exact grants never combine into /admin/marketing/* access', () => {
    // links + performance + affiliates are independent EXACT grants; together
    // they must still never grant the admin-only shell or any other descendant.
    for (const p of [
      '/admin/marketing',
      '/admin/marketing/preview',
      '/admin/marketing/anything',
      '/admin/marketing/affiliates/extra',
    ]) {
      expect(canAccessRoute('operations_admin', p), p).toBe(false)
    }
  })

  it('host / read_only / null never reach Affiliates', () => {
    for (const role of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(canAccessRoute(role, '/admin/marketing/affiliates'), `${role}`).toBe(false)
    }
  })

  it('admin reaches the marketing shell, Links, Performance, and all descendants', () => {
    for (const p of [
      '/admin/marketing',
      '/admin/marketing/links',
      '/admin/marketing/performance',
      '/admin/marketing/preview',
    ]) {
      expect(canAccessRoute('admin', p)).toBe(true)
    }
  })

  it('ops (Host), read_only and unknown never reach marketing or Links', () => {
    for (const role of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(canAccessRoute(role, '/admin/marketing'), `${role}`).toBe(false)
      expect(canAccessRoute(role, '/admin/marketing/links'), `${role}`).toBe(false)
      expect(canAccessRoute(role, '/admin/marketing/preview'), `${role}`).toBe(false)
    }
  })

  it('the destination lookup matches the Links CRUD roles (admin + operations_admin only)', () => {
    const guard = GUARDS['api:GET /api/admin/marketing/link-destinations']
    // The create/edit dialog would break for operations_admin if this endpoint
    // stayed admin-only, so it must allow both admin roles...
    expect(isAuthorized(guard, 'admin')).toBe(true)
    expect(isAuthorized(guard, 'operations_admin')).toBe(true)
    // ...but never Host / read_only / unauthenticated.
    for (const role of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(isAuthorized(guard, role), `${role}`).toBe(false)
    }
  })

  it('operations_admin is authorized for Links CRUD (+ destinations) but blocked from every other marketing API', () => {
    for (const surface of [
      'api:GET /api/admin/marketing/links',
      'api:POST /api/admin/marketing/links',
      'api:PUT /api/admin/marketing/links',
      'api:PATCH /api/admin/marketing/links',
      'api:GET /api/admin/marketing/link-destinations',
    ]) {
      expect(isAuthorized(GUARDS[surface], 'operations_admin'), surface).toBe(true)
    }
    for (const surface of [
      'api:GET /api/admin/marketing/analytics',
      'api:POST /api/admin/marketing/automations',
      'api:POST /api/admin/marketing/control',
      'api:GET /api/admin/marketing/audiences',
      'api:POST /api/admin/marketing/templates',
      'api:POST /api/admin/marketing/promotions',
      'api:GET /api/admin/marketing/ops/summary',
      'api:POST /api/admin/marketing/ops/control',
      'api:POST /api/admin/marketing/ops/automation',
      'api:GET /api/admin/marketing/ops/definition',
    ]) {
      expect(isAuthorized(GUARDS[surface], 'operations_admin'), surface).toBe(false)
      // ...but admin keeps full access to those same surfaces.
      expect(isAuthorized(GUARDS[surface], 'admin'), surface).toBe(true)
    }
  })
})

describe('Super Admin authorization matrix', () => {
  it('is authorized for every guarded surface', () => {
    for (const [surface, allowed] of Object.entries(GUARDS)) {
      expect(isAuthorized(allowed, 'admin'), surface).toBe(true)
    }
  })
})

describe('Operations Admin authorization matrix', () => {
  const allowedSurfaces = [
    'page:/admin/payouts',
    'page:/admin/instant-wins',
    'page:/admin/discount-codes',
    'page:/admin/entries',
    'page:/admin/wallets',
    'page:/admin/wallets/[userId]',
    'page:/admin/live-feed',
    'page:/admin/live-feed/[id]',
    'api:GET /api/admin/instant-winners',
    'api:POST /api/admin/instant-winners',
    'api:GET /api/admin/discount-codes',
    'api:GET /api/admin/entries',
    'api:GET /api/admin/wallets/search',
    'api:GET /api/admin/wallets/[userId]',
    'api:POST /api/admin/wallets/[userId]/credit',
    'api:GET /api/admin/live-feed',
    'api:GET /api/admin/live-feed/campaigns',
    'api:GET /api/admin/live-feed/[id]',
    'action:updatePayoutStatus',
    'action:bulkUpdatePayoutStatus',
    'layout:/admin',
    'page:/admin/marketing/links',
    'page:/admin/marketing/performance',
    'api:GET /api/admin/marketing/performance',
    'api:GET /api/admin/marketing/links',
    'api:POST /api/admin/marketing/links',
    'api:PUT /api/admin/marketing/links',
    'api:PATCH /api/admin/marketing/links',
    'api:GET /api/admin/marketing/link-destinations',
  ]

  const blockedSurfaces = [
    'page:/admin (dashboard)',
    'page:/admin/campaigns',
    'page:/admin/campaigns/[id]',
    'page:/admin/campaigns/[id]/tickets',
    'page:/admin/campaigns/[id]/live-board',
    'page:/admin/reports',
    'page:/admin/hosts',
    'page:/admin/audit-logs',
    'api:POST /api/admin/campaigns',
    'api:POST /api/admin/campaigns/duplicate',
    'api:GET /api/admin/campaigns/[id]/tickets',
    'api:POST /api/admin/campaigns/[id]/live-board/action',
    'api:instant-win-prizes',
    'api:instant-win-prizes/quantity',
    'api:POST /api/admin/discount-codes',
    'api:PUT /api/admin/discount-codes',
    'api:PATCH /api/admin/discount-codes',
    'api:GET /api/admin/reports',
    'api:GET /api/admin/reports/export',
    'action:deletePayout',
    'page:/admin/marketing (shell)',
    'api:GET /api/admin/marketing/analytics',
    'api:POST /api/admin/marketing/automations',
    'api:POST /api/admin/marketing/control',
    'api:GET /api/admin/marketing/audiences',
    'api:POST /api/admin/marketing/templates',
    'api:POST /api/admin/marketing/promotions',
    'api:GET /api/admin/marketing/ops/summary',
    'api:POST /api/admin/marketing/ops/control',
    'api:POST /api/admin/marketing/ops/automation',
    'api:GET /api/admin/marketing/ops/definition',
  ]

  it('is authorized for every allowed surface', () => {
    for (const surface of allowedSurfaces) {
      expect(isAuthorized(GUARDS[surface], 'operations_admin'), surface).toBe(true)
    }
  })

  it('is rejected for every blocked surface (direct URL / API / action)', () => {
    for (const surface of blockedSurfaces) {
      expect(isAuthorized(GUARDS[surface], 'operations_admin'), surface).toBe(false)
    }
  })

  it('cannot permanently delete payouts', () => {
    expect(isAuthorized(GUARDS['action:deletePayout'], 'operations_admin')).toBe(false)
    expect(isAuthorized(GUARDS['action:deletePayout'], 'admin')).toBe(true)
  })
})

describe('Host (ops) regression — behaviour unchanged', () => {
  it('keeps live feed access', () => {
    expect(isAuthorized(GUARDS['page:/admin/live-feed'], 'ops')).toBe(true)
    expect(isAuthorized(GUARDS['page:/admin/live-feed/[id]'], 'ops')).toBe(true)
    expect(isAuthorized(GUARDS['api:GET /api/admin/live-feed'], 'ops')).toBe(true)
    expect(isAuthorized(GUARDS['api:GET /api/admin/live-feed/campaigns'], 'ops')).toBe(true)
    expect(isAuthorized(GUARDS['api:GET /api/admin/live-feed/[id]'], 'ops')).toBe(true)
  })

  it('keeps existing live-board action access', () => {
    expect(isAuthorized(GUARDS['api:POST /api/admin/campaigns/[id]/live-board/action'], 'ops')).toBe(true)
  })

  it('remains denied for payouts, entries, wallets, instant winners, campaigns, reports', () => {
    for (const surface of [
      'page:/admin/payouts',
      'action:updatePayoutStatus',
      'page:/admin/entries',
      'page:/admin/wallets',
      'api:GET /api/admin/instant-winners',
      'api:POST /api/admin/instant-winners',
      'page:/admin/campaigns',
      'page:/admin/reports',
    ]) {
      expect(isAuthorized(GUARDS[surface], 'ops'), surface).toBe(false)
    }
  })
})

describe('disabled / invalid / unauthenticated (fail closed)', () => {
  // requireAdmin / authorizeAdminApi resolve the role to null when there is no
  // admin_users row, is_enabled !== true, the role is unknown, or the request
  // is unauthenticated. A null role must never satisfy any guard.
  it('a null role is rejected everywhere', () => {
    for (const [surface, allowed] of Object.entries(GUARDS)) {
      expect(isAuthorized(allowed, null), surface).toBe(false)
    }
  })

  it('read_only is rejected everywhere', () => {
    for (const [surface, allowed] of Object.entries(GUARDS)) {
      expect(isAuthorized(allowed, 'read_only'), surface).toBe(false)
    }
  })

  it('an unknown role string normalizes to null and is denied', () => {
    const unknown = normalizeRole('operations') // note: not "operations_admin"
    expect(unknown).toBeNull()
    expect(isAuthorized(GUARDS['page:/admin/payouts'], unknown)).toBe(false)
  })
})
