import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/admin/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LiveBoardPanel } from "@/components/admin/campaigns/live-board/LiveBoardPanel"
import { CampaignActivityFeed } from "@/components/admin/live-feed/CampaignActivityFeed"

export default async function CampaignLiveControlPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Super Admins, Operations Admins, and Hosts (ops) can operate a campaign's live control screen.
  await requireAdmin({ roles: ["admin", "operations_admin", "ops"] })

  const { id } = await params

  // Lightweight summary lookup; the feed + board fetch their own state client-side.
  const supabase = await createClient()
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("title, slug, status")
    .eq("id", id)
    .maybeSingle()

  const title = campaign?.title ?? "Campaign"
  const slug = campaign?.slug ?? ""
  const status = campaign?.status ?? ""

  return (
    // data-hide-public-chrome: hides the public footer + mobile bottom nav for
    // this admin live-control screen only (see globals.css). UI-only marker.
    <div className="space-y-6" data-hide-public-chrome>
      <div className="space-y-3">
        <Link
          href="/admin/live-feed"
          className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to live campaigns
        </Link>

        {/* Prominent campaign identity so a host never updates the wrong campaign. */}
        <div className="rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
            {status && (
              <Badge variant="secondary" className="uppercase">
                {status}
              </Badge>
            )}
          </div>
          {slug && <p className="mt-1 font-mono text-sm text-muted-foreground">/{slug}</p>}
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;re controlling this campaign. Double-check the name before making changes.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,360px)]">
        {/* Live Balloon Pop controls (handles its own no-board state).
            order-1 keeps the controls (with the sticky totals/actions) directly
            under the campaign header on mobile, before the recent-wins feed. */}
        <div className="order-1">
          <LiveBoardPanel campaignId={id} />
        </div>

        {/* Campaign-scoped instant win feed. */}
        <div className="order-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent instant wins</CardTitle>
              <CardDescription>This campaign only, refreshing every 10s</CardDescription>
            </CardHeader>
            <CardContent>
              <CampaignActivityFeed campaignId={id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
