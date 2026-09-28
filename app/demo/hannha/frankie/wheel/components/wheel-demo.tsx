"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PRIZES, SEGMENT_COUNT, type DemoPrize, type DemoPrizeType } from "../lib/prizes"
import { useCasinoSound } from "../lib/use-casino-sound"
import { PrizeWheel, type PrizeWheelHandle } from "./prize-wheel"
import { WheelPointer, type WheelPointerHandle } from "./wheel-pointer"
import { SpinButton, type SpinButtonState } from "./spin-button"
import { StatusBar } from "./status-bar"
import { ResultReveal } from "./result-reveal"
import { Confetti } from "./confetti"
import { TicketIcon } from "./ticket-icon"
import { DemoControls } from "./demo-controls"
import { SessionSummary, MoreSpinsPanel } from "./session-summary"
import { MultiWinSequence } from "./multi-win-sequence"

type Phase = "idle" | "spinning" | "revealing"

// Demo start values (item 12).
const START_SPINS = 3
const START_CASH = 0
const START_CREDIT = 0

// Celebration timeline, in ms measured from the instant the wheel fully stops.
const SUSPENSE_MS = 400 // wheel stopped, no text — pure suspense
const TEXT_AT_MS = 900 // large result typography appears
const COUNT_AT_MS = 1100 // balance count-up begins
const TICKET_AT_MS = 900 // free-spin ticket flies to the counter
// Total time before normal play resumes (SPIN AGAIN), per prize type.
const TOTAL_MS: Record<DemoPrizeType, number> = {
  cash: 3800,
  credit: 3600,
  free_spin: 2800,
  loss: 1400,
}

// Multiple-wins timeline anchors (ms from press) that the parent must sync to
// the CSS overlay: rim brighten, camera-flash/shake impact, and the shift to
// the prize list. Kept in step with T in multi-win-sequence.tsx.
const T_RAYS = 650
const T_IMPACT = 1150
const T_SHIFT = 3450

const confettiVariant = (t: DemoPrizeType): "gold" | "purple" | "cash" =>
  t === "cash" ? "cash" : t === "free_spin" ? "purple" : t === "credit" ? "purple" : "gold"

