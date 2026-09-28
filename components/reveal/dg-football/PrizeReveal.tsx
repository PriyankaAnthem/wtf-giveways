"use client"

/**
 * PrizeReveal — the premium sports-result panel that rises from the bottom for
 * a WINNING result, plus the end-of-run SummaryPanel. Not a shadcn Dialog /
 * generic modal.
 *
 * Wins auto-chain, so the prize panel has NO manual "next" button — it is shown
 * for a timed hold then the orchestrator advances automatically. The prize
 * value is the dominant element (gold for cash, green for credit) and lands
 * with a scale-punch + light sweep. Because DG is now large and celebrating on
 * the left, the panel is bottom-anchored and never full-height, so his face and
 * fists stay visible above it.
 */

import type { CSSProperties } from "react"
import { useEffect, useRef } from "react"
import type { RevealCopy } from "./types"
import {
  COLORS,
  formatGBP,
  ticketsAlsoInDraw,
  ticketsChecked,
  ticketsInDraw,
  type PlanSummary,
} from "./config"

/** Focus a button only while its panel is visible, without scrolling the
 *  overflow-hidden stage (which would shove the whole game up). */
function useVisibleFocus(visible: boolean) {
  const ref = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!visible) return
    const el = ref.current
    if (!el) return
    const id = window.setTimeout(() => {
      try {
        el.focus({ preventScroll: true })
      } catch {
        el.focus()
      }
    }, 40)
    return () => window.clearTimeout(id)
  }, [visible])
  return ref
}

