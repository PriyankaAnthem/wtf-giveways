"use client"

import { useMemo, useRef, useState } from "react"
import { ScratchCard, type ScratchCardHandle } from "./ScratchCard"
import { Confetti } from "./Confetti"

type MockResult =
  | { kind: "win"; amount: number }
  | { kind: "lose" }

const TICKETS = { from: 8286, to: 8295, competition: "FAST CASH", ref: "CHK-DEMO-001" }

function usePrefersReducedMotion() {
  // Read once on mount; prototype-only, no SSR mismatch concerns for behaviour.
  const [reduced] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  })
  return reduced
}

function formatGBP(amount: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(amount)
}

export default function ScratchRevealPrototype() {
  const reducedMotion = usePrefersReducedMotion()
  const [result, setResult] = useState<MockResult>({ kind: "win", amount: 1000 })
  const [revealed, setRevealed] = useState(false)
  const [confettiKey, setConfettiKey] = useState(0)
  const cardRef = useRef<ScratchCardHandle>(null)

  const isWin = result.kind === "win"

  const handleComplete = () => {
    if (revealed) return
    setRevealed(true)
    if (isWin && !reducedMotion) {
      setConfettiKey((k) => k + 1)
    }
  }

  const resetCard = () => {
    setRevealed(false)
    setConfettiKey(0)
    cardRef.current?.reset()
  }

  const applyResult = (next: MockResult) => {
    setResult(next)
    setRevealed(false)
    setConfettiKey(0)
    // Reset on next paint so the new foil is drawn cleanly.
    requestAnimationFrame(() => cardRef.current?.reset())
  }

  const headingId = useMemo(() => "scratch-reveal-heading", [])

  return (
    <main
      aria-labelledby={headingId}
      className="proto-root fixed inset-0 z-[100] min-h-[100svh] w-full overflow-x-hidden overflow-y-auto text-white"
    >
      {/* Scoped styles — prototype only, does not touch global theme */}
      <style>{prototypeCss}</style>

      {/* Ambient background: dark luxury + light beams + particles */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="proto-beam proto-beam-1" />
        <div className="proto-beam proto-beam-2" />
        <div className="proto-vignette absolute inset-0" />
        {!reducedMotion && (
          <div className="proto-particles absolute inset-0">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} className="proto-particle" style={particleStyle(i)} />
            ))}
          </div>
        )}
      </div>

      <Confetti fireKey={confettiKey} disabled={reducedMotion} />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-md flex-col items-center px-5 pb-52 pt-8">
        {/* 1. Header */}
        <header className={`flex w-full flex-col items-center text-center ${reducedMotion ? "" : "proto-enter"}`}>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#FFD400] font-black text-black shadow-[0_0_20px_rgba(255,212,0,0.55)]">
              W
            </span>
            <span className="text-lg font-extrabold tracking-tight">
              WTF <span className="text-[#FFD400]">Giveaways</span>
            </span>
          </div>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#FFD400]/30 bg-[#FFD400]/10 px-3 py-1 text-xs font-medium text-[#FFE680]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#36D399]" />
            Your tickets are confirmed
          </div>

          <h1 id={headingId} className="mt-4 text-balance text-4xl font-black leading-[1.05] tracking-tight">
            Scratch to <span className="proto-gold-text">reveal</span>
          </h1>
          <p className="mt-2 text-pretty text-sm text-white/60">
            Your instant-win result is hidden below
          </p>
        </header>

        {/* 2 + 3 + 4 + 5. Scratch card */}
        <section className={`mt-7 w-full ${reducedMotion ? "" : "proto-enter proto-enter-delay"}`}>
          <div className="proto-card-frame relative mx-auto aspect-[3/4] w-full max-w-[340px]">
            {/* Glow behind card on win */}
            {revealed && isWin && <div aria-hidden="true" className="proto-win-glow absolute inset-0" />}

            <div className="proto-card relative h-full w-full rounded-[30px] p-[2px]">
              <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-[#0b0b0f]">
                <ScratchCard
                  ref={cardRef}
                  revealed={revealed}
                  onComplete={handleComplete}
                  foil={isWin ? "gold" : "silver"}
                  threshold={0.6}
                  disabled={reducedMotion}
                >
                  {/* Hidden content (the result) */}
                  {isWin ? (
                    <WinContent amount={(result as { amount: number }).amount} animate={!reducedMotion} />
                  ) : (
                    <LoseContent />
                  )}
                </ScratchCard>

                {/* Foil face copy (only before reveal) */}
                {!revealed && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                    <span className="rounded-full bg-black/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-black/70">
                      Fast Cash
                    </span>
                    <span className="mt-1 text-2xl font-black uppercase tracking-tight text-black/80 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]">
                      Scratch here
                    </span>
                    <span className="text-xs font-medium text-black/55">Use your finger or mouse</span>
                    {!reducedMotion && (
                      <span className="proto-hand mt-3 text-3xl" aria-hidden="true">
                        👆
                      </span>
                    )}
                  </div>
                )}

                {reducedMotion && !revealed && (
                  <button
                    type="button"
                    onClick={handleComplete}
                    className="absolute inset-x-6 bottom-6 z-20 rounded-xl bg-[#FFD400] py-3 text-sm font-bold text-black"
                  >
                    Reveal result
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Result CTA */}
          {revealed && (
            <div className={`mt-6 flex flex-col items-center ${reducedMotion ? "" : "proto-result-in"}`}>
              <button
                type="button"
                className={`proto-cta ${reducedMotion ? "" : "proto-pulse"} w-full max-w-[340px] rounded-2xl bg-[#FFD400] py-4 text-center text-base font-extrabold text-black`}
              >
                View my tickets
              </button>
            </div>
          )}
        </section>

        {/* 7. Ticket details */}
        <section className="mt-8 w-full max-w-[340px]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#36D399]/15 text-[#36D399]">
                <CheckIcon />
              </span>
              <span className="text-sm font-bold text-white">Tickets confirmed</span>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Ticket range" value={`${TICKETS.from.toLocaleString()}–${TICKETS.to.toLocaleString()}`} />
              <Row label="Competition" value={TICKETS.competition} />
              <Row label="Order reference" value={TICKETS.ref} />
            </dl>
          </div>
        </section>
      </div>

      {/* 6. Prototype dev controls */}
      <DevControls
        current={result}
        onWin1000={() => applyResult({ kind: "win", amount: 1000 })}
        onWin100={() => applyResult({ kind: "win", amount: 100 })}
        onLose={() => applyResult({ kind: "lose" })}
        onReset={resetCard}
      />
    </main>
  )
}

