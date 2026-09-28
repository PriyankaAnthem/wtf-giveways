import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { getHostDashboard } from "@/lib/admin/host-dashboard"
import { HostCampaignDetail } from "@/components/admin/host/HostCampaignDetail"
import { HostDataError } from "@/components/admin/host/HostDataError"

export const dynamic = "force-dynamic"

/**
 * Host campaign detail (/admin/host/comps/[id]).
 *
 * Reuses the host-scoped payload (no extra queries) and looks the campaign up
 * within THIS host's own set. A campaign the host isn't assigned to simply
 * 404s — a host can never view another host's / an unassigned campaign by id.
 */
export default async function HostCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin({ roles: ["admin", "ops"], redirectTo: "/admin/host/comps" })
  const { id } = await params

  const result = await getHostDashboard()
  if (!result.ok) {
    return <HostDataError reason={result.error} />
  }

  const campaign = result.data.campaigns.find((c) => c.campaignId === id)
  if (!campaign) {
    notFound()
  }

  return <HostCampaignDetail campaign={campaign} monthLabel={result.data.month.label} />
}
