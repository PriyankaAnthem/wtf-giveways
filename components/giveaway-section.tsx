import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { PublicGiveawayCard } from "@/components/public-giveaway-card"
import type { GiveawayCategory } from "@/lib/giveaway-classification"

/**
 * A single public category section: heading + supporting copy + optional
 * "View all" link + a two-column (mobile) / three-column (desktop) grid of
 * shared {@link PublicGiveawayCard}s.
 *
 * Renders NOTHING when there are no giveaways, so empty categories disappear
 * entirely (no empty-state card). Used by BOTH the homepage and /giveaways so
 * the card/grid trees are never duplicated.
 */
export function GiveawaySection({
  id,
  title,
  supportingCopy,
  giveaways,
  category,
  viewAllHref,
  viewAllLabel,
}: {
  id: string
  title: string
  supportingCopy: string
  giveaways: any[]
  category: GiveawayCategory
  viewAllHref?: string
  viewAllLabel?: string
}) {
  if (!giveaways || giveaways.length === 0) return null

  return (
    <section aria-labelledby={id} className="mb-12 md:mb-16">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-balance text-2xl font-bold tracking-tight text-white md:text-3xl">
            {title}
          </h2>
          <p className="mt-1 text-pretty text-sm text-white/70 md:text-base">{supportingCopy}</p>
        </div>

        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="mt-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-white/10 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 md:text-sm"
          >
            {viewAllLabel ?? "View all"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {giveaways.map((giveaway: any) => (
          <PublicGiveawayCard key={giveaway.slug} giveaway={giveaway} category={category} />
        ))}
      </div>
    </section>
  )
}
