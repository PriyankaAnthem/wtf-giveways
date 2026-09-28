import { requireAdmin } from '@/lib/admin/auth'
import { ReportsDashboard } from '@/components/admin/reports/ReportsDashboard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Admin finance reports.
 *
 * The page is a thin, admin-only server shell: it enforces authorization and
 * then renders the interactive dashboard, which fetches its data from the
 * admin-only /api/admin/reports endpoint (service-role RPC behind auth).
 */
export default async function AdminReportsPage() {
  await requireAdmin({ roles: ['admin'] })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Sales split by external payment revenue, gross ticket sales, and WTF Credit redeemed.
        </p>
      </div>
      <ReportsDashboard initialRange="today" />
    </div>
  )
}
