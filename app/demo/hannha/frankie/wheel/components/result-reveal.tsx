"use client"

import type { DemoPrize } from "../lib/prizes"

const SHIELD = "/demo/wtf-spin/frame-shield.png"
const RIBBON = "/demo/wtf-spin/frame-ribbon-cash.png"
const PURPLE_BAR = "/demo/wtf-spin/frame-bar-purple.png"
const STARBURST = "/demo/wtf-spin/fx-starburst.png"

/**
 * Win-moment reveal. The wheel dims behind a centred game-show card: a crowned
 * shield frame holds the kicker + hero amount, and the unit label ("CASH" /
 * "WTF CREDIT") sits on its own ribbon/bar banner. A starburst blooms behind
 * the whole card.
 *
 * `show` gates everything so it appears a beat AFTER the wedge glow / burst
 * begin (the suspense pause), which is what makes the moment feel earned.
 */
export function ResultReveal({
  prize,
  runId,
  show,
}: {
  prize: DemoPrize | null
  runId: number
  show: boolean
}) {
  if (!prize || !show) return null

  // A loss keeps the light-touch pill — no celebration frame.
  if (prize.type === "loss") {
    return (
      <div className="stw-reveal" data-type="loss" aria-live="polite">
        <div className="stw-reveal-scrim" aria-hidden="true" />
        <div key={runId} className="stw-reveal-noprize">
          NO PRIZE THIS TIME
        </div>
      </div>
    )
  }

  return (
    <div className="stw-reveal" data-type={prize.type} aria-live="polite">
      <div className="stw-reveal-scrim" aria-hidden="true" />

      <div key={runId} className="stw-reveal-card">
        <img className="stw-reveal-burst" src={STARBURST || "/placeholder.svg"} alt="" aria-hidden="true" />

        <div className="stw-reveal-frame">
          <img className="stw-reveal-frame-img" src={SHIELD || "/placeholder.svg"} alt="" aria-hidden="true" />

          <div className="stw-reveal-content">
            {prize.type === "cash" && (
              <>
                <span className="stw-reveal-kicker">YOU JUST WON</span>
                <span className="stw-reveal-amount stw-reveal-amt">£{prize.value}</span>
              </>
            )}

            {prize.type === "credit" && (
              <>
                <span className="stw-reveal-kicker stw-reveal-kicker--credit">YOU WON</span>
                <span className="stw-reveal-amount stw-reveal-amount--credit stw-reveal-amt">£{prize.value}</span>
              </>
            )}

            {prize.type === "free_spin" && (
              <span className="stw-reveal-amount stw-reveal-amount--free stw-reveal-amt stw-reveal-freespin">
                <span>FREE</span>
                <span>SPIN!</span>
              </span>
            )}
          </div>

          <div className="stw-reveal-banner" data-type={prize.type}>
            {prize.type === "cash" ? (
              <img className="stw-reveal-banner-img" src={RIBBON || "/placeholder.svg"} alt="" aria-hidden="true" />
            ) : (
              <img className="stw-reveal-banner-img" src={PURPLE_BAR || "/placeholder.svg"} alt="" aria-hidden="true" />
            )}
            <span className="stw-reveal-banner-text" data-type={prize.type}>
              {prize.type === "cash" ? "CASH" : prize.type === "credit" ? "WTF CREDIT" : "+1 SPIN"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
