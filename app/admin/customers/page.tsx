import Link from "next/link"
import { Ban } from "lucide-react"
import { requireAdmin } from "@/lib/admin/auth"
import { Button } from "@/components/ui/button"
import { CustomersWorkspace } from "@/components/admin/customers/CustomersWorkspace"
import { normalizeView } from "@/components/admin/customers/views"

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>
}) {
  // Server-side guard. Mirrors the API allow-list: Super Admins + Operations
  // Admins only (Hosts / read_only are redirected to /auth/unauthorized).
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  // The selected view is URL-addressable (?view=…). Validate it server-side so
  // an unknown value falls back safely to "newest".
  const params = await searchParams
  const raw = Array.isArray(params.view) ? params.view[0] : params.view
  const initialView = normalizeView(raw)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Customers</h2>
          <p className="text-sm text-muted-foreground">
            Browse newest sign-ups, top spenders and recent winners in one workspace.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2 self-start">
          <Link href="/admin/customers/self-exclusions">
            <Ban className="size-4" aria-hidden="true" />
            Self Exclusions
          </Link>
        </Button>
      </div>

      <CustomersWorkspace initialView={initialView} />
    </div>
  )
}
