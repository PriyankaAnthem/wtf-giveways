import { requireAdmin } from "@/lib/admin/auth"
import { BigWinsManager } from "@/components/admin/big-wins/BigWinsManager"

export default async function BigWinsPage() {
  // Big Wins is a curated marketing surface: admin-only. The layout guards too;
  // this re-guard keeps the page self-contained and every /api/admin/big-wins
  // route is independently admin-guarded.
  await requireAdmin({ roles: ["admin"] })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-bold tracking-tight">Big Wins</h2>
        <p className="text-sm text-muted-foreground">
          Hand-picked winner cards shown at the top of the public Winners page. These are curated
          marketing highlights &mdash; separate from the automatic winners feed. Add, edit, reorder,
          and hide them here.
        </p>
      </div>

      <BigWinsManager />
    </div>
  )
}
