import { cn } from "@/lib/utils"

/**
 * Shared public sold-percentage bar. Consolidates the two previously
 * duplicated inline bars in PublicGiveawayCard.
 *
 * TRUE progress only: the fill width uses the floored display percentage
 * (e.g. 1%), never an inflated minimum. Server-compatible (no hooks).
 *
 * Variants:
 *  - "compact": homepage rail card (per-room accent fill/text).
 *  - "card":    /giveaways catalogue card (fixed amber→fuchsia).
 */
export function SoldProgress({
  variant,
  displayPercent,
  fillClassName,
  textClassName,
  className,
}: {
  variant: "compact" | "card"
  /** Floored 0..100 percentage, or null when there is no valid capacity. */
  displayPercent: number | null
  /** Accent fill classes (compact only). */
  fillClassName?: string
  /** Accent label classes (compact only). */
  textClassName?: string
  className?: string
}) {
  if (displayPercent === null) return null

  if (variant === "compact") {
    return (
      <div className={cn("mt-2.5 rounded-xl bg-black/10", className)}>
        <div className={cn("mb-1.5 text-xs font-black uppercase tracking-wide", textClassName)}>
          {displayPercent}% sold
        </div>
        <div className="h-[7px] w-full overflow-hidden rounded-full bg-black/70 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/10">
          <div className={cn("h-full rounded-full", fillClassName)} style={{ width: `${displayPercent}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("mt-3", className)}>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-400">{displayPercent}% Sold</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500"
          style={{ width: `${displayPercent}%` }}
        />
      </div>
    </div>
  )
}
