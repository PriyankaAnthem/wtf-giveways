/**
 * Central admin navigation registry.
 *
 * This is the single source of truth for the admin sidebar and mobile drawer:
 * every item carries its route, label, icon, and visual section directly. Both
 * the desktop sidebar and the mobile drawer render from the SAME registry via
 * `getVisibleNavGroups`, so they can never drift.
 *
 * IMPORTANT:
 *  - This module is client-safe. It must NOT import server-only modules.
 *  - It is a USABILITY control only. Actual authorization is enforced server
 *    side by requireAdmin / authorizeAdminApi. Visibility here is always
 *    filtered through `canAccessRoute` (the same function the guards mirror),
 *    and this file never widens or narrows any role's access.
 *  - The pure helpers (grouping + active-route resolution) contain no React and
 *    are unit-tested in the Node test environment.
 */
import {
  LayoutDashboard,
  LayoutTemplate,
  Radio,
  Megaphone,
  Trophy,
  Sparkles,
  Zap,
  Tag,
  CalendarDays,
  Ticket,
  Inbox,
  Wallet,
  Banknote,
  BarChart3,
  ScrollText,
  Users,
  UserSearch,
  Ban,
  Home,
  Link2,
  LineChart,
  Handshake,
  type LucideIcon,
} from 'lucide-react'
import { canAccessRoute, type AdminRole } from '@/lib/admin/permissions'

/** Visual grouping sections, in display order. */
export type AdminNavSection = 'overview' | 'operations' | 'finance' | 'system'

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = ['overview', 'operations', 'finance', 'system']

/** Small, muted, uppercase heading text for each section. */
export const ADMIN_SECTION_LABELS: Record<AdminNavSection, string> = {
  overview: 'Overview',
  operations: 'Operations',
  finance: 'Finance',
  system: 'System',
}

/** A nested child link rendered beneath its parent nav item. */
export interface AdminNavChild {
  href: string
  label: string
  icon: LucideIcon
}

export interface AdminNavItem {
  href: string
  label: string
  icon: LucideIcon
  section: AdminNavSection
  /**
   * Optional nested links shown indented beneath this item (e.g. Marketing →
   * Links). Each child is independently visibility-filtered through
   * `canAccessRoute`, so a role may see a parent with only a subset of its
   * children — or, when the parent route itself is not reachable, be routed to
   * the first accessible child instead (see `getVisibleNavGroups`).
   */
  children?: AdminNavChild[]
}

/**
 * A role-resolved nav item ready to render. `href` is the EFFECTIVE clickable
 * target for the current role (the parent route when reachable, otherwise the
 * first reachable child), and `children` contains only the role-visible
 * children. Produced by `getVisibleNavGroups`.
 */
export interface VisibleNavItem {
  href: string
  label: string
  icon: LucideIcon
  section: AdminNavSection
  children: AdminNavChild[]
}

/**
 * The VISIBLE admin navigation items.
 *
 * Order and grouping are authoritative; every item has exactly one icon.
 * Visibility is enforced by `canAccessRoute`, so admin-only items never surface
 * for operations_admin / ops regardless of section.
 *
 * NOTE: Marketing lives in the OPERATIONS section with a nested "Links" child.
 *  - Super Admin: parent → /admin/marketing (Overview + Automations); child →
 *    /admin/marketing/links.
 *  - Operations Admin: the parent route /admin/marketing is admin-only, so the
 *    parent is NOT reachable; `getVisibleNavGroups` routes their Marketing
 *    entry to the first accessible child (/admin/marketing/links) instead, so
 *    they see "Marketing → Links" without ever reaching the admin-only shell.
 *  - Host / read_only never see Marketing or Links.
 * The exact allow-list for /admin/marketing/links lives in permissions.ts
 * (OPERATIONS_ADMIN_EXACT_ROUTES); nav visibility is never the security control.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  // OVERVIEW
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, section: 'overview' },
  { href: '/admin/live-feed', label: 'Live Feed', icon: Radio, section: 'overview' },
  // OPERATIONS
  { href: '/admin/campaigns', label: 'Campaigns', icon: Trophy, section: 'operations' },
  { href: '/admin/schedule', label: 'Schedule', icon: CalendarDays, section: 'operations' },
  { href: '/admin/homepage', label: 'Homepage', icon: LayoutTemplate, section: 'operations' },
  { href: '/admin/big-wins', label: 'Big Wins', icon: Sparkles, section: 'operations' },
  { href: '/admin/instant-wins', label: 'Instant Wins', icon: Zap, section: 'operations' },
  { href: '/admin/discount-codes', label: 'Discount Codes', icon: Tag, section: 'operations' },
  { href: '/admin/entries', label: 'Entries', icon: Ticket, section: 'operations' },
  {
    href: '/admin/customers',
    label: 'Customers',
    icon: UserSearch,
    section: 'operations',
    children: [{ href: '/admin/customers/self-exclusions', label: 'Self Exclusions', icon: Ban }],
  },
  { href: '/admin/inbox', label: 'Inbox', icon: Inbox, section: 'operations' },
  {
    href: '/admin/marketing',
    label: 'Marketing',
    icon: Megaphone,
    section: 'operations',
    children: [
      { href: '/admin/marketing/links', label: 'Links', icon: Link2 },
      { href: '/admin/marketing/performance', label: 'Performance', icon: LineChart },
      { href: '/admin/marketing/affiliates', label: 'Affiliates', icon: Handshake },
    ],
  },
  // FINANCE
  { href: '/admin/wallets', label: 'WTF Credit', icon: Wallet, section: 'finance' },
  { href: '/admin/payouts', label: 'Payouts', icon: Banknote, section: 'finance' },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, section: 'finance' },
  // SYSTEM
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText, section: 'system' },
  { href: '/admin/hosts', label: 'Team Access', icon: Users, section: 'system' },
]

/**
 * Host (ops) navigation — a deliberately tiny, streamlined set for the
 * mobile-first Host area. This is SEPARATE from the staff registry above so the
 * host experience stays focused (Home / Live Feed / My Comps) and the full
 * staff sidebar is never rendered for a Host.
 *
 * Every href here is inside HOST_ALLOWED_ROUTES, so server guards
 * (requireAdmin / canAccessRoute) authorise them for ops. Visibility is never
 * the security boundary — the pages and APIs enforce role server-side.
 */
