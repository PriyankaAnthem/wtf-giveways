import EntriesPanel from "@/components/admin/entries/EntriesPanel"
import { requireAdmin } from "@/lib/admin/auth"

export default async function EntriesPage() {
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Entries</h2>
        <p className="text-muted-foreground">
          View and manage participant entries
        </p>
      </div>

      <EntriesPanel />
    </div>
  )
}
