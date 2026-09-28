"use client"

import { useEffect, useRef, useState } from "react"
import { Crown, Sparkles } from "lucide-react"
import { HERO_LIVE_POP_EVENT } from "./HeroLiveShell"

/**
 * LIVE-state stat tiles + genuine "just popped" chip for the Homepage Hero.
 *
 * Shows ONLY real balloon live-board data: prizes (balloons) remaining, VIP
 * prizes remaining, and — when the board actually supplies one — the most
 * recent public-safe event label with its real timestamp. Seeded with the
 * server-read values so it is correct on first paint, then lightly polls the
 * SAME public, CDN-cached endpoint the live board uses
 * (`/api/giveaways/[campaignId]/live-board`).
 *
 * Motion is tied to reality: a stat only flashes when a genuine value actually
 * changes between poll responses; the pop chip only animates in when the real
 * `lastEventLabel`/`lastEventAt` changes. Pauses while the tab is hidden,
 * ignores stale responses, and never throws. No viewer counts, no fabricated
 * activity, no invented timestamps.
 */

const POLL_MS = 30_000
const CLOCK_MS = 15_000

function relativeTime(iso: string | null, now: number): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const secs = Math.max(0, Math.floor((now - then) / 1000))
  if (secs < 10) return "just now"
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function HeroLiveStats({
  campaignId,
  initialTotalLeft,
  initialVipLeft,
  initialLastEventLabel = null,
  initialLastEventAt = null,
}: {
  campaignId: string
  initialTotalLeft: number
  initialVipLeft: number
  initialLastEventLabel?: string | null
  initialLastEventAt?: string | null
}) {
  const [totalLeft, setTotalLeft] = useState(initialTotalLeft)
  const [vipLeft, setVipLeft] = useState(initialVipLeft)
  const [eventLabel, setEventLabel] = useState<string | null>(initialLastEventLabel)
  const [eventAt, setEventAt] = useState<string | null>(initialLastEventAt)
  const [now, setNow] = useState(() => Date.now())

  // Bumped only when a GENUINE value changes, to re-trigger the CSS flash.
  const [totalPulse, setTotalPulse] = useState(0)
  const [vipPulse, setVipPulse] = useState(0)
  const [eventPulse, setEventPulse] = useState(0)

  const requestSeq = useRef(0)
  // Last-known genuine values, used for reliable change detection between polls
  // (drives both the per-tile flash and the shell's reaction glow).
  const lastTotalRef = useRef(initialTotalLeft)
  const lastVipRef = useRef(initialVipLeft)
  const lastEventKeyRef = useRef(
    initialLastEventLabel ? `${initialLastEventLabel}|${initialLastEventAt ?? ""}` : "",
  )

  useEffect(() => {
    let stopped = false
    let inFlight = false
    let intervalId: ReturnType<typeof setInterval> | null = null
    let clockId: ReturnType<typeof setInterval> | null = null
    let controller: AbortController | null = null

    const fetchTotals = async () => {
      if (typeof document !== "undefined" && document.hidden) return
      if (inFlight) return
      inFlight = true
      controller?.abort()
      const ctrl = new AbortController()
      controller = ctrl
      const seq = ++requestSeq.current

      try {
        const res = await fetch(`/api/giveaways/${campaignId}/live-board`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        if (stopped || seq !== requestSeq.current) return
        if (data?.ok && data.enabled === true && data.totals) {
          const nextTotal = Number(data.totals.totalRemaining ?? 0)
          const nextVip = Number(data.totals.vipRemaining ?? 0)
          const nextLabel =
            typeof data.lastEventLabel === "string" && data.lastEventLabel.trim()
              ? data.lastEventLabel.trim()
              : null
          const nextAt =
            typeof data.lastEventAt === "string" && data.lastEventAt.trim()
              ? data.lastEventAt.trim()
              : null
          const nextEventKey = nextLabel ? `${nextLabel}|${nextAt ?? ""}` : ""

          // Detect genuine changes against last-known values (never fabricated).
          let genuineChange = false

          if (nextTotal !== lastTotalRef.current) {
            setTotalPulse((p) => p + 1)
            genuineChange = true
          }
          lastTotalRef.current = nextTotal
          setTotalLeft(nextTotal)

          if (nextVip !== lastVipRef.current) {
            setVipPulse((p) => p + 1)
            genuineChange = true
          }
          lastVipRef.current = nextVip
          setVipLeft(nextVip)

          if (nextLabel && nextEventKey !== lastEventKeyRef.current) {
            setEventPulse((p) => p + 1)
            setNow(Date.now())
            genuineChange = true
          }
          lastEventKeyRef.current = nextEventKey
          setEventLabel(nextLabel)
          setEventAt(nextAt)

          // LEVEL 2: fire the shell's stronger-glow reaction ONLY on a real
          // backend change. No timers, no synthetic events.
          if (genuineChange && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(HERO_LIVE_POP_EVENT))
          }
        }
      } catch {
        // keep last known values
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (!document.hidden) {
        setNow(Date.now())
        void fetchTotals()
      }
    }

    intervalId = setInterval(() => void fetchTotals(), POLL_MS)
    clockId = setInterval(() => setNow(Date.now()), CLOCK_MS)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      stopped = true
      if (intervalId) clearInterval(intervalId)
      if (clockId) clearInterval(clockId)
      controller?.abort()
      document.removeEventListener("visibilitychange", onVisibility)
    }
    // eventAt intentionally omitted: it is read via closure only to detect a
    // changed timestamp; re-subscribing on every poll would reset the timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId])

  const eventRel = relativeTime(eventAt, now)

  return (
    <div className="space-y-2.5">
      {/* Genuine most-recent board event (only when the board supplies one). */}
      {eventLabel ? (
        <div
          key={eventPulse}
          className="hero-event-in flex items-center gap-2 rounded-lg border border-pink-400/30 bg-gradient-to-r from-pink-950/70 to-black/40 px-3 py-2"
        >
          <span className="relative flex size-2 shrink-0" aria-hidden="true">
            <span className="hero-signal absolute inline-flex size-full rounded-full bg-pink-400" />
            <span className="relative inline-flex size-2 rounded-full bg-pink-400" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide text-white">
            <span className="text-pink-300">Just popped</span> · {eventLabel}
          </span>
          {eventRel ? (
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-white/50">
              {eventRel}
            </span>
          ) : null}
        </div>
      ) : (
        /* No genuine event yet — show a neutral, truthful LIVE status rather
           than any fabricated activity. */
        <div className="flex items-center gap-2 rounded-lg border border-pink-400/25 bg-gradient-to-r from-pink-950/60 to-black/40 px-3 py-2">
          <span className="relative flex size-2 shrink-0" aria-hidden="true">
            <span className="hero-signal absolute inline-flex size-full rounded-full bg-pink-400" />
            <span className="relative inline-flex size-2 rounded-full bg-pink-400" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide text-pink-200">
            Balloon Pop live now
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex items-center gap-2.5 rounded-xl border border-pink-400/25 bg-black/45 px-3 py-2.5">
          <Sparkles className="h-5 w-5 shrink-0 text-pink-300" aria-hidden="true" />
          <div className="min-w-0 leading-none">
            <div
              key={`t-${totalPulse}`}
              className={
                "wtf-display text-lg font-black tabular-nums text-white" +
                (totalPulse > 0 ? " hero-stat-pop" : "")
              }
            >
              {totalLeft}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/55">
              {totalLeft === 1 ? "Prize left" : "Prizes left"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/25 bg-black/45 px-3 py-2.5">
          <Crown className="h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
          <div className="min-w-0 leading-none">
            <div
              key={`v-${vipPulse}`}
              className={
                "wtf-display text-lg font-black tabular-nums text-white" +
                (vipPulse > 0 ? " hero-stat-pop" : "")
              }
            >
              {vipLeft}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/55">
              {vipLeft === 1 ? "VIP prize" : "VIP prizes"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
