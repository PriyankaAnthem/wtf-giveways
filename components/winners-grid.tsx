import type { WinnerSnapshot } from "@/lib/types"
import { WinnerCard } from "@/components/winner-card"
import { winnerKey } from "@/lib/winners"

interface WinnersGridProps {
  winners: WinnerSnapshot[]
  /**
   * slug → campaign artwork URL, built server-side from data already loaded on
   * the page (giveaway snapshots). Used to give each row a colourful thumbnail
   * without any per-card fetch. Missing slugs simply fall back to a tile.
   */
  campaignArt?: Record<string, string>
}

/**
 * Latest winners feed — compact horizontal rows.
 * - below md: single-column vertical feed (never two columns), so every row
 *   stays readable down to 320px wide
 * - md and up: a clean 2-column grid (per the winners brief — the feed is not
 *   stretched into 3+ columns on wide screens)
 */
export function WinnersGrid({ winners, campaignArt = {} }: WinnersGridProps) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3">
      {winners.map((winner, i) => (
        <WinnerCard
          key={`${winnerKey(winner)}-${i}`}
          winner={winner}
          artworkUrl={winner.giveawaySlug ? campaignArt[winner.giveawaySlug] ?? null : null}
        />
      ))}
    </div>
  )
}
