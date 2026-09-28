import type { Metadata } from "next"
import Link from "next/link"
import { Zap, Gift, Clock, ArrowRight, Minus, Plus } from "lucide-react"
import "./just-launched-lab.css"

export const metadata: Metadata = {
  title: "Just Launched — Visual Lab",
  robots: { index: false, follow: false },
}

/* Dev-only prototype. Nothing here is wired into production components.
   The "D — WTF Master" energy border is shown wrapped around faithful
   reproductions of the REAL PublicGiveawayCard (compact) and TicketSelector
   purchase panel, so the launch treatment can be judged against the actual
   conversion UI and its existing CTAs. */

// The travelling-energy ring layers for Concept D. Purely decorative; every
// layer is pointer-events:none so the real CTA underneath stays clickable.
function DRing() {
  return (
    <>
      <span className="jl-heatring" aria-hidden="true" />
      <span className="jl-shimmer" aria-hidden="true" />
      <span className="jl-ring" aria-hidden="true" />
      <span className="jl-halo" aria-hidden="true" />
      <span className="jl-flarehead" aria-hidden="true" />
    </>
  )
}

// Faithful reproduction of PublicGiveawayCard (compact=true, gold accent,
// category "other" -> "Enter now"). Real Tailwind classes copied from the
// production component; only the accent FRAME is replaced by the D energy ring.
function RealCard() {
  return (
    <div className="jl-realcard jl-d">
      <span className="jl-glow" aria-hidden="true" />

      <div className="jl-realcard-inner">
        {/* Artwork + overlays */}
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dev/just-launched-prize.png"
            alt="£15,000 cash prize"
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

          {/* TOP-LEFT category badge */}
          <div className="absolute left-2 top-2 z-10">
            <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#FFD700] ring-1 ring-inset ring-amber-400/40 backdrop-blur-sm">
              <Gift className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              Giveaway
            </div>
          </div>

          {/* TOP-RIGHT countdown badge */}
          <div className="absolute right-2 top-2 z-10">
            <span className="inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-sm ring-1 ring-inset ring-[#E4B11F]/80 backdrop-blur-sm">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              6d 12h
            </span>
          </div>

          {/* BOTTOM-LEFT JUST LAUNCHED chip — ties the message to the card;
              kept small so it reinforces (never outshines) the CTA. */}
          <div className="absolute bottom-2 left-2 z-10">
            <span className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-orange-500 to-red-600 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-[0_0_12px_rgba(255,90,20,0.6)]">
              <Zap className="h-3 w-3 shrink-0" fill="currentColor" aria-hidden="true" />
              Just Launched
            </span>
          </div>
        </div>

        {/* Conversion-led content */}
        <div className="flex flex-1 flex-col p-3.5">
          <h3 className="text-pretty text-[17px] font-bold leading-tight text-white line-clamp-2 md:text-lg">
            £15,000 Cash — The Big One
          </h3>

          {/* TRUE 1% sold — never inflated */}
          <div className="mt-2.5 rounded-xl bg-black/10">
            <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-amber-300">1% sold</div>
            <div className="h-[7px] w-full overflow-hidden rounded-full bg-black/70 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/10">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#FFB900_0%,#FFD94C_72%,#FFF0A6_100%)] shadow-[0_0_4px_rgba(255,238,159,0.55),0_0_10px_rgba(255,183,0,0.42)]"
                style={{ width: "1%" }}
              />
            </div>
          </div>

          {/* Action strip: dark price tile + dominant gold ENTER NOW */}
          <div className="mt-3.5 flex items-stretch gap-2.5">
            <span className="wtf-display inline-flex min-h-[56px] shrink-0 items-center rounded-2xl bg-black/50 px-4 text-lg font-black leading-none tabular-nums text-[#FFE89B] ring-1 ring-inset ring-[#DDAA19]/75 shadow-[inset_0_1px_0_rgba(255,244,196,0.09),0_0_3px_rgba(255,225,121,0.28),0_0_12px_rgba(255,165,0,0.16)]">
              79p
            </span>
            <span className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#FFE06A]/85 bg-[linear-gradient(180deg,#FFE36A_0%,#FFC52E_44%,#FFA400_100%)] px-4 text-[15px] font-black uppercase tracking-wide text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(137,70,0,0.20),0_0_4px_rgba(255,245,199,0.55),0_0_13px_rgba(255,174,0,0.46)]">
              Enter now
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </span>
          </div>

          <p className="mt-2.5 text-[11px] leading-snug text-white/45 line-clamp-1">
            Enter for your chance to win
          </p>
        </div>
      </div>

      <DRing />
    </div>
  )
}

