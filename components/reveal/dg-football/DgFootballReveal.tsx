"use client"

/**
 * DgFootballReveal — the orchestrator and single source of truth for GameState.
 *
 * INTERACTION MODEL (approved "tap-a-ball → auto shot → into a hole" mechanic):
 *  - The customer performs ONE interaction for the WHOLE purchase: TAP A BALL.
 *    The five tray footballs are COSMETIC — the tapped one never decides
 *    anything.
 *  - The purchase has a PREDETERMINED reveal plan (`plan.awards`). One tap
 *    reveals EVERY result: each winning result auto-chains with NO further
 *    interaction. There is NO cap — a 7-win purchase visibly reveals all 7.
 *    The first MAX_CINEMATIC_WINS play as full cinematic reveals; the rest use
 *    FAST WIN STREAK mode (shorter, but every prize is still clearly shown).
 *  - Each animated shot flies the ball into its predetermined hole; that hole
 *    becomes the source of the reaction (win burst / non-win pulse).
 *  - After five cosmetic balls are used the tray reloads (green energy reset)
 *    and holes are reused — neither ever caps the number of awards shown.
 *
 * The Stage is a pure renderer: it derives all board lighting, DG's pose and
 * the ball's flight from the single `state` prop + the active animation. This
 * orchestrator owns the timed walk through the state machine (every duration
 * comes from TIMING and is scaled by the dev `speed`).
 */

import { useCallback, useEffect, useMemo, useReducer } from "react"
import type { Animation, DemoSettings, GameState, HoleId, RevealPlan, SoundCue } from "./types"
import {
  buildAnimations,
  buildRevealPlan,
  isBigWin,
  MAX_CINEMATIC_WINS,
  revealCopyFor,
  summarisePlan,
  TIMING,
  TRAY_BALL_COUNT,
} from "./config"
import { DgFootballStage } from "./DgFootballStage"

interface RevealStateShape {
  state: GameState
  /** Cosmetic ball number tapped to start the session (1..5), else null. */
  tappedBall: number | null
  /** Which animation (win or the single non-win) we are currently playing. */
  animIndex: number
}

type Action =
  | { type: "INTRO_DONE" }
  | { type: "SELECT"; ball: number }
  | { type: "GOTO"; from: GameState; to: GameState }
  | { type: "RELAUNCH" }
  | { type: "CONTINUE_TO_SUMMARY"; from: GameState }

function makeInitial(skipIntro: boolean): RevealStateShape {
  return { state: skipIntro ? "choosing" : "intro", tappedBall: null, animIndex: 0 }
}

function reducer(s: RevealStateShape, a: Action): RevealStateShape {
  switch (a.type) {
    case "INTRO_DONE":
      return s.state === "intro" ? { ...s, state: "choosing" } : s
    case "SELECT":
      return s.state === "choosing" ? { ...s, state: "selected", tappedBall: a.ball } : s
    case "GOTO":
      return s.state === a.from ? { ...s, state: a.to } : s
    case "RELAUNCH":
      // Advance to the next animated win and fire it automatically.
      return s.state === "auto_relaunch"
        ? { ...s, state: "launching", animIndex: s.animIndex + 1 }
        : s
    case "CONTINUE_TO_SUMMARY":
      return s.state === a.from ? { ...s, state: "summary" } : s
    default:
      return s
  }
}

interface DgFootballRevealProps {
  settings: DemoSettings
  playSound: (cue: SoundCue) => void
  onFinish: () => void
  onHelp: () => void
  /**
   * PRODUCTION: a predetermined plan built from the real AwardPayload. When
   * provided it is the sole source of truth and the mock `resultPreset`/
   * `ticketCount` path is bypassed entirely. When omitted (the /dgfootballidea
   * prototype) the deterministic mock plan is built from `settings`.
   */
  plan?: RevealPlan
}

