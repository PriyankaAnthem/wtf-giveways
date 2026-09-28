// Touch to force redeploy — no functional change.
/**
 * Client-safe admin role utilities.
 *
 * This file MUST NOT import any server-only modules (next/headers,
 * lib/supabase/server, next/navigation redirect, etc.) so it can be safely
 * imported by client components such as AdminSidebarNav.
 *
 * Admin role model (code-only — DB values are managed manually):
 *  - 'admin'            => "Super Admin". Full access to every /admin route + API.
 *  - 'operations_admin' => "Operations Admin". Operational access only
 *                          (payouts, instant winners, entries, wallets, live feed).
 *                          Blocked from dashboard, campaigns, reports, hosts,
 *                          audit logs, and permanent payout deletion.
 *  - 'ops'              => "Host" (UI label). Live-feed-only access.
 *  - 'read_only'        => reserved / no access for now
 *
 * NOTE: never surface the raw 'ops' value in the UI. Use ROLE_LABELS / "Host".
 */
export type AdminRole = 'admin' | 'operations_admin' | 'ops' | 'read_only'

export const ADMIN_ROLES: AdminRole[] = ['admin', 'operations_admin', 'ops', 'read_only']

/** User-facing labels. 'ops' is always shown as "Host". */
export const ROLE_LABELS: Record<AdminRole, string> = {
  admin: 'Super Admin',
  operations_admin: 'Operations Admin',
  ops: 'Host',
  read_only: 'Read Only',
}

/** The internal role value used when saving a Host. */
export const HOST_ROLE: AdminRole = 'ops'

/**
 * Routes a Host (ops) is allowed to reach. Admins can reach everything.
 *
 * Matching is exact-or-descendant (see canAccessRoute), so '/admin/host' also
 * covers '/admin/host/comps'. Note this deliberately does NOT grant
 * '/admin/hosts' (Team Access, plural) — that stays admin-only because
 * '/admin/hosts' neither equals '/admin/host' nor starts with '/admin/host/'.
 */
export const HOST_ALLOWED_ROUTES = ['/admin/host', '/admin/live-feed']

/**
 * Routes an Operations Admin is allowed to reach.
 *
 * Matching uses exact-or-prefix semantics (see canAccessRoute): a route entry
 * matches its own path exactly and any descendant path (`${route}/...`). It
 * deliberately does NOT include '/admin', so the dashboard and every other
 * admin route stay blocked unless explicitly listed here.
 */
export const OPERATIONS_ADMIN_ALLOWED_ROUTES = [
  '/admin/payouts',
  '/admin/instant-wins',
  '/admin/entries',
  '/admin/wallets',
  '/admin/live-feed',
  // Operations Admin works the support Inbox alongside admins. Hosts (ops) and
  // read_only get no access. Enforcement is mirrored on every /api/admin/inbox
  // route via authorizeAdminApi({ roles: ['admin', 'operations_admin'] }).
  '/admin/inbox',
  // Operations Admin may browse the customer directory and open individual
  // customers. The self-exclusion ACTION remains admin-only, enforced at the
  // dialog + wallet self-exclude API layer, never by nav visibility alone.
  '/admin/customers',
  // Operations Admin may VIEW discount codes (read-only). Mutations are still
  // blocked at the page + API layer (admin-only), never by nav visibility alone.
  '/admin/discount-codes',
  // Operations Admin plans alongside admins in the Schedule. This is a manual
  // forward-planning calendar with no live-system side effects, so unlike
  // discount codes both roles may also add/edit/duplicate/delete. Enforcement is
  // mirrored on the page guard and on every /api/admin/schedule route via
  // authorizeAdminApi({ roles: ['admin', 'operations_admin'] }).
  '/admin/schedule',
]

/**
 * Routes an Operations Admin may reach by EXACT match only (never descendants).
 *
 * Unlike OPERATIONS_ADMIN_ALLOWED_ROUTES (exact-or-descendant), these entries
 * grant access to the listed path and NOTHING beneath it. This is a deliberate,
 * explicit allow-list — never a '/admin/marketing/*' prefix.
 *
 * '/admin/marketing/links' is the Tracking Links page, '/admin/marketing/
 * performance' is the Marketing Performance page, and '/admin/marketing/
 * affiliates' is the Affiliates & Partners page (all admin + operations_admin).
 * The admin-only marketing shell at
 * '/admin/marketing' is NOT listed here, so operations_admin cannot reach
 * Overview/Automations, and neither can they reach other descendants like
 * '/admin/marketing/preview'. Because each entry is EXACT (never a descendant),
 * granting Performance does NOT imply broad '/admin/marketing/*' access. Every
 * marketing API except the links CRUD and the read-only performance endpoint
 * likewise stays admin-only. Nav visibility is never the authoritative control
 * — the page + API guards are.
 */
export const OPERATIONS_ADMIN_EXACT_ROUTES = [
  '/admin/marketing/links',
  '/admin/marketing/performance',
  '/admin/marketing/affiliates',
]

/** Normalizes an unknown value into a known AdminRole, or null. */
export function normalizeRole(value: unknown): AdminRole | null {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : null
}

/**
 * Returns true if the given role may access the given pathname.
 *
 * - admin            => everything.
 * - operations_admin => only OPERATIONS_ADMIN_ALLOWED_ROUTES (exact or descendant).
 * - ops (Host)       => only HOST_ALLOWED_ROUTES (exact or descendant).
 * - read_only / null => nothing.
 *
 * This is a usability control for navigation only. Server-side guards
 * (requireAdmin / authorizeAdminApi) remain the authoritative enforcement.
 */
export function canAccessRoute(role: AdminRole | null, pathname: string): boolean {
  if (role === 'admin') return true

  const matches = (routes: string[]) =>
    routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))

  const matchesExact = (routes: string[]) => routes.some((route) => pathname === route)

  if (role === 'operations_admin') {
    return matches(OPERATIONS_ADMIN_ALLOWED_ROUTES) || matchesExact(OPERATIONS_ADMIN_EXACT_ROUTES)
  }
  if (role === 'ops') return matches(HOST_ALLOWED_ROUTES)
  return false
}

/** Returns true if the role may access the admin area at all. */
export function canAccessAdmin(role: AdminRole | null): boolean {
  return role === 'admin' || role === 'operations_admin' || role === 'ops'
}