// Faithful reproduction of the TicketSelector purchase panel with the launch
// treatment sitting immediately ABOVE the buying controls. Only the JUST
// LAUNCHED banner carries the animated border; the purchase panel stays calm
// so the gold "Enter Now" button remains the unmistakable action.
function RealTicketSelector() {
  return (
    <div className="space-y-4">
      {/* Launch banner — the animated D border frames ONLY this attention block */}
      <div className="jl-launchbox jl-d">
        <span className="jl-glow" aria-hidden="true" />
        <div className="jl-launchbox-inner jl-d-text">
          <div className="jl-d-headline">
            <span className="jl-bolt" aria-hidden="true">⚡</span>
            Just Launched
          </div>
              <div className="jl-d-sub">Be one of the first</div>
            </div>
            <DRing />
      </div>

      {/* Purchase panel — real TicketSelector desktop "Total and CTA" card */}
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-lg">
        {/* Progress (percentage only) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-amber-400">1% sold</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: "1%" }} />
          </div>
        </div>

        {/* Quantity stepper */}
        <div className="flex items-center justify-between rounded-xl bg-[#160a26] p-2">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg border border-purple-600/40 bg-[#1f1033] text-white" aria-label="Decrease quantity">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="text-center">
            <div className="text-2xl font-bold tabular-nums text-white">10</div>
            <div className="text-[11px] uppercase tracking-wider text-purple-300">tickets</div>
          </div>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg border border-purple-600/40 bg-[#1f1033] text-white" aria-label="Increase quantity">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Total */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-purple-200">Total</span>
          <div className="text-right">
            <div className="bg-gradient-to-b from-[#FFD46A] to-[#F7A600] bg-clip-text text-3xl font-bold text-transparent">£7.90</div>
            <div className="text-xs text-purple-300">10 entries</div>
          </div>
        </div>

        {/* T&Cs */}
        <label className="flex cursor-pointer select-none items-start gap-3">
          <input type="checkbox" defaultChecked className="mt-0.5 h-5 w-5 shrink-0 rounded border-purple-500/50 bg-white/10 accent-amber-500" />
          <span className="text-sm text-purple-200">
            I am 18+ years old and agree to the <span className="text-amber-400 underline underline-offset-2">T&amp;Cs</span>
          </span>
        </label>

        {/* Primary CTA — the real gold Enter Now button */}
        <button
          type="button"
          className="w-full rounded-xl bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] py-4 text-base font-bold text-black shadow-[0_10px_40px_rgba(255,180,0,0.4)] transition-all duration-300 hover:scale-[1.02]"
        >
          Enter Now
        </button>
      </div>
    </div>
  )
}

// The original abstract energy-style references (kept for comparison only).
function ConceptCard({ scope }: { scope: string }) {
  return (
    <div className={`jl-card ${scope}`} style={{ width: 280, maxWidth: "100%" }}>
      <span className="jl-glow" aria-hidden="true" />
      <span className="jl-heatring" aria-hidden="true" />
      <span className="jl-shimmer" aria-hidden="true" />
      <span className="jl-ring" aria-hidden="true" />
      <span className="jl-halo" aria-hidden="true" />
      <span className="jl-spark" aria-hidden="true" />
      <span className="jl-flarehead" aria-hidden="true" />
      <div className="jl-content">
        <div className="jl-prize">
          <div>
            <div className="jl-prize-kicker">Instant Cash</div>
            <div className="jl-prize-title">£15,000</div>
          </div>
        </div>
        <div className={scope === "jl-d" ? "jl-d-text" : ""}>
          {scope === "jl-d" ? (
            <>
              <div className="jl-d-headline"><span className="jl-bolt" aria-hidden="true">⚡</span>Just Launched</div>
              <div className="jl-d-sub">Be one of the first</div>
            </>
          ) : (
            <div className="jl-badge"><span className="jl-bolt" aria-hidden="true">⚡</span>Just Launched</div>
          )}
        </div>
        <div className="jl-progress-row">
          <span className="jl-progress-label">Be one of the first</span>
          <span className="jl-progress-pct">1% sold</span>
        </div>
        <div className="jl-track"><div className="jl-fill" /></div>
      </div>
    </div>
  )
}

export default function JustLaunchedLab() {
  return (
    <main className="jl-lab">
      <div className="jl-lab-head">
        <div className="jl-lab-eyebrow">Dev prototype · not wired into production</div>
        <h1 className="jl-lab-title">Just Launched — D · WTF Master in real UI</h1>
        <p className="jl-lab-sub">
          The energy border shown around the ACTUAL competition card and ticket-purchase panel, with their real
          CTAs. Goal: the animation attracts the eye and leads it to the gold action button — it must never
          outshine the CTA. True 1% sold everywhere; nothing is integrated.
        </p>
      </div>

      <section className="jl-real" aria-label="Realistic contexts">
        <div className="jl-real-item jl-real-desktop">
          <label>A · Desktop competition card</label>
          <RealCard />
        </div>
        <div className="jl-real-item jl-real-mobile">
          <label>B · Mobile competition card</label>
          <RealCard />
        </div>
        <div className="jl-real-item jl-real-ticket">
          <label>C · Individual giveaway — ticket selector</label>
          <RealTicketSelector />
        </div>
      </section>

      <div className="jl-divider">
        <h2>Energy style reference (not the approval view)</h2>
        <p>The original abstract A / B / C / D concepts, kept only for comparing the border motion itself.</p>
      </div>
      <section className="jl-real" aria-label="Abstract concept references">
        <div className="jl-real-item"><label>A · Electric Ignition</label><ConceptCard scope="jl-a" /></div>
        <div className="jl-real-item"><label>B · Fire Runner</label><ConceptCard scope="jl-b" /></div>
        <div className="jl-real-item"><label>C · WTF Energy Burst</label><ConceptCard scope="jl-c" /></div>
        <div className="jl-real-item"><label>D · WTF Master</label><ConceptCard scope="jl-d" /></div>
      </section>
    </main>
  )
}
