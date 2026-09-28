import { requireAdmin } from "@/lib/admin/auth"
import { getHostDashboard } from "@/lib/admin/host-dashboard"
import { HostComps } from "@/components/admin/host/HostComps"
import { HostDataError } from "@/components/admin/host/HostDataError"

export const dynamic = "force-dynamic"

/**
 * My Comps (/admin/host/comps).
 *
 * Same server guard and host-scoped payload as Home — no extra queries. Only
 * Super Admins and Hosts (ops) may enter; the host is derived from the session.
 */
export default async function HostCompsPage() {
  await requireAdmin({ roles: ["admin", "ops"], redirectTo: "/admin/host/comps" })

  const result = await getHostDashboard()
  if (!result.ok) {
    return <HostDataError reason={result.error} />
  }

  return <HostComps initialData={result.data} />
}