function WinContent({ amount, animate }: { amount: number; animate: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 text-center">
      <span className="text-xs font-bold uppercase tracking-[0.35em] text-[#FFE680]">You&apos;ve won</span>
      <span className={`proto-amount ${animate ? "proto-amount-in" : ""} my-1 text-6xl font-black leading-none text-white`}>
        {formatGBP(amount)}
      </span>
      <span className="text-sm font-bold uppercase tracking-[0.3em] text-[#FFD400]">Instant cash</span>
    </div>
  )
}

function LoseContent() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-7 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl">🎟️</span>
      <span className="text-lg font-extrabold text-white">No instant win this time</span>
      <span className="text-sm text-white/65">
        Your tickets are still entered into the final draw
      </span>
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#36D399]/15 px-3 py-1 text-xs font-semibold text-[#36D399]">
        <CheckIcon /> Entry confirmed
      </span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/50">{label}</dt>
      <dd className="font-semibold text-white">{value}</dd>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DevControls({
  current,
  onWin1000,
  onWin100,
  onLose,
  onReset,
}: {
  current: MockResult
  onWin1000: () => void
  onWin100: () => void
  onLose: () => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(true)
  const activeWin1000 = current.kind === "win" && current.amount === 1000
  const activeWin100 = current.kind === "win" && current.amount === 100
  const activeLose = current.kind === "lose"

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/70 p-2 backdrop-blur-md">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
            Prototype controls · testing only
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-[10px] font-semibold text-white/50 underline-offset-2 hover:underline"
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
        {open && (
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DevButton active={activeWin1000} onClick={onWin1000}>
              Win £1,000
            </DevButton>
            <DevButton active={activeWin100} onClick={onWin100}>
              Win £100
            </DevButton>
            <DevButton active={activeLose} onClick={onLose}>
              No instant win
            </DevButton>
            <DevButton onClick={onReset}>Reset card</DevButton>
          </div>
        )}
      </div>
    </div>
  )
}

