"use client"

/**
 * FlightLayer — the single in-flight football plus its layered neon-green
 * energy trail. Driven IMPERATIVELY by the Stage's requestAnimationFrame loop
 * via a ref handle, so no React state updates happen per frame.
 *
 * Trail = three stacked SVG polylines (wide blurred glow → primary neon line →
 * pale centre streak) sharing a rolling buffer of the ball's recent positions,
 * so it fades out behind the ball. A few energy particles ride near the head.
 * This is never a cheap dotted line and never obscures the board.
 */

import { forwardRef, useImperativeHandle, useRef } from "react"
import { FLIGHT_BALL_SIZE } from "./config"
import { Football } from "./Football"

export interface FlightHandle {
  /** Show the ball at an origin point (stage-local px), reset the trail. */
  begin: (x: number, y: number) => void
  /** Update the ball transform + trail for the current frame. */
  frame: (x: number, y: number, rot: number, scale: number, opacity: number) => void
  /** Hide the ball + clear the trail. */
  end: () => void
}

interface FlightLayerProps {
  reducedMotion: boolean
}

const TRAIL_LEN = 18

export const FlightLayer = forwardRef<FlightHandle, FlightLayerProps>(function FlightLayer(
  { reducedMotion },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<SVGPolylineElement>(null)
  const lineRef = useRef<SVGPolylineElement>(null)
  const streakRef = useRef<SVGPolylineElement>(null)
  const p1Ref = useRef<SVGCircleElement>(null)
  const p2Ref = useRef<SVGCircleElement>(null)
  const bufRef = useRef<{ x: number; y: number }[]>([])

  useImperativeHandle(ref, () => ({
    begin(x, y) {
      bufRef.current = [{ x, y }]
      if (wrapRef.current) wrapRef.current.style.opacity = "1"
      if (ballRef.current) {
        ballRef.current.style.opacity = "1"
        ballRef.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
      }
      writeTrail()
    },
    frame(x, y, rot, scale, opacity) {
      const ball = ballRef.current
      if (ball) {
        ball.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`
        ball.style.opacity = String(opacity)
      }
      if (!reducedMotion) {
        const buf = bufRef.current
        buf.push({ x, y })
        if (buf.length > TRAIL_LEN) buf.shift()
        writeTrail(opacity)
      }
    },
    end() {
      bufRef.current = []
      if (wrapRef.current) wrapRef.current.style.opacity = "0"
      if (ballRef.current) ballRef.current.style.opacity = "0"
      writeTrail()
    },
  }))

  function writeTrail(headOpacity = 1) {
    const buf = bufRef.current
    const pts = buf.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    glowRef.current?.setAttribute("points", pts)
    lineRef.current?.setAttribute("points", pts)
    streakRef.current?.setAttribute("points", pts)
    // Particles ride just behind the head of the trail.
    const head = buf[buf.length - 1]
    const mid = buf[Math.max(0, buf.length - 4)]
    if (head && p1Ref.current) {
      p1Ref.current.setAttribute("cx", head.x.toFixed(1))
      p1Ref.current.setAttribute("cy", head.y.toFixed(1))
      p1Ref.current.setAttribute("opacity", String(0.9 * headOpacity))
    }
    if (mid && p2Ref.current) {
      p2Ref.current.setAttribute("cx", mid.x.toFixed(1))
      p2Ref.current.setAttribute("cy", mid.y.toFixed(1))
      p2Ref.current.setAttribute("opacity", String(0.6 * headOpacity))
    }
  }

  return (
    <div ref={wrapRef} className="dgf-flight" style={{ opacity: 0 }} aria-hidden="true">
      {!reducedMotion && (
        <svg className="dgf-flight-trail" width="100%" height="100%">
          <polyline ref={glowRef} className="dgf-trail-glow" points="" />
          <polyline ref={lineRef} className="dgf-trail-line" points="" />
          <polyline ref={streakRef} className="dgf-trail-streak" points="" />
          <circle ref={p1Ref} className="dgf-trail-particle" r="3" cx="-10" cy="-10" />
          <circle ref={p2Ref} className="dgf-trail-particle" r="2" cx="-10" cy="-10" />
        </svg>
      )}
      <div ref={ballRef} className="dgf-flight-ball" style={{ width: FLIGHT_BALL_SIZE, height: FLIGHT_BALL_SIZE }}>
        <Football size={FLIGHT_BALL_SIZE} idPrefix="dgf-flight-ball" />
      </div>
    </div>
  )
})
