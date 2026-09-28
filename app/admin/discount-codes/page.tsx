import { requireAdmin } from "@/lib/admin/auth"
import { DiscountCodesManager } from "@/components/admin/discount-codes/DiscountCodesManager"

export default async function DiscountCodesPage() {
  // Re-guard at the page (the layout also guards). Only 'admin' may mutate; the
  // manager receives `canManage` and hides all create/edit/status controls for
  // operations_admin, whose mutating API calls are also rejected server-side.
  const { role } = await requireAdmin({ roles: ["admin", "operations_admin"] })
  const canManage = role === "admin"

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-bold tracking-tight">Discount Codes</h2>
        <p className="text-sm text-muted-foreground">
          Discount codes reduce the price a customer pays at checkout. New checkouts use a
          code&apos;s current value immediately; existing checkout snapshots are never changed.
        </p>
      </div>

      <DiscountCodesManager canManage={canManage} />
    </div>
  )
}
