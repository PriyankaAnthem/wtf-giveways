'use client'

/**
 * WTF TICKET REVEAL MACHINE — the NORMAL checkout reveal experience.
 *
 * PRESENTATION ONLY. Every value shown comes directly from the `award` prop
 * that the server already decided (via /api/checkout/confirm →
 * confirmPaymentAndAward → the confirm_payment_and_award RPC). This component
 * never decides win/loss, never picks a prize, never allocates tickets, never
 * calls an API/Supabase, and never mutates the award. It only stages a
 * cosmetic ~5.6s reveal before showing the already-known result.
 *
 * The mechanic: the customer's actual ticket numbers are fed one-by-one UP
 * through a central glowing "result gate" inside a black-glass arcade console
 * while a red/gold charge meter fills. At RESULT OPENING the final tickets slam
 * into the gate, the machine flares, and the result panel is revealed. The
 * central WTF mark is only a small badge on the machine — the tickets are the
 * hero.
 *
 * The scratch-card path is handled elsewhere (ScratchCardReveal); this file is
 * only rendered for reveal_type === 'normal'.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ChevronDown, TicketCheck } from 'lucide-react'
import type { RevealType } from '@/lib/types/campaign'

type Prize = {
  award_id?: string | null
  title: string
  value_text?: string | null
  image_url?: string | null
}

export type NormalRevealAward = {
  confirmed: boolean
  checkout_ref: string
  qty: number
  won: boolean
  prize: Prize | null
  prizes?: Prize[]
  ticket_start?: number | null
  ticket_end?: number | null
  campaign_slug?: string | null
  reveal_type?: RevealType | null
}

type Stage = 'locked' | 'surge' | 'opening' | 'result'

// Cosmetic reveal timeline (UNCHANGED). The animated ticket-reveal phase is the
// valuable part of the experience, so it runs a full 4 seconds. Final result
// appears at ~5.6s total:
//   Stage 1 ENTRY LOCKED    0ms   – 800ms
//   Stage 2 TICKET REVEAL   800ms – 4800ms  (4s feed)
//   Stage 3 RESULT OPENING  4800ms – 5600ms
//   Stage 4 FINAL RESULT    after 5600ms
const T_SURGE = 800
const T_OPENING = 4800
const T_RESULT = 5600

// Individual ticket numbers shown before the drawer collapses the rest.
const TICKET_PREVIEW_COUNT = 10
// Hero tickets fed through the machine during the reveal (6–8 range).
const MACHINE_TICKET_COUNT = 6

function usePrefersReducedMotion() {
  const [reduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  })
  return reduced
}

/** Build the individual ticket numbers for DISPLAY ONLY from the start/end range. */
function useTicketNumbers(award: NormalRevealAward): number[] {
  return useMemo(() => {
    const start = award.ticket_start
    const end = award.ticket_end
    if (typeof start !== 'number' || typeof end !== 'number') return []
    if (end < start) return []
    const MAX = 5000
    const count = Math.min(end - start + 1, MAX)
    return Array.from({ length: count }, (_, i) => start + i)
  }, [award.ticket_start, award.ticket_end])
}

