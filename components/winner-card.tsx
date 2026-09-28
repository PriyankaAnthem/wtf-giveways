import Image from "next/image"
import { Gift } from "lucide-react"
import type { WinnerSnapshot } from "@/lib/types"
import { cn } from "@/lib/utils"
import { formatPrizeAmount } from "@/lib/winners"

interface WinnerCardProps {
  winner: WinnerSnapshot
  /**
   * Optional campaign artwork URL, resolved by the parent from data already on
   * the page (giveaway snapshots) — never via a per-card fetch. When absent, a
   * clean branded fallback tile is shown (never an initials circle).
   */
  artworkUrl?: string | null
}

/* -------------------------------------------------------------------------- */
/* Display-only prize helpers.                                                 */
/*                                                                             */
/* PURE and VISUAL-ONLY. Never filters, excludes, reorders, or invents a prize */
/* value. Uses only fields already on the supplied WinnerSnapshot (`kind` and  */
/* `prizeTitle`). Eligibility is decided entirely server-side.                 */
/* -------------------------------------------------------------------------- */

/** The prize headline — the strongest element on the card. */
function prizeHeadline(winner: WinnerSnapshot): string {
  const realTitle = (winner.prizeTitle ?? "").trim()
  if (winner.kind === "main") return realTitle || "Main draw prize"
  // Preserve a real cash value when present; otherwise the actual title.
  return realTitle || formatPrizeAmount(winner) || "Prize win"
}

/** Right-aligned badge: DRAW winners vs INSTANT wins. */
function badgeFor(winner: WinnerSnapshot): { label: string; className: string } {
  if (winner.kind === "main") {
    return {
      label: "Draw winner",
      className: "border-[#FCD253]/45 bg-[#FCD253]/12 text-[#FCD253]",
    }
  }
  return {
    label: "Instant win",
    className: "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200",
  }
}

/**
 * Compact date: "Today", "Yesterday", "3 Sep", or "3 Sep 2024" for older years.
 */
function formatDate(dateString: string): string {
  const then = new Date(dateString)
  if (Number.isNaN(then.getTime())) return "Recently"

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  const dayMs = 86400000

  if (thenDay === startOfToday) return "Today"
  if (thenDay === startOfToday - dayMs) return "Yesterday"

  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

const WINNER_FALLBACK = "WTF winner"
const CAMPAIGN_FALLBACK = "WTF Giveaways"

export function WinnerCard({ winner, artworkUrl }: WinnerCardProps) {
  const headline = prizeHeadline(winner)
  const badge = badgeFor(winner)
  const name = winner.name?.trim() ? winner.name.trim() : WINNER_FALLBACK
  const campaign = winner.giveawayTitle?.trim() ? winner.giveawayTitle.trim() : CAMPAIGN_FALLBACK
  const date = formatDate(winner.announcedAt)
  const art = artworkUrl?.trim() ? artworkUrl.trim() : null

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-[#26113f] to-[#160826] p-2.5 transition-colors duration-200 focus-within:ring-2 focus-within:ring-[#FCD253]/50 hover:border-white/20 md:p-3 motion-reduce:transition-none">
      {/* Campaign thumbnail (left) — artwork when available, else a branded tile. */}
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl md:h-16 md:w-16">
        {art ? (
          <Image
            src={art}
            alt=""
            fill
            sizes="64px"
            className="object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#3a1560] to-[#1f0b38]"
            aria-hidden="true"
          >
            <Gift className="h-6 w-6 text-[#FCD253]/70" />
          </div>
        )}
      </div>

      {/* Text column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {/* Prize — strongest element */}
          <p className="truncate text-[17px] font-black leading-tight text-[#FCD253] tabular-nums md:text-lg">
            {headline}
          </p>
          {/* Badge — right aligned */}
          <span
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider md:text-[10px]",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </div>

        {/* Winner name */}
        <p className="mt-0.5 truncate text-sm font-bold text-white">{name}</p>

        {/* Campaign + date — tertiary */}
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/45">
          <span className="truncate">{campaign}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{date}</span>
        </div>
      </div>
    </article>
  )
}
