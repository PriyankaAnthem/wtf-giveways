import { requireAdmin } from "@/lib/admin/auth"
import { getHostDashboard } from "@/lib/admin/host-dashboard"
import { HostHome } from "@/components/admin/host/HostHome"
import { HostDataError } from "@/components/admin/host/HostDataError"

// Host figures are per-session and time-sensitive; never statically cached.
export const dynamic = "force-dynamic"

/**
 * Host Home (/admin/host).
 *
 * Server guard: only enabled Super Admins and Hosts (ops) may enter — everyone
 * else is redirected to /auth/unauthorized. The initial payload is fetched
 * server-side (host derived from the session inside getHostDashboard) so the
 * screen paints immediately; the client then softly refreshes it.
 */
export default async function HostHomePage() {
  await requireAdmin({ roles: ["admin", "ops"], redirectTo: "/admin/host" })

  const result = await getHostDashboard()
  if (!result.ok) {
    return <HostDataError reason={result.error} />
  }

  return <HostHome initialData={result.data} />
}
