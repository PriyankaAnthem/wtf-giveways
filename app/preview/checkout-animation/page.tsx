"use client"

/**
 * INTERACTIVE ANIMATION PREVIEW — MOCK DATA ONLY.
 *
 * This route plays the full post-checkout instant-win reveal sequence
 * with hardcoded mock data so the animation flow can be reviewed.
 *
 * It does NOT touch checkout, API, Supabase, RPC, webhook, payment,
 * or the real checkout success page. Nothing here calls the network.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  Ticket,
  ScanLine,
  Zap,
  Trophy,
  Gift,
  PoundSterling,
  Sparkles,
  Play,
  RotateCcw,
  Repeat,
  Gauge,
} from "lucide-react"

/* ----------------------------- mock data ----------------------------- */

type Scenario = {
  qty: number
  ticketStart: number
  ticketEnd: number
  winningTicket?: number
  prizeAmount?: string
  orderRef: string
}

// Small order (5 tickets)
const SMALL_WIN: Scenario = {
  qty: 5,
  ticketStart: 8421,
  ticketEnd: 8425,
  winningTicket: 8423,
  prizeAmount: "1,000",
  orderRef: "CHK-PREVIEW-WIN-5",
}
const SMALL_NOWIN: Scenario = {
  qty: 5,
  ticketStart: 8421,
  ticketEnd: 8425,
  orderRef: "CHK-PREVIEW-NOWIN-5",
}

// Large order (500 tickets)
const LARGE_WIN: Scenario = {
  qty: 500,
  ticketStart: 8421,
  ticketEnd: 8920,
  winningTicket: 8764,
  prizeAmount: "1,000",
  orderRef: "CHK-PREVIEW-WIN-500",
}
const LARGE_NOWIN: Scenario = {
  qty: 500,
  ticketStart: 8421,
  ticketEnd: 8920,
  orderRef: "CHK-PREVIEW-NOWIN-500",
}

function scenarioFor(result: Result, size: Size): Scenario {
  if (size === "large") return result === "win" ? LARGE_WIN : LARGE_NOWIN
  return result === "win" ? SMALL_WIN : SMALL_NOWIN
}

function ticketRange(start: number, end: number) {
  const out: number[] = []
  for (let n = start; n <= end; n++) out.push(n)
  return out
}

// Show individual pills only for small orders.
const PILL_THRESHOLD = 10

/* ----------------------------- stages ----------------------------- */

type Stage = "payment" | "tickets" | "checking" | "final" | "reveal"
type Result = "win" | "nowin"
type Size = "small" | "large"
type Speed = "normal" | "fast"

const STAGE_LABEL: Record<Stage, string> = {
  payment: "Payment Confirmed",
  tickets: "Tickets Locked In",
  checking: "Checking Instant Wins",
  final: "Final Instant Win Check",
  reveal: "Result Reveal",
}

// Base durations (ms) at normal speed. `reveal` is terminal (stays on screen).
const STAGE_DURATION: Record<Exclude<Stage, "reveal">, number> = {
  payment: 2200,
  tickets: 2800,
  checking: 3200,
  final: 2400,
}

const SEQUENCE: Stage[] = ["payment", "tickets", "checking", "final", "reveal"]

/* ----------------------------- page ----------------------------- */