export function DgFootballReveal({ settings, playSound, onFinish, onHelp, plan: providedPlan }: DgFootballRevealProps) {
  const speed = settings.speed

  const [s, dispatch] = useReducer(reducer, undefined, () => makeInitial(settings.skipIntro))

  /* ---- predetermined plan + animation list ----------------------------- */
  const plan = useMemo(
    () => providedPlan ?? buildRevealPlan(settings.resultPreset, settings.ticketCount),
    [providedPlan, settings.resultPreset, settings.ticketCount],
  )
  const summary = useMemo(() => summarisePlan(plan), [plan])

  const animations: Animation[] = useMemo(() => {
    if (s.tappedBall == null) return []
    const list = buildAnimations(plan, s.tappedBall)
    // Dev: force the FIRST animation's hole for staging (outcome unchanged).
    if (settings.destination !== "auto" && list.length > 0) {
      list[0] = { ...list[0], destinationHole: settings.destination as HoleId }
    }
    return list
  }, [plan, s.tappedBall, settings.destination])

  const active = animations[s.animIndex] ?? null
  const isWin = active?.isWin ?? false
  const fast = active?.fast ?? false
  const bigWin = active ? isBigWin(active.outcome) : false
  const destinationHole: HoleId | null = active?.destinationHole ?? null
  const activeBall = active?.ballNumber ?? null
  const hasMoreAnimated = s.animIndex + 1 < animations.length

  /* ---- reconciliation assertion (dev only) ----------------------------- */
  // The animated win count, the summary win count and the mock award count MUST
  // all agree. If any award were silently dropped this would fire.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    if (animations.length === 0) return
    const animatedWins = animations.filter((a) => a.isWin).length
    if (animatedWins !== plan.awards.length || summary.instantWins !== plan.awards.length) {
      console.log(
        "[v0] DG reveal reconciliation MISMATCH:",
        `animatedWins=${animatedWins}`,
        `summaryWins=${summary.instantWins}`,
        `planAwards=${plan.awards.length}`,
      )
    }
  }, [animations, plan.awards.length, summary.instantWins])

  /* ---- fast-aware timings ---------------------------------------------- */
  const flightBaseMs = settings.reducedMotion
    ? TIMING.reducedFlightMs
    : fast
      ? TIMING.fastFlightMs
      : TIMING.flightMs
  const holeEntryMsBase = fast ? TIMING.fastHoleEntryMs : TIMING.holeEntryMs
  const suspenseMsBase = fast ? TIMING.fastSuspenseMs : bigWin ? TIMING.suspenseBigMs : TIMING.suspenseMs
  const winReactionMsBase = fast ? TIMING.fastWinReactionMs : TIMING.winReactionMs
  const panelRiseMsBase = fast ? TIMING.fastPanelRiseMs : TIMING.panelRiseMs
  const prizeHoldMsBase = fast ? TIMING.fastPrizeHoldMs : bigWin ? TIMING.prizeHoldBigMs : TIMING.prizeHoldMs

  /* ---- next-win presentation (interstitial + tray reload) -------------- */
  const nextIndex = s.animIndex + 1
  const nextIsFast = nextIndex >= MAX_CINEMATIC_WINS
  // A fresh set of five cosmetic balls is needed when the next ball wraps.
  const trayReload = hasMoreAnimated && nextIndex % TRAY_BALL_COUNT === 0
  // Show the interstitial for every CINEMATIC chain, but only intermittently in
  // fast mode so it never becomes annoying.
  let interstitialText = ""
  if (hasMoreAnimated) {
    if (!nextIsFast) {
      interstitialText = s.animIndex === 0 ? "THERE'S ANOTHER WIN!" : "ANOTHER ONE!"
    } else {
      const fastPos = nextIndex - MAX_CINEMATIC_WINS
      if (trayReload) interstitialText = "RELOADING..."
      else if (fastPos % 2 === 0) interstitialText = fastPos === 0 ? "YOU'RE STILL WINNING!" : "ANOTHER ONE!"
    }
  }
  const showInterstitial = interstitialText !== ""

  /* ---- timed walk through the state machine ---------------------------- */
  const go = useCallback((from: GameState, to: GameState) => dispatch({ type: "GOTO", from, to }), [])

  // intro → choosing
  useEffect(() => {
    if (s.state !== "intro") return
    const id = window.setTimeout(() => dispatch({ type: "INTRO_DONE" }), TIMING.introMs * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed])

  // selected → launching (short hold, then the shot fires itself)
  useEffect(() => {
    if (s.state !== "selected") return
    playSound("select")
    const id = window.setTimeout(() => go("selected", "launching"), TIMING.selectHoldMs * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, go, playSound])

  // launching → approaching_hole
  useEffect(() => {
    if (s.state !== "launching") return
    playSound("launch")
    const flightDur = flightBaseMs * speed
    const lead = Math.min(TIMING.anticipationLeadMs * speed, flightDur)
    const id = window.setTimeout(() => go("launching", "approaching_hole"), Math.max(0, flightDur - lead))
    return () => window.clearTimeout(id)
  }, [s.state, speed, flightBaseMs, go, playSound])

  // approaching_hole → entering_hole
  useEffect(() => {
    if (s.state !== "approaching_hole") return
    playSound("whoosh")
    const flightDur = flightBaseMs * speed
    const lead = Math.min(TIMING.anticipationLeadMs * speed, flightDur)
    const id = window.setTimeout(() => go("approaching_hole", "entering_hole"), lead)
    return () => window.clearTimeout(id)
  }, [s.state, speed, flightBaseMs, go, playSound])

  // entering_hole → suspense
  useEffect(() => {
    if (s.state !== "entering_hole") return
    playSound("drop")
    const id = window.setTimeout(() => go("entering_hole", "suspense"), holeEntryMsBase * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, holeEntryMsBase, go, playSound])

  // suspense → win_reaction | nonwin_reaction (theatrical, not "loading")
  useEffect(() => {
    if (s.state !== "suspense") return
    if (!fast) playSound("suspense")
    const id = window.setTimeout(() => {
      dispatch({ type: "GOTO", from: "suspense", to: isWin ? "win_reaction" : "nonwin_reaction" })
    }, suspenseMsBase * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, suspenseMsBase, fast, isWin, playSound])

  // win_reaction → celebrating (the hole is the source of the celebration)
  useEffect(() => {
    if (s.state !== "win_reaction") return
    playSound(bigWin ? "prize" : fast ? "streak" : "impact")
    if (typeof navigator !== "undefined" && "vibrate" in navigator && settings.soundOn) {
      try {
        navigator.vibrate?.(bigWin ? [18, 40, 26, 40, 30] : fast ? [12, 24] : [16, 40, 22])
      } catch {
        /* best effort */
      }
    }
    const id = window.setTimeout(() => go("win_reaction", "celebrating"), winReactionMsBase * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, winReactionMsBase, bigWin, fast, settings.soundOn, go, playSound])

  // celebrating → revealing (DG neutral → scored entrance)
  useEffect(() => {
    if (s.state !== "celebrating") return
    const celebrateDur = fast ? 0 : TIMING.celebrateMs + TIMING.pauseBeforePanelMs
    const id = window.setTimeout(() => go("celebrating", "revealing"), celebrateDur * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, fast, go])

  // revealing → revealed
  useEffect(() => {
    if (s.state !== "revealing") return
    playSound(active?.outcome.kind === "credit" ? "credit" : "prize")
    const id = window.setTimeout(() => go("revealing", "revealed"), panelRiseMsBase * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, panelRiseMsBase, active, go, playSound])

  // revealed → checking_additional (more wins) | summary (done)
  useEffect(() => {
    if (s.state !== "revealed") return
    const id = window.setTimeout(() => {
      if (hasMoreAnimated) go("revealed", "checking_additional")
      else dispatch({ type: "CONTINUE_TO_SUMMARY", from: "revealed" })
    }, prizeHoldMsBase * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, prizeHoldMsBase, hasMoreAnimated, go])

  // checking_additional → auto_relaunch. Duration depends on whether we show a
  // visible interstitial, a tray reload, or just a quick silent power-up.
  useEffect(() => {
    if (s.state !== "checking_additional") return
    if (trayReload) playSound("reload")
    else if (showInterstitial) playSound("another")
    const dur = trayReload
      ? TIMING.trayReloadMs
      : showInterstitial
        ? nextIsFast
          ? TIMING.fastInterstitialMs
          : TIMING.interstitialMs
        : TIMING.fastPowerUpMs
    const id = window.setTimeout(() => go("checking_additional", "auto_relaunch"), dur * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed, trayReload, showInterstitial, nextIsFast, go, playSound])

  // auto_relaunch → launching (advance to the next win, fire automatically)
  useEffect(() => {
    if (s.state !== "auto_relaunch") return
    const id = window.setTimeout(() => dispatch({ type: "RELAUNCH" }), TIMING.relaunchLiftMs * speed)
    return () => window.clearTimeout(id)
  }, [s.state, speed])

  // nonwin_reaction → summary
  useEffect(() => {
    if (s.state !== "nonwin_reaction") return
    playSound("nowin")
    const id = window.setTimeout(
      () => dispatch({ type: "CONTINUE_TO_SUMMARY", from: "nonwin_reaction" }),
      (TIMING.nonwinReactionMs + TIMING.summaryDelayMs) * speed,
    )
    return () => window.clearTimeout(id)
  }, [s.state, speed, playSound])

  /* ---- callbacks ------------------------------------------------------- */
  const onSelectBall = useCallback((n: number) => dispatch({ type: "SELECT", ball: n }), [])

  /* ---- derived reveal copy --------------------------------------------- */
  const revealCopy = active && active.isWin ? revealCopyFor(active.outcome) : null
  const revealVisible = isWin && (s.state === "revealing" || s.state === "revealed")

  const winSoFar = s.animIndex + 1
  const totalAnimatedWins = animations.filter((a) => a.isWin).length

  return (
    <div className="dgf-reveal-root">
      <DgFootballStage
        state={s.state}
        settings={settings}
        ticketCount={plan.ticketCount}
        ticketRangeText={plan.ticketRangeText ?? null}
        destinationHole={destinationHole}
        isWin={isWin}
        bigWin={bigWin}
        fast={fast}
        activeBall={activeBall}
        tappedBall={s.tappedBall}
        winSoFar={winSoFar}
        totalAnimatedWins={totalAnimatedWins}
        interstitialText={interstitialText}
        trayReload={trayReload}
        revealCopy={revealCopy}
        revealVisible={revealVisible}
        summary={summary}
        summaryVisible={s.state === "summary"}
        onSelectBall={onSelectBall}
        onFinish={onFinish}
        onHelp={onHelp}
      />

      {/* Live region for the result (screen-reader announcement). */}
      <div className="sr-only" role="status" aria-live="polite">
        {s.state === "revealed" && revealCopy
          ? `${revealCopy.eyebrow} ${revealCopy.amount} ${revealCopy.unit}. ${revealCopy.support}.`
          : s.state === "summary"
            ? `${plan.ticketCount} tickets checked. ${summary.instantWins} instant wins.`
            : ""}
      </div>
    </div>
  )
}
