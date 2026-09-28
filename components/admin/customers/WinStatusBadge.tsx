import { Badge } from "@/components/ui/badge"
import { resolveWinStatus, type WinStatusTone } from "./format"

/** Tailwind classes per operational tone. Paid/Credited/Fulfilled read as
 *  positive; Awaiting payout is a warning; Pending is neutral-muted; Draw is a
 *  distinct informational accent. */
const TONE_CLASS: Record<WinStatusTone, string> = {
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  credited: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  fulfilled: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  awaiting: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending: "border-border bg-muted text-muted-foreground",
  draw: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  neutral: "border-border bg-muted text-muted-foreground",
}

/**
 * Renders the correct operational status for a win using the shared
 * `resolveWinStatus` rules (§30). Never derives status from `is_paid` alone.
 */
export function WinStatusBadge({
  win,
}: {
  win: { win_kind?: string | null; fulfilment_type?: string | null; is_paid?: boolean; fulfilled_at?: string | null }
}) {
  const { label, tone } = resolveWinStatus(win)
  return (
    <Badge variant="outline" className={`uppercase tracking-wide ${TONE_CLASS[tone]}`}>
      {label}
    </Badge>
  )
}
