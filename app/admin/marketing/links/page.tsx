import { requireAdmin } from '@/lib/admin/auth'
import { LinksManager } from '@/components/admin/marketing/links/LinksManager'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Admin Tracking Links — dedicated page.
 *
 * Access: 'admin' + 'operations_admin'. This is the ONE marketing surface
 * Operations Admin may manage; the admin-only marketing shell at
 * /admin/marketing (Overview + Automations) is never exposed to them. Every
 * write still flows through /api/admin/marketing/links, which re-authorizes
 * both roles server-side — nav visibility is never the security boundary.
 *
 * The Links module itself (LinksManager) is unchanged; this page only provides
 * the route, guard, and heading chrome using the standard admin layout.
 */
export default async function AdminMarketingLinksPage() {
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-bold tracking-tight">Tracking Links</h2>
        <p className="text-sm text-muted-foreground">
          Create trackable links for email, SMS, social, live campaigns and referrals.
        </p>
      </div>

      <LinksManager />
    </div>
  )
}