function DevButton({
  children,
  onClick,
  active = false,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? "bg-[#FFD400] text-black"
          : "bg-white/5 text-white/80 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  )
}

function particleStyle(i: number): React.CSSProperties {
  const left = (i * 53) % 100
  const delay = (i % 9) * 0.7
  const duration = 7 + (i % 5) * 1.6
  const size = 2 + (i % 3)
  return {
    left: `${left}%`,
    width: size,
    height: size,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

const prototypeCss = `
.proto-root {
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(255, 212, 0, 0.10), transparent 60%),
    radial-gradient(900px 500px at 80% 20%, rgba(124, 92, 0, 0.18), transparent 55%),
    linear-gradient(180deg, #08080b 0%, #0c0c12 40%, #050507 100%);
}
.proto-gold-text {
  background: linear-gradient(180deg, #FFE680 0%, #FFD400 45%, #C8992F 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.proto-vignette {
  background: radial-gradient(120% 80% at 50% 30%, transparent 50%, rgba(0,0,0,0.6) 100%);
}
.proto-beam {
  position: absolute;
  top: -25%;
  width: 50%;
  height: 150%;
  filter: blur(40px);
  opacity: 0.4;
  background: linear-gradient(180deg, rgba(255, 212, 0, 0.35), transparent 70%);
  transform: rotate(18deg);
}
.proto-beam-1 { left: 5%; animation: proto-beam-sway 9s ease-in-out infinite; }
.proto-beam-2 { right: 5%; transform: rotate(-18deg); animation: proto-beam-sway 11s ease-in-out infinite reverse; }
@keyframes proto-beam-sway {
  0%, 100% { opacity: 0.25; transform: translateX(0) rotate(18deg); }
  50% { opacity: 0.5; transform: translateX(20px) rotate(14deg); }
}
.proto-particle {
  position: absolute;
  bottom: -10px;
  border-radius: 9999px;
  background: rgba(255, 224, 128, 0.7);
  box-shadow: 0 0 8px rgba(255, 212, 0, 0.6);
  animation-name: proto-float;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes proto-float {
  0% { transform: translateY(0) translateX(0); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(-105svh) translateX(20px); opacity: 0; }
}
.proto-card {
  background: linear-gradient(160deg, rgba(255,212,0,0.9), rgba(120,90,10,0.6) 40%, rgba(255,224,128,0.7));
  box-shadow:
    0 30px 60px -20px rgba(0,0,0,0.8),
    0 0 0 1px rgba(255,255,255,0.06) inset,
    0 0 40px rgba(255, 212, 0, 0.18);
}
.proto-card-frame { filter: drop-shadow(0 20px 40px rgba(0,0,0,0.6)); }
.proto-win-glow {
  border-radius: 40px;
  background: radial-gradient(circle at 50% 45%, rgba(255, 212, 0, 0.55), transparent 60%);
  filter: blur(30px);
  animation: proto-glow-pulse 2.4s ease-in-out infinite;
}
@keyframes proto-glow-pulse {
  0%, 100% { opacity: 0.5; transform: scale(0.98); }
  50% { opacity: 0.9; transform: scale(1.04); }
}
.proto-hand {
  display: inline-block;
  animation: proto-hand-move 1.4s ease-in-out infinite;
}
@keyframes proto-hand-move {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  50% { transform: translate(14px, -8px) rotate(-12deg); }
}
.proto-enter { animation: proto-fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
.proto-enter-delay { animation-delay: 0.12s; }
@keyframes proto-fade-up {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
.proto-result-in { animation: proto-fade-up 0.5s ease both; }
.proto-amount-in { animation: proto-amount-pop 0.6s cubic-bezier(0.22, 1.4, 0.36, 1) both; }
@keyframes proto-amount-pop {
  0% { opacity: 0; transform: scale(0.6); }
  60% { transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
}
.proto-pulse { animation: proto-btn-pulse 1.8s ease-in-out infinite; }
@keyframes proto-btn-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 212, 0, 0.5); }
  50% { box-shadow: 0 0 0 12px rgba(255, 212, 0, 0); }
}
.proto-cta:active { transform: scale(0.98); }
@keyframes flake-fall {
  to { transform: translate(var(--fx), var(--fy)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .proto-beam, .proto-particle, .proto-hand, .proto-enter, .proto-enter-delay,
  .proto-result-in, .proto-amount-in, .proto-pulse, .proto-win-glow {
    animation: none !important;
  }
}
`
