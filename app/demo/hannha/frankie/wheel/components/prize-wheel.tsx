"use client"

import { forwardRef, useImperativeHandle, useRef } from "react"
import { SEGMENT_ANGLE, type DemoPrizeType } from "../lib/prizes"

export interface SpinHandlers {
  onStart?: () => void
  /** Fired each time a segment boundary passes the fixed pointer. */
  onTick?: (intensity: number) => void
  /** Fired once when the dramatic final slowdown begins (for audio ducking). */
  onFinalPhase?: () => void
  /** Fired at the decisive final land tick. */
  onLand?: () => void
}

export interface PrizeWheelHandle {
  /** Animate so `index` lands exactly under the fixed 12 o'clock pointer. */
  spinToSegment: (index: number, handlers?: SpinHandlers) => Promise<void>
  resetRotation: () => void
  /**
   * DEMO ONLY (multiple-wins test): a fast, non-landing free spin.
   * Accelerates hard, holds an extremely fast (motion-blurred) top speed, then
   * eases to a stop on an arbitrary angle. Reuses the SAME rotor/artwork — it
   * never targets a wedge and never touches the deterministic spinToSegment.
   */
  multiWinSpin: () => Promise<void>
}

/**
 * Fine calibration for the baked artwork. Segment 0 (£100 CASH) sits at 12
 * o'clock in wheel_face_clean.png per the asset README, so 0 is correct;
 * adjust only if a visual test shows the winning wedge landing off-centre.
 */
const FACE_OFFSET_DEG = 0

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// top-of-wheel wedge highlight path (viewBox 0..100), spanning ±15° from vertical
const HIGHLIGHT_PATH = "M50 50 L37.06 1.71 A50 50 0 0 1 62.94 1.71 Z"

/**
 * The one and only spin easing. Deliberately NOT a CSS ease-out:
 *   - starts at zero velocity
 *   - accelerates quickly, peaking early
 *   - by t≈0.6 roughly 96% of the rotation is already done
 *   - the remaining ~40% of TIME crawls through only the last few wedges
 *   - reaches the target at exactly zero velocity (no jerk, no snap)
 * Derivative is 30·t·(1-t)^4, i.e. 0 at both ends — so the wheel glides to
 * a stop precisely on the target with no correction.
 */
const spinProgress = (t: number) => 1 - Math.pow(1 - t, 5) * (1 + 5 * t)

export const PrizeWheel = forwardRef<
  PrizeWheelHandle,
  {
    celebrating: boolean
    celebrationType: DemoPrizeType | null
  }
