'use client'

import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { validateCustomerName } from '@/lib/acquired/customer-name'
import { DiscountCodeField } from '@/components/checkout/DiscountCodeField'
import {
  discountUiReducer,
  initDiscountUiState,
  selectEffectiveTotalPence,
  selectDiscountPence,
  buildCreateCheckoutBody,
  type AppliedDiscount,
} from '@/lib/checkout/discountUiState'
import { createIdempotencyKey } from '@/lib/checkout/idempotencyKey'
import { checkoutErrorMessage, isCheckoutExpired } from '@/lib/discounts/customerErrorCopy'
import { normalizeDiscountCode } from '@/lib/discounts/discountCalc'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Crown,
  Flame,
  Lock,
  Sparkles,
  Ticket,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react'

/**
 * A server-authoritative ticket option. Every monetary value originates on the
 * server (configured bundle price or qty × ticket price). The client only ever
 * SELECTS between these; it never invents a price.
 */
export interface ReviewOption {
  key: string
  qty: number
  /** null = per-ticket pricing (no bundle). */
  bundlePricePence: number | null
  totalPence: number
  savingsPence: number
}

/**
 * Read-only aggregate instant-win facts for the upsell copy ONLY. Derived
 * server-side from the existing detail snapshot. Carries no ticket numbers,
 * slot positions, winning positions, award identities or prize configuration.
 */
export interface InstantWinSummary {
  /** Total instant prizes still available (sum of positive remaining counts). */
  remainingCount: number
  /**
   * A pre-formatted, unambiguous hero CASH label (e.g. "£1,000 CASH") when a
   * clearly-cash instant of £250+ remains; otherwise null. Site credit / wallet
   * prizes are never eligible.
   */
  heroCashLabel: string | null
}

/**
 * Format an integer pence amount as GBP with two decimal places (e.g. 2000 ->
 * "£20.00"). Clamps malformed/negative values to £0.00 so nothing negative or
 * raw ever renders.
 */
function formatGBP(pence: number): string {
  const safe = Number.isFinite(pence) ? Math.max(pence, 0) : 0
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(safe / 100)
}

// Non-negative SAFE integer guard (also rejects values above MAX_SAFE_INTEGER).
const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/**
 * Friendly, non-technical copy for every known failure code. Raw API/database/
 * provider error text is NEVER shown — anything not in this map falls back to a
 * single generic message.
 */
