"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import Image from "next/image"

/**
 * TREASURE CHEST REVEAL — premium "open the treasure" reward moment.
 *
 * PRESENTATION ONLY. Every value shown comes directly from the `award` prop the
 * server already decided (via /api/checkout/confirm → confirmPaymentAndAward →
 * the confirm_payment_and_award RPC). This component NEVER decides win/loss,
 * NEVER picks a prize, NEVER allocates tickets, NEVER calls an API/Supabase and
 * NEVER mutates the award. The chest opening is pure theatre over an
 * already-final result.
 *
 * VISUALS: two pre-rendered cinematic scenes (closed chest / open chest, shot
 * with the chest in the SAME position) cross-fade so it reads as the chest
 * bursting open. Both are opaque scenes — no transparency required.
 *
 * PERFORMANCE / ISOLATION:
 *  - Rendered only for reveal_type === 'treasure_chest', and only ever imported
 *    lazily (next/dynamic, ssr:false) from the success page, so it adds ZERO
 *    bytes to the Normal and Scratch Card reveals.
 *  - Every animation uses transform / opacity ONLY (GPU compositable). Nothing
 *    animates layout (width/height/top/left). No canvas, WebGL, physics, video,
 *    Lottie or third-party animation library.
 *  - Fully honours prefers-reduced-motion: no camera move, no shake, opens
 *    instantly, keeps the premium look.
 *  - Assets degrade gracefully (onError) and the whole component is wrapped in a
 *    RevealErrorBoundary on the success page that falls back to the Normal
 *    reveal, so checkout success can never blank out or crash.
 */

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

type Phase = "idle" | "charging" | "bursting" | "revealed"

// Presentation-only reward colour tiers. Derived purely from the value the
// server already sent — this is styling, never prize logic.
type TierKey = "jackpot" | "emerald" | "sapphire" | "credit"

// Cosmetic timeline after the customer taps (ms from tap):
//   0            tap → charging (scene pushes in, energy builds)
//   CHARGE_MS    → bursting (flash, cross-fade to open scene, coins erupt)
//   REVEAL_MS    → revealed (reward plaque rises, celebration)
//   CTA_MS       → the Continue button fades in (never before the reveal ends)
const CHARGE_MS = 900
const REVEAL_MS = 1500
const CTA_MS = 2650

function usePrefersReducedMotion() {
  const [reduced] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  })
  return reduced
}

/**
 * Map an already-decided prize to a presentation tier + whether it earns
 * confetti. Large cash → gold jackpot (confetti); mid → emerald; small → blue;
 * site credit → purple glow (no confetti). Unknown/physical wins default to the
 * celebratory gold tier.
 */
function getPrizeTier(prize: Prize | null): { key: TierKey; confetti: boolean } {
  if (!prize) return { key: "jackpot", confetti: false }
  const text = `${prize.value_text ?? ""} ${prize.title ?? ""}`.toLowerCase()
  if (text.includes("credit")) return { key: "credit", confetti: false }
  const match = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/)
  const amount = match ? Number.parseFloat(match[1]) : 0
  if (amount >= 250) return { key: "jackpot", confetti: true }
  if (amount >= 50) return { key: "emerald", confetti: false }
  if (amount > 0) return { key: "sapphire", confetti: false }
  return { key: "jackpot", confetti: true }
}

// Deterministic pseudo-random so particle layouts are stable between renders
// (no hydration mismatch, no per-frame recompute).
function seeded(count: number, salt: number) {
  return Array.from({ length: count }, (_, i) => {
    const r = (Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453) % 1
    return Math.abs(r)
  })
}

const CONFETTI_COLORS = ["#ffd76a", "#ffb020", "#fff1c2", "#7ad0ff", "#ff8fae", "#8effc1"]