>(function PrizeWheel({ celebrating, celebrationType }, ref) {
  const rotorRef = useRef<HTMLDivElement | null>(null)
  const rotationRef = useRef(0)
  const busyRef = useRef(false)

  const apply = (angle: number) => {
    // The ONLY transform on the rotating face is rotation about its exact
    // centre — no translate, no scale, no perspective.
    if (rotorRef.current) rotorRef.current.style.transform = `rotate(${angle}deg)`
  }

  useImperativeHandle(ref, () => ({
    resetRotation() {
      rotationRef.current = 0
      if (rotorRef.current) {
        rotorRef.current.style.transition = "transform 400ms ease"
        rotorRef.current.style.filter = "none"
        apply(0)
        window.setTimeout(() => {
          if (rotorRef.current) rotorRef.current.style.transition = "none"
        }, 420)
      }
    },
    multiWinSpin() {
      if (busyRef.current) return Promise.resolve()
      busyRef.current = true
      const reduce = prefersReducedMotion()
      const startAngle = rotationRef.current
      if (rotorRef.current) rotorRef.current.style.transition = "none"

      // Angular-velocity profile (deg/s), integrated per animation frame:
      //   0 → ACC        accelerate (ease-in) from 0 to VMAX
      //   ACC → HOLD_END hold VMAX (heavily motion-blurred)
      //   HOLD_END → END ease-out down to 0 (glides to rest)
      const ACC = reduce ? 120 : 650
      const HOLD_END = reduce ? 320 : 1950
      const END = reduce ? 700 : 3350
      const VMAX = reduce ? 720 : 2160 // ~6 revolutions / second at peak

      return new Promise<void>((resolve) => {
        const t0 = performance.now()
        let last = t0
        let angle = startAngle

        const frame = (now: number) => {
          const t = now - t0
          let dt = (now - last) / 1000
          if (dt > 0.05) dt = 0.05 // clamp after a dropped frame
          last = now

          let v: number
          if (t < ACC) {
            const p = t / ACC
            v = VMAX * p * p
          } else if (t < HOLD_END) {
            v = VMAX
          } else if (t < END) {
            const p = (t - HOLD_END) / (END - HOLD_END)
            v = VMAX * (1 - p) * (1 - p)
          } else {
            v = 0
          }

          angle += v * dt
          apply(angle)

          // Speed-driven blur sells the "too fast to read" wedge smear.
          if (rotorRef.current) {
            const blur = Math.min(7, v / 340)
            rotorRef.current.style.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : "none"
          }

          if (t < END) {
            requestAnimationFrame(frame)
            return
          }
          if (rotorRef.current) rotorRef.current.style.filter = "none"
          rotationRef.current = angle % 360
          busyRef.current = false
          resolve()
        }

        requestAnimationFrame(frame)
      })
    },
    spinToSegment(index, handlers = {}) {
      if (busyRef.current) return Promise.resolve()
      busyRef.current = true

      const cur = rotationRef.current
      const reduce = prefersReducedMotion()

      // ---- Calculate the final target rotation ONCE, before the spin ------
      // Bring the winning wedge centre to the fixed 12 o'clock pointer.
      const base = (360 - index * SEGMENT_ANGLE + FACE_OFFSET_DEG) % 360
      const fullSpins = reduce ? 1 : 7 + Math.floor(Math.random() * 2) // 7..8 turns
      const curMod = ((cur % 360) + 360) % 360
      let delta = (((base - curMod) % 360) + 360) % 360
      delta += fullSpins * 360
      const startRotation = cur
      const finalRotation = cur + delta // fixed for the whole spin — never corrected

      const duration = reduce ? 500 : 7500 + Math.random() * 1000 // 7.5s..8.5s

      if (rotorRef.current) rotorRef.current.style.transition = "none"

      // ---- One continuous requestAnimationFrame loop ----------------------
      // rotation = start + (final - start) * spinProgress(t). The transform is
      // never reset and there is no second animation or final snap.
      return new Promise<void>((resolve) => {
        handlers.onStart?.()

        const startTime = performance.now()
        // Ticks are derived from the ACTUAL current angle crossing a divider
        // line (15° + 30°·k). Dividers, not a schedule, so sound + pointer
        // always match the visible wheel; they naturally space out as it slows.
        let lastDivider = Math.floor((startRotation - 15) / SEGMENT_ANGLE)
        let lastTickTime = startTime
        let finalPhaseFired = false
        let landFired = false

        const frame = (now: number) => {
          const t = Math.min(1, (now - startTime) / duration)
          const angle = startRotation + (finalRotation - startRotation) * spinProgress(t)
          apply(angle)

          // Audio duck once the long slow tail begins — derived from t, not a
          // phase hand-off; the rotation timeline itself is untouched.
          if (!finalPhaseFired && t >= 0.62) {
            finalPhaseFired = true
            handlers.onFinalPhase?.()
          }

          // Segment-boundary (divider) crossing detection from the live angle.
          const d = Math.floor((angle - 15) / SEGMENT_ANGLE)
          if (d !== lastDivider) {
            const crossed = Math.max(1, Math.abs(d - lastDivider))
            const gap = (now - lastTickTime) / crossed
            lastTickTime = now
            lastDivider = d
            // Slower crossings (larger gap) read as more pronounced ticks.
            const intensity = Math.max(0.3, Math.min(1, gap / 150))
            if (t >= 0.97 && !landFired) {
              // The decisive final divider before the wheel settles.
              landFired = true
              handlers.onLand?.()
            } else {
              handlers.onTick?.(intensity)
            }
          }

          if (t < 1) {
            requestAnimationFrame(frame)
            return
          }

          // t === 1: angle already equals finalRotation exactly. No correction,
          // no snap, no follow-up animation.
          rotationRef.current = finalRotation
          if (!landFired) handlers.onLand?.()
          busyRef.current = false
          resolve()
        }

        requestAnimationFrame(frame)
      })
    },
  }))

  const showBurst = celebrating && celebrationType !== "loss"

  return (
    <div
      className={celebrating ? "stw-wheel stw-wheel--celebrate" : "stw-wheel"}
      data-celebrate-type={celebrationType ?? undefined}
    >
      {/* LAYER 1 — rotating prize face (baked 12-segment artwork) */}
      <div ref={rotorRef} className="stw-rotor">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="stw-face" src="/demo/wtf-spin/wheel-face-v2-upload.png?v=3" alt="" draggable={false} />
      </div>

      {/* Dim the non-winning wedges during a celebration */}
      <div className="stw-dim" aria-hidden="true" />

      {/* Winning wedge highlight (winner always rests at 12 o'clock) */}
      <svg className="stw-highlight" viewBox="0 0 100 100" aria-hidden="true">
        <path d={HIGHLIGHT_PATH} className="stw-highlight-wedge" />
      </svg>

      {/* Gold radial light burst from the centre */}
      {showBurst && <div className="stw-burst" aria-hidden="true" />}

      {/* LAYER 2 — fixed gold bulb rim overlay (pulses during a win) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="stw-rim" src="/demo/wtf-spin/wheel_rim_clean.png" alt="" aria-hidden="true" draggable={false} />

      {/* Travelling light that sweeps the rim bulbs clockwise twice on a win */}
      {showBurst && <div className="stw-rimlight" aria-hidden="true" />}

      {/* LAYER 3 — fixed centre medallion, exactly centred, stays upright */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="stw-center" src="/demo/wtf-spin/wheel_center_clean.png" alt="" aria-hidden="true" draggable={false} />
    </div>
  )
})
