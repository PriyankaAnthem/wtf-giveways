import type { Metadata } from "next"
import {
  CheckCircle2,
  Ticket,
  ScanLine,
  Sparkles,
  Trophy,
  Gift,
  Zap,
  PoundSterling,
} from "lucide-react"

export const metadata: Metadata = {
  title: "Preview · Instant Win Vault Animation",
  description: "Static design preview of the post-checkout Cash Reactor / Instant Win Vault states.",
}

/**
 * STATIC DESIGN PREVIEW ONLY.
 * This route renders non-functional mockups of the post-checkout
 * instant win animation states for visual approval.
 * It does NOT touch checkout, API, Supabase, RPC, webhook, or payment logic.
 */
export default function InstantWinPreviewPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      {/* Page heading */}
      <header className="mx-auto max-w-2xl px-4 pt-10 pb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-500">Design Preview</p>
        <h1 className="mt-2 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Cash Reactor / Instant Win Vault
        </h1>
        <p className="mt-3 text-pretty text-sm text-white/50">
          Static mockups of each post-checkout state. No functionality, no logic changes.
        </p>
      </header>

      <div className="mx-auto flex max-w-md flex-col gap-10 px-4 pb-24">
        <PreviewFrame label="1 · Payment Confirmed">
          <PaymentConfirmedState />
        </PreviewFrame>

        <PreviewFrame label="2 · Tickets Locked In">
          <TicketsLockedState />
        </PreviewFrame>

        <PreviewFrame label="3 · Checking Instant Wins">
          <CheckingWinsState />
        </PreviewFrame>

        <PreviewFrame label="4 · Final Instant Win Check">
          <FinalCheckState />
        </PreviewFrame>

        <PreviewFrame label="5 · Winner Reveal">
          <WinnerRevealState />
        </PreviewFrame>

        <PreviewFrame label="6 · Not-Won Reveal">
          <NotWonRevealState />
        </PreviewFrame>
      </div>
    </main>
  )
}

/* ---------------------------------------------------------------- */
/* Layout helper: a phone-shaped frame around each state            */
/* ---------------------------------------------------------------- */
function PreviewFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">{label}</h2>
      </div>
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
        {children}
      </div>
    </section>
  )
}