export function TreasureChestReveal({ award }: { award: RevealAward }) {
  const reducedMotion = usePrefersReducedMotion()
  const [phase, setPhase] = useState<Phase>("idle")
  const [ctaVisible, setCtaVisible] = useState(false)
  const [sceneBroken, setSceneBroken] = useState(false)
  // Purely decorative seeded particles (dust) render with random-ish inline
  // positions. Gate them behind mount so they never take part in SSR
  // hydration — this avoids a server/client float-formatting mismatch while
  // keeping the ambient effect (it simply fades in just after hydration).
  const [mounted, setMounted] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => setMounted(true), [])

  const prizes = award.prizes ?? (award.prize ? [award.prize] : [])
  const isWin = award.won && prizes.length > 0
  const primaryPrize = prizes[0] ?? null
  const tier = useMemo(() => getPrizeTier(primaryPrize), [primaryPrize])
  const headingId = "treasure-reveal-heading"

  useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout)
  }, [])

  const vibrate = useCallback(
    (pattern: number | number[]) => {
      if (reducedMotion) return
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(pattern)
        } catch {
          /* ignore unsupported */
        }
      }
    },
    [reducedMotion],
  )

  const handleOpen = useCallback(() => {
    if (phase !== "idle") return

    // Reduced motion: skip the cinematic build-up and reveal instantly.
    if (reducedMotion) {
      setPhase("revealed")
      setCtaVisible(true)
      return
    }

    vibrate(20)
    setPhase("charging")
    timersRef.current.push(
      setTimeout(() => {
        vibrate([0, 40, 30, 60])
        setPhase("bursting")
      }, CHARGE_MS),
      setTimeout(() => setPhase("revealed"), REVEAL_MS),
      setTimeout(() => setCtaVisible(true), CTA_MS),
    )
  }, [phase, reducedMotion, vibrate])

  const start = award.ticket_start
  const end = award.ticket_end
  const hasTickets = typeof start === "number" && typeof end === "number"
  const ticketLabel = hasTickets ? (start === end ? `#${start}` : `#${start}\u2013#${end}`) : null

  const chestOpen = phase === "bursting" || phase === "revealed"
  const revealed = phase === "revealed"

  const dust = useMemo(() => seeded(16, 1), [])
  const coins = useMemo(() => seeded(18, 2), [])
  const sparks = useMemo(() => seeded(14, 3), [])
  const confetti = useMemo(() => seeded(34, 5), [])

  const showConfetti = revealed && isWin && tier.confetti && !reducedMotion

  return (
    <main
      aria-labelledby={headingId}
      // Neutral gold until revealed so the aura colour never hints the outcome
      // before the customer opens the chest.
      data-tier={revealed ? tier.key : "idle"}
      data-phase={phase}
      className="tcr-root relative flex min-h-[100dvh] w-full flex-col items-center justify-between overflow-hidden px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]"
    >
      <style>{treasureRevealCss}</style>

      {/* Confetti (large wins only) — CSS particles, transform/opacity only */}
      {showConfetti && (
        <div aria-hidden="true" className="tcr-confetti pointer-events-none fixed inset-0 z-50">
          {confetti.map((r, i) => (
            <span
              key={`cf-${i}`}
              className="tcr-cf-piece"
              style={
                {
                  left: `${(r * 100).toFixed(2)}%`,
                  background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  "--d": `${(r * 0.9).toFixed(2)}s`,
                  "--x": `${((confetti[(i + 3) % confetti.length] ?? 0.5) * 60 - 30).toFixed(1)}px`,
                  "--r": `${(r * 720 - 360).toFixed(0)}deg`,
                  "--dur": `${(2.2 + r * 1.2).toFixed(2)}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      {/* ---- Header ---- */}
      <header className="relative z-20 flex flex-shrink-0 flex-col items-center text-center">
        <span className="tcr-eyebrow inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-black/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200 backdrop-blur-sm">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Tickets confirmed
        </span>
        <h1
          id={headingId}
          className="tcr-title mt-3 text-balance text-2xl font-black uppercase leading-tight tracking-[0.03em] sm:text-3xl"
        >
          {revealed ? (isWin ? "Jackpot unlocked" : "Into the draw") : "Your treasure has arrived"}
        </h1>
        <p className="tcr-sub mt-1 text-pretty text-sm font-medium text-amber-100/80">
          {revealed
            ? isWin
              ? "Your prize is confirmed and saved to your account"
              : "Your tickets are locked into the main draw"
            : "Tap the chest to reveal your prize"}
        </p>
      </header>

      {/* ---- Chest stage ---- */}
      <div className="relative z-10 flex w-full flex-1 items-center justify-center py-4">
        <button
          type="button"
          onClick={handleOpen}
          disabled={phase !== "idle"}
          aria-label={revealed ? "Treasure chest opened" : "Tap to open your treasure chest"}
          className="tcr-stage-btn group relative block w-full max-w-[420px] outline-none disabled:cursor-default"
        >
          <div className="tcr-stage relative mx-auto aspect-[4/5] w-full overflow-hidden rounded-[1.75rem]">
            {sceneBroken ? (
              // Graceful CSS fallback if the artwork fails to load.
              <div className="tcr-scene-fallback absolute inset-0" aria-hidden="true">
                <span className="tcr-fallback-chest" />
              </div>
            ) : (
              <>
                {/* Closed scene (idle) */}
                <Image
                  src="/reveal/treasure-scene-closed.png"
                  alt=""
                  aria-hidden="true"
                  fill
                  priority
                  sizes="(max-width: 480px) 92vw, 420px"
                  className={`tcr-scene object-cover ${chestOpen ? "tcr-scene-hidden" : "tcr-scene-visible"}`}
                  onError={() => setSceneBroken(true)}
                />
                {/* Open scene (revealed) */}
                <Image
                  src="/reveal/treasure-scene-open.png"
                  alt="Open treasure chest overflowing with gold"
                  fill
                  sizes="(max-width: 480px) 92vw, 420px"
                  className={`tcr-scene object-cover ${chestOpen ? "tcr-scene-visible" : "tcr-scene-hidden"}`}
                />
              </>
            )}

            {/* Inner camera push toward the chest while charging/open */}
            <div className="tcr-cam absolute inset-0" data-phase={phase} />

            {/* Glow pulsing over the chest lock (idle + charge) */}
            {!chestOpen && <span aria-hidden="true" className="tcr-lockglow" />}

            {/* Light rays bursting upward on open */}
            {chestOpen && <span aria-hidden="true" className="tcr-burst-rays" />}

            {/* White flash masking the closed→open swap */}
            {phase === "bursting" && <span aria-hidden="true" className="tcr-flash" />}

            {/* Coins + sparks erupting from the chest mouth */}
            {chestOpen && !reducedMotion && (
              <div aria-hidden="true" className="tcr-particles">
                {coins.map((r, i) => (
                  <span
                    key={`coin-${i}`}
                    className="tcr-coin"
                    style={
                      {
                        "--tx": `${(r * 300 - 150).toFixed(0)}px`,
                        "--ty": `${(-120 - r * 170).toFixed(0)}px`,
                        "--r": `${(r * 720 - 360).toFixed(0)}deg`,
                        "--d": `${(r * 0.2).toFixed(2)}s`,
                      } as CSSProperties
                    }
                  />
                ))}
                {sparks.map((r, i) => (
                  <span
                    key={`spark-${i}`}
                    className="tcr-spark"
                    style={
                      {
                        "--tx": `${(r * 340 - 170).toFixed(0)}px`,
                        "--ty": `${(-90 - r * 200).toFixed(0)}px`,
                        "--d": `${(r * 0.22).toFixed(2)}s`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            )}

            {/* Floating dust motes (idle ambience) */}
            {mounted && !reducedMotion && phase === "idle" && (
              <div aria-hidden="true" className="tcr-dust-layer absolute inset-0">
                {dust.map((r, i) => (
                  <span
                    key={`dust-${i}`}
                    className="tcr-dust"
                    style={
                      {
                        left: `${6 + r * 88}%`,
                        bottom: `${(dust[(i + 5) % dust.length] ?? 0.5) * 70}%`,
                        "--d": `${(r * 6).toFixed(2)}s`,
                        "--dur": `${(7 + r * 6).toFixed(2)}s`,
                        "--sc": (0.5 + r).toFixed(2),
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            )}

            {/* Inner ring + vignette to frame the stage */}
            <span aria-hidden="true" className="tcr-stage-ring" />
          </div>

          {/* Tap hint (idle only) */}
          {phase === "idle" && (
            <span className="tcr-hint pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-amber-100 backdrop-blur-sm">
              Tap to open
            </span>
          )}
        </button>
      </div>

      {/* ---- Reward plaque + actions (only once revealed) ---- */}
      <section
        className="relative z-20 flex w-full max-w-[420px] flex-shrink-0 flex-col items-center"
        aria-live="polite"
      >
        {revealed ? (
          isWin ? (
            <div className="tcr-plaque-rise flex w-full flex-col items-center">
              <div className="tcr-plaque" data-tier={tier.key}>
                <span className="tcr-plaque-eyebrow">
                  {prizes.length > 1 ? `You won ${prizes.length} prizes` : "You've won"}
                </span>

                {primaryPrize?.image_url ? (
                  <span className="tcr-plaque-img">
                    <Image
                      src={primaryPrize.image_url || "/placeholder.svg"}
                      alt={primaryPrize.title}
                      width={72}
                      height={72}
                      className="h-full w-full object-cover"
                      crossOrigin="anonymous"
                    />
                  </span>
                ) : null}

                <span className="tcr-plaque-value">{primaryPrize?.value_text || primaryPrize?.title}</span>
                {primaryPrize?.value_text ? (
                  <span className="tcr-plaque-title">{primaryPrize?.title}</span>
                ) : null}
              </div>

              {prizes.length > 1 && (
                <ul className="mt-3 w-full space-y-2">
                  {prizes.slice(1).map((p, i) => (
                    <li
                      key={p.award_id ?? `${p.title}-${i}`}
                      className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-black/40 px-3 py-2 text-left backdrop-blur-sm"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-black text-black">
                        {i + 2}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-amber-50">{p.title}</span>
                        {p.value_text ? <span className="block text-xs text-amber-200/70">{p.value_text}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="tcr-plaque-rise flex w-full flex-col items-center">
              <div className="tcr-plaque" data-tier="credit">
                <span className="tcr-plaque-eyebrow">No instant win this time</span>
                <span className="tcr-plaque-value tcr-plaque-value--sm">You&apos;re in the draw</span>
                <span className="tcr-plaque-title">Good luck in the main event</span>
              </div>
            </div>
          )
        ) : (
          <div className="h-[132px]" aria-hidden="true" />
        )}

        {/* Ticket numbers (from the fixed award) */}
        {revealed && ticketLabel && (
          <div className="tcr-tickets mt-3 w-full rounded-xl border border-amber-300/20 bg-black/40 px-4 py-2.5 text-center backdrop-blur-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/70">
              {start === end ? "Your ticket number" : "Your ticket numbers"}
            </p>
            <p className="font-mono text-base font-bold text-amber-50">{ticketLabel}</p>
          </div>
        )}

        {/* CTA — appears only after the reveal animation completes */}
        <div className={`tcr-cta mt-4 w-full ${ctaVisible ? "tcr-cta-in" : "tcr-cta-hidden"}`}>
          <Link
            href={award.campaign_slug ? `/giveaways/${award.campaign_slug}` : "/giveaways"}
            className="tcr-btn-primary flex w-full items-center justify-center rounded-2xl py-4 text-center text-base font-extrabold uppercase tracking-wide text-black transition-transform active:scale-[0.98]"
            tabIndex={ctaVisible ? 0 : -1}
          >
            {award.campaign_slug ? "Play again" : "Browse competitions"}
          </Link>
          <Link
            href="/me"
            className="mt-2 flex w-full items-center justify-center rounded-2xl border border-amber-200/25 py-3 text-center text-sm font-semibold text-amber-100 transition-colors hover:bg-white/5"
            tabIndex={ctaVisible ? 0 : -1}
          >
            View my account
          </Link>
        </div>
      </section>
    </main>
  )
}

/**
 * All animation is transform/opacity only. Layout properties are never
 * animated, so every keyframe runs on the compositor. Colours are driven by
 * data-tier on the root and the plaque.
 */
const treasureRevealCss = `
.tcr-root {
  background:
    radial-gradient(120% 80% at 50% 12%, rgba(60,42,16,0.65), transparent 60%),
    radial-gradient(140% 90% at 50% 108%, rgba(120,84,26,0.5), transparent 55%),
    linear-gradient(180deg, #120c06 0%, #0b0805 55%, #060403 100%);
  color: #fff;
  isolation: isolate;
}

/* ---------------- Stage ---------------- */
.tcr-stage {
  background: radial-gradient(60% 50% at 50% 60%, #1a120a, #0a0705);
  box-shadow:
    0 30px 80px -30px rgba(0,0,0,0.9),
    inset 0 0 0 1px rgba(255,214,120,0.14);
  transform: translateZ(0);
}
.tcr-stage-ring {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 0 60px 10px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,220,140,0.18);
}
.tcr-scene {
  transition: opacity 620ms ease;
  will-change: opacity;
}
.tcr-scene-visible { opacity: 1; }
.tcr-scene-hidden { opacity: 0; }

/* Camera push — scales the stage image group toward the chest. Applied via a
   sibling overlay transform on the parent using scale on the images' wrapper.
   We scale the whole stage subtly instead of layout changes. */
.tcr-stage-btn { -webkit-tap-highlight-color: transparent; }
.tcr-stage { transition: transform 700ms cubic-bezier(0.22,1,0.36,1); transform-origin: 50% 62%; }
.tcr-root[data-phase="idle"] .tcr-stage { animation: tcr-breathe 6s ease-in-out infinite; }
.tcr-root[data-phase="charging"] .tcr-stage { transform: scale(1.08); animation: tcr-shake 0.9s ease-in-out; }
.tcr-root[data-phase="bursting"] .tcr-stage { transform: scale(1.12); }
.tcr-root[data-phase="revealed"] .tcr-stage { transform: scale(1.05); }
.tcr-stage-btn:not(:disabled):hover .tcr-stage { transform: scale(1.03); }
.tcr-stage-btn:focus-visible .tcr-stage { box-shadow: 0 0 0 4px rgba(255,214,120,0.6), 0 30px 80px -30px rgba(0,0,0,0.9); }

@keyframes tcr-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
@keyframes tcr-shake {
  0%, 100% { transform: scale(1.08) translateX(0); }
  20% { transform: scale(1.08) translateX(-5px) rotate(-0.5deg); }
  40% { transform: scale(1.08) translateX(5px) rotate(0.5deg); }
  60% { transform: scale(1.08) translateX(-4px) rotate(-0.4deg); }
  80% { transform: scale(1.08) translateX(4px) rotate(0.4deg); }
}

/* Lock glow over the chest keyhole (~50% / 62%) */
.tcr-lockglow {
  position: absolute; left: 50%; top: 62%; width: 26%; height: 26%;
  transform: translate(-50%, -50%);
  border-radius: 999px; pointer-events: none;
  background: radial-gradient(circle, rgba(255,214,120,0.55), rgba(255,180,60,0.18) 45%, transparent 70%);
  mix-blend-mode: screen;
  animation: tcr-lockpulse 1.9s ease-in-out infinite;
}
.tcr-root[data-phase="charging"] .tcr-lockglow { animation: tcr-lockpulse 0.28s ease-in-out infinite; }
@keyframes tcr-lockpulse {
  0%, 100% { opacity: 0.5; transform: translate(-50%,-50%) scale(0.9); }
  50% { opacity: 1; transform: translate(-50%,-50%) scale(1.12); }
}

/* Burst rays fanning up out of the open chest */
.tcr-burst-rays {
  position: absolute; left: 50%; top: 60%; width: 220%; height: 220%;
  transform: translate(-50%, -50%);
  pointer-events: none; mix-blend-mode: screen;
  background: conic-gradient(from 0deg at 50% 50%,
    rgba(255,225,150,0) 0deg, rgba(255,225,150,0.5) 6deg, rgba(255,225,150,0) 12deg,
    rgba(255,225,150,0) 30deg, rgba(255,225,150,0.4) 36deg, rgba(255,225,150,0) 42deg,
    rgba(255,225,150,0) 66deg, rgba(255,225,150,0.5) 72deg, rgba(255,225,150,0) 78deg,
    rgba(255,225,150,0) 96deg, rgba(255,225,150,0.35) 102deg, rgba(255,225,150,0) 108deg,
    rgba(255,225,150,0) 300deg, rgba(255,225,150,0.4) 306deg, rgba(255,225,150,0) 312deg,
    rgba(255,225,150,0) 336deg, rgba(255,225,150,0.5) 342deg, rgba(255,225,150,0) 348deg);
  -webkit-mask-image: radial-gradient(circle, #000 0%, #000 30%, transparent 66%);
  mask-image: radial-gradient(circle, #000 0%, #000 30%, transparent 66%);
  opacity: 0; animation: tcr-rays-in 700ms ease-out forwards, tcr-rays-spin 24s linear infinite;
}
@keyframes tcr-rays-in { to { opacity: 0.9; } }
@keyframes tcr-rays-spin { to { transform: translate(-50%,-50%) rotate(360deg); } }

/* White flash */
.tcr-flash {
  position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(circle at 50% 60%, #fff, rgba(255,240,200,0.6) 40%, transparent 72%);
  opacity: 0; animation: tcr-flash 620ms ease-out forwards;
}
@keyframes tcr-flash { 0% { opacity: 0; } 22% { opacity: 1; } 100% { opacity: 0; } }

/* Coins + sparks erupt from ~50%/60% */
.tcr-particles { position: absolute; left: 50%; top: 60%; width: 0; height: 0; pointer-events: none; }
.tcr-coin, .tcr-spark { position: absolute; left: 0; top: 0; border-radius: 999px; opacity: 0; }
.tcr-coin {
  width: 16px; height: 16px; margin: -8px;
  background: radial-gradient(circle at 35% 30%, #fff3c4, #f2c14e 45%, #b9791d 100%);
  box-shadow: 0 0 6px rgba(255,200,90,0.7);
  animation: tcr-coin-fly 1.5s cubic-bezier(0.18,0.7,0.3,1) forwards;
  animation-delay: var(--d);
}
.tcr-spark {
  width: 6px; height: 6px; margin: -3px; background: #fff6d8;
  box-shadow: 0 0 8px rgba(255,235,170,0.95);
  animation: tcr-spark-fly 1.2s ease-out forwards; animation-delay: var(--d);
}
@keyframes tcr-coin-fly {
  0% { opacity: 0; transform: translate(0,0) scale(0.4) rotate(0deg); }
  15% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--tx), calc(var(--ty) * -0.2)) scale(1) rotate(var(--r)); }
}
@keyframes tcr-spark-fly {
  0% { opacity: 0; transform: translate(0,0) scale(0.5); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(1); }
}

/* Idle dust */
.tcr-dust {
  position: absolute; width: 4px; height: 4px; border-radius: 999px;
  background: radial-gradient(circle, rgba(255,236,190,0.9), rgba(255,236,190,0) 70%);
  opacity: 0; transform: scale(var(--sc, 1));
  animation: tcr-dust-float var(--dur, 9s) ease-in-out var(--d, 0s) infinite;
}
@keyframes tcr-dust-float {
  0% { opacity: 0; transform: translateY(0) scale(var(--sc,1)); }
  20% { opacity: 0.8; }
  80% { opacity: 0.5; }
  100% { opacity: 0; transform: translateY(-38px) scale(var(--sc,1)); }
}

/* ---------------- Headline ---------------- */
.tcr-title { color: #ffe6a3; text-shadow: 0 2px 24px rgba(255,180,60,0.45); }
.tcr-title, .tcr-sub, .tcr-eyebrow { animation: tcr-soft-in 0.5s ease-out both; }
.tcr-sub { animation-delay: 0.08s; }
@keyframes tcr-soft-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

/* ---------------- Reward plaque ---------------- */
.tcr-plaque-rise { animation: tcr-rise 0.6s cubic-bezier(0.18,0.9,0.3,1.2) both; }
@keyframes tcr-rise { from { opacity: 0; transform: translateY(26px) scale(0.94); } to { opacity: 1; transform: translateY(0) scale(1); } }

.tcr-plaque {
  --a: #f2c14e; --b: #b9791d;
  position: relative; width: 100%;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 18px 20px; border-radius: 20px; text-align: center;
  background: linear-gradient(180deg, rgba(28,20,10,0.92), rgba(14,10,6,0.92));
  border: 1px solid color-mix(in srgb, var(--a) 55%, transparent);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 20px 50px -22px color-mix(in srgb, var(--a) 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.08);
}
.tcr-plaque[data-tier="jackpot"] { --a: #ffd257; --b: #d98a1f; }
.tcr-plaque[data-tier="emerald"] { --a: #4fd39a; --b: #1f8a5c; }
.tcr-plaque[data-tier="sapphire"] { --a: #5cc1ff; --b: #1f6fbf; }
.tcr-plaque[data-tier="credit"] { --a: #c9a2ff; --b: #7a4fd9; }
.tcr-plaque-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: color-mix(in srgb, var(--a) 85%, #fff); }
.tcr-plaque-img { width: 72px; height: 72px; overflow: hidden; border-radius: 14px; margin: 6px 0; border: 1px solid color-mix(in srgb, var(--a) 50%, transparent); }
.tcr-plaque-value {
  font-size: clamp(24px, 7vw, 34px); font-weight: 900; line-height: 1.05; text-transform: uppercase; letter-spacing: 0.01em;
  color: #fff; text-shadow: 0 2px 20px color-mix(in srgb, var(--a) 60%, transparent);
}
.tcr-plaque-value--sm { font-size: clamp(20px, 6vw, 26px); }
.tcr-plaque-title { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.72); }

.tcr-tickets { animation: tcr-soft-in 0.5s ease-out 0.15s both; }

/* ---------------- CTA ---------------- */
.tcr-btn-primary {
  background: linear-gradient(180deg, #ffd257, #e79a1e);
  box-shadow: 0 12px 30px -12px rgba(231,154,30,0.8), inset 0 1px 0 rgba(255,255,255,0.5);
}
.tcr-cta { transition: opacity 0.5s ease, transform 0.5s ease; }
.tcr-cta-hidden { opacity: 0; transform: translateY(10px); pointer-events: none; }
.tcr-cta-in { opacity: 1; transform: translateY(0); }

/* ---------------- Confetti ---------------- */
.tcr-cf-piece {
  position: absolute; top: -6vh; width: 9px; height: 14px; border-radius: 2px; opacity: 0;
  animation: tcr-cf-fall var(--dur, 2.6s) linear var(--d, 0s) forwards;
}
@keyframes tcr-cf-fall {
  0% { opacity: 0; transform: translateY(0) translateX(0) rotate(0deg); }
  10% { opacity: 1; }
  100% { opacity: 0; transform: translateY(112vh) translateX(var(--x, 0)) rotate(var(--r, 360deg)); }
}

/* ---------------- Fallback chest (art failed) ---------------- */
.tcr-scene-fallback { background: radial-gradient(60% 50% at 50% 55%, #241708, #0b0705); display: grid; place-items: center; }
.tcr-fallback-chest {
  width: 44%; height: 32%; border-radius: 12px 12px 8px 8px;
  background: linear-gradient(180deg, #6b4a22, #3c2a13);
  box-shadow: inset 0 0 0 4px #caa24a, 0 0 50px rgba(255,190,80,0.35);
}

/* ---------------- Reduced motion ---------------- */
@media (prefers-reduced-motion: reduce) {
  .tcr-stage, .tcr-scene, .tcr-plaque-rise, .tcr-title, .tcr-sub, .tcr-eyebrow,
  .tcr-cta, .tcr-tickets, .tcr-lockglow, .tcr-burst-rays, .tcr-flash {
    animation: none !important;
    transition: none !important;
  }
  .tcr-root[data-phase] .tcr-stage { transform: none !important; }
  .tcr-cta-hidden { opacity: 1; transform: none; pointer-events: auto; }
}
`
