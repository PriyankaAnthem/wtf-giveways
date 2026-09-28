import { requireAdmin } from "@/lib/admin/auth"
import { getHostDashboard, getHostPastEarnings } from "@/lib/admin/host-dashboard"
import { HostEarnings } from "@/components/admin/host/HostEarnings"
import { HostDataError } from "@/components/admin/host/HostDataError"

// Host figures are per-session and time-sensitive; never statically cached.
export const dynamic = "force-dynamic"

/**
 * Host Earnings (/admin/host/earnings).
 *
 * Server guard: only enabled Super Admins and Hosts (ops) may enter. The
 * current-month payload reuses the canonical getHostDashboard() (same source as
 * Home / My Comps) and past months come from getHostPastEarnings(); both derive
 * the host from the session, never a client id. They run in parallel.
 */
export default async function HostEarningsPage() {
  await requireAdmin({ roles: ["admin", "ops"], redirectTo: "/admin/host/earnings" })

  const [dashboard, pastResult] = await Promise.all([getHostDashboard(), getHostPastEarnings()])

  if (!dashboard.ok) {
    return (
      <HostDataError
        reason={dashboard.error}
        title="We couldn't load your earnings"
        retryHref="/admin/host/earnings"
      />
    )
  }

  // Past months are secondary: a failure there must not block the live figures.
  const past = pastResult.ok ? pastResult.data : []

  return <HostEarnings initialDashboard={dashboard.data} past={past} />
}
