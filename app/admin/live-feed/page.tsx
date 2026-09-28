import { requireAdmin } from "@/lib/admin/auth"
import { LiveCampaignPicker } from "@/components/admin/live-feed/LiveCampaignPicker"
import { HostLiveFeed } from "@/components/admin/live-feed/HostLiveFeed"
import { getHostLiveFeed } from "@/lib/admin/host-live-feed"
import { getHostLiveSummary } from "@/lib/admin/host-live-summary"
import { HostDataError } from "@/components/admin/host/HostDataError"

// Always render fresh: the host stream is polled and the picker reflects live
// campaign state.
export const dynamic = "force-dynamic"

export default async function LiveFeedPage() {
  // Super Admins, Operations Admins, and Hosts (ops) can reach the Live Feed.
  const { role } = await requireAdmin({ roles: ["admin", "operations_admin", "ops"] })

  // HOSTS (ops): open DIRECTLY into the redesigned winner stream — no campaign
  // picker, no "Open Live Control", no board. Scoped server-side to the host's
  // assigned campaigns.
  if (role === "ops") {
    // Feed + summary fetched in parallel so the metrics strip renders seeded
    // (no loading flash) for the initial "All my comps" view.
    const [result, summaryResult] = await Promise.all([getHostLiveFeed(), getHostLiveSummary()])

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Live Feed</h1>
          <p className="text-sm text-muted-foreground">
            Instant-win prizes as your players win them, live.
          </p>
        </header>

        {result.ok ? (
          <HostLiveFeed
            initial={result.data}
            initialSummary={summaryResult.ok ? summaryResult.data : null}
          />
        ) : (
          <HostDataError
            reason={result.error}
            title="We couldn't load your live feed"
            retryHref="/admin/live-feed"
          />
        )}
      </div>
    )
  }

  // ADMIN / OPERATIONS_ADMIN: unchanged campaign-picker → live control flow.
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Feed</h1>
          <p className="text-muted-foreground">
            Choose the campaign you&apos;re hosting to open its live control screen
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/0/09/TikTok_logo.svg"
          alt="TikTok"
          className="h-7 w-auto opacity-90"
        />
      </div>

      <LiveCampaignPicker />
    </div>
  )
}
