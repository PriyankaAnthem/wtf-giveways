import { SectionHeader } from "@/components/section-header"
import { GiveawayCard } from "@/components/giveaway-card"
import { createPublicClient } from "@/lib/supabase/public"
import type { GiveawayPublic } from "@/lib/types"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Past Draws | WTF Giveaways",
  description: "Browse recently ended giveaways and see the results.",
}

export default async function PastDrawsPage() {
  let giveaways: GiveawayPublic[] = []

  try {
    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from("giveaway_snapshots")
      .select("payload")
      .eq("kind", "list")
      .order("generated_at", { ascending: false })

    if (!error && data && data.length > 0) {
      giveaways = data
        .map((row) => {
          const p = row.payload as Record<string, any>
          return {
            slug: p.slug || "unknown",
            title: p.title || "Untitled",
            prizeTitle: p.prize_title || p.title || "Prize",
            imageUrl: p.hero_image_url || "/placeholder.svg",
            ticketPrice: (p.base_ticket_price_pence ?? 0) / 100,
            endsAt: new Date(p.ends_at),
            status: p.status,
            prizeValue: p.prize_value_text || undefined,
            bundles: p.bundles || undefined,
            rulesText: "See full terms and conditions for complete rules.",
            ticketsSold: Number(p.tickets_sold ?? 0),
            nextTicket: Number(p.next_ticket ?? 1),
          }
        })
        .filter((g) => g.endsAt.getTime() <= Date.now())
    }
  } catch (err) {
    console.error("[pastdraws] Failed to fetch snapshots:", err)
  }

  return (
    <div className="container px-4 py-8">
      <SectionHeader
        title="Past Draws"
        subtitle="Recently ended giveaways"
      />

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {giveaways.length > 0 ? (
          giveaways.map((giveaway) => (
            <GiveawayCard
              key={giveaway.slug}
              giveaway={giveaway}
              mode="past"
            />
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No past draws yet.
          </div>
        )}
      </div>
    </div>
  )
}