export default function CheckoutAnimationPreviewPage() {
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState<Result>("win")
  const [size, setSize] = useState<Size>("small")
  const [speed, setSpeed] = useState<Speed>("normal")
  const [stageIndex, setStageIndex] = useState(0)
  const [runId, setRunId] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const start = useCallback(
    (nextResult: Result, nextSize: Size) => {
      clearTimers()
      setResult(nextResult)
      setSize(nextSize)
      setStageIndex(0)
      setPlaying(true)
      setRunId((id) => id + 1)
    },
    [clearTimers],
  )

  const replay = useCallback(() => {
    clearTimers()
    setStageIndex(0)
    setPlaying(true)
    setRunId((id) => id + 1)
  }, [clearTimers])

  // Drive the stage sequence with timers whenever a run starts.
  useEffect(() => {
    if (!playing) return
    clearTimers()
    const factor = speed === "fast" ? 0.5 : 1
    let elapsed = 0
    for (let i = 0; i < SEQUENCE.length - 1; i++) {
      const stage = SEQUENCE[i] as Exclude<Stage, "reveal">
      elapsed += STAGE_DURATION[stage] * factor
      const target = i + 1
      timers.current.push(setTimeout(() => setStageIndex(target), elapsed))
    }
    return clearTimers
    // runId forces a fresh schedule on each replay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, playing, speed, clearTimers])

  useEffect(() => clearTimers, [clearTimers])

  const currentStage = SEQUENCE[stageIndex]
  const switchResult = useCallback(() => {
    start(result === "win" ? "nowin" : "win", size)
  }, [result, size, start])

  return (
    <main className="min-h-screen bg-[#15101F] text-white">
      <PreviewKeyframes />

      {/* Control bar */}
      <header className="mx-auto max-w-md px-4 pt-8 pb-4">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-400">
          Interactive Animation Preview
        </p>
        <h1 className="mt-1 text-center text-2xl font-extrabold tracking-tight">
          Checkout Instant Win Sequence
        </h1>
        <p className="mt-2 text-center text-xs text-white/40">
          Mock data only. No checkout, payment, or backend logic is touched.
        </p>

        {/* Big start buttons: 2x2 (win/nowin x 5/500) */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => start("win", "small")}
            className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(245,158,11,0.45)] transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              <Play className="h-4 w-4" aria-hidden="true" />
              Instant Win
            </span>
            <span className="text-[11px] font-semibold opacity-70">5 tickets</span>
          </button>
          <button
            type="button"
            onClick={() => start("nowin", "small")}
            className="flex flex-col items-center justify-center gap-1 rounded-xl border border-purple-400/40 bg-purple-500/15 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              <Play className="h-4 w-4" aria-hidden="true" />
              No Win
            </span>
            <span className="text-[11px] font-semibold text-white/50">5 tickets</span>
          </button>
          <button
            type="button"
            onClick={() => start("win", "large")}
            className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(245,158,11,0.45)] transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              <Play className="h-4 w-4" aria-hidden="true" />
              Instant Win
            </span>
            <span className="text-[11px] font-semibold opacity-70">500 tickets</span>
          </button>
          <button
            type="button"
            onClick={() => start("nowin", "large")}
            className="flex flex-col items-center justify-center gap-1 rounded-xl border border-purple-400/40 bg-purple-500/15 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              <Play className="h-4 w-4" aria-hidden="true" />
              No Win
            </span>
            <span className="text-[11px] font-semibold text-white/50">500 tickets</span>
          </button>
        </div>

        {/* Secondary controls */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={replay}
            disabled={!playing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Replay
          </button>
          <button
            type="button"
            onClick={switchResult}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
          >
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
            Switch Result
          </button>
          <button
            type="button"
            onClick={() => setSpeed((s) => (s === "normal" ? "fast" : "normal"))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
          >
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            Speed: {speed === "normal" ? "Normal" : "Fast"}
          </button>
        </div>

        {/* Stage debug indicator */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-mono">
            <span
              className={`h-2 w-2 rounded-full ${playing ? "animate-pulse bg-emerald-400" : "bg-white/30"}`}
              aria-hidden="true"
            />
            {playing ? (
              <>
                stage {stageIndex + 1}/5 · {currentStage} · {result.toUpperCase()} ·{" "}
                {size === "large" ? "500" : "5"}t
              </>
            ) : (
              "idle — press a preview button"
            )}
          </span>
        </div>
      </header>

      {/* Phone-framed stage viewport */}
      <div className="mx-auto max-w-md px-4 pb-16">
        <div className="relative mx-auto aspect-[9/19] w-full max-w-[380px] overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#0E0A17] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.6)]">
          {!playing ? (
            <IdleScreen />
          ) : (
            <StagePlayer key={runId} stage={currentStage} result={result} size={size} />
          )}
        </div>
      </div>
    </main>
  )
}

/* ----------------------------- idle ----------------------------- */

function IdleScreen() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
      <VaultBackdrop tone="purple" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-amber-400/40 bg-amber-400/10 shadow-[0_0_36px_rgba(245,158,11,0.35)]">
        <Sparkles className="h-9 w-9 text-amber-300" aria-hidden="true" />
      </div>
      <h2 className="relative mt-6 text-xl font-extrabold tracking-tight">Ready to Preview</h2>
      <p className="relative mt-2 max-w-xs text-pretty text-sm text-white/50">
        Pick a scenario above to play the full reveal sequence in the WTF Giveaways style.
      </p>
    </div>
  )
}

/* ----------------------------- stage player ----------------------------- */

function StagePlayer({ stage, result, size }: { stage: Stage; result: Result; size: Size }) {
  const data = scenarioFor(result, size)
  return (
    <div className="relative h-full w-full">
      {/* Each stage cross-fades using a keyed wrapper. Safe-area padding keeps
          content clear of any mobile bottom nav. */}
      <div
        key={stage}
        className="absolute inset-0 anim-stage-in pb-[env(safe-area-inset-bottom)]"
      >
        {stage === "payment" && <PaymentStage />}
        {stage === "tickets" && <TicketsStage data={data} />}
        {stage === "checking" && <CheckingStage data={data} />}
        {stage === "final" && <FinalStage />}
        {stage === "reveal" &&
          (result === "win" ? <WinnerReveal data={data} /> : <NotWonReveal data={data} />)}
      </div>
    </div>
  )
}

/* ----------------------------- shared visuals ----------------------------- */

function VaultBackdrop({ tone = "purple" }: { tone?: "purple" | "gold" | "green" }) {
  const glow =
    tone === "gold"
      ? "bg-[radial-gradient(circle_at_50%_30%,rgba(245,158,11,0.28),transparent_60%),radial-gradient(circle_at_50%_90%,rgba(109,40,217,0.35),transparent_70%)]"
      : tone === "green"
        ? "bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.22),transparent_60%),radial-gradient(circle_at_50%_92%,rgba(109,40,217,0.32),transparent_72%)]"
        : "bg-[radial-gradient(circle_at_50%_28%,rgba(124,58,237,0.45),transparent_62%),radial-gradient(circle_at_50%_96%,rgba(245,158,11,0.12),transparent_70%)]"
  return (
    <>
      {/* Deep purple base wash */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#2E1065] via-[#1B1230] to-[#0E0A17]"
        aria-hidden="true"
      />
      <div className={`pointer-events-none absolute inset-0 ${glow}`} aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
    </>
  )
}

function FloatingParticles({ tone = "gold" }: { tone?: "gold" | "purple" }) {
  const color = tone === "purple" ? "bg-purple-300" : "bg-amber-300"
  const dots = [
    { left: "12%", top: "20%", size: "h-2 w-2", delay: "0s", dur: "3.2s" },
    { left: "80%", top: "24%", size: "h-1.5 w-1.5", delay: "0.6s", dur: "3.8s" },
    { left: "22%", top: "68%", size: "h-1 w-1", delay: "1.1s", dur: "2.9s" },
    { left: "72%", top: "64%", size: "h-2.5 w-2.5", delay: "0.3s", dur: "4.1s" },
    { left: "50%", top: "14%", size: "h-1 w-1", delay: "1.4s", dur: "3.4s" },
    { left: "88%", top: "50%", size: "h-1.5 w-1.5", delay: "0.9s", dur: "3.6s" },
    { left: "8%", top: "48%", size: "h-1.5 w-1.5", delay: "1.7s", dur: "3.1s" },
  ]
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {dots.map((d, i) => (
        <span
          key={i}
          className={`absolute rounded-full ${color} ${d.size} anim-float blur-[0.5px]`}
          style={{ left: d.left, top: d.top, animationDelay: d.delay, animationDuration: d.dur }}
        />
      ))}
    </div>
  )
}

/* ----------------------------- STAGE 1: Payment ----------------------------- */

function PaymentStage() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
      <VaultBackdrop tone="green" />
      <div className="relative anim-pop">
        <div
          className="absolute inset-0 -m-4 rounded-full bg-emerald-500/25 blur-2xl anim-pulse-glow"
          aria-hidden="true"
        />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.5)]">
          <CheckCircle2 className="h-12 w-12 text-emerald-400 anim-check" aria-hidden="true" />
        </div>
      </div>
      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
        Payment Confirmed
      </p>
      <h3 className="relative mt-2 text-3xl font-extrabold tracking-tight">You&apos;re In!</h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm leading-relaxed text-white/60">
        Your payment went through. Loading your tickets into the vault&hellip;
      </p>
    </div>
  )
}