export interface HostNavItem {
  href: string
  label: string
  icon: LucideIcon
}

export const HOST_NAV_ITEMS: HostNavItem[] = [
  { href: '/admin/host', label: 'Home', icon: Home },
  { href: '/admin/live-feed', label: 'Live Feed', icon: Radio },
  { href: '/admin/host/comps', label: 'My Comps', icon: Trophy },
  { href: '/admin/host/earnings', label: 'Earnings', icon: Banknote },
]

/** Active-route test for the host nav (exact or descendant path). */
export function isHostNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Hidden admin routes.
 *
 * Pages reachable by direct URL for authorised admins but deliberately excluded
 * from every navigation surface. They participate ONLY in header label /
 * active-route resolution (never render a link or prefetch).
 *
 * This list is currently empty: Marketing was previously hidden here but has
 * been restored as a first-class OPERATIONS nav item (see ADMIN_NAV_ITEMS).
 * The export is retained so `resolveActiveNavItem` can still fold in any future
 * hidden routes without a signature change.
 */
export const ADMIN_HIDDEN_NAV_ITEMS: AdminNavItem[] = []

/**
 * Active-route test for sidebar highlighting.
 *
 * "/admin" must match EXACTLY (otherwise it would light up on every route,
 * since it is a prefix of them all). Every other item matches its own path or
 * any descendant. No two non-dashboard hrefs are prefixes of one another, so at
 * most one item is ever active.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export interface AdminNavGroup {
  section: AdminNavSection
  label: string
  items: VisibleNavItem[]
}

/**
 * Groups the role-visible items by section, preserving registry order and
 * dropping any section with no visible items. Visibility is delegated entirely
 * to `canAccessRoute` — this function never changes access.
 *
 * Nested children are visibility-filtered independently. A parent item is shown
 * when its own route is reachable OR at least one child is. When the parent
 * route is NOT reachable but a child is, the parent's clickable `href` is
 * redirected to that first reachable child, so a role can navigate the group
 * without ever being pointed at a route it cannot open (e.g. Operations Admin's
 * Marketing entry resolves to /admin/marketing/links, never /admin/marketing).
 */
export function getVisibleNavGroups(role: AdminRole | null): AdminNavGroup[] {
  const resolved: VisibleNavItem[] = []
  for (const item of ADMIN_NAV_ITEMS) {
    const visibleChildren = (item.children ?? []).filter((child) => canAccessRoute(role, child.href))
    const parentAccessible = canAccessRoute(role, item.href)
    if (!parentAccessible && visibleChildren.length === 0) continue
    resolved.push({
      href: parentAccessible ? item.href : visibleChildren[0].href,
      label: item.label,
      icon: item.icon,
      section: item.section,
      children: visibleChildren,
    })
  }
  return ADMIN_NAV_SECTIONS.map((section) => ({
    section,
    label: ADMIN_SECTION_LABELS[section],
    items: resolved.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0)
}

/**
 * Resolves the nav item that best represents the current pathname, using
 * longest-prefix matching so nested routes (e.g. /admin/campaigns/123/tickets)
 * resolve to their nearest parent nav item (/admin/campaigns). Returns null
 * when nothing matches so callers can fall back to a safe default label.
 *
 * Hidden routes (ADMIN_HIDDEN_NAV_ITEMS) are considered here for LABEL/active
 * resolution only — this function feeds the header title, never the rendered
 * navigation lists, so no hidden link or prefetch is produced.
 */
export function resolveActiveNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null
  let bestLen = -1
  for (const item of [...ADMIN_NAV_ITEMS, ...ADMIN_HIDDEN_NAV_ITEMS]) {
    // Consider the parent and each nested child, so the most specific match
    // wins (e.g. /admin/marketing/links resolves to "Links", not "Marketing").
    const candidates: AdminNavItem[] = [
      item,
      ...(item.children ?? []).map((child) => ({ ...child, section: item.section })),
    ]
    for (const candidate of candidates) {
      if (isNavItemActive(pathname, candidate.href) && candidate.href.length > bestLen) {
        best = candidate
        bestLen = candidate.href.length
      }
    }
  }
  return best
}

/**
 * Compact section/page label for the header. Falls back to "Admin" for any
 * route that has no matching nav item.
 */
export function resolveSectionLabel(pathname: string): string {
  return resolveActiveNavItem(pathname)?.label ?? 'Admin'
}
