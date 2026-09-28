"use client"

/**
 * BallTray — the premium bottom platform holding FIVE cosmetic footballs.
 *
 * Interaction model (approved spec):
 *  - The five footballs are purely COSMETIC choices. They are NOT tickets and
 *    the choice NEVER decides the result.
 *  - The customer performs ONE interaction for the whole purchase: TAP A BALL.
 *    On tap we lock all five and the tapped ball is lifted/scaled/rotated with
 *    a halo + energy ring while the others dim; the Stage then auto-launches.
 *  - For chained wins the orchestrator lifts a DIFFERENT remaining ball
 *    automatically (no extra tap) via the controlled `liftedBall` prop.
 *
 * This component is controlled: the currently lifted ball, whether it is hidden
 * (because the real flight ball has taken over) and whether the tray is locked
 * all come from props. Each ball exposes `data-ball={n}` so the Stage can
 * measure its on-screen centre as the flight origin.
 */

import { BALL_SIZE, TIMING, TRAY_BALL_COUNT } from "./config"
import { Football } from "./Football"

interface BallTrayProps {
  /** 1-based number of the currently lifted ball, else null. */
  liftedBall: number | null
  /** Hide the lifted ball (the real flight ball has taken over). */
  hideLifted: boolean
  /** Disable tapping (everything except the initial choosing phase). */
  locked: boolean
  reducedMotion: boolean
  speed: number
  /** Fires once when the customer taps a ball to begin the reveal. */
  onSelect: (n: number) => void
}

const NUMBERS = Array.from({ length: TRAY_BALL_COUNT }, (_, i) => i + 1)

export function BallTray({ liftedBall, hideLifted, locked, reducedMotion, speed, onSelect }: BallTrayProps) {
  const handleSelect = (n: number) => {
    if (locked || liftedBall !== null) return
    // Light haptic pulse on tap where supported.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate?.(12)
      } catch {
        /* best effort */
      }
    }
    onSelect(n)
  }

  return (
    <div className="dgf-tray-platform">
      <div className="dgf-tray" role="group" aria-label="Choose a ball">
        {NUMBERS.map((n) => {
          const chosen = n === liftedBall
          const dimmed = liftedBall !== null && !chosen
          const hidden = chosen && hideLifted
          const idle = !reducedMotion && !locked && liftedBall === null
          return (
            <button
              key={n}
              type="button"
              data-ball={n}
              className={`dgf-ball-btn ${chosen ? "dgf-ball-chosen" : ""} ${dimmed ? "dgf-ball-dim" : ""} ${
                hidden ? "dgf-ball-hidden" : ""
              } ${idle ? "dgf-ball-idle" : ""}`}
              style={{
                width: BALL_SIZE,
                height: BALL_SIZE,
                transitionDuration: `${TIMING.ballLiftMs * speed}ms`,
              }}
              onClick={() => handleSelect(n)}
              disabled={locked}
              aria-label={`Choose ball ${n}`}
            >
              <span className="dgf-ball-inner">
                <Football size={BALL_SIZE} idPrefix={`dgf-tray-${n}`} />
                <span className="dgf-ball-badge" aria-hidden="true">
                  {n}
                </span>
              </span>
              {!reducedMotion && chosen && !hidden && <span className="dgf-ball-ring" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
