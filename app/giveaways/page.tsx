import Link from "next/link"
import { createPublicClient } from "@/lib/supabase/public"
import { GiveawaySection } from "@/components/giveaway-section"
import { PublicGiveawayCard } from "@/components/public-giveaway-card"
import { groupGiveawaysByCategory } from "@/lib/giveaway-classification"

type View = "all" | "live" | "instant"

// Compact, keyboard-accessible category navigation. Plain links using query
// params — never a client-side tab system. Horizontally scrollable on narrow
// mobile without overflowing the page.
function CategoryNav({ view }: { view: View }) {
  const items: { label: string; href: string; key: View }[] = [
    { label: "All Giveaways", href: "/giveaways", key: "all" },
    { label: "TikTok Live", href: "/giveaways?category=live", key: "live" },
    { label: "Instant Cash", href: "/giveaways?category=instant", key: "instant" },
  ]

  return (
    <nav aria-label="Giveaway categories" className="mt-5 -mx-4 px-4">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const active = item.key === view
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0014] " +
                  (active
                    ? "bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-black"
                    : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white")
                }
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const GRID_CLASS = "mt-8 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-2 md:gap-5 lg:grid-cols-3"

export default async function GiveawaysPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const rawCategory = Array.isArray(sp?.category) ? sp.category[0] : sp?.category
  // Unknown values fall back safely to the all-category view.
  const view: View = rawCategory === "live" ? "live" : rawCategory === "instant" ? "instant" : "all"

  // Cookie-FREE anon client: public snapshot list, no per-user filtering.
  // Matches /giveaways/[slug], which already reads this same table anonymously.
  // Avoids the per-pageview Supabase Auth token refresh that the cookie-bound
  // client triggers (and cannot persist) inside a Server Component.
  const supabase = createPublicClient()

  const { data } = await supabase
    .from("giveaway_snapshots")
    .select("payload")
    .eq("kind", "list")
    .order("generated_at", { ascending: false })
    .limit(20)

  const now = Date.now()
  const giveaways = (data ?? [])
    .map((x: any) => x.payload)
    .filter((g: any) => {
      if (!g || g.status === "ended" || g.status === "sold_out" || g.status === "closed") return false
      if (g.status !== "live") return false
      if (g.ends_at) {
        const endsAt = new Date(g.ends_at).getTime()
        if (Number.isFinite(endsAt) && endsAt <= now) return false
      }
      return true
    })

  // Classify + sort once, server-side, from the already-fetched array.
  const grouped = groupGiveawaysByCategory(giveaways)

  const headings: Record<View, { title: string; copy: string }> = {
    all: { title: "All Giveaways", copy: "Big prizes. Small ticket prices. Pick your winner." },
    live: { title: "TikTok Live Balloon Pops", copy: "Enter now, then watch the balloons pop live with your host." },
    instant: { title: "Instant Cash Wins", copy: "Play any time and reveal instant cash prizes automatically." },
  }

  const filtered = view === "live" ? grouped.live_balloon : view === "instant" ? grouped.instant_cash : []

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a002b] via-[#2d0050] to-[#0a0014]">
      <div className="container px-4 py-8">
        <header>
          <h1 className="text-balance text-2xl font-bold tracking-tight text-white md:text-3xl">
            {headings[view].title}
          </h1>
          <p className="mt-1 text-pretty text-sm text-white/70 md:text-base">{headings[view].copy}</p>
        </header>

        <CategoryNav view={view} />

        {view === "all" ? (
          <div className="mt-8">
            <GiveawaySection
              id="all-live-heading"
              title="TikTok Live Balloon Pops"
              supportingCopy="Enter now, then watch the balloons pop live with your host."
              giveaways={grouped.live_balloon}
              category="live_balloon"
              viewAllHref="/giveaways?category=live"
              viewAllLabel="View all Live"
            />
            <GiveawaySection
              id="all-instant-heading"
              title="Instant Cash Wins"
              supportingCopy="Play any time and reveal instant cash prizes automatically."
              giveaways={grouped.instant_cash}
              category="instant_cash"
              viewAllHref="/giveaways?category=instant"
              viewAllLabel="View all Instant Cash"
            />
            <GiveawaySection
              id="all-other-heading"
              title="More Giveaways"
              supportingCopy="More ways to play and win."
              giveaways={grouped.other}
              category="other"
            />
            {grouped.live_balloon.length + grouped.instant_cash.length + grouped.other.length === 0 && (
              <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/60">
                No live giveaways right now. Check back soon.
              </p>
            )}
          </div>
        ) : filtered.length > 0 ? (
          <div className={GRID_CLASS}>
            {filtered.map((giveaway: any) => (
              <PublicGiveawayCard
                key={giveaway.slug}
                giveaway={giveaway}
                category={view === "live" ? "live_balloon" : "instant_cash"}
              />
            ))}
          </div>
        ) : (
          <p className="mt-8 rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/60">
            No {view === "live" ? "TikTok Live Balloon Pops" : "Instant Cash Wins"} available right now.{" "}
            <Link href="/giveaways" className="font-semibold text-amber-300 underline hover:text-amber-200">
              View all giveaways
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