export function WheelDemo() {
  const wheelRef = useRef<PrizeWheelHandle | null>(null)
  const pointerRef = useRef<WheelPointerHandle | null>(null)

  const [spins, setSpins] = useState(START_SPINS)
  const [cashWinnings, setCashWinnings] = useState(START_CASH)
  const [siteCredit, setSiteCredit] = useState(START_CREDIT)

  const [phase, setPhase] = useState<Phase>("idle")
  const [result, setResult] = useState<DemoPrize | null>(null)
  const [showText, setShowText] = useState(false)
  const [runId, setRunId] = useState(0)
  const [flyTicket, setFlyTicket] = useState(false)
  const [target, setTarget] = useState(0)
  const [confettiOn, setConfettiOn] = useState(true)
  const [claimMsg, setClaimMsg] = useState(false)
  // Celebratory screen shake: "strong" for cash wins, "soft" for credit/free.
  const [shake, setShake] = useState<"strong" | "soft" | null>(null)

  // End-of-round (0 spins) session summary + its demo "get more spins" panel.
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [morePanelOpen, setMorePanelOpen] = useState(false)

  // DEMO ONLY — multiple-wins celebration overlay (hard-coded test scenario).
  const [multiWinOn, setMultiWinOn] = useState(false)
  const [mwClosing, setMwClosing] = useState(false)
  const [wheelMw, setWheelMw] = useState<"impact" | "settle" | null>(null)
  const [rootShake, setRootShake] = useState(false)
  // Once the user chooses FINISH FOR NOW we must not immediately reopen the
  // summary while spins are still 0; this latch clears when spins return.
  const dismissedRef = useRef(false)

  const sound = useCasinoSound()

  // Track celebration timers so a reset / new spin can cancel them cleanly.
  const timersRef = useRef<number[]>([])
  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id))
    timersRef.current = []
  }, [])
  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms)
    timersRef.current.push(id)
  }, [])
  useEffect(() => () => clearTimers(), [clearTimers])

  // ---- 0-spins session summary trigger (item 1) --------------------------
  // Fires only once the wheel is at rest (phase idle), no free-spin ticket is
  // still flying (a refund would push spins back above 0), and the user has
  // not just dismissed it. A short pause after the celebration keeps the win
  // moment from being trampled by the popup.
  useEffect(() => {
    if (spins > 0) {
      dismissedRef.current = false
      return
    }
    if (phase !== "idle" || flyTicket || summaryOpen || dismissedRef.current) return
    const id = window.setTimeout(() => setSummaryOpen(true), 700)
    return () => window.clearTimeout(id)
  }, [spins, phase, flyTicket, summaryOpen])

  // Session-summary sting: positive if anything was won, neutral otherwise.
  // Respects the existing mute state (handled inside the sound layer).
  useEffect(() => {
    if (!summaryOpen) return
    if (cashWinnings > 0 || siteCredit > 0) sound.sessionWin()
    else sound.sessionNeutral()
  }, [summaryOpen, cashWinnings, siteCredit, sound])

  // While a FREE SPIN reveal is playing, a +1 refund is pending — reflect it so
  // the CTA never flashes "NO SPINS LEFT" before the ticket lands.
  const effectiveSpins = phase === "revealing" && result?.type === "free_spin" ? spins + 1 : spins
  const btnState: SpinButtonState =
    phase === "spinning" ? "spinning" : effectiveSpins <= 0 ? "empty" : result ? "again" : "ready"

  const playSting = useCallback(
    (type: DemoPrizeType) => {
      switch (type) {
        case "cash":
          sound.winCash()
          break
        case "credit":
          sound.winCredit()
          break
        case "free_spin":
          sound.winFree()
          break
        case "loss":
          sound.noPrize()
          break
      }
    },
    [sound],
  )

  const runSpin = useCallback(
    async (index: number) => {
      if (phase === "spinning" || spins <= 0) return

      clearTimers()
      sound.unlock()
      sound.startAmbient()

      setResult(null)
      setShowText(false)
      setClaimMsg(false)
      setShake(null)
      setPhase("spinning")
      setSpins((s) => Math.max(0, s - 1))

      await wheelRef.current?.spinToSegment(index, {
        onStart: () => sound.whoosh(),
        onTick: (intensity) => {
          pointerRef.current?.flick(intensity)
          sound.tick(intensity)
        },
        onFinalPhase: () => sound.duck(0.55, 1100),
        onLand: () => {
          pointerRef.current?.flick(1)
          sound.tick(1)
        },
      })

      const prize = PRIZES[index]

      // ---- Staged win celebration (item 4) --------------------------------
      after(SUSPENSE_MS, () => {
        setResult(prize)
        setPhase("revealing")
        setRunId((r) => r + 1)
        playSting(prize.type)
        // Screen shake sells the impact — strong for cash, gentle otherwise,
        // none for a loss. Cleared automatically before the next spin.
        if (prize.type === "cash") setShake("strong")
        else if (prize.type !== "loss") setShake("soft")
      })

      after(TEXT_AT_MS, () => setShowText(true))

      if (prize.type === "cash" && prize.value) {
        after(COUNT_AT_MS, () => setCashWinnings((c) => c + prize.value!))
      } else if (prize.type === "credit" && prize.value) {
        after(COUNT_AT_MS, () => setSiteCredit((c) => c + prize.value!))
      } else if (prize.type === "free_spin") {
        after(TICKET_AT_MS, () => setFlyTicket(true))
      }

      after(TOTAL_MS[prize.type], () => {
        setPhase("idle")
        setShowText(false)
      })
    },
    [phase, spins, sound, clearTimers, after, playSting],
  )

  const handleSpinPress = useCallback(() => {
    if (btnState !== "ready" && btnState !== "again") return
    // Live gameplay: land on a random wedge each press. (Test control overrides.)
    const idx = Math.floor(Math.random() * SEGMENT_COUNT)
    setTarget(idx)
    void runSpin(idx)
  }, [btnState, runSpin])

  const handleTicketArrived = useCallback(() => {
    setFlyTicket(false)
    setSpins((s) => s + 1) // FREE SPIN refunds the spin
  }, [])

  // DEMO ONLY — GET MORE SPINS never touches checkout/wallet. CONTINUE grants
  // 3 demo spins and closes the summary so the loop stays playable. Crucially
  // it does NOT reset cashWinnings or siteCredit — those persist across rounds.
  const handleGetMoreSpins = useCallback(() => setMorePanelOpen(true), [])
  const handleContinue = useCallback(() => {
    setSpins((s) => s + 3)
    setMorePanelOpen(false)
    setSummaryOpen(false)
  }, [])
  const handleFinish = useCallback(() => {
    dismissedRef.current = true
    setMorePanelOpen(false)
    setSummaryOpen(false)
  }, [])

  // Demo shortcut: jump straight to an end-of-round summary with given totals.
  const endSession = useCallback(
    (cash: number, credit: number) => {
      clearTimers()
      setPhase("idle")
      setResult(null)
      setShowText(false)
      setFlyTicket(false)
      setClaimMsg(false)
      setMorePanelOpen(false)
      setSummaryOpen(false)
      dismissedRef.current = false
      setCashWinnings(cash)
      setSiteCredit(credit)
      setSpins(0) // triggers the summary via the effect above
    },
    [clearTimers],
  )

  // ---- DEMO ONLY — multiple-wins visual test (item: TEST MULTIPLE WINS) ----
  // Fixed scenario: 2 wins = £5 WTF CREDIT + 1 FREE SPIN. Proves animation
  // only — it grants nothing, mutates no wallet/spin balances, and plays NO
  // win sound (the old fruit-machine beep is deliberately never triggered).
  const startMultiWin = useCallback(() => {
    if (phase !== "idle" || multiWinOn) return
    clearTimers()

    // Reset the demo scene to the scenario's baseline (local demo state only).
    setResult(null)
    setShowText(false)
    setClaimMsg(false)
    setShake(null)
    setSummaryOpen(false)
    setMorePanelOpen(false)
    dismissedRef.current = false
    setCashWinnings(0)
    setSiteCredit(0)
    setSpins(2)

    setMwClosing(false)
    setWheelMw(null)
    setMultiWinOn(true)

    // Existing rotor: fast, non-landing spin (no target, no sting, no beep).
    void wheelRef.current?.multiWinSpin()

    // Scene lighting: rim brightens as the spin peaks; wheel dims + blurs as
    // the prize list takes over.
    after(T_RAYS, () => setWheelMw("impact"))
    after(T_SHIFT, () => setWheelMw("settle"))

    // Impact: game-root screen shake + optional haptics (demo only).
    after(T_IMPACT, () => {
      setRootShake(true)
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([40, 25, 70])
      }
    })
    after(T_IMPACT + 340, () => setRootShake(false))
  }, [phase, multiWinOn, clearTimers, after])

  const handleMwContinue = useCallback(() => {
    // Demo only: fade the overlays out and return to the normal wheel. Grants
    // no credit, no free spin, mutates no real balances.
    setMwClosing(true)
    after(360, () => {
      setMultiWinOn(false)
      setMwClosing(false)
      setWheelMw(null)
    })
  }, [after])

  const resetAll = useCallback(() => {
    clearTimers()
    setPhase("idle")
    setResult(null)
    setShowText(false)
    setFlyTicket(false)
    setClaimMsg(false)
    setSummaryOpen(false)
    setMorePanelOpen(false)
    setShake(null)
    setMultiWinOn(false)
    setMwClosing(false)
    setWheelMw(null)
    setRootShake(false)
    dismissedRef.current = false
    setSpins(START_SPINS)
    setCashWinnings(START_CASH)
    setSiteCredit(START_CREDIT)
    wheelRef.current?.resetRotation()
  }, [clearTimers])

  const busy = phase !== "idle" || multiWinOn

  return (
    <div className={rootShake ? "stw-root stw-root--mwshake" : "stw-root"}>
      <button
        type="button"
        className="stw-mute"
        aria-label={sound.muted ? "Unmute" : "Mute"}
        onClick={() => sound.setMuted(!sound.muted)}
      >
        {sound.muted ? "🔇" : "🔊"}
      </button>

      <div className="stw-stage">
        {/* Always-visible progress bar (item 11) */}
        <StatusBar spins={spins} cash={cashWinnings} credit={siteCredit} />

        <h1 className="stw-title">
          SPIN <span className="stw-title-amp">TO</span> WIN
        </h1>

        <div className="stw-wheel-wrap" data-shake={shake ?? undefined} data-mw={wheelMw ?? undefined}>
          <WheelPointer ref={pointerRef} />
          <PrizeWheel
            ref={wheelRef}
            celebrating={phase === "revealing"}
            celebrationType={phase === "revealing" ? (result?.type ?? null) : null}
          />
          <ResultReveal prize={phase === "revealing" ? result : null} runId={runId} show={showText} />

          {/* Free-spin reward ticket flying to the counter */}
          {flyTicket && (
            <div className="stw-flyticket" onAnimationEnd={handleTicketArrived} aria-hidden="true">
              <TicketIcon size={54} />
            </div>
          )}
        </div>

        <SpinButton state={btnState} onClick={handleSpinPress} busy={busy} />

        {/* Secondary claim action — demo stub only, never the primary CTA */}
        {cashWinnings > 0 && (
          <div className="stw-claim-wrap">
            <button type="button" className="stw-claim" onClick={() => setClaimMsg(true)} disabled={busy}>
              CLAIM WINNINGS · £{cashWinnings.toFixed(2)}
            </button>
            {claimMsg && (
              <p className="stw-claim-msg" role="status">
                Demo only — claim flow not connected.
              </p>
            )}
          </div>
        )}

        <Confetti
          active={showText && result?.type !== "loss"}
          enabled={confettiOn}
          variant={result ? confettiVariant(result.type) : "gold"}
          runId={runId}
        />

        <DemoControls
          target={target}
          onTargetChange={setTarget}
          onTest={() => void runSpin(target)}
          onRandom={() => {
            const idx = Math.floor(Math.random() * SEGMENT_COUNT)
            setTarget(idx)
            void runSpin(idx)
          }}
          onSetSpins={(n) => setSpins(n)}
          onAddSpin={() => setSpins((s) => s + 1)}
          onSetCash={(n) => setCashWinnings(n)}
          onSetCredit={(n) => setSiteCredit(n)}
          onEndSession={endSession}
          onTestMultiWin={startMultiWin}
          onReset={resetAll}
          busy={busy}
          soundOn={!sound.muted}
          onToggleSound={(v) => sound.setMuted(!v)}
          confettiOn={confettiOn}
          onToggleConfetti={setConfettiOn}
        />
      </div>

      <SessionSummary
        open={summaryOpen}
        cash={cashWinnings}
        credit={siteCredit}
        confettiEnabled={confettiOn}
        onGetMoreSpins={handleGetMoreSpins}
        onFinish={handleFinish}
      />

      <MoreSpinsPanel
        open={morePanelOpen}
        credit={siteCredit}
        onContinue={handleContinue}
        onClose={() => setMorePanelOpen(false)}
      />

      <MultiWinSequence
        open={multiWinOn}
        closing={mwClosing}
        confettiEnabled={confettiOn}
        onContinue={handleMwContinue}
      />
    </div>
  )
}
