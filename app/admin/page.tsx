import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/admin/auth'
import { DashboardView } from '@/components/admin/reports/DashboardView'
import { GrowthIntelligence } from '@/components/admin/reports/growth/GrowthIntelligence'
import { MarketingDashboardCard } from '@/components/admin/marketing/analytics/MarketingDashboardCard'
import { parseDashboardView } from '@/lib/admin/reporting/growth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  // Preserve existing role routing: hosts (ops) land on the live feed and
  // operations admins land on payouts rather than an unauthorized page; only
  // full Super Admins see finance figures. The role branch runs BEFORE any
  // Dashboard-specific data is loaded, so non-admins never receive it.
  const adminContext = await getAdminContext()

  if (!adminContext) {
    redirect('/auth/unauthorized')
  }
  if (adminContext.role === 'ops') {
    redirect('/admin/live-feed')
  }
  if (adminContext.role === 'operations_admin') {
    redirect('/admin/payouts')
  }
  if (adminContext.role !== 'admin') {
    redirect('/auth/unauthorized')
  }

  const { view } = await searchParams
  const initialView = parseDashboardView(view)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          External payment revenue, gross ticket sales, and WTF Credit redeemed — never blended.
        </p>
      </div>
      {/* Deterministic Growth Intelligence — headline recommendations from the
          last 7 days of real order/checkout/campaign data (no visitor metrics). */}
      <GrowthIntelligence className="rounded-xl border border-border bg-muted/30 p-4" />
      <DashboardView initialView={initialView} />
      <MarketingDashboardCard />
    </div>
  )
}
