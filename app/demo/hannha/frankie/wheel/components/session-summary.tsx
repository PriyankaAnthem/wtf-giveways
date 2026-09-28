"use client"

import { Check, ChevronRight } from "lucide-react"

/** Root folder for the approved END-OF-SPINS artwork (visual source of truth). */
const ASSET = "/demo/wtf-spin/end-screen"

export interface SessionSummaryProps {
  open: boolean
  cash: number
  credit: number
  confettiEnabled: boolean
  onGetMoreSpins: () => void
  onFinish: () => void
}

/**
 * END-OF-SPINS / SESSION SUMMARY — the big casino / TV game-show win screen.
 *
 * DESIGN / COMPOSITION PASS ONLY. Every value shown here is a STATIC
 * placeholder per the approved brief (SPINS 0 · CASH WON £35.00 · WTF CREDIT
 * £0.00 · headline "NICE WIN!"). There is deliberately NO reward logic, wallet,
 * checkout, count-up, or reward-type switching — that arrives in the next step.
 *
 * The supplied PNG artwork in /public/demo/wtf-spin/end-screen is the visual
 * source of truth. CSS/React only position, size, layer, and render text over
 * the artwork — nothing is recreated with gradients or shadcn components.
 *
 * The GET MORE SPINS / FINISH FOR NOW handlers stay wired to the existing demo
 * controls purely so the prototype remains navigable; no new behaviour added.
 */
export function SessionSummary({ open, onGetMoreSpins, onFinish }: SessionSummaryProps) {
  if (!open) return null

  return (
    <div className="stw-end" role="dialog" aria-modal="true" aria-label="Session summary">
      {/* z10 — the existing wheel stays visible but dimmed behind everything */}
      <div className="stw-end-dim" aria-hidden="true" />
      <div className="stw-end-overlay" aria-hidden="true" />

      <div className="stw-end-stage">
        {/* z20 / z25 — massive gold celebration burst + ring */}
        <img src={`${ASSET}/gold_win_burst.png`} alt="" aria-hidden="true" className="stw-end-burst" />
        <img src={`${ASSET}/gold_win_ring.png`} alt="" aria-hidden="true" className="stw-end-ring" />
        {/* z30 / z31 — confetti + flying cash foregrounds (full-bleed) */}
        <img
          src={`${ASSET}/gold_confetti_foreground.png`}
          alt=""
          aria-hidden="true"
          className="stw-end-confetti"
        />
        <img src={`${ASSET}/cash_notes_foreground.png`} alt="" aria-hidden="true" className="stw-end-notes" />

        {/* z40 — status bar (3 equal groups over the supplied frame) */}
        <div className="stw-end-status">
          <img src={`${ASSET}/status_bar_blank.png`} alt="" aria-hidden="true" className="stw-end-status-img" />
          <div className="stw-end-status-grid">
            <div className="stw-end-status-cell">
              <span className="stw-end-status-label">SPINS</span>
              <span className="stw-end-status-value" data-kind="spins">
                0
              </span>
            </div>
            <div className="stw-end-status-cell">
              <span className="stw-end-status-label">CASH WON</span>
              <span className="stw-end-status-value" data-kind="cash">
                £35.00
              </span>
            </div>
            <div className="stw-end-status-cell">
              <span className="stw-end-status-label" data-kind="credit">
                WTF CREDIT
              </span>
              <span className="stw-end-status-value" data-kind="credit">
                £0.00
              </span>
            </div>
          </div>
        </div>

        <div className="stw-end-mid">
          {/* z50 — crowned hero frame + hero typography + cash ribbon */}
          <div className="stw-end-hero">
            <img src={`${ASSET}/cash_hero_frame_blank.png`} alt="" aria-hidden="true" className="stw-end-frame" />
            <div className="stw-end-nicewin">NICE WIN!</div>
            <div className="stw-end-amount">£35.00</div>
            <div className="stw-end-ribbon">
              <img
                src={`${ASSET}/cash_label_ribbon_blank.png`}
                alt=""
                aria-hidden="true"
                className="stw-end-ribbon-img"
              />
              <span className="stw-end-ribbon-text">CASH WINNINGS</span>
            </div>
          </div>

          {/* z65 — saved-winnings confirmation chip */}
          <div className="stw-end-chip">
            <img
              src={`${ASSET}/saved_confirmation_chip_blank.png`}
              alt=""
              aria-hidden="true"
              className="stw-end-chip-img"
            />
            <span className="stw-end-chip-text">
              <span className="stw-end-chip-tick" aria-hidden="true">
                <Check size={13} strokeWidth={3.5} />
              </span>
              Your cash winnings are saved.
            </span>
          </div>
        </div>

        {/* z70 / z75 — CTAs */}
        <div className="stw-end-actions">
          <button type="button" className="stw-end-primary" onClick={onGetMoreSpins}>
            <img src={`${ASSET}/primary_cta_blank.png`} alt="" aria-hidden="true" className="stw-end-primary-img" />
            <span className="stw-end-primary-text">
              GET MORE SPINS
              <ChevronRight className="stw-end-primary-chev" size={30} strokeWidth={3} aria-hidden="true" />
            </span>
          </button>
          <button type="button" className="stw-end-secondary" onClick={onFinish}>
            <img
              src={`${ASSET}/secondary_cta_blank.png`}
              alt=""
              aria-hidden="true"
              className="stw-end-secondary-img"
            />
            <span className="stw-end-secondary-text">FINISH FOR NOW</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export interface MoreSpinsPanelProps {
  open: boolean
  credit: number
  onContinue: () => void
  onClose: () => void
}

/**
 * DEMO-ONLY mock of the "buy more spins" step. It is deliberately NOT wired to
 * checkout, wallet, or any purchase logic. CONTINUE simply grants 3 demo spins
 * so the gameplay loop can be tested end to end.
 */
export function MoreSpinsPanel({ open, credit, onContinue, onClose }: MoreSpinsPanelProps) {
  if (!open) return null
  return (
    <div className="stw-more" role="dialog" aria-modal="true" aria-label="Get more spins">
      <div className="stw-more-scrim" aria-hidden="true" onClick={onClose} />
      <div className="stw-more-sheet">
        <h3 className="stw-more-title">GET MORE SPINS</h3>

        <div className="stw-more-credit">
          <span className="stw-more-credit-label">AVAILABLE WTF CREDIT</span>
          <span className="stw-more-credit-amt">£{credit.toFixed(2)}</span>
        </div>

        <p className="stw-more-copy">Use your credit and jump straight back in.</p>
        <p className="stw-more-demo">Demo only — not connected to checkout.</p>

        <button type="button" className="stw-more-continue" onClick={onContinue}>
          CONTINUE PLAYING
        </button>
        <button type="button" className="stw-more-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