/* ----------------------------- STAGE 2: Tickets ----------------------------- */

function TicketChip({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-gradient-to-b from-amber-400/15 to-amber-500/5 px-3 py-2 shadow-[0_0_14px_rgba(245,158,11,0.25)]">
      <Ticket className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
      <span className="font-mono text-sm font-bold tracking-wider text-amber-200">#{n}</span>
    </div>
  )
}

function TicketsStage({ data }: { data: Scenario }) {
  const isLarge = data.qty > PILL_THRESHOLD

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
      <VaultBackdrop tone="purple" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-purple-400/50 bg-purple-500/15 shadow-[0_0_36px_rgba(124,58,237,0.5)] anim-pop">
        <Ticket className="h-10 w-10 text-purple-200" aria-hidden="true" />
      </div>
      <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
        Tickets Locked In
      </p>
      <h3 className="relative mt-2 text-2xl font-extrabold tracking-tight">
        {data.qty} Tickets Secured
      </h3>

      {isLarge ? (
        /* Compact summary card for large orders (no per-ticket pills). */
        <div className="relative mt-6 w-full max-w-xs rounded-2xl border border-purple-400/30 bg-purple-500/10 p-4 shadow-[0_0_24px_rgba(124,58,237,0.25)] anim-card-in">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-purple-200/70">
            Ticket Range
          </p>
          <p className="mt-1 font-mono text-lg font-bold tracking-wider text-amber-200">
            #{data.ticketStart} – #{data.ticketEnd}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {[data.ticketStart, data.ticketStart + 1, data.ticketStart + 2].map((t) => (
              <span
                key={t}
                className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-xs font-semibold text-amber-200"
              >
                #{t}
              </span>
            ))}
            <span className="px-1 text-amber-300/70" aria-hidden="true">
              &hellip;
            </span>
            {[data.ticketEnd - 2, data.ticketEnd - 1, data.ticketEnd].map((t) => (
              <span
                key={t}
                className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-xs font-semibold text-amber-200"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      ) : (
        /* Individual pills for small orders. */
        <div className="relative mt-6 flex w-full flex-wrap items-center justify-center gap-2">
          {ticketRange(data.ticketStart, data.ticketEnd).map((t, i) => (
            <div
              key={t}
              className="anim-ticket-in"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <TicketChip n={t} />
            </div>
          ))}
        </div>
      )}

      <p className="relative mt-6 max-w-xs text-pretty text-sm text-white/55">
        Your ticket numbers are locked. Next up: the instant win scan.
      </p>
    </div>
  )
}

