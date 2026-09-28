import { Badge } from "@/components/ui/badge"
import { inboxStatusMeta, type InboxStatusTone } from "@/lib/admin/inbox/format"
import type { InboxStatus } from "@/lib/admin/inbox/types"

/**
 * Status colour is always paired with a text label, so status is never conveyed
 * by colour alone (accessibility). Open = attention (amber), Waiting = in
 * progress (sky), Resolved = done (emerald/muted).
 */
const TONE_CLASS: Record<InboxStatusTone, string> = {
  open: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  waiting: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
}

export function InboxStatusBadge({ status }: { status: InboxStatus }) {
  const { label, tone } = inboxStatusMeta(status)
  return (
    <Badge variant="outline" className={`uppercase tracking-wide ${TONE_CLASS[tone]}`}>
      {label}
    </Badge>
  )
}
