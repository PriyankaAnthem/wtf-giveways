"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ScratchCard, type ScratchCardHandle } from "./ScratchCard"
import { Confetti } from "./Confetti"

type Prize = {
  award_id?: string | null
  title: string
  value_text?: string | null
  image_url?: string | null
}

type RevealAward = {
  confirmed: boolean
  checkout_ref: string
  qty: number
  won: boolean
  prize: Prize | null
  prizes?: Prize[]
  ticket_start?: number | null
  ticket_end?: number | null
  campaign_slug?: string | null
}

function usePrefersReducedMotion() {
  const [reduced] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  })
  return reduced
}

/**
 * Production scratch-card reveal. It is PRESENTATION ONLY: every value shown
 * comes directly from the `award` prop that the server already decided. It
 * never decides win/loss, never picks a prize, never calls an API or Supabase,
 * and never mutates the award.
 */
export function ScratchCardReveal({ award }: { award: RevealAward }) {
  const reducedMotion = usePrefersReducedMotion()
  const [revealed, setRevealed] = useState(false)
  const [confettiKey, setConfettiKey] = useState(0)
  const cardRef = useRef<ScratchCardHandle>(null)

  // Derive the prize list straight from the fixed award (no generation).
  const prizes = award.prizes ?? (award.prize ? [award.prize] : [])
  const isWin = award.won && prizes.length > 0
  const primaryPrize = prizes[0] ?? null

  const headingId = useMemo(() => "scratch-reveal-heading", [])

  const handleComplete = () => {
    if (revealed) return
    setRevealed(true)
    if (isWin && !reducedMotion) {
      setConfettiKey((k) => k + 1)
    }
  }

  const start = award.ticket_start
  const end = award.ticket_end
  const hasTickets = typeof start === "number" && typeof end === "number"
  const ticketLabel = hasTickets
    ? start === end
      ? `#${start}`
      : `#${start}\u2013#${end}`
    : null

  return (
    <div aria-labelledby={headingId} className="scr-root flex w-full flex-col items-center">
      <style>{scratchRevealCss}</style>

      <Confetti fireKey={confettiKey} disabled={reducedMotion} />

      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Your tickets are confirmed
        </div>
        <h2 id={headingId} className="mt-3 text-balance text-2xl font-black leading-tight tracking-tight text-foreground">
          Scratch to reveal
        </h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Your instant-win result is hidden below
        </p>
      </div>

      {/* Scratch card */}
      <div className="scr-card-frame relative mx-auto mt-6 aspect-[3/4] w-full max-w-[300px]">
        {revealed && isWin && <div aria-hidden="true" className="scr-win-glow absolute inset-0" />}

        <div className="scr-card relative h-full w-full rounded-[30px] p-[2px]">
          <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-[#0b0b0f]">
            <ScratchCard
              ref={cardRef}
              revealed={revealed}
              onComplete={handleComplete}
              foil={isWin ? "gold" : "silver"}
              threshold={0.6}
              disabled={reducedMotion}
            >
              {isWin ? (
                <WinContent prize={primaryPrize} extraCount={prizes.length - 1} animate={!reducedMotion} />
              ) : (
                <LoseContent />
              )}
            </ScratchCard>

            {/* Foil face copy (before reveal only) */}
            {!revealed && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                <span className="rounded-full bg-black/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-black/70">
                  Instant Win
                </span>
                <span className="mt-1 text-2xl font-black uppercase tracking-tight text-black/80 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]">
                  Scratch here
                </span>
                <span className="text-xs font-medium text-black/55">Use your finger or mouse</span>
                {!reducedMotion && (
                  <span className="scr-hand mt-3 text-3xl" aria-hidden="true">
                    {"\u{1F446}"}
                  </span>
                )}
              </div>
            )}

            {/* Reduced-motion: explicit reveal button (no scratching required) */}
            {reducedMotion && !revealed && (
              <button
                type="button"
                onClick={handleComplete}
                className="absolute inset-x-6 bottom-6 z-20 rounded-xl bg-amber-400 py-3 text-sm font-bold text-black"
              >
                Reveal result
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Full prize list — shown after the scratch is complete when more than
          one prize was won. The scratch card itself keeps the first prize as
          the primary visual; this accessible list guarantees every prize is
          shown and never collapsed into a single line. */}
      {revealed && isWin && prizes.length > 1 && (
        <div className="mt-6 w-full max-w-[300px]">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-[0.2em] text-amber-500">
            You won {prizes.length} prizes
          </p>
          <ul className="space-y-2">
            {prizes.map((p, i) => (
              <li
                key={p.award_id ?? `${p.title}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2 text-left"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-black text-black">
                  {i + 1}
                </span>
                {p.image_url ? (
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-amber-300/50">
                    <Image
                      src={p.image_url || "/placeholder.svg"}
                      alt={p.title}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                      crossOrigin="anonymous"
                    />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{p.title}</span>
                  {p.value_text ? (
                    <span className="block text-xs text-muted-foreground">{p.value_text}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ticket numbers (from the fixed award) */}
      {ticketLabel && (
        <div className="mt-6 w-full max-w-[300px] rounded-lg border border-border bg-muted/50 px-4 py-3 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {start === end ? "Your Ticket Number" : "Your Ticket Numbers"}
          </p>
          <p className="font-mono text-lg font-bold text-foreground">{ticketLabel}</p>
        </div>
      )}

      {/* Buy more tickets — same behaviour as the normal reveal, shown once revealed */}
      {award.campaign_slug && revealed && (
        <Link
          href={`/giveaways/${award.campaign_slug}`}
          className={`mt-6 inline-flex w-full max-w-[300px] items-center justify-center rounded-2xl bg-amber-400 py-4 text-center text-base font-extrabold text-black transition-transform active:scale-[0.98] ${
            reducedMotion ? "" : "scr-pulse"
          }`}
        >
          Buy More Tickets
        </Link>
      )}
    </div>
  )
}

function WinContent({
  prize,
  extraCount,
  animate,
}: {
  prize: Prize | null
  extraCount: number
  animate: boolean
}) {
  if (!prize) return null
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-5 text-center">
      <span className="text-xs font-bold uppercase tracking-[0.35em] text-amber-200">You&apos;ve won</span>

      {prize.image_url ? (
        <span className="my-2 block h-20 w-20 overflow-hidden rounded-xl ring-2 ring-amber-300/60">
          <Image
            src={prize.image_url || "/placeholder.svg"}
            alt={prize.title}
            width={80}
            height={80}
            className="h-full w-full object-cover"
            crossOrigin="anonymous"
          />
        </span>
      ) : null}

      <span
        className={`${animate ? "scr-amount-in" : ""} my-1 text-3xl font-black leading-tight text-white`}
      >
        {prize.value_text || prize.title}
      </span>
      {prize.value_text && (
        <span className="text-sm font-bold uppercase tracking-[0.25em] text-amber-400">{prize.title}</span>
      )}
      {extraCount > 0 && (
        <span className="mt-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-amber-100">
          +{extraCount} more prize{extraCount > 1 ? "s" : ""}
        </span>
      )}
    </div>
  )
}

function LoseContent() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-7 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl">
        {"\u{1F3AB}"}
      </span>
      <span className="text-lg font-extrabold text-white">No instant win this time</span>
      <span className="text-sm text-white/65">Your tickets are still entered into the final draw</span>
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
        <CheckIcon /> Entry confirmed
      </span>
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

const scratchRevealCss = `
.scr-card {
  background: linear-gradient(160deg, rgba(255,212,0,0.9), rgba(120,90,10,0.6) 40%, rgba(255,224,128,0.7));
  box-shadow:
    0 30px 60px -20px rgba(0,0,0,0.55),
    0 0 0 1px rgba(255,255,255,0.06) inset,
    0 0 40px rgba(255, 212, 0, 0.18);
}
.scr-card-frame { filter: drop-shadow(0 20px 40px rgba(0,0,0,0.35)); }
.scr-win-glow {
  border-radius: 40px;
  background: radial-gradient(circle at 50% 45%, rgba(255, 212, 0, 0.55), transparent 60%);
  filter: blur(30px);
  animation: scr-glow-pulse 2.4s ease-in-out infinite;
}
@keyframes scr-glow-pulse {
  0%, 100% { opacity: 0.5; transform: scale(0.98); }
  50% { opacity: 0.9; transform: scale(1.04); }
}
.scr-hand {
  display: inline-block;
  animation: scr-hand-move 1.4s ease-in-out infinite;
}
@keyframes scr-hand-move {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  50% { transform: translate(14px, -8px) rotate(-12deg); }
}
.scr-amount-in { animation: scr-amount-pop 0.6s cubic-bezier(0.22, 1.4, 0.36, 1) both; }
@keyframes scr-amount-pop {
  0% { opacity: 0; transform: scale(0.6); }
  60% { transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
}
.scr-pulse { animation: scr-btn-pulse 1.8s ease-in-out infinite; }
@keyframes scr-btn-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 212, 0, 0.5); }
  50% { box-shadow: 0 0 0 12px rgba(255, 212, 0, 0); }
}
@keyframes flake-fall {
  to { transform: translate(var(--fx), var(--fy)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .scr-hand, .scr-amount-in, .scr-pulse, .scr-win-glow {
    animation: none !important;
  }
}
`
