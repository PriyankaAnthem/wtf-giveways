import { describe, it, expect } from 'vitest'
import {
  ADMIN_NAV_ITEMS,
  ADMIN_HIDDEN_NAV_ITEMS,
  ADMIN_NAV_SECTIONS,
  getVisibleNavGroups,
  isNavItemActive,
  resolveActiveNavItem,
  resolveSectionLabel,
} from '@/lib/admin/navigation'
import { canAccessRoute, type AdminRole } from '@/lib/admin/permissions'

/**
 * Presentation-layer navigation registry tests.
 *
 * These assert the SHELL's visual contract (icons, grouping, active-route
 * resolution) AND that navigation visibility still exactly mirrors
 * `canAccessRoute`. They must fail loudly if the registry ever drifts from the
 * authoritative permission model or if a role's visible set changes.
 */

// The authoritative expected registry — order, labels, routes and sections.
// Locked here so any accidental reorder/rename/regroup is caught.
const EXPECTED = [
  { href: '/admin', label: 'Dashboard', section: 'overview' },
  { href: '/admin/live-feed', label: 'Live Feed', section: 'overview' },
  { href: '/admin/campaigns', label: 'Campaigns', section: 'operations' },
  { href: '/admin/schedule', label: 'Schedule', section: 'operations' },
  { href: '/admin/homepage', label: 'Homepage', section: 'operations' },
  { href: '/admin/big-wins', label: 'Big Wins', section: 'operations' },
  { href: '/admin/instant-wins', label: 'Instant Wins', section: 'operations' },
  { href: '/admin/discount-codes', label: 'Discount Codes', section: 'operations' },
  { href: '/admin/entries', label: 'Entries', section: 'operations' },
  { href: '/admin/customers', label: 'Customers', section: 'operations' },
  { href: '/admin/inbox', label: 'Inbox', section: 'operations' },
  // Marketing is a first-class OPERATIONS item (admin-only via canAccessRoute).
  { href: '/admin/marketing', label: 'Marketing', section: 'operations' },
  { href: '/admin/wallets', label: 'WTF Credit', section: 'finance' },
  { href: '/admin/payouts', label: 'Payouts', section: 'finance' },
  { href: '/admin/reports', label: 'Reports', section: 'finance' },
  { href: '/admin/audit-logs', label: 'Audit Logs', section: 'system' },
  { href: '/admin/hosts', label: 'Team Access', section: 'system' },
] as const

describe('admin nav registry', () => {
  it('contains exactly the 17 visible items in the expected order, labels and sections', () => {
    expect(ADMIN_NAV_ITEMS.map((i) => ({ href: i.href, label: i.label, section: i.section }))).toEqual(
      EXPECTED.map((e) => ({ href: e.href, label: e.label, section: e.section })),
    )
  })

  it('gives every item exactly one icon (a renderable component)', () => {
    expect(ADMIN_NAV_ITEMS).toHaveLength(17)
    for (const item of ADMIN_NAV_ITEMS) {
      // lucide icons are forwardRef objects or functions — both are valid.
      const t = typeof item.icon
      expect(t === 'function' || t === 'object', `${item.href} icon`).toBe(true)
      expect(item.icon, `${item.href} icon`).toBeTruthy()
    }
  })

  it('only uses known sections', () => {
    for (const item of ADMIN_NAV_ITEMS) {
      expect(ADMIN_NAV_SECTIONS).toContain(item.section)
    }
  })
})

describe('isNavItemActive', () => {
  it('matches /admin (dashboard) exactly, never as a prefix', () => {
    expect(isNavItemActive('/admin', '/admin')).toBe(true)
    expect(isNavItemActive('/admin/campaigns', '/admin')).toBe(false)
    expect(isNavItemActive('/admin/reports', '/admin')).toBe(false)
  })

  it('matches other items on exact path or descendant', () => {
    expect(isNavItemActive('/admin/campaigns', '/admin/campaigns')).toBe(true)
    expect(isNavItemActive('/admin/campaigns/123', '/admin/campaigns')).toBe(true)
    expect(isNavItemActive('/admin/campaigns/123/tickets', '/admin/campaigns')).toBe(true)
    expect(isNavItemActive('/admin/entries', '/admin/campaigns')).toBe(false)
  })

  it('never marks more than one registry item active for any real route', () => {
    const routes = [
      '/admin',
      '/admin/live-feed',
      '/admin/live-feed/abc',
      '/admin/campaigns/123/tickets',
      '/admin/wallets/user-1',
      '/admin/discount-codes',
    ]
    for (const route of routes) {
      const activeCount = ADMIN_NAV_ITEMS.filter((i) => isNavItemActive(route, i.href)).length
      expect(activeCount, route).toBeLessThanOrEqual(1)
    }
  })
})