/* Shared background: dark vault with red glow + subtle grid */
function VaultBackdrop({ tone = "red" }: { tone?: "red" | "gold" | "green" }) {
  const glow =
    tone === "gold"
      ? "bg-[radial-gradient(circle_at_50%_30%,rgba(245,158,11,0.28),transparent_60%)]"
      : tone === "green"
        ? "bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.22),transparent_60%)]"
        : "bg-[radial-gradient(circle_at_50%_30%,rgba(239,68,68,0.28),transparent_60%)]"
  return (
    <>
      <div className={`pointer-events-none absolute inset-0 ${glow}`} aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
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

/* Floating spark/cash particle layer (static positions for the mockup) */
function Particles({ tone = "gold" }: { tone?: "gold" | "red" | "green" }) {
  const color = tone === "red" ? "text-red-400" : tone === "green" ? "text-emerald-400" : "text-amber-300"
  const dots = [
    { left: "10%", top: "18%", size: "h-2 w-2", o: "opacity-70" },
    { left: "82%", top: "22%", size: "h-1.5 w-1.5", o: "opacity-60" },
    { left: "24%", top: "70%", size: "h-1 w-1", o: "opacity-50" },
    { left: "70%", top: "66%", size: "h-2.5 w-2.5", o: "opacity-80" },
    { left: "50%", top: "12%", size: "h-1 w-1", o: "opacity-40" },
    { left: "88%", top: "52%", size: "h-1.5 w-1.5", o: "opacity-60" },
  ]
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {dots.map((d, i) => (
        <span
          key={i}
          className={`absolute rounded-full bg-current ${color} ${d.size} ${d.o} blur-[0.5px]`}
          style={{ left: d.left, top: d.top }}
        />
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* STATE 1 — Payment Confirmed                                       */
/* ---------------------------------------------------------------- */
function PaymentConfirmedState() {
  return (
    <div className="relative flex min-h-[460px] flex-col items-center justify-center px-6 py-12 text-center">
      <VaultBackdrop tone="green" />
      <div className="relative">
        <div className="absolute inset-0 -m-4 rounded-full bg-emerald-500/20 blur-2xl" aria-hidden="true" />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.45)]">
          <CheckCircle2 className="h-12 w-12 text-emerald-400" aria-hidden="true" />
        </div>
      </div>
      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
        Payment Confirmed
      </p>
      <h3 className="relative mt-2 text-3xl font-extrabold tracking-tight text-white">You&apos;re In!</h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm leading-relaxed text-white/60">
        Your payment went through. Hold tight while we load your tickets into the vault.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* STATE 2 — Tickets Locked In                                       */
/* ---------------------------------------------------------------- */
function TicketsLockedState() {
  const tickets = ["04821", "04822", "04823", "04824", "04825"]
  return (
    <div className="relative flex min-h-[460px] flex-col items-center justify-center px-6 py-12 text-center">
      <VaultBackdrop tone="red" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-red-500/50 bg-red-500/10 shadow-[0_0_36px_rgba(239,68,68,0.4)]">
        <Ticket className="h-10 w-10 text-red-400" aria-hidden="true" />
      </div>
      <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-red-500">
        Tickets Locked In
      </p>
      <h3 className="relative mt-2 text-2xl font-extrabold tracking-tight text-white">5 Tickets Secured</h3>

      {/* Ticket cards */}
      <div className="relative mt-6 flex w-full flex-wrap items-center justify-center gap-2">
        {tickets.map((t) => (
          <div
            key={t}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-gradient-to-b from-amber-400/15 to-amber-500/5 px-3 py-2 shadow-[0_0_14px_rgba(245,158,11,0.25)]"
          >
            <Ticket className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
            <span className="font-mono text-sm font-bold tracking-wider text-amber-200">#{t}</span>
          </div>
        ))}
      </div>
      <p className="relative mt-6 max-w-xs text-pretty text-sm text-white/55">
        Your ticket numbers are locked. Next up: the instant win scan.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* STATE 3 — Checking Instant Wins (scanning beam)                   */
/* ---------------------------------------------------------------- */
function CheckingWinsState() {
  return (
    <div className="relative flex min-h-[460px] flex-col items-center justify-center px-6 py-12 text-center">
      <VaultBackdrop tone="red" />
      <Particles tone="red" />

      {/* Reactor circle with scanning beam */}
      <div className="relative flex h-44 w-44 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-red-500/40" aria-hidden="true" />
        <div
          className="absolute inset-2 rounded-full border border-amber-400/30 shadow-[inset_0_0_30px_rgba(245,158,11,0.25)]"
          aria-hidden="true"
        />
        {/* scanning beam */}
        <div
          className="absolute left-1/2 top-1/2 h-1/2 w-1 origin-bottom -translate-x-1/2 -translate-y-full rotate-[35deg] bg-gradient-to-t from-red-500 to-transparent blur-[1px]"
          aria-hidden="true"
        />
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(239,68,68,0.25)_40deg,transparent_80deg)]" aria-hidden="true" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 shadow-[0_0_30px_rgba(239,68,68,0.5)]">
          <ScanLine className="h-9 w-9 text-red-400" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-red-500">
        Instant Win Check
      </p>
      <h3 className="relative mt-2 text-2xl font-extrabold tracking-tight text-white">
        Scanning Your Tickets&hellip;
      </h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm text-white/55">
        Running your ticket numbers against the instant win vault.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* STATE 4 — Final Instant Win Check (reactor charging)              */
/* ---------------------------------------------------------------- */
function FinalCheckState() {
  return (
    <div className="relative flex min-h-[460px] flex-col items-center justify-center px-6 py-12 text-center">
      <VaultBackdrop tone="gold" />
      <Particles tone="gold" />

      {/* Charging vault circle */}
      <div className="relative flex h-48 w-48 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-amber-400/50 shadow-[0_0_50px_rgba(245,158,11,0.5)]" aria-hidden="true" />
        <div className="absolute inset-3 rounded-full border border-red-500/40" aria-hidden="true" />
        <div className="absolute inset-6 rounded-full bg-amber-500/10 blur-md" aria-hidden="true" />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-b from-amber-400/25 to-red-500/10 shadow-[0_0_40px_rgba(245,158,11,0.6)]">
          <Zap className="h-12 w-12 text-amber-300" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
        Final Check
      </p>
      <h3 className="relative mt-2 text-2xl font-extrabold tracking-tight text-white">
        Finalising Your Result&hellip;
      </h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm text-white/55">
        The vault is locking in your outcome right now.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* STATE 5 — Winner Reveal                                           */
/* ---------------------------------------------------------------- */
function WinnerRevealState() {
  return (
    <div className="relative flex min-h-[500px] flex-col items-center justify-center px-6 py-12 text-center">
      <VaultBackdrop tone="gold" />
      <Particles tone="gold" />

      {/* Trophy vault */}
      <div className="relative">
        <div className="absolute inset-0 -m-6 rounded-full bg-amber-400/25 blur-3xl" aria-hidden="true" />
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-b from-amber-400/30 to-amber-600/10 shadow-[0_0_60px_rgba(245,158,11,0.7)]">
          <Trophy className="h-14 w-14 text-amber-300" aria-hidden="true" />
        </div>
      </div>

      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.35em] text-amber-400">
        Instant Winner
      </p>
      <h3 className="relative mt-2 bg-gradient-to-b from-amber-200 to-amber-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent drop-shadow-[0_0_20px_rgba(245,158,11,0.5)]">
        YOU WON!
      </h3>

      {/* Prize card */}
      <div className="relative mt-6 w-full max-w-xs rounded-2xl border-2 border-amber-400/50 bg-gradient-to-b from-amber-400/15 to-black/40 p-5 shadow-[0_0_40px_rgba(245,158,11,0.35)]">
        <div className="flex items-center justify-center gap-2">
          <PoundSterling className="h-6 w-6 text-amber-300" aria-hidden="true" />
          <span className="text-3xl font-extrabold text-white">250 Cash</span>
        </div>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-amber-200/70">Winning Ticket #04823</p>
      </div>

      <button
        type="button"
        className="relative mt-7 w-full max-w-xs rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-6 py-3.5 text-base font-bold text-black shadow-[0_0_30px_rgba(245,158,11,0.5)] transition active:scale-[0.98]"
      >
        Claim Your Prize
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* STATE 6 — Not-Won Reveal                                          */
/* ---------------------------------------------------------------- */
function NotWonRevealState() {
  return (
    <div className="relative flex min-h-[500px] flex-col items-center justify-center px-6 py-12 text-center">
      <VaultBackdrop tone="red" />

      <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-red-500/40 bg-red-500/10 shadow-[0_0_36px_rgba(239,68,68,0.35)]">
        <Gift className="h-11 w-11 text-red-400" aria-hidden="true" />
      </div>

      <p className="relative mt-7 text-xs font-semibold uppercase tracking-[0.3em] text-red-500">
        No Instant Win This Time
      </p>
      <h3 className="relative mt-2 text-3xl font-extrabold tracking-tight text-white">You&apos;re In The Draw!</h3>
      <p className="relative mt-3 max-w-xs text-pretty text-sm leading-relaxed text-white/60">
        No instant win on this one, but all 5 of your tickets are entered into the main prize draw. Good luck!
      </p>

      {/* Entered tickets summary */}
      <div className="relative mt-6 flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/5 px-4 py-2">
        <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
        <span className="text-sm font-semibold text-amber-200">5 tickets in the main draw</span>
      </div>

      <button
        type="button"
        className="relative mt-7 w-full max-w-xs rounded-xl border border-red-500/50 bg-red-500/10 px-6 py-3.5 text-base font-bold text-white transition active:scale-[0.98]"
      >
        Enter Another Giveaway
      </button>
    </div>
  )
}
