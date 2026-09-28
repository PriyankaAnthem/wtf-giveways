import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/auth"
import { CustomerDetail } from "@/components/admin/customers/CustomerDetail"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  // Super Admins + Operations Admins only. The self-exclusion ACTION is gated
  // further (admin-only) inside CustomerDetail via the acting role.
  const { role } = await requireAdmin({ roles: ['admin', 'operations_admin'] })

  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    notFound()
  }

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
        <h2 className="text-3xl font-bold tracking-tight">Customer</h2>
        <p className="text-muted-foreground">
          Account details, purchase activity and WTF Credit.
        </p>
      </div>

      <CustomerDetail userId={userId} role={role} />
    </div>
  )
}
