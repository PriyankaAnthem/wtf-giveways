"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import type { WinnerSnapshot } from "@/lib/types"
import type { LiveGiveaway } from "@/app/winners/page"
import type { BigWinDTO } from "@/lib/big-wins"
import { WinnersGrid } from "@/components/winners-grid"
import { WinnersHero } from "@/components/winners/winners-hero"
import { BigWinsCarousel } from "@/components/winners/big-wins-carousel"
import { winnerKey } from "@/lib/winners"
import { cn } from "@/lib/utils"
import { Loader2, Search, Ticket, Trophy } from "lucide-react"

interface WinnersPageClientProps {
  initialWinners: WinnerSnapshot[]
  initialCursor: string | null
  initialHasMore: boolean
  loadError: boolean
  liveGiveaway?: LiveGiveaway | null
  /** Exact count of eligible winners (server-cached). null when unavailable. */
  verifiedWinsCount?: number | null
  /** Curated, active Big Wins (manual admin module — NOT the automatic feed). */
  bigWins?: BigWinDTO[]
  /** slug → campaign artwork URL, built server-side from already-loaded data. */
  campaignArt?: Record<string, string>
}

type WinnerFilter = "all" | "draw" | "instant"

const FILTERS: { id: WinnerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draw", label: "Draw" },
  { id: "instant", label: "Instant" },
]

