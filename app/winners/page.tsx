import { unstable_cache } from "next/cache"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { WinnersPageClient } from "@/components/winners-page-client"
import { mockWinners } from "@/lib/mock-data"
import { createPublicClient } from "@/lib/supabase/public"
import type { WinnerSnapshot } from "@/lib/types"
import { BIG_WIN_PUBLIC_COLUMNS, mapBigWinRow, type BigWinDTO } from "@/lib/big-wins"
import {
  FEATURED_COUNT,
  GRID_PAGE_SIZE,
  PUBLIC_WINNER_COLUMNS,
  applyWinnersKeyset,
  encodeWinnersCursor,
  formatWinnerFirstName,
  isWinnerEligible,
  mapWinnerRow,
  winnersEligibilityOrFilter,
} from "@/lib/winners"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Exact count of PUBLIC-eligible winners, cached server-side for 60 seconds.
 *
 * Uses the SAME `winnersEligibilityOrFilter()` as the winners query, so the
 * "Verified wins" figure always matches the corrected public eligibility rule
 * (site-credit rows are excluded by that filter). `head: true` + `count: exact`
 * fetches only the count, not any rows.
 *
 * Wrapped in `unstable_cache` so at most one count query runs per 60s window
 * regardless of how many visitors load the page. IMPORTANT: `unstable_cache`
 * runs OUTSIDE the request scope, so it must NOT call the cookie-based server
 * client (`@/lib/supabase/server`, which awaits `cookies()`). This is a purely
 * public aggregate over an already-public view, so we build a cookie-free anon
 * client here instead. Returns null on any failure so the page never crashes.
 */
const getVerifiedWinsCount = unstable_cache(
  async (): Promise<number | null> => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) return null

      const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      })
      const { count, error } = await supabase
        .from("winners_feed")
        .select("*", { count: "exact", head: true })
        .or(winnersEligibilityOrFilter())
      if (error || typeof count !== "number") return null
      return count
    } catch {
      return null
    }
  },
  ["winners-verified-wins-count"],
  { revalidate: 60 },
)

export interface LiveGiveaway {
  slug: string
  title: string
  heroImageUrl: string | null
  ticketPricePence: number
  endsAt: string
}