describe('resolveActiveNavItem (longest-prefix, nested routes)', () => {
  it('resolves nested routes to their nearest parent nav item', () => {
    expect(resolveActiveNavItem('/admin/campaigns/123/tickets')?.href).toBe('/admin/campaigns')
    expect(resolveActiveNavItem('/admin/live-feed/xyz')?.href).toBe('/admin/live-feed')
    expect(resolveActiveNavItem('/admin/wallets/user-1')?.href).toBe('/admin/wallets')
  })

  it('resolves the dashboard exactly', () => {
    expect(resolveActiveNavItem('/admin')?.href).toBe('/admin')
  })

  it('returns null for unmatched routes so the label can fall back', () => {
    expect(resolveActiveNavItem('/admin/does-not-exist')).toBeNull()
    expect(resolveSectionLabel('/admin/does-not-exist')).toBe('Admin')
    expect(resolveSectionLabel('/admin/campaigns/123')).toBe('Campaigns')
  })
})

describe('getVisibleNavGroups — visibility mirrors canAccessRoute exactly', () => {
  // Flatten helper.
  const hrefs = (role: AdminRole | null) => getVisibleNavGroups(role).flatMap((g) => g.items.map((i) => i.href))

  it('admin sees all 17 visible items across all 4 groups, in order', () => {
    const groups = getVisibleNavGroups('admin')
    expect(groups.map((g) => g.section)).toEqual(['overview', 'operations', 'finance', 'system'])
    expect(hrefs('admin')).toEqual(ADMIN_NAV_ITEMS.map((i) => i.href))
    // The super admin now sees Marketing as a visible operations item.
    expect(hrefs('admin')).toContain('/admin/marketing')
  })

  it('operations_admin sees exactly its authorised routes (no more, no less)', () => {
    expect(new Set(hrefs('operations_admin'))).toEqual(
      new Set([
        '/admin/live-feed',
        // Operations Admin plans in the Schedule alongside admins.
        '/admin/schedule',
        '/admin/instant-wins',
        '/admin/discount-codes',
        '/admin/entries',
        '/admin/customers',
        '/admin/inbox',
        // Operations Admin sees the Marketing group, but the parent route
        // (/admin/marketing) is admin-only, so its EFFECTIVE clickable href
        // resolves to the first accessible child: the dedicated Links page.
        '/admin/marketing/links',
        '/admin/wallets',
        '/admin/payouts',
      ]),
    )
    // The admin-only marketing shell, dashboard, campaigns, homepage, reports,
    // audit logs and team access must NOT appear.
    for (const denied of [
      '/admin',
      '/admin/marketing',
      '/admin/campaigns',
      '/admin/homepage',
      '/admin/reports',
      '/admin/audit-logs',
      '/admin/hosts',
    ]) {
      expect(hrefs('operations_admin')).not.toContain(denied)
    }
  })

  it('operations_admin does not render the (now-empty) system group', () => {
    const sections = getVisibleNavGroups('operations_admin').map((g) => g.section)
    expect(sections).not.toContain('system')
    // Overview only has Live Feed for this role (Dashboard hidden) but still renders.
    expect(sections).toContain('overview')
  })

  it('host (ops) sees only Live Feed, in a single group', () => {
    expect(hrefs('ops')).toEqual(['/admin/live-feed'])
    const groups = getVisibleNavGroups('ops')
    expect(groups).toHaveLength(1)
    expect(groups[0].section).toBe('overview')
  })

  it('read_only and null see NOTHING (no groups rendered)', () => {
    expect(getVisibleNavGroups('read_only')).toEqual([])
    expect(getVisibleNavGroups(null)).toEqual([])
  })

  it('never renders an empty group for any role', () => {
    for (const role of ['admin', 'operations_admin', 'ops', 'read_only', null] as (AdminRole | null)[]) {
      for (const group of getVisibleNavGroups(role)) {
        expect(group.items.length, `${role} / ${group.section}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('Marketing → nested Links navigation', () => {
  const marketingItem = (role: AdminRole | null) =>
    getVisibleNavGroups(role)
      .flatMap((g) => g.items)
      .find((i) => i.label === 'Marketing')

  it('is present exactly once in the registry, in operations, with Links + Performance + Affiliates children', () => {
    const marketing = ADMIN_NAV_ITEMS.filter((i) => i.href === '/admin/marketing')
    expect(marketing).toHaveLength(1)
    expect(marketing[0].label).toBe('Marketing')
    expect(marketing[0].section).toBe('operations')
    expect(marketing[0].children).toEqual([
      expect.objectContaining({ href: '/admin/marketing/links', label: 'Links' }),
      expect.objectContaining({ href: '/admin/marketing/performance', label: 'Performance' }),
      expect.objectContaining({ href: '/admin/marketing/affiliates', label: 'Affiliates' }),
    ])
  })

  it('admin: parent points at the shell and exposes all children', () => {
    const item = marketingItem('admin')
    expect(item?.href).toBe('/admin/marketing')
    expect(item?.children.map((c) => c.href)).toEqual([
      '/admin/marketing/links',
      '/admin/marketing/performance',
      '/admin/marketing/affiliates',
    ])
  })

  it('operations_admin: parent is redirected to the first accessible child; all children visible', () => {
    const item = marketingItem('operations_admin')
    expect(item, 'operations_admin should see Marketing').toBeDefined()
    // Parent route is admin-only, so the clickable target is the first child (Links).
    expect(item?.href).toBe('/admin/marketing/links')
    // Links, Performance and Affiliates are all exact-route grants for operations_admin.
    expect(item?.children.map((c) => c.href)).toEqual([
      '/admin/marketing/links',
      '/admin/marketing/performance',
      '/admin/marketing/affiliates',
    ])
  })

  it('host / read_only / null never see Marketing, Links, Performance or Affiliates', () => {
    for (const role of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(marketingItem(role), `${role}`).toBeUndefined()
    }
  })

  it('is no longer part of the hidden-route list; visible/hidden never overlap', () => {
    expect(ADMIN_HIDDEN_NAV_ITEMS.map((i) => i.href)).not.toContain('/admin/marketing')
    const visible = new Set(ADMIN_NAV_ITEMS.map((i) => i.href))
    for (const hidden of ADMIN_HIDDEN_NAV_ITEMS) {
      expect(visible.has(hidden.href)).toBe(false)
    }
  })

  it('permissions: /admin/marketing is admin-only; /admin/marketing/links allows both admins', () => {
    // The admin-only shell.
    expect(canAccessRoute('admin', '/admin/marketing')).toBe(true)
    expect(canAccessRoute('operations_admin', '/admin/marketing')).toBe(false)
    // The dedicated Links + Performance pages (exact allow-list — no leakage).
    expect(canAccessRoute('admin', '/admin/marketing/links')).toBe(true)
    expect(canAccessRoute('operations_admin', '/admin/marketing/links')).toBe(true)
    expect(canAccessRoute('admin', '/admin/marketing/performance')).toBe(true)
    expect(canAccessRoute('operations_admin', '/admin/marketing/performance')).toBe(true)
    expect(canAccessRoute('admin', '/admin/marketing/affiliates')).toBe(true)
    expect(canAccessRoute('operations_admin', '/admin/marketing/affiliates')).toBe(true)
    // Other marketing descendants stay admin-only for operations_admin.
    expect(canAccessRoute('operations_admin', '/admin/marketing/preview')).toBe(false)
    expect(canAccessRoute('operations_admin', '/admin/marketing/links/extra')).toBe(false)
    expect(canAccessRoute('operations_admin', '/admin/marketing/performance/extra')).toBe(false)
    expect(canAccessRoute('operations_admin', '/admin/marketing/affiliates/extra')).toBe(false)
    for (const denied of ['ops', 'read_only', null] as (AdminRole | null)[]) {
      expect(canAccessRoute(denied, '/admin/marketing'), `${denied}`).toBe(false)
      expect(canAccessRoute(denied, '/admin/marketing/links'), `${denied}`).toBe(false)
      expect(canAccessRoute(denied, '/admin/marketing/performance'), `${denied}`).toBe(false)
      expect(canAccessRoute(denied, '/admin/marketing/affiliates'), `${denied}`).toBe(false)
    }
  })

  it('resolves the header label: Marketing for the shell, Links/Performance for nested pages', () => {
    expect(resolveActiveNavItem('/admin/marketing')?.label).toBe('Marketing')
    expect(resolveSectionLabel('/admin/marketing')).toBe('Marketing')
    expect(resolveSectionLabel('/admin/marketing/anything')).toBe('Marketing')
    // The nested children are more specific, so they win on their own routes.
    expect(resolveActiveNavItem('/admin/marketing/links')?.label).toBe('Links')
    expect(resolveSectionLabel('/admin/marketing/links')).toBe('Links')
    expect(resolveActiveNavItem('/admin/marketing/performance')?.label).toBe('Performance')
    expect(resolveSectionLabel('/admin/marketing/performance')).toBe('Performance')
    expect(resolveActiveNavItem('/admin/marketing/affiliates')?.label).toBe('Affiliates')
    expect(resolveSectionLabel('/admin/marketing/affiliates')).toBe('Affiliates')
  })
})
