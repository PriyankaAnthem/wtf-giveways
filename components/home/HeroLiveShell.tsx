"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Client wrapper for the LIVE hero's outer shell.
 *
 * Provides the "LEVEL 2" reaction: when HeroLiveStats detects a GENUINE
 * live-board change (a real prize/VIP delta or a new real `lastEventLabel`), it
 * dispatches a `wtf:hero-live-pop` window event; this wrapper briefly plays a
 * stronger glow ring (~1.5s) then settles back to the always-on breathing
 * state. The reaction is therefore driven purely by real backend data — no
 * timers, no fabricated activity.
 *
 * Server-rendered children (artwork + commerce area) pass straight through, so
 * only the tiny reaction state lives on the client.
 */
export const HERO_LIVE_POP_EVENT = "wtf:hero-live-pop"

export function HeroLiveShell({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const [reacting, setReacting] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onPop = () => {
      setReacting(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      // Match the hero-react-ring keyframe duration; restart cleanly if another
      // genuine event lands before it finishes.
      timeoutRef.current = setTimeout(() => setReacting(false), 1500)
    }
    window.addEventListener(HERO_LIVE_POP_EVENT, onPop)
    return () => {
      window.removeEventListener(HERO_LIVE_POP_EVENT, onPop)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return (
    <div className={cn(className, reacting && "hero-react")}>
      {children}
      {/* Reaction-only overlay; inert until a genuine event fires. */}
      <span className="hero-react-ring pointer-events-none absolute inset-0 rounded-[24px]" aria-hidden="true" />
    </div>
  )
}
