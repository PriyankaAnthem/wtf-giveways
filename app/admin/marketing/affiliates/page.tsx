import { Suspense } from 'react'
import { requireAdmin } from '@/lib/admin/auth'
import { AffiliatesManager } from '@/components/admin/marketing/affiliates/AffiliatesManager'
import { AffiliatePerformance } from '@/components/admin/marketing/affiliates/AffiliatePerformance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Admin Affiliates — dedicated page.
 *
 * Access: 'admin' + 'operations_admin' (same surface set as Tracking Links and
 * Performance). The admin-only marketing shell at /admin/marketing is never
 * exposed to operations_admin; this exact route is allow-listed in
 * permissions.ts (OPERATIONS_ADMIN_EXACT_ROUTES). Every write flows through
 * /api/admin/marketing/affiliates, which re-authorizes both roles server-side —
 * nav visibility is never the security boundary.
 */
export default async function AdminMarketingAffiliatesPage() {
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-bold tracking-tight">Affiliates</h2>
        <p className="text-sm text-muted-foreground">
          Track affiliate revenue and commission, then manage the affiliates and partners
          themselves. Attach them to tracking links to attribute revenue and commission —
          independently of channel, source and campaign.
        </p>
      </div>

      <Suspense
        fallback={<div className="h-64 animate-pulse rounded-xl border border-border bg-card" />}
      >
        <AffiliatePerformance />
      </Suspense>

      <section className="space-y-4 border-t border-border pt-6">
        <div className="space-y-1">
          <h3 className="text-2xl font-bold tracking-tight">Manage affiliates</h3>
          <p className="text-sm text-muted-foreground">
            Create, edit and deactivate affiliates and their commission rates.
          </p>
        </div>
        <AffiliatesManager />
      </section>
    </div>
  )
}
