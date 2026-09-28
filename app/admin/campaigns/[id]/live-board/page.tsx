import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/admin/auth"
import { LiveBoardPanel } from "@/components/admin/campaigns/live-board/LiveBoardPanel"

export default async function CampaignLiveBoardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin({ roles: ["admin"] })

  const { id } = await params

  // Lightweight title lookup; the live panel fetches full board state client-side.
  const supabase = await createClient()
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("title")
    .eq("id", id)
    .maybeSingle()

  const title = campaign?.title ?? "Campaign"

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/admin/campaigns"
          className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to campaigns
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-balance">{title}</h2>
          <p className="text-muted-foreground">Live Balloon Pop control board</p>
        </div>
      </div>

      <LiveBoardPanel campaignId={id} />
    </div>
  )
}
