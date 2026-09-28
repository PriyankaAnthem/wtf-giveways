import { requireAdmin } from "@/lib/admin/auth"
import { InboxList } from "@/components/admin/inbox/InboxList"

export const dynamic = "force-dynamic"

export default async function InboxPage() {
  // Server-side guard. Mirrors every /api/admin/inbox route: Super Admins +
  // Operations Admins only (Hosts / read_only are redirected to unauthorized).
  await requireAdmin({ roles: ["admin", "operations_admin"] })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Inbox</h2>
        <p className="text-sm text-muted-foreground">
          Customer support enquiries. Reply, assign and track each ticket to resolution.
        </p>
      </div>

      <InboxList />
    </div>
  )
}