/* ----------------------------- STAGE 3: Checking (scan) ----------------------------- */

function CheckingStage({ data }: { data: Scenario }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
      <VaultBackdrop tone="purple" />
      <FloatingParticles tone="purple" />

      <div className="relative flex h-44 w-44 items-center justify-center">
        <div
          className="absolute inset-0 rounded-full border-2 border-purple-400/40 anim-ring-pulse"
          aria-hidden="true"
        />
        <div
          className="absolute inset-2 rounded-full border border-amber-400/30 shadow-[inset_0_0_30px_rgba(245,158,11,0.25)]"
          aria-hidden="true"
        />
        {/* rotating conic scan sweep (gold) */}
        <div
          className="absolute inset-0 rounded-full anim-scan-rotate bg-[conic-gradient(from_0deg,transparent_0deg,rgba(245,158,11,0.4)_40deg,transparent_90deg)]"
          aria-hidden="true"
        />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-purple-500/15 shadow-[0_0_30px_rgba(124,58,237,0.6)]">
          <ScanLine className="h-9 w-9 text-amber-300" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
        Instant Win Check
      </p>
      <h3 className="relative mt-2 text-2xl font-extrabold tracking-tight">
        Scanning all {data.qty} tickets&hellip;
      </h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm text-white/55">
        Running your ticket numbers against the instant win vault.
      </p>
    </div>
  )
}

/* ----------------------------- STAGE 4: Final ----------------------------- */

function FinalStage() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
      <VaultBackdrop tone="gold" />
      <FloatingParticles tone="gold" />

      <div className="relative flex h-48 w-48 items-center justify-center">
        <div
          className="absolute inset-0 rounded-full border-2 border-amber-400/50 shadow-[0_0_50px_rgba(245,158,11,0.5)] anim-charge"
          aria-hidden="true"
        />
        <div
          className="absolute inset-3 rounded-full border border-purple-400/40 anim-ring-pulse"
          aria-hidden="true"
        />
        <div
          className="absolute inset-6 rounded-full bg-amber-500/10 blur-md anim-pulse-glow"
          aria-hidden="true"
        />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-b from-amber-400/25 to-purple-500/15 shadow-[0_0_40px_rgba(245,158,11,0.6)]">
          <Zap className="h-12 w-12 text-amber-300 anim-zap" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
        Final Check
      </p>
      <h3 className="relative mt-2 text-2xl font-extrabold tracking-tight">
        Finalising Your Result&hellip;
      </h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm text-white/55">
        The vault is locking in your outcome right now.
      </p>
    </div>
  )
}

