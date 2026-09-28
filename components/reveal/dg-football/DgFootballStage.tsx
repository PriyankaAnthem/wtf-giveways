"use client"

/**
 * DgFootballStage — the pure presentational stage for DG'S BIG BALLERS.
 *
 * Layer order (back → front):
 *   1. Stadium environment (radial pitch glow + vignette), energy-tiered
 *   2. Brand header (logo lockup + ticket messaging + hero instruction) + help
 *   3. TargetBoard (the main game object — five identical mystery holes)
 *   4. DgCharacter (host, larger, left of / partly behind the board)
 *   5. FlightLayer (the flying ball + neon energy trail) — above the board
 *   6. Hole-entry front lip (occludes the ball as it sinks into the hole)
 *   7. BallTray (five cosmetic footballs) + "TAP A BALL"
 *   8. Suspense veil / interstitial / PrizeReveal / SummaryPanel
 *   9. Dev guide overlays (opt-in, invisible in normal play)
 *
 * The Stage owns ONE piece of imperative behaviour: the requestAnimationFrame
 * flight of the ball along a quadratic-bezier arc from the ACTIVE tray ball to
 * the measured centre of the predetermined hole, then a short sink into the
 * throat. Everything else is derived from the single `state` prop so board
 * lighting, DG's pose and the ball are always consistent. Measuring the active
 * tray ball (rather than a captured tap point) lets chained wins auto-launch a
 * different cosmetic ball with no extra interaction.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  BOARD_RECT,
  chancesLine,
  energyTierFor,
  INSTRUCTIONS,
  showsBigBaller,
  TAP_A_BALL,
  ticketsLoaded,
  TIMING,
} from "./config"
import type { DemoSettings, GameState, HoleId, RevealCopy } from "./types"
import { TargetBoard } from "./TargetBoard"
import { DgCharacter } from "./DgCharacter"
import { FlightLayer, type FlightHandle } from "./FlightLayer"
import { BallTray } from "./BallTray"
import { PrizeReveal, SummaryPanel } from "./PrizeReveal"
import type { PlanSummary } from "./config"

interface DgFootballStageProps {
  state: GameState
  settings: DemoSettings
  ticketCount: number
  /** Optional compact ticket-range label (e.g. "TICKETS #1201–#1325"), shown
   *  in the header for parity with other reveals. Null = omit. */
  ticketRangeText?: string | null
  /** The predetermined destination hole for the active animation. */
  destinationHole: HoleId | null
  /** Whether the active animation is a win. */
  isWin: boolean
  bigWin: boolean
  /** FAST WIN STREAK treatment (4th win onward). */
  fast: boolean
  /** Cosmetic tray ball the active animation launches (1..5). */
  activeBall: number | null
  /** Ball the customer tapped to start the session. */
  tappedBall: number | null
  /** 1-based index of the win currently animating, and total animated wins. */
  winSoFar: number
  totalAnimatedWins: number
  /** Interstitial copy for the "another win" beat ("" = none). */
  interstitialText: string
  /** Whether the upcoming shot needs a fresh tray of five (green reset). */
  trayReload: boolean
  revealCopy: RevealCopy | null
  revealVisible: boolean
  summary: PlanSummary
  summaryVisible: boolean
  onSelectBall: (n: number) => void
  onFinish: () => void
  onHelp: () => void
}

/* State groups (keep transitions readable). */
const FOCUS_STATES: GameState[] = [
  "approaching_hole",
  "entering_hole",
  "suspense",
  "win_reaction",
  "nonwin_reaction",
  "celebrating",
  "revealing",
  "revealed",
]
const ENTERED_STATES: GameState[] = [
  "entering_hole",
  "suspense",
  "win_reaction",
  "nonwin_reaction",
  "celebrating",
  "revealing",
  "revealed",
]
const FLIGHT_STATES: GameState[] = ["launching", "approaching_hole", "entering_hole"]
const CELEBRATION_STATES: GameState[] = ["win_reaction", "celebrating", "revealing", "revealed"]
const NONWIN_STATES: GameState[] = ["nonwin_reaction"]

const cubicOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function DgFootballStage({
  state,
  settings,
  ticketCount,
  ticketRangeText,
  destinationHole,
  isWin,
  bigWin,
  fast,
  activeBall,
  tappedBall,
  winSoFar,
  totalAnimatedWins,
  interstitialText,
  trayReload,
  revealCopy,
  revealVisible,
  summary,
  summaryVisible,
  onSelectBall,
  onFinish,
  onHelp,
}: DgFootballStageProps) {
  const reduced = settings.reducedMotion
  const speed = settings.speed
  const preview = settings.charPreview
  const tier = energyTierFor(ticketCount)

  const stageRef = useRef<HTMLDivElement>(null)
  const flightRef = useRef<FlightHandle>(null)
  const rafRef = useRef<number | null>(null)
  const flightTokenRef = useRef(0)

  const [entryMask, setEntryMask] = useState<{ x: number; y: number; size: number } | null>(null)
  const [debugGeom, setDebugGeom] = useState<{
    origin: { x: number; y: number }
    control: { x: number; y: number }
    endpoint: { x: number; y: number }
  } | null>(null)

  /* ---- measure a hole's centre + size in stage-local pixels ---- */
  const measureHole = useCallback((hole: HoleId) => {
    const stage = stageRef.current
    if (!stage) return null
    const holeEl = stage.querySelector<HTMLElement>(`[data-hole="${hole}"]`)
    const marker = stage.querySelector<HTMLElement>(`[data-hole="${hole}"] .dgf-hole-centre`)
    if (!holeEl || !marker) return null
    const s = stage.getBoundingClientRect()
    const m = marker.getBoundingClientRect()
    const h = holeEl.getBoundingClientRect()
    return { x: m.left + m.width / 2 - s.left, y: m.top + m.height / 2 - s.top, size: h.width }
  }, [])

  /* ---- measure the active tray ball's centre (flight origin) ---- */
  const measureBall = useCallback((n: number) => {
    const stage = stageRef.current
    if (!stage) return null
    const el = stage.querySelector<HTMLElement>(`[data-ball="${n}"]`)
    if (!el) return null
    const s = stage.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    return { x: b.left + b.width / 2 - s.left, y: b.top + b.height / 2 - s.top }
  }, [])

  /* ---- run the flight whenever we (re)enter "launching" ---- */
  useEffect(() => {
    if (state !== "launching") return
    if (activeBall == null || destinationHole == null) return
    const stage = stageRef.current
    const flight = flightRef.current
    if (!stage || !flight) return

    const token = ++flightTokenRef.current
    const origin = measureBall(activeBall)
    const target = measureHole(destinationHole)
    if (!origin || !target) return

    // Quadratic-bezier control point: arc up and lean toward the board.
    const dist = Math.hypot(target.x - origin.x, target.y - origin.y)
    const arcLift = Math.max(110, dist * 0.36)
    const control = {
      x: origin.x + (target.x - origin.x) * 0.5,
      y: Math.min(origin.y, target.y) - arcLift,
    }
    setDebugGeom({ origin, control, endpoint: target })
    setEntryMask({ x: target.x, y: target.y, size: target.size })

    const dir = target.x >= origin.x ? 1 : -1
    const arcMs = (reduced ? TIMING.reducedFlightMs : fast ? TIMING.fastFlightMs : TIMING.flightMs) * speed
    const dropMs = (fast ? TIMING.fastHoleEntryMs : TIMING.holeEntryMs) * speed
    const startAt = performance.now()

    flight.begin(origin.x, origin.y)

    const tick = (now: number) => {
      if (flightTokenRef.current !== token) return
      const elapsed = now - startAt

      if (elapsed <= arcMs) {
        // Phase A — arc toward the hole. Ball stays large + easy to follow.
        const t = cubicOut(Math.min(1, elapsed / arcMs))
        const mt = 1 - t
        const x = mt * mt * origin.x + 2 * mt * t * control.x + t * t * target.x
        const y = mt * mt * origin.y + 2 * mt * t * control.y + t * t * target.y
        const rot = reduced ? 0 : dir * t * 620
        const scale = 1 - 0.08 * t // only a slight perspective shrink
        flight.frame(x, y, rot, scale, 1)
        rafRef.current = requestAnimationFrame(tick)
      } else if (elapsed <= arcMs + dropMs) {
        // Phase B — sink into the throat: 1 → 0.72 → 0.35 → 0.1, drop + fade.
        const t = Math.min(1, (elapsed - arcMs) / dropMs)
        const scale = 0.92 * (1 - 0.9 * t)
        const opacity = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28
        flight.frame(target.x, target.y + t * 14, dir * (620 + t * 140), scale, opacity)
        rafRef.current = requestAnimationFrame(tick)
      } else {
        flight.end()
      }
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, activeBall, destinationHole])

  // Hide the ball whenever we are not mid-flight.
  useEffect(() => {
    if (!FLIGHT_STATES.includes(state)) flightRef.current?.end()
  }, [state])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  /* ---- derived board lighting from state ---- */
  const pulse = state === "launching" || state === "approaching_hole"
  const focusHole = FOCUS_STATES.includes(state) ? destinationHole : null
  const enteredHole = ENTERED_STATES.includes(state) ? destinationHole : null
  const suspense = state === "suspense"
  const resultTone: "win" | "nonwin" | null = CELEBRATION_STATES.includes(state)
    ? "win"
    : NONWIN_STATES.includes(state)
      ? "nonwin"
      : null
  const holeBurst = (state === "win_reaction" || state === "celebrating") && isWin
  const holePulseOut = state === "nonwin_reaction"

  /* ---- DG pose ---- */
  const livePose: "neutral" | "scored" = CELEBRATION_STATES.includes(state) && isWin ? "scored" : "neutral"
  const pose = preview === "off" ? livePose : preview === "scored" ? "scored" : "neutral"
  const winFlash = preview === "off" && (state === "win_reaction" || state === "celebrating") && isWin
  const dimCharacter = state === "nonwin_reaction" || (state === "summary" && summary.instantWins === 0)

  /* ---- brand + instruction + ticket header ---- */
  const celebrating = CELEBRATION_STATES.includes(state) && isWin
  const brandHidden = celebrating || summaryVisible || state === "checking_additional"
  const instruction = preview === "off" ? INSTRUCTIONS[state] : null
  const showFullTicketMsg = state === "intro" || state === "choosing"
  const bigBallerBeat = state === "intro" && showsBigBaller(ticketCount) && !reduced

  /* ---- ball tray control ---- */
  const trayLocked = state !== "choosing" || preview !== "off"
  const liftedBall =
    state === "selected"
      ? tappedBall
      : state === "auto_relaunch"
        ? activeBall
        : [...FLIGHT_STATES, "suspense", "win_reaction", "nonwin_reaction", "celebrating", "revealing", "revealed"].includes(
              state,
            )
          ? activeBall
          : null
  const hideLifted = [...FLIGHT_STATES, "suspense", "win_reaction", "nonwin_reaction", "celebrating", "revealing", "revealed"].includes(
    state,
  )

  const stageClasses = [
    "dgf-stage",
    `dgf-tier-${tier}`,
    settings.skipIntro ? "" : "dgf-run-entrance",
    state === "win_reaction" && isWin && !reduced ? "dgf-punch" : "",
    state === "win_reaction" && isWin && !reduced ? "dgf-shake" : "",
  ]
    .filter(Boolean)
    .join(" ")

  const boardStyle = {
    left: `${BOARD_RECT.leftPct * 100}%`,
    top: `${BOARD_RECT.topPct * 100}%`,
    width: `${BOARD_RECT.widthPct * 100}%`,
    height: `${BOARD_RECT.heightPct * 100}%`,
  } as const

  return (
    <div ref={stageRef} className={stageClasses}>
      {/* 1. Environment */}
      <div className="dgf-env" aria-hidden="true">
        <div className="dgf-env-pitch" />
        <div className="dgf-env-glow" />
        <div className="dgf-env-beams" />
        <div className="dgf-env-vignette" />
      </div>

      {/* 2. Brand header + ticket messaging + help */}
      <header className={`dgf-brand ${brandHidden ? "dgf-brand-hidden" : ""}`}>
        <button type="button" className="dgf-help-btn" onClick={onHelp} aria-label="How it works">
          ?
        </button>
        <div className="dgf-brand-lockup dgf-entrance-brand" aria-label="DG'S BIG BALLERS">
          <span className="dgf-brand-kicker">DG&apos;S</span>
          <span className="dgf-brand-title">BIG BALLERS</span>
        </div>

        {/* Ticket messaging — a real sales/reinforcement message, not fine print. */}
        <div className={`dgf-tickets dgf-entrance-tickets ${showFullTicketMsg ? "" : "dgf-tickets-compact"}`}>
          <span className="dgf-tickets-loaded">{ticketsLoaded(ticketCount)}</span>
          {showFullTicketMsg && <span className="dgf-tickets-chances">{chancesLine(ticketCount)}</span>}
          {showFullTicketMsg && ticketRangeText && (
            <span className="dgf-tickets-range">{ticketRangeText}</span>
          )}
        </div>

        {instruction && (
          <div className="dgf-instruction" aria-live="polite">
            <span className="dgf-instruction-text">
              {instruction.text} {instruction.key && <span className="dgf-instruction-key">{instruction.key}</span>}
            </span>
            {instruction.sub && <span className="dgf-instruction-sub">{instruction.sub}</span>}
          </div>
        )}
      </header>

      {/* Optional BIG BALLER MODE beat during the intro (100+ tickets). */}
      {bigBallerBeat && (
        <div className="dgf-bigballer" aria-hidden="true">
          <span>BIG BALLER MODE</span>
        </div>
      )}

      {/* 3 + 4. Board area (board + DG share this positioned box) */}
      <div className="dgf-board-area dgf-entrance-board" style={boardStyle}>
        <DgCharacter
          pose={pose}
          winFlash={winFlash}
          bigWin={bigWin}
          dim={dimCharacter}
          reducedMotion={reduced}
          speed={speed}
          showBounds={settings.showBoardBounds}
        />
        <TargetBoard
          pulse={pulse}
          suspense={suspense}
          focusHole={focusHole}
          enteredHole={enteredHole}
          resultTone={resultTone}
          holeBurst={holeBurst}
          holePulseOut={holePulseOut}
          bigWin={bigWin}
          reducedMotion={reduced}
          showHoleBounds={settings.showHoleBounds}
          showHoleCentres={settings.showHoleCentres}
          showBoardBounds={settings.showBoardBounds}
        />
      </div>

      {/* 5. Flight layer spans the whole stage so the ball can travel tray→board. */}
      <FlightLayer ref={flightRef} reducedMotion={reduced} />

      {/* 6. Hole-entry front lip — occludes the ball's lower half as it sinks. */}
      {entryMask && ENTERED_STATES.includes(state) && (
        <div
          className={`dgf-entry-mask ${state === "entering_hole" ? "dgf-entry-mask-active" : ""}`}
          style={{ left: entryMask.x, top: entryMask.y, width: entryMask.size, height: entryMask.size }}
          aria-hidden="true"
        >
          <span className="dgf-entry-throat" />
          <span className="dgf-entry-lip" />
        </div>
      )}

      {/* 7. Ball tray + call to action */}
      <div
        className={`dgf-tray-area dgf-entrance-tray ${
          trayReload && (state === "checking_additional" || state === "auto_relaunch") ? "dgf-tray-reloading" : ""
        }`}
      >
        <div
          className={`dgf-tap-cta ${state === "choosing" && preview === "off" ? "" : "dgf-tap-cta-hidden"}`}
          aria-hidden="true"
        >
          <span className="dgf-tap-chevrons">
            <span /> <span /> <span />
          </span>
          <span className="dgf-tap-label">{TAP_A_BALL}</span>
        </div>
        <BallTray
          liftedBall={liftedBall}
          hideLifted={hideLifted}
          locked={trayLocked}
          reducedMotion={reduced}
          speed={speed}
          onSelect={onSelectBall}
        />
      </div>

      {/* 8a. Suspense veil (theatrical, not "loading"). */}
      <div className={`dgf-suspense-veil ${suspense ? "dgf-suspense-veil-on" : ""}`} aria-hidden="true" />

      {/* 8b. "THERE'S ANOTHER WIN!" / streak / reload interstitial (only when
             there is copy to show — quick silent power-ups render nothing). */}
      {state === "checking_additional" && interstitialText !== "" && (
        <div className={`dgf-interstitial ${trayReload ? "dgf-interstitial-reload" : ""}`} role="status">
          <span className="dgf-interstitial-wait">{trayReload ? "NEW BALLS" : "WAIT..."}</span>
          <span className="dgf-interstitial-main">{interstitialText}</span>
        </div>
      )}

      {/* 8c. Reveal / summary */}
      {revealCopy && (
        <PrizeReveal
          copy={revealCopy}
          visible={revealVisible}
          reducedMotion={reduced}
          slowFactor={speed}
          winSoFar={winSoFar}
          totalWins={totalAnimatedWins}
          compact={fast}
        />
      )}
      <SummaryPanel
        summary={summary}
        visible={summaryVisible}
        reducedMotion={reduced}
        slowFactor={speed}
        onFinish={onFinish}
      />

      {/* 9. Dev guide overlays */}
      {settings.showState && (
        <div className="dgf-state-badge" aria-hidden="true">
          {state}
          {destinationHole != null && ` · hole ${destinationHole}`}
          {activeBall != null && ` · ball ${activeBall}`}
        </div>
      )}
      {debugGeom && (settings.showBallOrigin || settings.showControlPoints || settings.showEndpoint) && (
        <svg className="dgf-guide-svg" aria-hidden="true">
          {settings.showControlPoints && (
            <>
              <line
                className="dgf-guide-line"
                x1={debugGeom.origin.x}
                y1={debugGeom.origin.y}
                x2={debugGeom.control.x}
                y2={debugGeom.control.y}
              />
              <line
                className="dgf-guide-line"
                x1={debugGeom.control.x}
                y1={debugGeom.control.y}
                x2={debugGeom.endpoint.x}
                y2={debugGeom.endpoint.y}
              />
              <circle className="dgf-guide-ctrl" cx={debugGeom.control.x} cy={debugGeom.control.y} r={6} />
            </>
          )}
          {settings.showBallOrigin && (
            <circle className="dgf-guide-origin" cx={debugGeom.origin.x} cy={debugGeom.origin.y} r={6} />
          )}
          {settings.showEndpoint && (
            <circle className="dgf-guide-endpoint" cx={debugGeom.endpoint.x} cy={debugGeom.endpoint.y} r={6} />
          )}
        </svg>
      )}
    </div>
  )
}
