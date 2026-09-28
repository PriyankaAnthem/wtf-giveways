import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/auth"
import { SelfExclusionsWorkspace } from "@/components/admin/customers/SelfExclusionsWorkspace"

/**
 * Self Exclusions module (a submodule of the Customers area).
 *
 * Viewable by Super Admins AND Operations Admins. The APPLY and REVOKE actions
 * are gated further to Super Admins only — enforced authoritatively by the
 * wallet self-exclude API and the revoke API, never by hiding buttons. The
 * page guard mirrors the list/history APIs (admin + operations_admin).
 */
export default async function SelfExclusionsPage() {
  const { role } = await requireAdmin({ roles: ["admin", "operations_admin"] })

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/customers"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to customers
        </Link>
        <h2 className="text-3xl font-bold tracking-tight">Self Exclusions</h2>
        <p className="text-muted-foreground">
          Search customers, apply purchase restrictions and review exclusion history.
        </p>
      </div>

      <SelfExclusionsWorkspace role={role} />
    </div>
  )
}