export default async function WinnersPage() {
  let winners: WinnerSnapshot[] = []
  let hasMore = false
  let loadError = false
  let usingMock = false
  let liveGiveaway: LiveGiveaway | null = null
  let bigWins: BigWinDTO[] = []
  // slug → campaign artwork, derived from the giveaway snapshots we already
  // load below (NO extra query, NO per-winner N+1). Used only to give the feed
  // colourful thumbnails; winners without a match fall back to a branded tile.
  let campaignArt: Record<string, string> = {}

  // Cached exact count of eligible winners (server-side, 60s). Independent of
  // the bounded winners fetch below; never throws (returns null on failure).
  const verifiedWinsCount = await getVerifiedWinsCount()

  // Initial bounded fetch: featured winners + one grid page (+1 peek row).
  const initialLimit = FEATURED_COUNT + GRID_PAGE_SIZE

  try {
    // Cookie-FREE anon client. Both queries below read public data with no
    // per-user filtering, so they never needed the caller's session.
    //
    // Using the cookie-bound client here was the cause of the Supabase Auth 429s:
    // supabase-js resolves an access token via `auth.getSession()` on EVERY
    // `.from()` call, and when the stored token is expired that performs a
    // network refresh. Because a Server Component cannot write cookies, the
    // refreshed token was discarded (see the swallowed `setAll` in
    // lib/supabase/server.ts), so the very next pageview repeated the refresh
    // forever. These two queries run concurrently in one Promise.all with no
    // cross-instance dedup, so both refreshed the SAME refresh token —
    // producing repeated `refresh_token_already_used` / 429 responses from a
    // single request.
    //
    // This mirrors `getVerifiedWinsCount` above and /giveaways/[slug].
    const supabase = createPublicClient()

    const [winnersResult, snapshotsResult, bigWinsResult] = await Promise.all([
      applyWinnersKeyset(
        supabase
          .from("winners_feed")
          // Explicit public allow-list: never fetch `winning_ticket` / `user_id`,
          // so they cannot leak via the raw result envelope Next.js serialises.
          .select(PUBLIC_WINNER_COLUMNS)
          // Eligibility (shared, identical to /api/winners): every genuine
          // awarded prize EXCEPT site credit (fulfilment_type = 'wallet_credit').
          // Applied BEFORE order/limit/peek so featured, grid, hasMore and the
          // cursor all derive from the same eligible set.
          .or(winnersEligibilityOrFilter()),
        // Initial page has no cursor: deterministic order happened_at DESC, feed_id DESC.
        null,
      ).limit(initialLimit + 1),
      supabase
        .from("giveaway_snapshots")
        .select("payload")
        .eq("kind", "list")
        .order("generated_at", { ascending: false })
        .limit(10),
      // Curated Big Wins — only ACTIVE rows (RLS lets anon read those), in the
      // admin-defined display order. Separate from the automatic winners feed.
      supabase
        .from("big_wins")
        .select(BIG_WIN_PUBLIC_COLUMNS)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("won_on", { ascending: false })
        .limit(20),
    ])

    const { data, error } = winnersResult

    if (error) {
      loadError = true
    } else if (data && data.length > 0) {
      hasMore = data.length > initialLimit
      const rows = hasMore ? data.slice(0, initialLimit) : data
      winners = rows.map(mapWinnerRow)
    }

    if (winners.length === 0 && !loadError) {
      // Never bypass the privacy rule via the mock fallback. Map into a new
      // array (do not mutate the imported mock data) with first names only, and
      // apply the SAME eligibility rule (£20+ OR approved balloon slug) so the
      // fallback can never surface an ineligible winner.
      winners = mockWinners
        .filter(isWinnerEligible)
        .map((w) => ({ ...w, name: formatWinnerFirstName(w.name) }))
      usingMock = true
      hasMore = false
    }

    if (!bigWinsResult.error && Array.isArray(bigWinsResult.data)) {
      bigWins = bigWinsResult.data.map(mapBigWinRow)
    }

    if (!snapshotsResult.error && snapshotsResult.data) {
      // Build the slug → artwork map from every snapshot row we already have.
      for (const row of snapshotsResult.data as any[]) {
        const p = row?.payload
        const slug = typeof p?.slug === "string" ? p.slug.trim() : ""
        const img = typeof p?.hero_image_url === "string" ? p.hero_image_url.trim() : ""
        if (slug && img && !campaignArt[slug]) campaignArt[slug] = img
      }

      const liveRow = snapshotsResult.data.find((row: any) => row.payload?.status === "live")
      if (liveRow?.payload) {
        const p = liveRow.payload
        liveGiveaway = {
          slug: p.slug || "",
          title: p.title || p.prize_title || "Live Raffle",
          heroImageUrl: p.hero_image_url || null,
          ticketPricePence: p.base_ticket_price_pence || 0,
          endsAt: p.ends_at || "",
        }
      }
    }
  } catch (err) {
    console.error("[winners] Failed to fetch winners_feed:", err)
    loadError = true
  }

  // Deterministic cursor from the last eligible row: carries BOTH happened_at
  // and the stable feed_id so "Load more" resumes exactly across shared timestamps.
  const initialCursor = winners.length > 0 ? encodeWinnersCursor(winners[winners.length - 1]) : null

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a002b] via-[#2d0050] to-[#0a0014]">
      <div className="container px-4 py-6 pb-24 md:py-10">
        <WinnersPageClient
          initialWinners={winners}
          initialCursor={usingMock ? null : initialCursor}
          initialHasMore={hasMore}
          loadError={loadError}
          liveGiveaway={liveGiveaway}
          verifiedWinsCount={verifiedWinsCount}
          bigWins={bigWins}
          campaignArt={campaignArt}
        />
      </div>
    </div>
  )
}