export function WinnersPageClient({
  initialWinners,
  initialCursor,
  initialHasMore,
  loadError,
  liveGiveaway,
  verifiedWinsCount,
  bigWins = [],
  campaignArt = {},
}: WinnersPageClientProps) {
  const router = useRouter()

  const [winners, setWinners] = useState<WinnerSnapshot[]>(initialWinners)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState(false)

  // Presentation-only controls. These filter the ALREADY-ELIGIBLE dataset that
  // is on the page; they never change eligibility or the server query.
  const [filter, setFilter] = useState<WinnerFilter>("all")
  const [search, setSearch] = useState("")

  // Stable de-duplication guard across pages, keyed by the stable winner id.
  const seenRef = useRef<Set<string>>(new Set(initialWinners.map(winnerKey)))

  const filteredWinners = useMemo(() => {
    const q = search.trim().toLowerCase()
    return winners.filter((w) => {
      if (filter === "draw" && w.kind !== "main") return false
      if (filter === "instant" && w.kind !== "instant") return false
      if (q && !(w.giveawayTitle ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [winners, filter, search])

  async function loadMore() {
    if (loading || !hasMore || !cursor) return
    setLoading(true)
    setPageError(false)
    try {
      const res = await fetch(`/api/winners?cursor=${encodeURIComponent(cursor)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setPageError(true)
        return
      }
      const incoming: WinnerSnapshot[] = Array.isArray(json.winners) ? json.winners : []
      const fresh = incoming.filter((w) => !seenRef.current.has(winnerKey(w)))
      fresh.forEach((w) => seenRef.current.add(winnerKey(w)))
      setWinners((prev) => [...prev, ...fresh])
      setCursor(typeof json.nextCursor === "string" ? json.nextCursor : null)
      setHasMore(Boolean(json.hasMore) && typeof json.nextCursor === "string")
    } catch {
      setPageError(true)
    } finally {
      setLoading(false)
    }
  }

  const liveHref = liveGiveaway?.slug ? `/giveaways/${liveGiveaway.slug}` : "/giveaways"
  const hasWinners = winners.length > 0
  const searchActive = search.trim().length > 0 || filter !== "all"

  return (
    <>
      {/* HERO */}
      <WinnersHero winnerCount={verifiedWinsCount} />

      {/* BIG WINS (curated) — renders nothing when there are no active items. */}
      <BigWinsCarousel items={bigWins} />

      {/* LATEST WINNERS */}
      <section aria-labelledby="latest-winners-heading" className="mt-8">
        <div className="mb-3">
          <h2 id="latest-winners-heading" className="text-lg font-black text-white md:text-xl">
            Latest winners
          </h2>
          <p className="mt-0.5 text-sm text-white/60">See every recent WTF winner.</p>
        </div>

        {hasWinners && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Filter pills */}
            <div className="flex items-center gap-2" role="group" aria-label="Filter winners by type">
              {FILTERS.map((f) => {
                const active = filter === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={active}
                    className={cn(
                      "min-h-[36px] rounded-full border px-4 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)]/60 motion-reduce:transition-none",
                      active
                        ? "border-[color:var(--gold)]/50 bg-[color:var(--gold)]/15 text-[#FCD253]"
                        : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10",
                    )}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>

            {/* Search competition */}
            <div className="relative sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search competition"
                aria-label="Search competition"
                className="min-h-[40px] w-full rounded-full border border-white/15 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus-visible:border-[color:var(--gold)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)]/40"
              />
            </div>
          </div>
        )}

        {!hasWinners ? (
          loadError || pageError ? (
            <ErrorState onRetry={() => router.refresh()} />
          ) : (
            <EmptyState liveHref={liveHref} />
          )
        ) : filteredWinners.length === 0 ? (
          <NoMatchesState onClear={() => { setFilter("all"); setSearch("") }} />
        ) : (
          <>
            <WinnersGrid winners={filteredWinners} campaignArt={campaignArt} />

            {/* LOAD MORE — disabled while a filter/search hides the full set is
                still allowed; pagination fetches the next eligible page. */}
            <div className="mt-6 flex flex-col items-center gap-3">
              {pageError && (
                <p className="text-sm text-red-300" role="alert">
                  Unable to load more winners. Please try again.
                </p>
              )}
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  aria-busy={loading}
                  className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--gold)]/40 bg-[color:var(--gold)]/10 px-6 text-sm font-bold uppercase tracking-wide text-[#FCD253] transition-colors duration-200 hover:bg-[color:var(--gold)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0018] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-10 motion-reduce:transition-none"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      Loading winners…
                    </>
                  ) : (
                    "Load more winners"
                  )}
                </button>
              ) : (
                <p className="text-sm text-white/45">
                  {searchActive ? "That's every match so far" : "You're all caught up"}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* TRUST / WINNER EXPLANATION */}
      <section
        aria-labelledby="winners-trust-heading"
        className="mt-8 rounded-2xl border border-white/10 bg-[#1a0a2e]/80 p-6 text-center md:p-8"
      >
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--gold)]/15">
          <Trophy className="h-5 w-5 text-[#FCD253]" aria-hidden="true" />
        </div>
        <h2 id="winners-trust-heading" className="text-lg font-black uppercase tracking-wide text-white md:text-xl">
          Real people. Real wins.
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-relaxed text-white/65">
          Every winner shown here comes directly from completed WTF competition and instant-win records. From £10
          instant wins to our biggest cash prizes, these are genuine WTF players winning real prizes.
        </p>
        <Link
          href="/faq"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#FCD253] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)]/60"
        >
          How winners are chosen
        </Link>
      </section>
    </>
  )
}

function EmptyState({ liveHref }: { liveHref: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#1a0a2e]/70 p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--gold)]/15">
        <Trophy className="h-7 w-7 text-[#FCD253]" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-white">Real winners are being added regularly.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
        Check back soon or browse the latest giveaways.
      </p>
      <Link
        href={liveHref}
        className="mt-5 inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 px-6 text-sm font-bold text-black transition-colors duration-200 hover:from-yellow-400 hover:to-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a0a2e] motion-reduce:transition-none"
      >
        <Ticket className="h-4 w-4" aria-hidden="true" />
        Browse giveaways
      </Link>
    </section>
  )
}

function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#1a0a2e]/60 p-10 text-center">
      <h2 className="text-lg font-bold text-white">No winners match that filter.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
        Try a different competition or clear the filters to see every win.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)]/60 motion-reduce:transition-none"
      >
        Clear filters
      </button>
    </section>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="rounded-2xl border border-red-500/20 bg-[#1a0a2e]/70 p-10 text-center" role="alert">
      <h2 className="text-xl font-bold text-white">Winners couldn&apos;t be loaded right now.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/60">Please try again in a moment.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a0a2e] motion-reduce:transition-none"
      >
        Try again
      </button>
    </section>
  )
}
