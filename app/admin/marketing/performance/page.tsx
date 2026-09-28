import { requireAdmin } from '@/lib/admin/auth'
import { MarketingPerformance } from '@/components/admin/marketing/performance/MarketingPerformance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Marketing Performance — dedicated page.
 *
 * Access: 'admin' + 'operations_admin'. This is the SECOND marketing surface
 * (alongside Tracking Links) that Operations Admin may reach; the admin-only
 * marketing shell at /admin/marketing (Overview + Automations) is never exposed
 * to them. The grant is an EXACT route in permissions.ts
 * (OPERATIONS_ADMIN_EXACT_ROUTES) — it does NOT widen /admin/marketing/*.
 *
 * All data comes from /api/admin/marketing/performance (which re-authorizes both
 * roles server-side and runs the service-role RPC); the browser never touches
 * Supabase directly. This page only provides the route, guard, and heading.
 */
export default async function AdminMarketingPerformancePage() {
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-bold tracking-tight">Marketing Performance</h2>
        <p className="text-sm text-muted-foreground">
          See where your revenue comes from and how vouchers affect conversion.
        </p>
      </div>

      <MarketingPerformance />
    </div>
  )
}