export function NormalCheckoutReveal({ award }: { award: NormalRevealAward }) {
  const reducedMotion = usePrefersReducedMotion()
  const [stage, setStage] = useState<Stage>(reducedMotion ? 'result' : 'locked')

  useEffect(() => {
    if (reducedMotion) {
      setStage('result')
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => setStage('surge'), T_SURGE),
      setTimeout(() => setStage('opening'), T_OPENING),
      setTimeout(() => setStage('result'), T_RESULT),
    ]
    return () => timers.forEach(clearTimeout)
  }, [reducedMotion])

  const prizes = award.prizes ?? (award.prize ? [award.prize] : [])
  const won = award.won && prizes.length > 0
  const tickets = useTicketNumbers(award)
  const ticketCount = tickets.length > 0 ? tickets.length : award.qty

  return (
    <div
      data-reveal="root"
      className="reveal-root relative min-h-screen w-full overflow-hidden bg-black text-white"
    >
      <MachineStyles />
      <MachineBackground stage={stage} won={won} />
      <MachineFlashes stage={stage} won={won} />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-5 pt-10 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {stage !== 'result' ? (
          <>
            <MachineHeader stage={stage} qty={award.qty} />
            <div className="relative flex flex-1 items-center justify-center py-6">
              <TicketMachine stage={stage} tickets={tickets} qty={award.qty} won={won} />
            </div>
            <span className="sr-only" role="status">
              Confirming your entry and revealing your result.
            </span>
          </>
        ) : (
          <div
            data-reveal="result"
            className={`reveal-result flex flex-1 flex-col pt-2 ${won ? 'gap-5' : 'gap-4'}`}
          >
            <ResultImpactPanel won={won} prizes={prizes} qty={ticketCount} />
            <TicketDrawer tickets={tickets} qty={ticketCount} compact={!won} />
            <MachineActions campaignSlug={award.campaign_slug} won={won} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header: phase copy (COPY LOCK)
// ---------------------------------------------------------------------------

function MachineHeader({ stage, qty }: { stage: Stage; qty: number }) {
  const eyebrow =
    stage === 'locked'
      ? 'ENTRY LOCKED'
      : stage === 'surge'
        ? `${qty} TICKETS IN PLAY`
        : 'REVEALING RESULT'
  const sub = stage === 'locked' ? 'Your tickets are in' : null

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p
        key={eyebrow}
        className="reveal-fade text-2xl font-black uppercase tracking-[0.18em] text-white drop-shadow-[0_0_20px_rgba(245,158,11,0.55)] sm:text-3xl"
      >
        {eyebrow}
      </p>
      {sub && <p className="reveal-fade text-sm font-medium text-amber-200/80">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The Ticket Reveal Machine: black-glass console with a central result gate.
// The customer's ticket cards feed UP through the gate one-by-one; a charge
// meter fills across the 4s reveal.
// ---------------------------------------------------------------------------

function TicketMachine({
  stage,
  tickets,
  qty,
  won,
}: {
  stage: Stage
  tickets: number[]
  qty: number
  won: boolean
}) {
  const opening = stage === 'opening'
  const active = stage === 'surge' || stage === 'opening'

  const passes = tickets.slice(0, MACHINE_TICKET_COUNT)
  const total = passes.length
  // The last 1–2 tickets slam and HOLD in the gate for the final charge so a
  // ticket is always sitting in the result window at RESULT OPENING.
  const holdCount = total >= 2 ? 2 : total >= 1 ? 1 : 0
  // Spread every ticket across ~0–2.8s of the surge so the feed is continuous
  // (never static), capped so large orders don't over-compress.
  const step = total > 1 ? Math.min(0.55, 2.8 / (total - 1)) : 0
  const remaining = Math.max(qty - total, 0)

  return (
    <div
      data-reveal="machine"
      className={`reveal-machine relative w-[280px] max-w-full rounded-[28px] border-2 border-amber-400/30 bg-gradient-to-b from-zinc-900/90 via-black to-zinc-950 p-4 shadow-[0_0_60px_rgba(239,68,68,0.25),inset_0_0_30px_rgba(0,0,0,0.9)] ring-1 ring-amber-400/20 transition-transform duration-500 ${
        opening ? 'scale-[1.05]' : 'scale-100'
      }`}
    >
      {/* Gold/red top edge lighting (static, no animated shadow). */}
      <div className="pointer-events-none absolute inset-x-6 -top-px h-0.5 rounded-full bg-gradient-to-r from-transparent via-amber-400 to-transparent" />

      {/* Machine chrome row — small WTF badge (NOT the hero). */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-gradient-to-b from-amber-300 to-amber-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-black">
            WTF
          </span>
          <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-amber-400/70">
            Reveal Machine
          </span>
        </div>
        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.2em] text-amber-400/70">
          <span
            className={`size-1.5 rounded-full ${active ? 'reveal-live bg-red-500' : 'bg-amber-500/40'}`}
          />
          Live
        </span>
      </div>

      {/* Feed lane = the result gate chamber. Tickets travel UP through it. */}
      <div
        data-reveal="feed"
        className="relative mx-auto h-[300px] w-[220px] overflow-hidden rounded-2xl border border-amber-400/20 bg-[#060607] shadow-[inset_0_0_30px_rgba(0,0,0,0.95)]"
      >
        {/* The glowing result window band across the centre. */}
        <div
          data-reveal="gate"
          className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-[84px] -translate-y-1/2 border-y-2 border-amber-400/60 bg-gradient-to-b from-amber-400/10 via-red-500/10 to-amber-400/10"
        >
          {/* Window side rails. */}
          <span className="absolute left-0 top-0 h-full w-1 bg-amber-400/70" />
          <span className="absolute right-0 top-0 h-full w-1 bg-amber-400/70" />
          {/* Subtle window glow pulse (opacity only). */}
          <div className="reveal-gate-pulse absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.35),transparent_70%)]" />
          {/* Active light sweep across the window (transform + opacity). */}
          {active && (
            <div className="reveal-sweep absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-transparent via-amber-200/40 to-transparent" />
          )}
          {/* RESULT OPENING: gate flares open + a bright wipe crosses it. */}
          {opening && (
            <>
              <div
                className={`reveal-gate-flare absolute inset-0 ${
                  won
                    ? 'bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.75),rgba(239,68,68,0.3)_60%,transparent)]'
                    : 'bg-[radial-gradient(ellipse_at_center,rgba(248,113,113,0.7),rgba(239,68,68,0.3)_60%,transparent)]'
                }`}
              />
              <div className="absolute left-0 top-1/2 flex w-full -translate-y-1/2 justify-center overflow-hidden">
                <div
                  className={`reveal-wipe h-1 w-[140%] ${
                    won
                      ? 'bg-gradient-to-r from-transparent via-amber-200 to-transparent'
                      : 'bg-gradient-to-r from-transparent via-red-300 to-transparent'
                  }`}
                />
              </div>
            </>
          )}
        </div>

        {/* The customer's tickets feeding through the gate. */}
        {active &&
          passes.map((n, i) => {
            const isHold = i >= total - holdCount
            const holdOrder = total - 1 - i // 0 = the very last ticket
            const holdY = -holdOrder * 12 // stack held tickets slightly in the gate
            return (
              <div
                key={n}
                data-reveal="ticket"
                className={`absolute left-1/2 top-1/2 z-10 -ml-[84px] -mt-[42px] ${
                  isHold ? 'reveal-slam' : 'reveal-feed'
                }`}
                style={
                  {
                    '--hy': `${holdY}px`,
                    animationDelay: `${i * step}s`,
                  } as CSSProperties
                }
              >
                <TicketCard n={n} />
              </div>
            )
          })}
      </div>

      {/* Upcoming ticket stack / deck that cards feed from. */}
      <div data-reveal="stack" className="relative mx-auto mt-3 h-9 w-[168px]">
        {[0, 1, 2].map((k) => (
          <div
            key={k}
            className="absolute inset-x-0 top-0 h-7 rounded-md border border-amber-400/25 bg-zinc-900/80"
            style={{
              transform: `translateY(${k * 4}px) scale(${1 - k * 0.05})`,
              opacity: 1 - k * 0.22,
              zIndex: 3 - k,
            }}
          />
        ))}
        <span className="absolute inset-0 z-10 flex items-center justify-center pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-amber-300/80">
          {remaining > 0 ? `+${remaining} more in play` : `${qty} in play`}
        </span>
      </div>

      {/* Result charge meter (fills across the 4s — transform scaleX only). */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-amber-400/70">
            Result
          </span>
          <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-amber-400/70">
            {active ? 'Charging' : 'Ready'}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            data-reveal="meter"
            className={`h-full w-full origin-left rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-600 ${
              active ? 'reveal-meter-fill' : 'scale-x-0'
            }`}
          />
        </div>
      </div>
    </div>
  )
}

// A single readable ticket card fed through the machine.
function TicketCard({ n }: { n: number }) {
  return (
    <div className="relative flex h-[84px] w-[168px] flex-col items-center justify-center rounded-xl border-2 border-amber-400/70 bg-gradient-to-b from-zinc-900 to-black shadow-[0_0_20px_rgba(239,68,68,0.4)]">
      {/* Punched ticket perforations (blend with the lane bg). */}
      <span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full bg-[#060607]" />
      <span className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full bg-[#060607]" />
      <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-amber-400/80">Ticket</span>
      <span className="font-mono text-2xl font-black tracking-tight text-amber-100">#{n}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result impact panel: dominant win / no-win state
// ---------------------------------------------------------------------------

function ResultImpactPanel({ won, prizes, qty }: { won: boolean; prizes: Prize[]; qty: number }) {
  if (won) {
    const multiple = prizes.length > 1
    return (
      <div className="relative flex flex-col items-center gap-4 text-center">
        {/* Explosion glow behind the headline */}
        <div className="pointer-events-none absolute -top-6 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.5),rgba(239,68,68,0.25)_45%,transparent_70%)] blur-2xl" />

        <div className="relative flex flex-col items-center">
          <h1 className="reveal-headline text-4xl font-black uppercase leading-none tracking-tight text-white drop-shadow-[0_0_28px_rgba(245,158,11,0.8)] sm:text-6xl">
            {multiple ? 'Multiple Instant Wins' : 'Instant Win'}
          </h1>
          <p className="mt-2 text-lg font-bold text-amber-300">
            {multiple ? `You won ${prizes.length} prizes` : "You've won"}
          </p>
        </div>

        {/* One visually distinct card per prize. A single win keeps the strong
            hero treatment; multiple wins each get their own full prize card. */}
        <div className="w-full space-y-3">
          {prizes.map((prize, i) => (
            <div
              key={prize.award_id ?? `${prize.title}-${i}`}
              className="relative w-full overflow-hidden rounded-2xl border-2 border-amber-400/60 bg-gradient-to-b from-zinc-900/90 to-black p-4 shadow-[0_0_40px_rgba(245,158,11,0.3)]"
            >
              {multiple && (
                <span className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-amber-400 text-sm font-black text-black shadow-lg">
                  {i + 1}
                </span>
              )}
              {prize.image_url && (
                <div className="mb-3 overflow-hidden rounded-xl border border-amber-400/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={prize.image_url || '/placeholder.svg'}
                    alt={prize.title}
                    className="h-48 w-full bg-black object-contain"
                  />
                </div>
              )}
              <h2 className="text-2xl font-extrabold text-white text-balance">{prize.title}</h2>
              {prize.value_text && (
                <p className="mt-1 text-lg font-bold text-amber-300">{prize.value_text}</p>
              )}
            </div>
          ))}
        </div>

        {/* Recorded-win reassurance */}
        <p className="text-sm font-medium text-amber-100/80">
          {multiple ? 'Your wins have' : 'Your win has'} been saved to your account.
        </p>
      </div>
    )
  }

  // No-win — reassuring, premium, never grey/dead. Reduced red glow, a calm
  // gold "entry active" mark, and restrained supporting copy that keeps the
  // customer's tickets front-of-mind for the main draw.
  const single = qty === 1
  return (
    <div className="relative flex flex-col items-center gap-4 text-center">
      {/* Softened ambient glow (gold-led, faint red) — no aggressive flare. */}
      <div className="pointer-events-none absolute -top-4 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.18),rgba(239,68,68,0.08)_55%,transparent_75%)] blur-2xl" />

      {/* Ticket/check mark: signals the main-draw entry is still active. */}
      <div className="relative flex size-16 items-center justify-center rounded-full border border-amber-400/40 bg-gradient-to-b from-zinc-900/80 to-black shadow-[0_0_20px_rgba(245,158,11,0.18)]">
        <TicketCheck className="size-8 text-amber-300" aria-hidden="true" />
      </div>

      <div className="relative flex flex-col items-center gap-2">
        <h1 className="reveal-headline text-3xl font-black uppercase leading-none tracking-tight text-white drop-shadow-[0_0_18px_rgba(245,158,11,0.35)] sm:text-4xl">
          Not This Time
        </h1>
        <p className="max-w-[20rem] text-base font-medium leading-relaxed text-zinc-300 text-balance">
          {single
            ? 'Your ticket didn’t reveal an instant prize, but it is still entered in the main draw.'
            : 'Your tickets didn’t reveal an instant prize, but they are still entered in the main draw.'}
        </p>
      </div>

      {/* Restrained gold status chip (no oversized glowing badge). */}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
        <span className="size-1.5 rounded-full bg-amber-300" aria-hidden="true" />
        {single ? '1 ticket still active' : `${qty} tickets still active`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ticket drawer: individual numbers, collapsed by default for large orders
// ---------------------------------------------------------------------------

function TicketDrawer({
  tickets,
  qty,
  compact = false,
}: {
  tickets: number[]
  qty: number
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  if (tickets.length === 0) return null

  const single = tickets.length === 1
  // Singular "Your ticket" is only used in the compact no-win layout. The winner
  // (non-compact) variant keeps its original "Your tickets (N)" heading.
  const heading = compact && single ? 'Your ticket' : `Your tickets (${qty})`

  // Compact single-ticket no-win layout: one pill + a small "Main draw entry"
  // status label, on a single row, with reduced padding. Multi-ticket keeps the
  // full number grid (and its preview/collapse behaviour) regardless of compact.
  if (compact && single) {
    return (
      <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-col gap-0.5 text-left">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-amber-400/90">
            {heading}
          </p>
          <p className="text-xs font-medium text-zinc-400">Main draw entry</p>
        </div>
        <span className="inline-flex min-w-[54px] items-center justify-center rounded-lg border border-amber-400/25 bg-black/50 px-2.5 py-1.5 font-mono text-sm font-bold text-amber-100">
          #{tickets[0]}
        </span>
      </div>
    )
  }

  const needsDrawer = tickets.length > TICKET_PREVIEW_COUNT
  const visible = expanded ? tickets : tickets.slice(0, TICKET_PREVIEW_COUNT)

  return (
    <div
      className={`w-full rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <p
        className={`text-xs font-bold uppercase tracking-[0.15em] text-amber-400/90 ${
          compact ? 'mb-2' : 'mb-3'
        }`}
      >
        {heading}
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((n) => (
          <span
            key={n}
            className="inline-flex min-w-[54px] items-center justify-center rounded-lg border border-amber-400/25 bg-black/50 px-2.5 py-1.5 font-mono text-sm font-bold text-amber-100"
          >
            #{n}
          </span>
        ))}
      </div>

      {needsDrawer && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          aria-expanded={expanded}
        >
          {expanded ? 'Hide tickets' : 'View all tickets'}
          <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Actions: exactly Buy More + My Account
// ---------------------------------------------------------------------------

function MachineActions({
  campaignSlug,
  won,
}: {
  campaignSlug?: string | null
  won: boolean
}) {
  // href logic is unchanged (campaign slug preserved, /giveaways fallback).
  const buyMoreHref = campaignSlug ? `/giveaways/${campaignSlug}` : '/giveaways'

  return (
    <div className={`flex w-full flex-col ${won ? 'gap-3 pt-2' : 'gap-2 pt-1'}`}>
      <Link
        href={buyMoreHref}
        className="flex h-14 min-h-[44px] w-full items-center justify-center rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-red-600 text-base font-black uppercase tracking-wide text-black shadow-[0_0_28px_rgba(245,158,11,0.4)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]"
      >
        {won ? 'Buy More' : 'Try Again'}
      </Link>

      {!won && (
        <p className="text-center text-xs font-medium text-zinc-400">
          Add more tickets for more chances in the main draw.
        </p>
      )}

      <Link
        href="/me"
        className={
          won
            ? 'flex h-14 min-h-[44px] w-full items-center justify-center rounded-xl border border-amber-400/40 bg-white/[0.05] text-base font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]'
            : 'flex h-11 min-h-[44px] w-full items-center justify-center rounded-xl border border-white/10 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]'
        }
      >
        My Account
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Background: layered black/red/gold arena (no images, no canvas, no particles)
// ---------------------------------------------------------------------------

function MachineBackground({ stage, won }: { stage: Stage; won: boolean }) {
  const intense = stage === 'result' && won
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Black base */}
      <div className="absolute inset-0 bg-[#060607]" />
      {/* Deep red radial glow from top-right (soft gradient, no blur filter). */}
      <div
        className={`absolute -right-24 -top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgba(220,38,38,0.4),transparent_65%)] transition-opacity duration-700 ${
          intense ? 'opacity-100' : 'opacity-70'
        }`}
      />
      {/* Gold glow from bottom-centre (soft gradient, no blur filter). */}
      <div
        className={`absolute -bottom-28 left-1/2 h-[24rem] w-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.32),transparent_65%)] transition-opacity duration-700 ${
          intense ? 'opacity-100' : 'opacity-70'
        }`}
      />
      {/* Dotted texture */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      {/* Vignette */}
      <div className="absolute inset-0 shadow-[inset_0_0_140px_50px_rgba(0,0,0,0.9)]" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screen lighting: a subtle full-screen pulse as the machine charges, plus a
// dramatic flash + light slash on result opening. Overlay only.
// ---------------------------------------------------------------------------

function MachineFlashes({ stage, won }: { stage: Stage; won: boolean }) {
  if (stage !== 'surge' && stage !== 'opening') return null

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
      {stage === 'surge' && (
        // A SINGLE subtle screen pulse — opacity only, no blend mode — timed to
        // the final charge so the screen brightens as the machine peaks.
        <div
          className="reveal-screenpulse absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(245,158,11,0.4),rgba(239,68,68,0.25)_45%,transparent_70%)]"
          style={{ animationDelay: '3.0s' }}
        />
      )}

      {stage === 'opening' && (
        <>
          {/* Background flash as the machine opens — opacity only, no blend. */}
          <div
            className={`reveal-flash absolute inset-0 ${
              won
                ? 'bg-[radial-gradient(circle_at_50%_45%,rgba(253,224,71,0.7),rgba(245,158,11,0.35)_45%,transparent_75%)]'
                : 'bg-[radial-gradient(circle_at_50%_45%,rgba(248,113,113,0.65),rgba(239,68,68,0.3)_45%,transparent_75%)]'
            }`}
          />
          {/* Full-screen light slash sweeping across — transform only, no blur. */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <div
              className={`reveal-slash h-24 w-[160%] -rotate-6 ${
                won
                  ? 'bg-gradient-to-r from-transparent via-amber-200/80 to-transparent'
                  : 'bg-gradient-to-r from-transparent via-red-300/75 to-transparent'
              }`}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Global animations. `global` is REQUIRED: styled-jsx would otherwise scope the
// rules to elements rendered by THIS component (which renders none), so the
// .reveal-* selectors would never match the machine/ticket elements in sibling
// components and no animations would run.
// ---------------------------------------------------------------------------

function MachineStyles() {
  return (
    <style jsx global>{`
      @keyframes reveal-fade {
        0% {
          opacity: 0;
          transform: translateY(8px);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }
      /* A ticket feeds UP from the stack, through the gate window, out the top. */
      @keyframes reveal-feed {
        0% {
          opacity: 0;
          transform: translateY(150px) scale(0.86);
        }
        14% {
          opacity: 1;
        }
        50% {
          opacity: 1;
          transform: translateY(0) scale(1.02);
        }
        86% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateY(-170px) scale(0.86);
        }
      }
      /* The final ticket(s) slam into the gate and HOLD there (fill forwards). */
      @keyframes reveal-slam {
        0% {
          opacity: 0;
          transform: translateY(150px) scale(0.85);
        }
        35% {
          opacity: 1;
        }
        65% {
          transform: translateY(calc(var(--hy) - 8px)) scale(1.06);
        }
        100% {
          opacity: 1;
          transform: translateY(var(--hy)) scale(1);
        }
      }
      /* Result charge meter fills across the 4s (accelerating). */
      @keyframes reveal-meter {
        0% {
          transform: scaleX(0.04);
        }
        70% {
          transform: scaleX(0.62);
        }
        100% {
          transform: scaleX(1);
        }
      }
      /* Gate window glow pulse (opacity only). */
      @keyframes reveal-gate-pulse {
        0%,
        100% {
          opacity: 0.45;
        }
        50% {
          opacity: 0.9;
        }
      }
      /* Light sweep across the result window. */
      @keyframes reveal-sweep {
        0% {
          opacity: 0;
          transform: translateX(-120%);
        }
        40% {
          opacity: 0.8;
        }
        100% {
          opacity: 0;
          transform: translateX(240%);
        }
      }
      /* "Live" indicator blink (opacity only). */
      @keyframes reveal-live {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }
      /* RESULT OPENING: the gate flares open. */
      @keyframes reveal-gate-flare {
        0% {
          opacity: 0;
          transform: scaleY(1);
        }
        100% {
          opacity: 1;
          transform: scaleY(1.6);
        }
      }
      /* RESULT OPENING: bright wipe across the window. */
      @keyframes reveal-wipe {
        0% {
          opacity: 0;
          transform: translateX(-120%);
        }
        30% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateX(120%);
        }
      }
      /* Screen-wide light pulse (single, at the charge peak). */
      @keyframes reveal-screenpulse {
        0%,
        100% {
          opacity: 0;
        }
        45% {
          opacity: 0.6;
        }
      }
      /* Opening background flash. */
      @keyframes reveal-flash {
        0% {
          opacity: 0;
        }
        35% {
          opacity: 0.9;
        }
        100% {
          opacity: 0;
        }
      }
      /* Opening light slash sweeping across the whole screen. */
      @keyframes reveal-slash {
        0% {
          opacity: 0;
          transform: translateX(-120%) rotate(-6deg);
        }
        40% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateX(120%) rotate(-6deg);
        }
      }
      @keyframes reveal-result-in {
        0% {
          opacity: 0;
          transform: translateY(14px) scale(0.92);
        }
        60% {
          opacity: 1;
          transform: translateY(0) scale(1.04);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @keyframes reveal-headline {
        0% {
          opacity: 0;
          transform: scale(0.8);
        }
        60% {
          transform: scale(1.06);
        }
        100% {
          opacity: 1;
          transform: scale(1);
        }
      }

      .reveal-fade {
        animation: reveal-fade 0.4s ease-out both;
      }
      /* Per-ticket motion layers — transform/opacity only. They auto-promote
         while animating; no persistent will-change so the layer count stays low. */
      .reveal-feed {
        animation: reveal-feed 1.15s cubic-bezier(0.4, 0, 0.2, 1) both;
      }
      .reveal-slam {
        animation: reveal-slam 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.1) forwards;
      }
      .reveal-meter-fill {
        animation: reveal-meter 4s cubic-bezier(0.45, 0, 0.55, 1) forwards;
        will-change: transform;
      }
      .reveal-gate-pulse {
        animation: reveal-gate-pulse 1.6s ease-in-out infinite;
      }
      .reveal-sweep {
        animation: reveal-sweep 1.8s ease-in-out infinite;
      }
      .reveal-live {
        animation: reveal-live 1s ease-in-out infinite;
      }
      .reveal-gate-flare {
        animation: reveal-gate-flare 0.7s ease-out both;
      }
      .reveal-wipe {
        animation: reveal-wipe 0.8s ease-in-out both;
      }
      .reveal-screenpulse {
        animation: reveal-screenpulse 1.1s ease-in-out both;
      }
      .reveal-flash {
        animation: reveal-flash 0.8s ease-out both;
      }
      .reveal-slash {
        animation: reveal-slash 0.8s ease-in-out both;
      }
      .reveal-result {
        animation: reveal-result-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
        will-change: transform, opacity;
      }
      .reveal-headline {
        animation: reveal-headline 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
        will-change: transform, opacity;
      }
      @media (prefers-reduced-motion: reduce) {
        .reveal-fade,
        .reveal-feed,
        .reveal-slam,
        .reveal-meter-fill,
        .reveal-gate-pulse,
        .reveal-sweep,
        .reveal-live,
        .reveal-gate-flare,
        .reveal-wipe,
        .reveal-screenpulse,
        .reveal-flash,
        .reveal-slash,
        .reveal-result,
        .reveal-headline {
          animation: none !important;
        }
      }
    `}</style>
  )
}