const FRIENDLY_ERRORS: Record<string, string> = {
  auth_required: 'Please log in to complete your entry.',
  // Server-enforced self-exclusion. Retrying will not help, so we show clear,
  // non-technical copy (enforcement is entirely server-side — see
  // /api/checkout/create and the Acquired create-checkout route).
  ACCOUNT_SELF_EXCLUDED: 'Purchasing has been disabled on this account.',
  sold_out: 'This giveaway just sold out. Please try a smaller quantity or another giveaway.',
  user_ticket_cap_exceeded: "You've reached the maximum number of tickets allowed for this giveaway.",
  wallet_prepare_failed: "We couldn't apply your WTF Credit. Your credit was not charged — please try again.",
  invalid_wallet_split: "We couldn't apply your WTF Credit. Your credit was not charged — please try again.",
  wallet_reservation_invalid:
    'Your WTF Credit hold expired before checkout completed. Your credit was not charged — please try again.',
  wallet_reservation_unavailable:
    'Your WTF Credit is temporarily unavailable. Your credit was not charged — please try again.',
  wallet_confirmation_invalid_state:
    "We couldn't confirm this order. Your credit was not charged — please start again.",
  provider_payment_not_required: 'Please try again to finish your entry.',
  // Deterministic customer-name problems saved on the account (see NAME_ERROR_CODES).
  customer_name_invalid:
    "We couldn't verify the name saved on your account. Please check your first and last name before continuing.",
  customer_name_required:
    "We couldn't verify the name saved on your account. Please check your first and last name before continuing.",
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'

/**
 * Deterministic, user-data errors. These will NOT succeed on a blind retry with
 * the same account details, so instead of re-enabling the pay button we open a
 * small inline form that collects the name and continues checkout in ONE
 * request (see goToAcquired / submitName).
 */
const NAME_ERROR_CODES = new Set(['customer_name_invalid', 'customer_name_required'])

function isNameError(code: unknown): boolean {
  return typeof code === 'string' && NAME_ERROR_CODES.has(code)
}

function friendlyError(code: unknown): string {
  if (typeof code === 'string' && code in FRIENDLY_ERRORS) return FRIENDLY_ERRORS[code]
  return GENERIC_ERROR
}

type InstantHookState = 'hero_cash' | 'generic' | 'none'

/**
 * CSS-ONLY neon perimeter + glow for the Exclusive Chance Boost card. No JS
 * loop, no canvas, no library, no image. The travelling light animates a single
 * registered custom property (--ecb-angle) that drives a masked conic-gradient
 * border ring; a separate opacity pulse provides the glow. Reduced-motion users
 * keep the static neon border/glow with no movement. Nothing here animates a
 * layout property, so there is no CLS and no re-render cost.
 */
const ECB_STYLES = `
@property --ecb-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
.ecb-card { position: relative; isolation: isolate; }
.ecb-card::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 2px;
  background: conic-gradient(from var(--ecb-angle),
    rgba(255,47,179,0) 0deg, #ff2fb3 40deg, #ff4fd8 85deg, #8b5cf6 140deg,
    rgba(139,92,246,0) 190deg, #facc15 250deg, #ff2fb3 315deg, rgba(255,47,179,0) 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: ecb-rotate 3.5s linear infinite;
  pointer-events: none; z-index: 1;
}
.ecb-card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
  box-shadow: 0 0 16px rgba(255,47,179,0.34), 0 0 30px rgba(139,92,246,0.26), 0 0 54px rgba(255,47,179,0.14);
  animation: ecb-pulse 2.4s ease-in-out infinite alternate;
}
.ecb-inner { position: relative; z-index: 2; }
@keyframes ecb-rotate { to { --ecb-angle: 360deg; } }
@keyframes ecb-pulse { from { opacity: 0.6; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .ecb-card::before { animation: none; }
  .ecb-card::after { animation: none; opacity: 0.85; }
}
`

/**
 * Presentational-only "Exclusive Chance Boost" upsell card. Contains no data
 * fetching, no pricing logic and no checkout state — it renders values passed
 * in and calls onUnlock (which the parent wires to the existing selectOption()).
 */
function ExclusiveChanceBoost({
  currentQty,
  targetQty,
  incrementalLabel,
  savingsPence,
  instantState,
  remainingCount,
  heroCashLabel,
  disabled,
  onUnlock,
}: {
  currentQty: number
  targetQty: number
  /** Pre-formatted "£X" when a precise nudge is safe to show; else null. */
  incrementalLabel: string | null
  savingsPence: number
  instantState: InstantHookState
  remainingCount: number
  heroCashLabel: string | null
  disabled: boolean
  onUnlock: () => void
}) {
  const currentUnit = currentQty === 1 ? 'CHANCE' : 'CHANCES'
  const targetUnit = targetQty === 1 ? 'CHANCE' : 'CHANCES'
  const targetUnitLower = targetUnit.toLowerCase()
  const instantsRemain = instantState === 'hero_cash' || instantState === 'generic'

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ECB_STYLES }} />
      <div className="ecb-card rounded-2xl bg-[#0b0416] p-4 sm:p-5">
        {/* Radial illumination behind the chance upgrade (fades to transparent
            before the corners, so no clipping is needed). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background:
              'radial-gradient(circle at 50% 34%, rgba(255,47,179,0.18), rgba(139,92,246,0.06) 45%, transparent 66%)',
          }}
        />

        <div className="ecb-inner flex flex-col items-center text-center">
          {/* Gold exclusivity pill */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-black shadow-[0_0_16px_rgba(247,166,0,0.5)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Selected for you
          </span>

          {/* Headline */}
          <h2 className="mt-3 text-xl font-extrabold uppercase tracking-tight text-white sm:text-2xl">
            Exclusive Chance Boost
          </h2>
          <p className="mt-1 text-xs text-purple-200/90 sm:text-sm">
            You&apos;ve unlocked a special upgrade before checkout
          </p>

          {/* Campaign / instant-win hook */}
          {instantState === 'hero_cash' && heroCashLabel && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-pink-400/40 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100 sm:text-sm">
              <Flame className="h-3.5 w-3.5 text-pink-300" aria-hidden="true" />
              {`${heroCashLabel} INSTANT STILL LIVE`}
            </p>
          )}
          {instantState === 'generic' && (
            <div className="mt-3">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-pink-400/40 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100 sm:text-sm">
                <Zap className="h-3.5 w-3.5 text-pink-300" aria-hidden="true" />
                INSTANT WINS STILL LIVE
              </p>
              {remainingCount > 0 && (
                <p className="mt-1 text-xs text-purple-200/90">
                  {remainingCount} instant {remainingCount === 1 ? 'prize' : 'prizes'} still available
                </p>
              )}
            </div>
          )}
          {instantState === 'none' && (
            <div className="mt-3">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-yellow-400/40 bg-yellow-500/15 px-3 py-1 text-xs font-bold text-yellow-100 sm:text-sm">
                <Trophy className="h-3.5 w-3.5 text-yellow-300" aria-hidden="true" />
                MORE CHANCES AT THE FINAL PRIZE
              </p>
              <p className="mt-1 text-xs text-purple-200/90">
                Every extra ticket gives you another entry into the final draw.
              </p>
            </div>
          )}

          {/* Quantity comparison — the visual focal point */}
          <div className="mt-4 flex w-full items-stretch justify-center gap-3">
            <div className="flex min-w-[80px] flex-col items-center justify-center rounded-xl border border-purple-500/30 bg-white/5 px-3 py-2.5">
              <span className="text-2xl font-extrabold leading-none tabular-nums text-purple-100 sm:text-3xl">
                {currentQty}
              </span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
                {currentUnit}
              </span>
            </div>
            <div className="flex items-center">
              <span
                aria-hidden="true"
                className="text-2xl font-black text-pink-300 drop-shadow-[0_0_10px_rgba(255,47,179,0.7)] sm:text-3xl"
              >
                →
              </span>
            </div>
            <div className="flex min-w-[80px] flex-col items-center justify-center rounded-xl border border-pink-400/60 bg-gradient-to-br from-pink-500/25 to-purple-500/15 px-3 py-2.5 shadow-[0_0_20px_rgba(255,47,179,0.35)]">
              <span className="text-3xl font-black leading-none tabular-nums text-white drop-shadow-[0_0_12px_rgba(255,47,179,0.7)] sm:text-4xl">
                {targetQty}
              </span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-pink-200">
                {targetUnit}
              </span>
            </div>
          </div>

          {/* Price nudge */}
          <p className="mt-3 text-sm text-purple-100">
            {incrementalLabel ? (
              <>
                Only <span className="text-base font-extrabold text-white">{incrementalLabel}</span> more
              </>
            ) : (
              <>
                Upgrade to {targetQty} {targetUnitLower}
              </>
            )}
            {savingsPence > 0 && (
              <span className="ml-1 text-emerald-300">· save {formatGBP(savingsPence)}</span>
            )}
          </p>

          {/* Gold upgrade CTA — deliberately distinct from the Pay button */}
          <button
            type="button"
            onClick={onUnlock}
            disabled={disabled}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#FFE49A] via-[#FBC53D] to-[#F7A600] px-4 py-3.5 text-base font-extrabold uppercase tracking-wide text-[#3a2600] shadow-[0_0_26px_rgba(247,166,0,0.55)] ring-1 ring-[#FFE9A8]/70 transition-transform duration-200 hover:-translate-y-px hover:shadow-[0_0_34px_rgba(247,166,0,0.75)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Crown className="h-4 w-4" aria-hidden="true" />
            {`Unlock my ${targetQty} ${targetUnitLower}`}
          </button>

          {/* Benefit row */}
          <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-purple-200/90">
            {instantsRemain && (
              <span className="inline-flex items-center gap-1">
                <Zap className="h-3 w-3 text-yellow-300" aria-hidden="true" />
                Instant win chance
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Trophy className="h-3 w-3 text-yellow-300" aria-hidden="true" />
              Every ticket enters the final draw
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * CSS-ONLY entrance for the mobile boost sheet: backdrop opacity fade + panel
 * slide-up. No JS animation loop, no library. Reduced-motion users get an
 * instant (non-sliding) appearance and keep the static neon glow (the moving
 * perimeter/pulse is disabled by ECB_STYLES' own reduced-motion rule).
 */
const SHEET_STYLES = `
.boost-backdrop { opacity: 0; transition: opacity 300ms ease; }
.boost-backdrop[data-visible="true"] { opacity: 1; }
.boost-panel { transform: translateY(100%); transition: transform 440ms cubic-bezier(0.22,1,0.36,1); will-change: transform; }
.boost-panel[data-visible="true"] { transform: translateY(0); }
@media (prefers-reduced-motion: reduce) {
  .boost-backdrop { transition: opacity 120ms ease; }
  .boost-panel { transition: none; transform: translateY(0); }
}
`

/**
 * Mobile-only "Exclusive Chance Boost" bottom sheet. Pure presentation: it holds
 * NO pricing or checkout logic. Accepting calls onUnlock (wired by the parent to
 * the existing selectOption()); dismissing / close / backdrop / ESC all call
 * onDismiss. Body scroll is locked while mounted and focus is moved into the
 * panel, then restored on unmount. The parent gates the mount to mobile only.
 */
function MobileBoostSheet({
  visible,
  success,
  currentQty,
  targetQty,
  incrementalLabel,
  savingsPence,
  instantState,
  remainingCount,
  heroCashLabel,
  disabled,
  onUnlock,
  onDismiss,
}: {
  visible: boolean
  success: boolean
  currentQty: number
  targetQty: number
  incrementalLabel: string | null
  savingsPence: number
  instantState: InstantHookState
  remainingCount: number
  heroCashLabel: string | null
  disabled: boolean
  onUnlock: () => void
  onDismiss: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Lock body scroll and trap focus while the sheet is mounted. The parent
    // only mounts this on mobile, so desktop scroll is never affected.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 60)
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(focusTimer)
      previouslyFocused?.focus?.()
    }
  }, [onDismiss])

  const currentUnit = currentQty === 1 ? 'CHANCE' : 'CHANCES'
  const targetUnit = targetQty === 1 ? 'CHANCE' : 'CHANCES'
  const targetUnitLower = targetUnit.toLowerCase()
  const declineUnit = currentQty === 1 ? 'chance' : 'chances'
  const instantsRemain = instantState === 'hero_cash' || instantState === 'generic'

  return (
    <div
      className="fixed inset-0 z-[60] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Exclusive Chance Boost"
    >
      <style dangerouslySetInnerHTML={{ __html: ECB_STYLES + SHEET_STYLES }} />

      {/* Backdrop — tap to dismiss */}
      <button
        type="button"
        aria-label="Close offer"
        onClick={onDismiss}
        data-visible={visible}
        className="boost-backdrop absolute inset-0 h-full w-full cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* Sheet panel — anchored bottom, capped height so checkout stays visible */}
      <div
        ref={panelRef}
        tabIndex={-1}
        data-visible={visible}
        className="boost-panel ecb-card absolute inset-x-0 bottom-0 max-h-[62vh] overflow-hidden rounded-t-3xl bg-[#0b0416] outline-none"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        {/* Radial illumination */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 18%, rgba(255,47,179,0.18), rgba(139,92,246,0.06) 45%, transparent 68%)',
          }}
        />

        {/* Close control — z-20 keeps it above the neon ring (::before z-1) and
            the ecb-inner content (z-2); it must NOT use ecb-inner, whose
            position:relative would cancel this absolute placement. */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close offer"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-purple-200 transition-colors hover:bg-white/20 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="ecb-inner flex flex-col items-center px-5 pt-5 text-center">
          {success ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 py-8">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 shadow-[0_0_28px_rgba(16,185,129,0.5)]">
                <Check className="h-7 w-7" aria-hidden="true" />
              </span>
              <p className="mt-1 text-lg font-extrabold uppercase tracking-wide text-white">Boost unlocked</p>
              <p className="text-sm text-purple-100">
                You now have{' '}
                <span className="font-bold text-white">
                  {targetQty} {targetUnitLower}
                </span>
              </p>
            </div>
          ) : (
            <>
              {/* Gold exclusivity pill */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-black shadow-[0_0_16px_rgba(247,166,0,0.5)]">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Selected for you
              </span>

              <h2 className="mt-2.5 text-xl font-extrabold uppercase tracking-tight text-white">
                Exclusive Chance Boost
              </h2>
              <p className="mt-1 text-xs text-purple-200/90">
                You&apos;ve unlocked a special upgrade before checkout
              </p>

              {/* Instant-win hook (same safe logic as the desktop card) */}
              {instantState === 'hero_cash' && heroCashLabel && (
                <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-pink-400/40 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100">
                  <Flame className="h-3.5 w-3.5 text-pink-300" aria-hidden="true" />
                  {`${heroCashLabel} INSTANT STILL LIVE`}
                </p>
              )}
              {instantState === 'generic' && (
                <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-pink-400/40 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100">
                  <Zap className="h-3.5 w-3.5 text-pink-300" aria-hidden="true" />
                  {remainingCount > 0
                    ? `INSTANT WINS STILL LIVE · ${remainingCount} left`
                    : 'INSTANT WINS STILL LIVE'}
                </p>
              )}
              {instantState === 'none' && (
                <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-yellow-400/40 bg-yellow-500/15 px-3 py-1 text-xs font-bold text-yellow-100">
                  <Trophy className="h-3.5 w-3.5 text-yellow-300" aria-hidden="true" />
                  MORE CHANCES AT THE FINAL PRIZE
                </p>
              )}

              {/* Quantity comparison — the focal point */}
              <div className="mt-4 flex w-full items-stretch justify-center gap-3">
                <div className="flex min-w-[76px] flex-col items-center justify-center rounded-xl border border-purple-500/30 bg-white/5 px-3 py-2">
                  <span className="text-2xl font-extrabold leading-none tabular-nums text-purple-100">
                    {currentQty}
                  </span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
                    {currentUnit}
                  </span>
                </div>
                <div className="flex items-center">
                  <span
                    aria-hidden="true"
                    className="text-2xl font-black text-pink-300 drop-shadow-[0_0_10px_rgba(255,47,179,0.7)]"
                  >
                    →
                  </span>
                </div>
                <div className="flex min-w-[76px] flex-col items-center justify-center rounded-xl border border-pink-400/60 bg-gradient-to-br from-pink-500/25 to-purple-500/15 px-3 py-2 shadow-[0_0_20px_rgba(255,47,179,0.35)]">
                  <span className="text-3xl font-black leading-none tabular-nums text-white drop-shadow-[0_0_12px_rgba(255,47,179,0.7)]">
                    {targetQty}
                  </span>
                  <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-pink-200">
                    {targetUnit}
                  </span>
                </div>
              </div>

              {/* Price nudge */}
              <p className="mt-3 text-sm text-purple-100">
                {incrementalLabel ? (
                  <>
                    Only <span className="text-lg font-extrabold text-white">{incrementalLabel}</span> more
                  </>
                ) : (
                  <>
                    Upgrade to {targetQty} {targetUnitLower}
                  </>
                )}
                {savingsPence > 0 && (
                  <span className="ml-1 text-emerald-300">· save {formatGBP(savingsPence)}</span>
                )}
              </p>

              {/* Gold unlock CTA */}
              <button
                type="button"
                onClick={onUnlock}
                disabled={disabled}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#FFE49A] via-[#FBC53D] to-[#F7A600] px-4 py-3.5 text-base font-extrabold uppercase tracking-wide text-[#3a2600] shadow-[0_0_26px_rgba(247,166,0,0.55)] ring-1 ring-[#FFE9A8]/70 transition-transform duration-200 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Crown className="h-4 w-4" aria-hidden="true" />
                {`Unlock my ${targetQty} ${targetUnitLower}`}
              </button>

              {/* Respectful decline */}
              <button
                type="button"
                onClick={onDismiss}
                disabled={disabled}
                className="mt-2.5 text-xs font-medium text-purple-300 underline underline-offset-2 transition-colors hover:text-white disabled:opacity-50"
              >
                No thanks — keep my {currentQty} {declineUnit}
              </button>

              {/* Compact benefit strip */}
              <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-purple-200/90">
                {instantsRemain && (
                  <span className="inline-flex items-center gap-1">
                    <Zap className="h-3 w-3 text-yellow-300" aria-hidden="true" />
                    Instant win chance
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Trophy className="h-3 w-3 text-yellow-300" aria-hidden="true" />
                  Every ticket enters the final draw
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface CheckoutReviewClientProps {
  campaignId: string
  slug: string | null
  title: string
  prizeTitle: string | null
  prizeValueText: string | null
  heroImageUrl: string | null
  ticketPricePence: number
  options: ReviewOption[]
  initialKey: string
  availableWalletPence: number
  instantWins: InstantWinSummary | null
}

export function CheckoutReviewClient({
  campaignId,
  slug,
  title,
  prizeTitle,
  prizeValueText,
  heroImageUrl,
  ticketPricePence,
  options,
  initialKey,
  availableWalletPence,
  instantWins,
}: CheckoutReviewClientProps) {
  // The toggle is OFF by default on every page load and is NOT persisted.
  const [useCredit, setUseCredit] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ---- Inline "Confirm your name" form -------------------------------------
  // Shown ONLY when the server reports the stored name is missing/invalid for a
  // payment. Customers with a valid stored name never see it and pay a zero
  // extra-request cost. The completed form reuses the SAME checkout ref and
  // continues to the payment page in a single request.
  const [nameFormOpen, setNameFormOpen] = useState(false)
  const [pendingRef, setPendingRef] = useState<string | null>(null)
  const [nameFirst, setNameFirst] = useState('')
  const [nameLast, setNameLast] = useState('')
  const [nameFirstError, setNameFirstError] = useState<string | null>(null)
  const [nameLastError, setNameLastError] = useState<string | null>(null)
  const [nameSubmitting, setNameSubmitting] = useState(false)
  // Which field(s) the server actually needs. Fields we already legitimately
  // hold are prefilled and shown read-only so the customer never retypes them.
  // Defaults to both until the server tells us otherwise.
  const [nameRequiredFields, setNameRequiredFields] = useState<Array<'first_name' | 'last_name'>>([
    'first_name',
    'last_name',
  ])
  const firstNameRequired = nameRequiredFields.includes('first_name')
  const lastNameRequired = nameRequiredFields.includes('last_name')
  // Synchronous latch mirroring submitLatch — blocks rapid double submits of the
  // name form before React state settles.
  const nameSubmitLatch = useRef(false)

  // Selected ticket option. Defaults to the option the customer arrived with.
  const [selectedKey, setSelectedKey] = useState(initialKey)
  const [showAllOptions, setShowAllOptions] = useState(false)
  // Local, non-persisted: once the customer accepts the boost we do not offer it
  // again for this Review visit (one upsell per visit). Nothing is stored.
  const [upsellAccepted, setUpsellAccepted] = useState(false)

  // ---- Mobile Exclusive Chance Boost sheet (presentation only) -------------
  // sheetMounted = in DOM; sheetVisible = transition target (drives slide/fade);
  // sheetDecided = accepted or dismissed this visit (never auto-reopens);
  // sheetSuccess = brief "✓ Boost unlocked" state before auto-close. All local,
  // no persistence, no requests.
  const [sheetMounted, setSheetMounted] = useState(false)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [sheetDecided, setSheetDecided] = useState(false)
  const [sheetSuccess, setSheetSuccess] = useState(false)
  // The offer is FROZEN when the sheet opens (the "from" qty + the target
  // option), so accepting — which changes `selected` and re-derives
  // `recommended` to the next tier — never mutates the offer the customer is
  // currently looking at. This is what the sheet renders.
  const [sheetOffer, setSheetOffer] = useState<{
    fromQty: number
    option: ReviewOption
    incrementalLabel: string | null
  } | null>(null)

  // ---- Discount code -------------------------------------------------------
  // All apply / remove / invalidation / idempotency-key logic lives in the pure
  // `discountUiState` reducer so it is unit-testable without a DOM.
  const [discountState, dispatchDiscount] = useReducer(
    discountUiReducer,
    undefined,
    () => initDiscountUiState(createIdempotencyKey()),
  )
  // Monotonic token so a slow validation response for a code the shopper has
  // since changed/removed is ignored (prevents a stale "applied" flash).
  const discountReqId = useRef(0)

  // Synchronous latch: set BEFORE the first await so a rapid double-click can
  // never create two checkout intents. React state alone is not synchronous
  // enough to guarantee this.
  const submitLatch = useRef(false)

  // Resolve the current selection to a concrete, server-supplied option.
  const initialOption = useMemo(
    () => options.find((o) => o.key === initialKey) ?? options[0],
    [options, initialKey],
  )
  const selected = useMemo(
    () => options.find((o) => o.key === selectedKey) ?? initialOption,
    [options, selectedKey, initialOption],
  )

  // Authoritative-for-display selection values (all from the server option).
  const qty = selected.qty
  const validatedBundlePricePence = selected.bundlePricePence
  const displayTotalPence = selected.totalPence
  const hasBundle = validatedBundlePricePence != null

  const walletDisabled = availableWalletPence <= 0
  const walletVisible = availableWalletPence > 0

  // Effective (discounted) total the shopper actually pays. When a discount is
  // applied we use the server's authoritative discounted total; otherwise the
  // base option total. Everything below prices against this value so the
  // preview, WTF Credit split and CTA all reflect the discount.
  const discountPence = selectDiscountPence(discountState)
  const effectiveTotalPence = selectEffectiveTotalPence(discountState, displayTotalPence)

  // Display-only credit preview. This is NEVER treated as authoritative — the
  // create API (and the DB function) compute the real split. No API call and no
  // reservation happens when the toggle changes.
  const previewCreditPence = useCredit ? Math.min(availableWalletPence, effectiveTotalPence) : 0
  const previewExternalPence = effectiveTotalPence - previewCreditPence
  const fullyFunded = useCredit && previewExternalPence <= 0 && effectiveTotalPence > 0

  // Recommend a larger EXISTING option for the "Exclusive Chance Boost". Only
  // options that offer MORE chances at a higher total qualify (so the price
  // nudge is always a real, positive difference). A preferred round tier is
  // chosen when it exists; otherwise the nearest sensible larger option. Never
  // invents a quantity, bundle or price.
  const recommended = useMemo(() => {
    const larger = options
      .filter((o) => o.qty > selected.qty && o.totalPence > selected.totalPence)
      .sort((a, b) => a.qty - b.qty || a.totalPence - b.totalPence)
    if (larger.length === 0) return null

    let preferredQty: number | null = null
    if (selected.qty < 10) preferredQty = 10
    else if (selected.qty < 20) preferredQty = 20
    else if (selected.qty < 40) preferredQty = 50

    if (preferredQty != null) {
      const preferred = larger.find((o) => o.qty === preferredQty)
      if (preferred) return preferred
    }
    // Nearest sensible larger option (smallest qualifying upgrade).
    return larger[0]
  }, [options, selected])

  // Other valid options the customer could switch to (excludes the current one).
  const otherOptions = useMemo(
    () => options.filter((o) => o.key !== selected.key),
    [options, selected],
  )

  const backHref = slug ? `/giveaways/${slug}` : '/giveaways'
  const perUnitPence = hasBundle && qty > 0 ? Math.round(displayTotalPence / qty) : ticketPricePence

  // ---- Exclusive Chance Boost (upsell) — all display-only, all local --------
  const boostVisible = recommended != null && !upsellAccepted
  const boostDeltaPence = recommended ? Math.max(recommended.totalPence - displayTotalPence, 0) : 0
  // Only show a precise "£X more" when neither a discount nor WTF Credit is in
  // play — either would make the simple base-total delta misleading.
  const boostPriceSafe = discountPence <= 0 && !useCredit
  const boostIncrementalLabel = boostPriceSafe && boostDeltaPence > 0 ? formatGBP(boostDeltaPence) : null
  const instantRemaining = instantWins?.remainingCount ?? 0
  const instantHeroLabel = instantWins?.heroCashLabel ?? null
  const instantState: InstantHookState = instantHeroLabel
    ? 'hero_cash'
    : instantRemaining > 0
      ? 'generic'
      : 'none'

  /** Preserve campaignId, selected qty and bundlePricePence in the review URL. */
  function buildReviewUrl(): string {
    const params = new URLSearchParams()
    params.set('campaignId', campaignId)
    params.set('qty', String(qty))
    if (validatedBundlePricePence != null) {
      params.set('bundlePricePence', String(validatedBundlePricePence))
    }
    return `/checkout/review?${params.toString()}`
  }

  function redirectToLogin() {
    const redirect = encodeURIComponent(buildReviewUrl())
    window.location.href = `/auth/login?redirect=${redirect}`
  }

  /**
   * Clear the busy state after a TRANSIENT failure so the customer can retry.
   * Deterministic name problems are handled separately by opening the inline
   * name form (see openNameForm), not by this path.
   */
  function releaseForRetry(code?: unknown) {
    setError(friendlyError(code))
    setStatus(null)
    setSubmitting(false)
    submitLatch.current = false
  }

  /**
   * Open (or refresh) the inline name form after the server reports a missing/
   * invalid name. Preserves the checkout ref so submission continues the SAME
   * checkout. When `fromSubmit` is true the name we just sent was rejected by
   * the provider, so we flag the offending field(s) inline.
   */
  function openNameForm(
    ref: string,
    requiredFields: unknown,
    fromSubmit: boolean,
    knownFields?: unknown,
  ) {
    const fields = (
      Array.isArray(requiredFields)
        ? requiredFields.filter((f) => f === 'first_name' || f === 'last_name')
        : []
    ) as Array<'first_name' | 'last_name'>
    // Prefill whatever the server already legitimately holds so the customer
    // only fills the gap. Any field the server did NOT return stays required.
    const known = knownFields && typeof knownFields === 'object' ? (knownFields as Record<string, unknown>) : {}
    const knownFirst = typeof known.first_name === 'string' ? known.first_name : ''
    const knownLast = typeof known.last_name === 'string' ? known.last_name : ''
    if (knownFirst) setNameFirst(knownFirst)
    if (knownLast) setNameLast(knownLast)
    setNameRequiredFields(fields.length > 0 ? fields : ['first_name', 'last_name'])
    setPendingRef(ref)
    setNameFormOpen(true)
    setError(null)
    setStatus(null)
    setSubmitting(false)
    submitLatch.current = false
    if (fromSubmit) {
      const msg = 'Please check this name and try again.'
      if (fields.length === 0 || fields.includes('first_name')) setNameFirstError(msg)
      if (fields.length === 0 || fields.includes('last_name')) setNameLastError(msg)
    }
  }

  /**
   * Validate the inline form locally (mirroring the server's Acquired-confirmed
   * rules), then continue the EXISTING checkout in a single request that saves
   * the name and returns the payment redirect. No page reload; the basket,
   * checkout intent and any wallet reservation are all preserved.
   */
  async function submitName() {
    if (nameSubmitLatch.current || nameSubmitting) return
    const first = validateCustomerName(nameFirst, 'first_name')
    if (!first.ok) {
      setNameFirstError(
        first.error === 'customer_name_required'
          ? 'Enter your first name to continue.'
          : 'Please check this name and try again.',
      )
      return
    }
    const last = validateCustomerName(nameLast, 'last_name')
    if (!last.ok) {
      setNameLastError(
        last.error === 'customer_name_required'
          ? 'Enter your surname to continue.'
          : 'Please check this name and try again.',
      )
      return
    }
    const ref = pendingRef
    if (!ref) {
      // No checkout context to continue — fall back to a normal retry.
      setNameFormOpen(false)
      releaseForRetry()
      return
    }
    nameSubmitLatch.current = true
    setNameSubmitting(true)
    setNameFirstError(null)
    setNameLastError(null)
    try {
      await goToAcquired(ref, { firstName: nameFirst, lastName: nameLast })
    } catch {
      setNameFormOpen(false)
      releaseForRetry()
    } finally {
      nameSubmitLatch.current = false
      setNameSubmitting(false)
    }
  }

  function onNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    // Respect CJK IME composition (and Safari's unreliable final event).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void submitName()
  }

  function selectOption(key: string) {
    if (submitting || nameFormOpen) return
    setError(null)
    setSelectedKey(key)
  }

  /**
   * Accept the Exclusive Chance Boost. Uses ONLY the existing selectOption()
   * mechanism (which changes `selected`, and therefore the quantity display,
   * order total, discount/wallet previews and the Pay button, all naturally).
   * No API call, no URL change, no checkout mutation. We then hide the offer so
   * it is not shown again this visit.
   */
  function acceptBoost() {
    if (!recommended || submitting || nameFormOpen) return
    selectOption(recommended.key)
    setUpsellAccepted(true)
  }

  // Auto-present the mobile boost sheet ~400ms after render (mobile only). The
  // small delay lets the Review page settle first, so the offer feels unlocked
  // rather than injected. Desktop uses the inline card and never opens a sheet.
  useEffect(() => {
    if (sheetDecided || upsellAccepted || !recommended) return
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    const openTimer = window.setTimeout(() => {
      // Freeze the offer at open time (from-qty + target option + the price
      // nudge) so later recomputation of `recommended`/`selected` never shifts
      // what the sheet shows. The sheet auto-opens before any discount/credit
      // entry, so the captured label is accurate for this offer.
      setSheetOffer({ fromQty: qty, option: recommended, incrementalLabel: boostIncrementalLabel })
      setSheetMounted(true)
      // Commit the off-screen transform for two frames so the slide-up plays.
      requestAnimationFrame(() => requestAnimationFrame(() => setSheetVisible(true)))
    }, 400)
    return () => window.clearTimeout(openTimer)
    // Intentionally runs once for the initial recommendation; acceptance/dismissal
    // set the guards above so it never re-triggers during this visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Dismiss the sheet (close / decline / backdrop / ESC). Never reopens. */
  function dismissBoostSheet() {
    setSheetVisible(false)
    setSheetDecided(true)
    window.setTimeout(() => setSheetMounted(false), 320)
  }

  /**
   * Accept from the sheet: identical to acceptBoost() (existing selectOption()
   * only) but against the FROZEN offer, then show a brief success state and
   * auto-close. No request, no new quantity mechanism.
   */
  function acceptBoostFromSheet() {
    if (!sheetOffer || submitting || nameFormOpen) return
    selectOption(sheetOffer.option.key)
    setUpsellAccepted(true)
    setSheetSuccess(true)
    window.setTimeout(() => {
      setSheetVisible(false)
      setSheetDecided(true)
      window.setTimeout(() => setSheetMounted(false), 320)
    }, 600)
  }

  function onDiscountInputChange(value: string) {
    // Editing invalidates any applied code / shown error and rotates the
    // idempotency key (pricing inputs are changing).
    dispatchDiscount({ type: 'inputChanged', value, nextKey: createIdempotencyKey() })
  }

  function onRemoveDiscount() {
    // Ignore in-flight validation results and revert to the base total.
    discountReqId.current += 1
    dispatchDiscount({ type: 'remove', nextKey: createIdempotencyKey() })
    setError(null)
  }

  async function applyDiscount() {
    const normalized = normalizeDiscountCode(discountState.input)
    if (!normalized.ok || discountState.status === 'validating') return

    const reqId = ++discountReqId.current
    dispatchDiscount({ type: 'validateStart' })

    let json: Record<string, unknown>
    try {
      const res = await fetch('/api/checkout/discount/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          qty,
          ...(validatedBundlePricePence != null ? { bundlePricePence: validatedBundlePricePence } : {}),
          code: normalized.code,
        }),
      })
      if (res.status === 401) {
        redirectToLogin()
        return
      }
      json = (await res.json()) as Record<string, unknown>
    } catch {
      // Network/parse failure — treat as a transient validation failure.
      if (reqId === discountReqId.current) {
        dispatchDiscount({ type: 'validateError', code: 'discount_code_validation_failed' })
      }
      return
    }

    // The shopper changed/removed the code while this request was in flight —
    // drop this stale response entirely.
    if (reqId !== discountReqId.current) return

    if (
      json.ok === true &&
      json.pricing &&
      typeof json.pricing === 'object' &&
      json.discount &&
      typeof json.discount === 'object'
    ) {
      const pricing = json.pricing as Record<string, unknown>
      const discount = json.discount as Record<string, unknown>
      const toInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : Number.NaN)
      const subtotalPence = toInt(pricing.subtotalPence)
      const discPence = toInt(pricing.discountPence)
      const totalPence = toInt(pricing.totalPence)

      // Guard the authoritative shape before applying.
      if (
        discount &&
        typeof discount.code === 'string' &&
        (discount.discountType === 'fixed' || discount.discountType === 'percentage') &&
        (discount.scope === 'site_wide' || discount.scope === 'campaign') &&
        Number.isInteger(subtotalPence) &&
        Number.isInteger(discPence) &&
        discPence > 0 &&
        Number.isInteger(totalPence) &&
        totalPence > 0 &&
        totalPence < subtotalPence
      ) {
        const applied: AppliedDiscount = {
          code: discount.code,
          discountType: discount.discountType,
          discountValue: Number(discount.discountValue),
          scope: discount.scope,
          subtotalPence,
          discountPence: discPence,
          totalPence,
        }
        dispatchDiscount({ type: 'validateSuccess', applied, nextKey: createIdempotencyKey() })
        return
      }
      // A success response we cannot trust — surface a safe generic error.
      dispatchDiscount({ type: 'validateError', code: 'discount_code_validation_failed' })
      return
    }

    const code = typeof json.error === 'string' ? json.error : 'discount_code_invalid'
    dispatchDiscount({ type: 'validateError', code })
  }

  async function handleConfirm() {
    // While the inline name form is open the pay button is inert — the form's
    // own "Save and continue" action drives the (single-request) continuation.
    if (nameFormOpen) return
    // Synchronous guard — set the latch before any await.
    if (submitLatch.current) return
    submitLatch.current = true
    setSubmitting(true)
    setError(null)
    setStatus('Preparing checkout…')

    try {
      if (useCredit) setStatus('Applying WTF Credit…')

      const createRes = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildCreateCheckoutBody({
            state: discountState,
            campaignId,
            qty,
            bundlePricePence: validatedBundlePricePence ?? undefined,
            useCredit,
          }),
        ),
      })

      if (createRes.status === 401) {
        redirectToLogin()
        return
      }

      let createJson: Record<string, unknown>
      try {
        createJson = (await createRes.json()) as Record<string, unknown>
      } catch {
        releaseForRetry()
        return
      }

      if (!createRes.ok || createJson.ok !== true) {
        const code = typeof createJson.error === 'string' ? createJson.error : undefined
        // A finalized/expired reservation means this checkout session is spent.
        // Reset the discount (rotating the idempotency key to a fresh request)
        // and show a clear "start again" message.
        if (isCheckoutExpired(code)) {
          discountReqId.current += 1
          dispatchDiscount({ type: 'remove', nextKey: createIdempotencyKey() })
          setError(checkoutErrorMessage(code))
          setStatus(null)
          setSubmitting(false)
          submitLatch.current = false
          return
        }
        // Discount rejections carry a discount_code_* code — surface friendly
        // copy; other codes fall through to the existing name/transient handling.
        if (code && code.startsWith('discount_code_')) {
          setError(checkoutErrorMessage(code))
          setStatus(null)
          setSubmitting(false)
          submitLatch.current = false
          return
        }
        releaseForRetry(createJson.error)
        return
      }

      // Authoritative discounted total from the create response. Falls back to
      // the display total for older responses without a pricing block.
      const pricingBlock = createJson.pricing as Record<string, unknown> | undefined
      const authoritativeTotalPence =
        pricingBlock && isNonNegInt(pricingBlock.totalPence) ? pricingBlock.totalPence : displayTotalPence

      const ref = createJson.ref
      if (typeof ref !== 'string' || ref.length === 0 || ref.length > 128) {
        releaseForRetry()
        return
      }

      const wallet = createJson.wallet as Record<string, unknown> | undefined

      // The wallet object must be consistent with what the user actually
      // submitted (state captured at submit time):
      //   - useCredit === false -> a wallet object must NOT control routing;
      //   - useCredit === true  -> a valid wallet object is REQUIRED.
      const submittedUseCredit = useCredit

      if (!submittedUseCredit) {
        // A wallet object here is contradictory — never let it route payment.
        if (wallet !== undefined) {
          releaseForRetry()
          return
        }
        // Branch A — plain, non-wallet provider flow (unchanged behaviour).
        await goToProvider(ref)
        return
      }

      // submittedUseCredit === true from here.
      if (wallet === undefined) {
        releaseForRetry()
        return
      }

      // Validate the wallet split. Bad counters/flags, an unsafe sum, or a sum
      // that does not equal the server-rendered display total => malformed.
      const walletCreditPence = wallet.walletCreditPence
      const externalPaymentPence = wallet.externalPaymentPence
      const providerPaymentRequired = wallet.providerPaymentRequired
      const sum =
        isNonNegInt(walletCreditPence) && isNonNegInt(externalPaymentPence)
          ? walletCreditPence + externalPaymentPence
          : Number.NaN
      const validWallet =
        wallet.useCredit === true &&
        isNonNegInt(walletCreditPence) &&
        isNonNegInt(externalPaymentPence) &&
        typeof providerPaymentRequired === 'boolean' &&
        Number.isSafeInteger(sum) &&
        sum === authoritativeTotalPence
      if (!validWallet) {
        releaseForRetry()
        return
      }

      const externalPence = externalPaymentPence as number
      const providerRequired = providerPaymentRequired as boolean

      // Only two consistent combinations are permitted; every other pairing is
      // contradictory and must call NO payment provider.
      const isFullyFunded = externalPence === 0 && providerRequired === false
      const isPartial = externalPence > 0 && providerRequired === true

      // Branch C — fully WTF Credit-funded: never call a PSP. Confirm directly.
      if (isFullyFunded) {
        setStatus('Confirming your entry…')
        const confirmRes = await fetch('/api/checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref, provider: 'wallet' }),
        })

        if (confirmRes.status === 401) {
          redirectToLogin()
          return
        }

        let confirmJson: Record<string, unknown>
        try {
          confirmJson = (await confirmRes.json()) as Record<string, unknown>
        } catch {
          releaseForRetry()
          return
        }

        if (!confirmRes.ok || confirmJson.ok !== true) {
          releaseForRetry(confirmJson.error)
          return
        }

        // Award must be a NON-NULL, NON-ARRAY object. Arrays, primitives and
        // null are malformed and must NOT navigate to success.
        const award = confirmJson.award
        if (typeof award !== 'object' || award === null || Array.isArray(award)) {
          releaseForRetry()
          return
        }

        setStatus('Taking you to your entry…')
        window.location.assign(`/checkout/success?ref=${encodeURIComponent(ref)}&provider=wallet`)
        return
      }

      // Branch B — partial WTF Credit (external payment still due). Wallet
      // partial payments ALWAYS use the implemented Acquired route (never SumUp).
      if (isPartial) {
        setStatus('Taking you to secure payment…')
        await goToAcquired(ref)
        return
      }

      // Contradictory split (external 0 + providerPaymentRequired true, or
      // external > 0 + providerPaymentRequired false). Fail locally; call no PSP.
      releaseForRetry()
      return
    } catch {
      releaseForRetry()
    }
  }

  /** Non-wallet provider routing, mirroring the previous TicketSelector flow. */
  async function goToProvider(ref: string) {
    const useAcquired =
      (process.env.NEXT_PUBLIC_CHECKOUT_PROVIDER ?? '').trim().toLowerCase() === 'acquired'

    setStatus('Taking you to secure payment…')

    if (useAcquired) {
      await goToAcquired(ref)
      return
    }

    // SumUp fallback (rollback switch) — unchanged behaviour.
    const sumupRes = await fetch('/api/payments/sumup/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref }),
    })

    if (sumupRes.status === 401) {
      redirectToLogin()
      return
    }

    let sumupJson: Record<string, unknown>
    try {
      sumupJson = (await sumupRes.json()) as Record<string, unknown>
    } catch {
      releaseForRetry()
      return
    }

    const checkoutUrl = sumupJson.checkoutUrl
    if (sumupRes.ok && sumupJson.ok === true && typeof checkoutUrl === 'string' && checkoutUrl.length > 0) {
      window.location.assign(checkoutUrl)
      return
    }

    releaseForRetry(sumupJson.error)
  }

  /**
   * Acquired Hosted Checkout — authoritative for the external amount. When
   * `names` is supplied (the inline form submission) they ride along on the
   * SAME request that saves the name and returns the payment redirect, so the
   * correction flow costs exactly one request.
   */
  async function goToAcquired(ref: string, names?: { firstName: string; lastName: string }) {
    const acquiredRes = await fetch('/api/payments/acquired/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        names ? { ref, firstName: names.firstName, lastName: names.lastName } : { ref },
      ),
    })

    if (acquiredRes.status === 401) {
      redirectToLogin()
      return
    }

    let acquiredJson: Record<string, unknown>
    try {
      acquiredJson = (await acquiredRes.json()) as Record<string, unknown>
    } catch {
      releaseForRetry()
      return
    }

    const checkoutUrl = acquiredJson.checkout_url
    if (
      acquiredRes.ok &&
      acquiredJson.ok === true &&
      typeof checkoutUrl === 'string' &&
      checkoutUrl.length > 0
    ) {
      // Success — leave for the hosted payment page. Ensure the form is closed.
      setNameFormOpen(false)
      window.location.assign(checkoutUrl)
      return
    }

    // Deterministic name problem: open (or keep) the inline form rather than a
    // blind retry. `names` present means the provider rejected what we just
    // sent, so flag the field(s).
    if (isNameError(acquiredJson.error)) {
      openNameForm(ref, acquiredJson.requiredFields, Boolean(names), acquiredJson.knownFields)
      return
    }

    // Any other failure is transient. If the name was just saved it stays saved;
    // close the form and fall back to the normal retryable error.
    setNameFormOpen(false)
    releaseForRetry(acquiredJson.error)
  }

  // ---- Dynamic CTA wording (display only — the backend stays authoritative) --
  let ctaLabel: string
  if (!useCredit || previewCreditPence <= 0) {
    ctaLabel = `Pay ${formatGBP(effectiveTotalPence)} securely`
  } else if (previewExternalPence > 0) {
    ctaLabel = `Use ${formatGBP(previewCreditPence)} credit & pay ${formatGBP(previewExternalPence)}`
  } else {
    ctaLabel = `Enter using ${formatGBP(previewCreditPence)} WTF Credit`
  }

  const primaryButton = (
    <Button
      size="lg"
      onClick={handleConfirm}
      disabled={submitting || nameFormOpen}
      className="w-full rounded-xl bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] py-4 text-base font-bold text-black shadow-[0_10px_40px_rgba(255,180,0,0.4)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? (
        <span className="flex items-center justify-center gap-2">
          <Spinner className="h-5 w-5" />
          {status ?? 'Processing…'}
        </span>
      ) : (
        ctaLabel
      )}
    </Button>
  )

  // Inline "Confirm your name" form. Rendered in place of the pay button when
  // the server reports the stored name is missing/invalid. Submitting continues
  // the SAME checkout (single request) — no page reload, basket/wallet intact.
  const nameForm = (
    <div className="space-y-3 rounded-xl border border-purple-500/30 bg-white/5 p-4">
      <div>
        <p className="text-sm font-bold text-white">One quick detail</p>
        <p className="mt-1 text-xs text-purple-200">
          We just need your full name before we can continue to payment.
        </p>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="checkout-first-name" className="text-xs text-purple-100">
            First name
          </Label>
          <Input
            id="checkout-first-name"
            type="text"
            autoComplete="given-name"
            required={firstNameRequired}
            readOnly={!firstNameRequired}
            aria-invalid={Boolean(nameFirstError)}
            disabled={nameSubmitting}
            value={nameFirst}
            onChange={(e) => {
              setNameFirst(e.target.value)
              if (nameFirstError) setNameFirstError(null)
            }}
            onKeyDown={onNameKeyDown}
            className={
              firstNameRequired
                ? 'bg-white/10 text-white placeholder:text-purple-300'
                : 'bg-white/5 text-purple-100 placeholder:text-purple-300'
            }
          />
          {nameFirstError && <p className="text-xs text-red-300">{nameFirstError}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="checkout-last-name" className="text-xs text-purple-100">
            Last name
          </Label>
          <Input
            id="checkout-last-name"
            type="text"
            autoComplete="family-name"
            required={lastNameRequired}
            readOnly={!lastNameRequired}
            aria-invalid={Boolean(nameLastError)}
            disabled={nameSubmitting}
            value={nameLast}
            onChange={(e) => {
              setNameLast(e.target.value)
              if (nameLastError) setNameLastError(null)
            }}
            onKeyDown={onNameKeyDown}
            className={
              lastNameRequired
                ? 'bg-white/10 text-white placeholder:text-purple-300'
                : 'bg-white/5 text-purple-100 placeholder:text-purple-300'
            }
          />
          {nameLastError && <p className="text-xs text-red-300">{nameLastError}</p>}
        </div>
      </div>
      <Button
        type="button"
        size="lg"
        onClick={() => void submitName()}
        disabled={nameSubmitting}
        className="w-full rounded-xl bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] py-4 text-base font-bold text-black shadow-[0_10px_40px_rgba(255,180,0,0.4)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {nameSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner className="h-5 w-5" />
            Saving…
          </span>
        ) : (
          'Save & Continue'
        )}
      </Button>
    </div>
  )

  const trustRow = (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-purple-200">
      <span className="inline-flex items-center gap-1.5">
        <Lock className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
        Secure payment
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Ticket className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
        Tickets issued instantly
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-pink-400" aria-hidden="true" />
        Instant-win result revealed after entry
      </span>
    </div>
  )

  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-5 pb-[var(--checkout-pad)] lg:py-10 lg:pb-10"
      style={{ '--checkout-pad': 'calc(11rem + env(safe-area-inset-bottom))' } as CSSProperties}
    >
      {/* Progress indicator — compact on mobile */}
      <ol className="mx-auto mb-5 flex max-w-md items-center justify-center gap-1.5 text-[11px] font-semibold sm:gap-2 sm:text-xs">
        {[
          { n: 1, label: 'Review', active: true },
          { n: 2, label: 'Secure payment', active: false },
          { n: 3, label: 'Reveal', active: false },
        ].map((step, i) => (
          <li key={step.n} className="flex items-center gap-2">
            <span
              className={
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 sm:px-3 sm:py-1 ' +
                (step.active
                  ? 'bg-gradient-to-r from-[#F7A600] to-[#FFD46A] text-black shadow-[0_0_16px_rgba(255,180,0,0.5)]'
                  : 'bg-white/5 text-purple-300')
              }
            >
              <span
                className={
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px] ' +
                  (step.active ? 'bg-black/20 text-black' : 'bg-white/10 text-purple-200')
                }
              >
                {step.n}
              </span>
              {step.label}
            </span>
            {i < 2 && <span className="h-px w-4 bg-purple-500/30" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <Link
        href={backHref}
        aria-disabled={submitting}
        tabIndex={submitting ? -1 : undefined}
        onClick={(e) => {
          if (submitting) e.preventDefault()
        }}
        className={
          'mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-purple-300 transition-colors hover:text-white ' +
          (submitting ? 'pointer-events-none opacity-50' : '')
        }
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to giveaway
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* LEFT — campaign excitement */}
        <section className="min-w-0 space-y-4 lg:col-span-3">
          <div className="overflow-hidden rounded-2xl border border-purple-500/20 bg-[#160a26] shadow-[0_0_40px_rgba(168,85,247,0.15)]">
            {heroImageUrl && (
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-white/5">
                <Image
                  src={heroImageUrl || '/placeholder.svg'}
                  alt={prizeTitle ?? title}
                  fill
                  priority
                  sizes="(min-width: 1024px) 600px, 100vw"
                  className="object-contain"
                />
              </div>
            )}
            <div className="space-y-2 p-4 sm:p-5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pink-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                You&apos;re one step away from your tickets
              </span>
              <h1 className="text-balance break-words text-xl font-extrabold leading-tight sm:text-2xl">
                {title}
              </h1>
              {prizeTitle && prizeTitle !== title && (
                <p className="flex items-center gap-2 text-sm text-purple-200">
                  <Trophy className="h-4 w-4 shrink-0 text-yellow-300" aria-hidden="true" />
                  <span>
                    Win: <span className="font-semibold text-white">{prizeTitle}</span>
                  </span>
                </p>
              )}
              {prizeValueText && (
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-purple-300">Retail value</span>
                  <span className="text-lg font-bold text-yellow-300">{prizeValueText}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT — checkout summary */}
        <section className="min-w-0 space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-purple-500/20 bg-[#160a26] p-5 shadow-[0_0_40px_rgba(168,85,247,0.15)]">
            {/* Chances headline (moved in from the left column) */}
            <div className="text-center">
              <p className="text-xs font-medium text-purple-200">You&apos;re entering with</p>
              <p className="mt-0.5 text-balance break-words text-2xl font-extrabold leading-tight text-white drop-shadow-[0_0_18px_rgba(255,0,200,0.35)] sm:text-3xl">
                {qty} {qty === 1 ? 'chance' : 'chances'} to win
              </p>
              {selected.savingsPence > 0 && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  You&apos;re saving {formatGBP(selected.savingsPence)}
                </p>
              )}
            </div>

            <dl className="mt-4 space-y-2.5 border-t border-purple-500/15 pt-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-purple-200">{hasBundle ? 'Bundle price' : 'Price per ticket'}</dt>
                <dd className="font-semibold tabular-nums">
                  {hasBundle ? formatGBP(displayTotalPence) : formatGBP(perUnitPence)}
                </dd>
              </div>
              {selected.savingsPence > 0 && (
                <div className="flex items-center justify-between gap-4 text-emerald-300">
                  <dt>Bundle saving</dt>
                  <dd className="font-semibold tabular-nums">−{formatGBP(selected.savingsPence)}</dd>
                </div>
              )}
            </dl>

            {discountPence > 0 && (
              <div className="mt-2 flex items-center justify-between gap-4 text-sm text-emerald-300">
                <span>Discount ({discountState.applied?.code})</span>
                <span className="font-semibold tabular-nums">−{formatGBP(discountPence)}</span>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-white/5 p-4">
              <span className="text-sm font-semibold text-purple-100">Order total</span>
              <span className="text-2xl font-extrabold tabular-nums text-yellow-300">
                {formatGBP(effectiveTotalPence)}
              </span>
            </div>

            {/* EXCLUSIVE CHANCE BOOST — DESKTOP ONLY. Positioned directly below
                Order total and above Ways to save. Read-only + local: it only
                calls the existing selectOption() via onUnlock. On mobile the
                same offer is presented as an auto-opening bottom sheet instead
                (hidden here so the two never appear together). */}
            {boostVisible && recommended && (
              <div className="mt-4 hidden lg:block">
                <ExclusiveChanceBoost
                  currentQty={qty}
                  targetQty={recommended.qty}
                  incrementalLabel={boostIncrementalLabel}
                  savingsPence={recommended.savingsPence}
                  instantState={instantState}
                  remainingCount={instantRemaining}
                  heroCashLabel={instantHeroLabel}
                  disabled={submitting || nameFormOpen}
                  onUnlock={acceptBoost}
                />
              </div>
            )}

            {selectedKey !== initialKey && (
              <button
                type="button"
                onClick={() => selectOption(initialKey)}
                disabled={submitting}
                className="mt-3 text-xs font-medium text-purple-300 underline underline-offset-2 transition-colors hover:text-white disabled:opacity-50"
              >
                Back to {initialOption.qty} {initialOption.qty === 1 ? 'chance' : 'chances'}
              </button>
            )}

            {/* Ways to save — one unified module pairing the discount code and
                WTF Credit as two controls in a shared branded system. Discount
                is priced first; WTF Credit applies to the already-discounted
                total. */}
            <div className="mt-4 border-t border-purple-500/15 pt-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-purple-300">
                <Sparkles className="h-3.5 w-3.5 text-purple-300" aria-hidden="true" />
                Ways to save
              </p>

              <div className="space-y-2">
                <DiscountCodeField
                  state={discountState}
                  discountPence={discountPence}
                  formatGBP={formatGBP}
                  disabled={submitting || nameFormOpen}
                  onInputChange={onDiscountInputChange}
                  onApply={applyDiscount}
                  onRemove={onRemoveDiscount}
                />

                {/* WTF Credit — ALWAYS rendered for authenticated users, styled
                    as the second row in the savings pair. Gold active state when
                    on; a compact, disabled row when the balance is £0. */}
                {walletVisible ? (
                  <div
                    className={
                      'rounded-xl border p-3 transition-colors ' +
                      (useCredit
                        ? 'border-yellow-400/45 bg-gradient-to-br from-yellow-500/15 to-amber-500/5 shadow-[0_0_24px_rgba(247,166,0,0.12)]'
                        : 'border-purple-500/25 bg-purple-500/10')
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="use-credit" className="flex min-w-0 cursor-pointer items-center gap-2.5">
                        <span
                          className={
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' +
                            (useCredit ? 'bg-yellow-500/25' : 'bg-purple-500/20')
                          }
                        >
                          <Wallet
                            className={'h-4 w-4 ' + (useCredit ? 'text-yellow-200' : 'text-purple-200')}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="min-w-0 text-sm font-semibold text-white">
                          Use WTF Credit
                          <span className="block truncate text-xs font-normal text-purple-300">
                            Available balance{' '}
                            <span className="font-bold tabular-nums text-purple-100">
                              {formatGBP(availableWalletPence)}
                            </span>
                          </span>
                        </span>
                      </label>
                      <Switch
                        id="use-credit"
                        checked={useCredit}
                        onCheckedChange={setUseCredit}
                        disabled={walletDisabled || submitting}
                        aria-label="Use WTF Credit for this order"
                      />
                    </div>

                    <div
                      className={
                        'grid overflow-hidden transition-all duration-300 ease-out ' +
                        (useCredit ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')
                      }
                    >
                      <div className="min-h-0">
                        <div className="space-y-1.5 border-t border-yellow-500/20 pt-2.5 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-yellow-200/90">WTF Credit applied</span>
                            <span className="font-semibold tabular-nums text-yellow-100">
                              −{formatGBP(previewCreditPence)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-yellow-200/90">
                              {fullyFunded ? 'Nothing to pay by card' : 'To pay by card'}
                            </span>
                            <span className="font-semibold tabular-nums text-yellow-100">
                              {fullyFunded ? '£0.00' : formatGBP(previewExternalPence)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-purple-500/25 bg-purple-500/10 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
                        <Wallet className="h-4 w-4 text-purple-200" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 text-sm font-semibold text-white">
                        Use WTF Credit
                        <span className="block truncate text-xs font-normal text-purple-300">
                          Balance <span className="font-bold tabular-nums text-purple-100">{formatGBP(0)}</span> · win
                          credit in instant-win games
                        </span>
                      </span>
                    </div>
                    <Switch
                      id="use-credit"
                      checked={false}
                      disabled
                      aria-label="WTF Credit unavailable — no balance"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Other ticket options — a small text link, not another large card */}
          {otherOptions.length > 0 && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowAllOptions((s) => !s)}
                aria-expanded={showAllOptions}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-300 underline underline-offset-2 transition-colors hover:text-white disabled:opacity-50"
              >
                See other ticket options
                <ChevronDown
                  className={'h-4 w-4 transition-transform ' + (showAllOptions ? 'rotate-180' : '')}
                  aria-hidden="true"
                />
              </button>
              {showAllOptions && (
                <ul className="mt-3 space-y-2 text-left">
                  {options.map((o) => {
                    const isSel = o.key === selected.key
                    return (
                      <li key={o.key}>
                        <button
                          type="button"
                          onClick={() => selectOption(o.key)}
                          disabled={submitting}
                          className={
                            'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60 ' +
                            (isSel
                              ? 'border-yellow-400/60 bg-yellow-500/10'
                              : 'border-purple-500/20 bg-white/5 hover:border-purple-400/40')
                          }
                        >
                          <span className="flex items-center gap-2">
                            {isSel && <Check className="h-4 w-4 text-yellow-300" aria-hidden="true" />}
                            <span className="font-semibold text-white">
                              {o.qty} {o.qty === 1 ? 'chance' : 'chances'}
                            </span>
                            {o.savingsPence > 0 && (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                save {formatGBP(o.savingsPence)}
                              </span>
                            )}
                          </span>
                          <span className="font-bold tabular-nums text-yellow-300">
                            {formatGBP(o.totalPence)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-red-500/15 p-3 text-sm text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          {/* Desktop / inline CTA — swap the pay button for the name form when
              the server needs the customer's name. */}
          <div className="hidden space-y-3 lg:block">
            {nameFormOpen ? nameForm : primaryButton}
            {trustRow}
          </div>

          <p aria-live="polite" className="sr-only">
            {status ?? ''}
          </p>
        </section>
      </div>

      {/* Mobile sticky CTA — the global bottom nav is suppressed on this route
          (see MobileNav), so the Pay control now owns the bottom safe area and
          sits just above the device inset. */}
      <div
        className="fixed inset-x-0 z-40 px-3 lg:hidden"
        style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-5xl space-y-2 rounded-2xl border border-purple-500/30 bg-[#0e0618]/95 p-3 shadow-[0_-4px_30px_rgba(0,0,0,0.5)] backdrop-blur">
          {nameFormOpen ? nameForm : primaryButton}
          {trustRow}
        </div>
      </div>

      {/* Mobile-only auto-opening bottom sheet — same offer as the desktop
          inline card, driven entirely by the existing selectOption(). Sits
          above the sticky Pay bar (z-[60] > z-40) so the customer makes one
          clear decision. */}
      {sheetMounted && sheetOffer && (
        <MobileBoostSheet
          visible={sheetVisible}
          success={sheetSuccess}
          currentQty={sheetOffer.fromQty}
          targetQty={sheetOffer.option.qty}
          incrementalLabel={sheetOffer.incrementalLabel}
          savingsPence={sheetOffer.option.savingsPence}
          instantState={instantState}
          remainingCount={instantRemaining}
          heroCashLabel={instantHeroLabel}
          disabled={submitting || nameFormOpen}
          onUnlock={acceptBoostFromSheet}
          onDismiss={dismissBoostSheet}
        />
      )}
    </div>
  )
}