/* -------------------------------------------------------------------------- */
/*  Confetti (lightweight DOM burst, deterministic)                           */
/* -------------------------------------------------------------------------- */
function Confetti({ tone, slowFactor }: { tone: RevealCopy["tone"] | "summary"; slowFactor: number }) {
  const count = tone === "big" ? 54 : tone === "credit" ? 20 : 30
  const palette =
    tone === "big"
      ? [COLORS.gold, COLORS.neon, COLORS.white, COLORS.cash]
      : tone === "credit"
        ? [COLORS.neon, COLORS.white]
        : [COLORS.cash, COLORS.neon, COLORS.white]
  return (
    <div className="dgf-confetti" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const left = (i * 47) % 100
        const delay = (i % 7) * 60
        const dur = 1400 + (i % 6) * 240
        const rot = (i * 57) % 360
        const w = 5 + (i % 3) * 2
        return (
          <span
            key={i}
            className="dgf-confetti-piece"
            style={
              {
                left: `${left}%`,
                width: w,
                height: w * 1.8,
                background: palette[i % palette.length],
                transform: `rotate(${rot}deg)`,
                animationDelay: `${delay}ms`,
                animationDuration: `${dur * slowFactor}ms`,
              } as CSSProperties
            }
          />
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Single winning result panel                                               */
/* -------------------------------------------------------------------------- */
interface PrizeRevealProps {
  copy: RevealCopy
  visible: boolean
  reducedMotion: boolean
  slowFactor: number
  /** 1-based index of the win currently shown, and total animated wins. */
  winSoFar: number
  totalWins: number
  /** FAST WIN STREAK — lighter confetti so a long streak never overloads. */
  compact?: boolean
}

export function PrizeReveal({
  copy,
  visible,
  reducedMotion,
  slowFactor,
  winSoFar,
  totalWins,
  compact = false,
}: PrizeRevealProps) {
  const valueColor =
    copy.tone === "big" ? COLORS.gold : copy.tone === "cash" ? COLORS.cash : COLORS.neon

  return (
    <div
      className={`dgf-panel dgf-panel-${copy.tone} ${visible ? "dgf-panel-in" : ""} ${
        reducedMotion ? "dgf-panel-reduced" : ""
      }`}
      style={{ transitionDuration: `${700 * slowFactor}ms` }}
      role="dialog"
      aria-modal="false"
      aria-label={`${copy.eyebrow} ${copy.amount} ${copy.unit}`.trim()}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="dgf-panel-edge" />
      {visible && !reducedMotion && !compact && <Confetti tone={copy.tone} slowFactor={slowFactor} />}

      <div className="dgf-panel-body">
        {copy.tone === "big" && <div className="dgf-rays" aria-hidden="true" />}

        <p className="dgf-panel-eyebrow dgf-eyebrow-win">
          {copy.eyebrow}
          {totalWins > 1 && <span className="dgf-win-counter">WIN {winSoFar} OF {totalWins}</span>}
        </p>

        {/* Physical / manual prizes show their image (when supplied) above the
            title. Image loading NEVER gates the award: an onError hides only the
            image and the title still reveals. */}
        {copy.isManual && copy.imageUrl && (
          <img
            className="dgf-panel-img"
            src={copy.imageUrl || "/placeholder.svg"}
            alt=""
            crossOrigin="anonymous"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}

        <p
          className={`dgf-panel-amount ${visible ? "dgf-value-pop" : ""} ${
            copy.tone === "big" && visible && !reducedMotion && !copy.isManual ? "dgf-value-shake" : ""
          }`}
          style={{ color: valueColor }}
          aria-live="assertive"
        >
          <span className={`dgf-panel-amount-value ${copy.isManual ? "dgf-amount-manual" : ""}`}>
            {copy.amount}
            {visible && !reducedMotion && !copy.isManual && <span className="dgf-value-sweep" aria-hidden="true" />}
          </span>
          {copy.unit && <span className="dgf-panel-amount-unit">{copy.unit}</span>}
        </p>

        <p className="dgf-panel-support text-balance">{copy.support}</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  End-of-run summary (LOADED → GAME → CHECKED)                              */
/* -------------------------------------------------------------------------- */
interface SummaryPanelProps {
  summary: PlanSummary
  visible: boolean
  reducedMotion: boolean
  slowFactor: number
  onFinish: () => void
}

export function SummaryPanel({ summary, visible, reducedMotion, slowFactor, onFinish }: SummaryPanelProps) {
  const wonSomething = summary.instantWins > 0
  const btnRef = useVisibleFocus(visible)
  const winsWord = summary.instantWins === 1 ? "INSTANT WIN" : "INSTANT WINS"

  return (
    <div
      className={`dgf-panel dgf-summary ${wonSomething ? "dgf-summary-win" : "dgf-summary-none"} ${
        visible ? "dgf-panel-in" : ""
      } ${reducedMotion ? "dgf-panel-reduced" : ""}`}
      style={{ transitionDuration: `${560 * slowFactor}ms` }}
      role="dialog"
      aria-modal="false"
      aria-label={ticketsChecked(summary.ticketCount)}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="dgf-panel-edge" />
      {visible && wonSomething && !reducedMotion && <Confetti tone="summary" slowFactor={slowFactor} />}

      <div className="dgf-panel-body">
        {wonSomething ? (
          <>
            <p className="dgf-summary-winline">
              YOUR <span className="dgf-summary-wincount">{summary.instantWins}</span> {winsWord}
            </p>

            {/* ITEMISED award list FIRST — every prize the customer was shown,
                derived from the same awards array the animation walked. */}
            <ul className="dgf-summary-list">
              {summary.items.map((item, i) => (
                <li key={i} className="dgf-summary-item">
                  {item.count > 1 && <span className="dgf-summary-item-x">{item.count} ×</span>}
                  {item.kind === "manual" ? (
                    // Physical / manual prize: no reliable cash value, so show
                    // the prize title itself rather than a fabricated amount.
                    <span className="dgf-summary-item-amt" style={{ color: COLORS.gold }}>
                      {item.label}
                    </span>
                  ) : (
                    <>
                      <span
                        className="dgf-summary-item-amt"
                        style={{ color: item.kind === "credit" ? COLORS.neon : COLORS.cash }}
                      >
                        {formatGBP(item.amountPence)}
                      </span>
                      <span className="dgf-summary-item-label">{item.label}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {/* Aggregate totals AFTER the itemised list. */}
            <div className="dgf-summary-totals">
              {summary.cashPence > 0 && (
                <div className="dgf-summary-total">
                  <span className="dgf-summary-total-label">TOTAL CASH</span>
                  <span className="dgf-summary-total-amt" style={{ color: COLORS.cash }}>
                    {formatGBP(summary.cashPence)}
                  </span>
                </div>
              )}
              {summary.creditPence > 0 && (
                <div className="dgf-summary-total">
                  <span className="dgf-summary-total-label">SITE CREDIT</span>
                  <span className="dgf-summary-total-amt" style={{ color: COLORS.neon }}>
                    {formatGBP(summary.creditPence)}
                  </span>
                </div>
              )}
            </div>

            <p className="dgf-summary-checked">{ticketsChecked(summary.ticketCount)}</p>
            <p className="dgf-summary-draw">{ticketsAlsoInDraw(summary.ticketCount)}</p>
          </>
        ) : (
          <>
            <p className="dgf-summary-checked">{ticketsChecked(summary.ticketCount)}</p>
            <p className="dgf-summary-nowin">NO INSTANT WIN THIS TIME</p>
            <p className="dgf-summary-draw dgf-summary-draw-strong">{ticketsInDraw(summary.ticketCount)}</p>
          </>
        )}

        <button ref={btnRef} type="button" className="dgf-next-btn" onClick={onFinish}>
          CONTINUE
        </button>
      </div>
    </div>
  )
}
