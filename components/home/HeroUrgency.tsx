"use client"

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { heroUrgency, type HeroUrgency as HeroUrgencyData } from "@/lib/countdown"

/**
 * Compact, sales-first urgency line for the Featured hero — replaces the heavy
 * four-box DAYS/HRS/MINS/SECS overlay. Wording comes from `heroUrgency`
 * (Europe/London aware) and is deliberately minimal about ticking:
 *   - multi-day states recompute only at the next London midnight,
 *   - today/tomorrow refresh coarsely so they can step into the final hour,
 *   - only the final hour steps down each minute,
 *   - the timer stops entirely once ended.
 *
 * It can NEVER show an all-zero countdown: once the deadline passes the row
 * hides itself, which also covers a tab left open across the deadline.
 */
export function HeroUrgency({ endsAtMs }: { endsAtMs: number }) {
  const [state, setState] = useState<HeroUrgencyData>(() => heroUrgency(endsAtMs, Date.now()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const next = heroUrgency(endsAtMs, Date.now())
      setState(next)
      if (!next.ended && next.refreshMs != null) {
        timer = setTimeout(schedule, next.refreshMs)
      }
    }
    schedule()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [endsAtMs])

  if (state.ended) return null

  return (
    <p className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-amber-300">
      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span suppressHydrationWarning>{state.label}</span>
    </p>
  )
}
