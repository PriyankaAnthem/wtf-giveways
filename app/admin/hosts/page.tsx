import { requireAdmin } from "@/lib/admin/auth"
import { listTeamMembers } from "./actions"
import { TeamAccessManager } from "@/components/admin/team-access/TeamAccessManager"

export default async function TeamAccessPage() {
  // Super-Admin-only page.
  const { user } = await requireAdmin({ roles: ['admin'] })

  const result = await listTeamMembers()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Team Access</h2>
        <p className="text-muted-foreground">
          Manage Super Admins, Operations Admins and Hosts.
        </p>
      </div>

      {result.ok ? (
        <TeamAccessManager initialMembers={result.members ?? []} currentUserId={user.id} />
      ) : (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {result.error ?? 'Failed to load team members.'}
        </div>
      )}
    </div>
  )
}