/* ----------------------------- STAGE 5a: Winner ----------------------------- */

function WinnerReveal({ data }: { data: Scenario }) {
  const burst = useMemo(
    () =>
      Array.from({ length: 18 }).map((_, i) => ({
        left: `${Math.round((Math.sin(i * 2.3) * 0.5 + 0.5) * 100)}%`,
        delay: `${(i % 6) * 90}ms`,
        dur: `${1600 + (i % 5) * 240}ms`,
        gold: i % 3 !== 0,
        size: i % 3 === 0 ? "h-2.5 w-2.5" : "h-1.5 w-1.5",
      })),
    [],
  )
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 pb-6 text-center">
      <VaultBackdrop tone="gold" />

      {/* cash/confetti burst (gold with controlled purple accent) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {burst.map((b, i) => (
          <span
            key={i}
            className={`absolute top-1/3 ${b.size} rounded-sm anim-burst ${b.gold ? "bg-amber-300" : "bg-purple-300"}`}
            style={{ left: b.left, animationDelay: b.delay, animationDuration: b.dur }}
          />
        ))}
      </div>

      <div className="relative anim-pop">
        <div
          className="absolute inset-0 -m-6 rounded-full bg-amber-400/30 blur-3xl anim-pulse-glow"
          aria-hidden="true"
        />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-b from-amber-400/30 to-amber-600/10 shadow-[0_0_60px_rgba(245,158,11,0.75)]">
          <Trophy className="h-12 w-12 text-amber-300" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.35em] text-amber-400">
        Instant Winner
      </p>
      <h3 className="relative mt-2 bg-gradient-to-b from-amber-200 to-amber-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent drop-shadow-[0_0_20px_rgba(245,158,11,0.55)] anim-pop-big">
        YOU WON!
      </h3>

      <div className="relative mt-5 w-full max-w-xs rounded-2xl border-2 border-amber-400/50 bg-gradient-to-b from-amber-400/15 to-[#1B1230]/60 p-5 shadow-[0_0_40px_rgba(245,158,11,0.4)] anim-card-in">
        <div className="flex items-center justify-center gap-2">
          <PoundSterling className="h-6 w-6 text-amber-300" aria-hidden="true" />
          <span className="text-3xl font-extrabold">{data.prizeAmount} Instant Win</span>
        </div>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-amber-200/70">
          Winning Ticket #{data.winningTicket}
        </p>
        <p className="mt-1 font-mono text-[10px] text-white/40">{data.orderRef}</p>
      </div>

      <button
        type="button"
        className="relative mt-6 w-full max-w-xs rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-6 py-3.5 text-base font-bold text-black shadow-[0_0_30px_rgba(245,158,11,0.5)] transition active:scale-[0.98]"
      >
        Claim Your Prize
      </button>
    </div>
  )
}

/* ----------------------------- STAGE 5b: No Win ----------------------------- */

function NotWonReveal({ data }: { data: Scenario }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 pb-6 text-center">
      <VaultBackdrop tone="purple" />
      <FloatingParticles tone="purple" />

      <div className="relative anim-pop">
        <div
          className="absolute inset-0 -m-4 rounded-full bg-amber-400/20 blur-2xl anim-pulse-glow"
          aria-hidden="true"
        />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-amber-400/50 bg-amber-400/10 shadow-[0_0_40px_rgba(245,158,11,0.4)]">
          <Gift className="h-11 w-11 text-amber-300" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-7 text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
        You&apos;re In The Draw
      </p>
      <h3 className="relative mt-2 text-3xl font-extrabold tracking-tight anim-pop-big">
        All Tickets Entered!
      </h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm leading-relaxed text-white/60">
        No instant win on this order, but all {data.qty} of your tickets are locked into the main
        prize draw. Good luck!
      </p>

      <div className="relative mt-6 flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/5 px-4 py-2 anim-card-in">
        <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
        <span className="text-sm font-semibold text-amber-200">
          {data.qty} tickets in the main draw
        </span>
      </div>
      <p className="relative mt-2 font-mono text-[10px] text-white/40">{data.orderRef}</p>

      <button
        type="button"
        className="relative mt-6 w-full max-w-xs rounded-xl border border-amber-400/50 bg-amber-400/10 px-6 py-3.5 text-base font-bold text-white transition active:scale-[0.98]"
      >
        Enter Another Giveaway
      </button>
    </div>
  )
}

/* ----------------------------- keyframes ----------------------------- */

function PreviewKeyframes() {
  return (
    <style>{`
      @keyframes prev-stage-in {
        0% { opacity: 0; transform: translateY(10px) scale(0.985); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      .anim-stage-in { animation: prev-stage-in 420ms ease-out both; }

      @keyframes prev-pop {
        0% { opacity: 0; transform: scale(0.6); }
        60% { opacity: 1; transform: scale(1.08); }
        100% { transform: scale(1); }
      }
      .anim-pop { animation: prev-pop 520ms cubic-bezier(0.34,1.56,0.64,1) both; }

      @keyframes prev-pop-big {
        0% { opacity: 0; transform: scale(0.5); }
        55% { opacity: 1; transform: scale(1.15); }
        100% { transform: scale(1); }
      }
      .anim-pop-big { animation: prev-pop-big 640ms cubic-bezier(0.34,1.56,0.64,1) both; }

      @keyframes prev-pulse-glow {
        0%, 100% { opacity: 0.55; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.12); }
      }
      .anim-pulse-glow { animation: prev-pulse-glow 1.8s ease-in-out infinite; }

      @keyframes prev-ring-pulse {
        0%, 100% { opacity: 0.5; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.04); }
      }
      .anim-ring-pulse { animation: prev-ring-pulse 1.6s ease-in-out infinite; }

      @keyframes prev-scan-rotate { to { transform: rotate(360deg); } }
      .anim-scan-rotate { animation: prev-scan-rotate 1.4s linear infinite; }

      @keyframes prev-charge {
        0% { opacity: 0.45; transform: scale(0.96); box-shadow: 0 0 30px rgba(245,158,11,0.4); }
        50% { opacity: 1; transform: scale(1.02); box-shadow: 0 0 70px rgba(245,158,11,0.8); }
        100% { opacity: 0.45; transform: scale(0.96); box-shadow: 0 0 30px rgba(245,158,11,0.4); }
      }
      .anim-charge { animation: prev-charge 1.3s ease-in-out infinite; }

      @keyframes prev-zap {
        0%, 100% { transform: scale(1); filter: drop-shadow(0 0 6px rgba(245,158,11,0.6)); }
        50% { transform: scale(1.15); filter: drop-shadow(0 0 16px rgba(245,158,11,1)); }
      }
      .anim-zap { animation: prev-zap 0.7s ease-in-out infinite; }

      @keyframes prev-check {
        0% { opacity: 0; transform: scale(0.4) rotate(-12deg); }
        100% { opacity: 1; transform: scale(1) rotate(0); }
      }
      .anim-check { animation: prev-check 520ms cubic-bezier(0.34,1.56,0.64,1) 120ms both; }

      @keyframes prev-ticket-in {
        0% { opacity: 0; transform: translateY(12px) scale(0.9); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      .anim-ticket-in { animation: prev-ticket-in 420ms ease-out both; }

      @keyframes prev-card-in {
        0% { opacity: 0; transform: translateY(16px) scale(0.96); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      .anim-card-in { animation: prev-card-in 560ms ease-out 220ms both; }

      @keyframes prev-float {
        0% { transform: translateY(0); opacity: 0.3; }
        50% { transform: translateY(-14px); opacity: 0.9; }
        100% { transform: translateY(0); opacity: 0.3; }
      }
      .anim-float { animation: prev-float 3.2s ease-in-out infinite; }

      @keyframes prev-burst {
        0% { transform: translateY(0) scale(0.6); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translateY(-220px) scale(1); opacity: 0; }
      }
      .anim-burst { animation: prev-burst 1.8s ease-out both; }

      @media (prefers-reduced-motion: reduce) {
        .anim-stage-in, .anim-pop, .anim-pop-big, .anim-pulse-glow, .anim-ring-pulse,
        .anim-scan-rotate, .anim-charge, .anim-zap, .anim-check, .anim-ticket-in,
        .anim-card-in, .anim-float, .anim-burst {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
        }
      }
    `}</style>
  )
}
