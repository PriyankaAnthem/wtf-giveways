"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

const A = "/demo/wtf-spin/multiwin"

/** Timeline offsets in ms, all measured from the instant the overlay mounts
 *  (which is the same instant the wheel begins its fast spin). Every layer is
 *  a CSS animation keyed off this single mount clock — one orchestrated
 *  sequence, no independently-fired effects. */
const T = {
  rays: 650,
  flash: 1150,
  burst: 1180,
  debris: 1220,
  spark: 1220,
  particles: 1220,
  smoke1: 1280,
  smoke2: 1550,
  smoke3: 1820,
  glow: 2050,
  title: 2180,
  star: 2350,
  subtitle: 2650,
  confetti: 2800,
  shift: 3450,
  row1: 3700,
  row2: 4100,
  pulse: 4500,
  continueBtn: 4800,
} as const

const d = (ms: number): React.CSSProperties => ({ animationDelay: `${ms}ms` })

type Props = {
  open: boolean
  closing: boolean
  confettiEnabled: boolean
  onContinue: () => void
}

/**
 * DEMO ONLY — the multiple-wins celebration. Sits on top of the existing wheel
 * scene using ONLY the supplied artwork in /demo/wtf-spin/multiwin. It renders
 * no gameplay logic: values are the hard-coded test scenario (£5 WTF CREDIT +
 * 1 FREE SPIN, 2 prizes) and CONTINUE simply asks the parent to dismiss it.
 */
export function MultiWinSequence({ open, closing, confettiEnabled, onContinue }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [settling, setSettling] = useState(false)

  // Centre the wheel-anchored effects on the ACTUAL wheel, whatever the layout.
  useLayoutEffect(() => {
    if (!open) return
    const wheel = document.querySelector<HTMLElement>(".stw-wheel-wrap")
    const root = rootRef.current
    if (!wheel || !root) return
    const r = wheel.getBoundingClientRect()
    root.style.setProperty("--mw-cx", `${r.left + r.width / 2}px`)
    root.style.setProperty("--mw-cy", `${r.top + r.height / 2}px`)
    root.style.setProperty("--mw-w", `${r.width}px`)
  }, [open])

  // Fade the celebration burst + subtitle out and drop the title back as the
  // prize list takes over.
  useEffect(() => {
    if (!open) {
      setSettling(false)
      return
    }
    const id = window.setTimeout(() => setSettling(true), T.shift)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  return (
    <div ref={rootRef} className="mw-overlay" data-closing={closing || undefined} aria-hidden="true">
      {/* z15 — scene dimming (background + wheel brightness down) */}
      <div className="mw-scrim" style={d(T.rays)} />

      {/* Smoke — left + right, three crossfading frames each (z30) */}
      {/* eslint-disable @next/next/no-img-element */}
      <img className="mw-smoke mw-smoke--l1" style={d(T.smoke1)} src={`${A}/smoke_left_01.png`} alt="" />
      <img className="mw-smoke mw-smoke--l2" style={d(T.smoke2)} src={`${A}/smoke_left_02.png`} alt="" />
      <img className="mw-smoke mw-smoke--l3" style={d(T.smoke3)} src={`${A}/smoke_left_03.png`} alt="" />
      <img className="mw-smoke mw-smoke--r1" style={d(T.smoke1)} src={`${A}/smoke_right_01.png`} alt="" />
      <img className="mw-smoke mw-smoke--r2" style={d(T.smoke2)} src={`${A}/smoke_right_02.png`} alt="" />
      <img className="mw-smoke mw-smoke--r3" style={d(T.smoke3)} src={`${A}/smoke_right_03.png`} alt="" />

      {/* Wheel-centred celebration burst — faded out as the prize list arrives */}
      <div className={`mw-burstgroup${settling ? " mw-faded" : ""}`}>
        {/* z20 light rays */}
        <div className="mw-anchor mw-anchor--wheel" style={{ zIndex: 20 }}>
          <img className="mw-fx mw-rays" style={d(T.rays)} src={`${A}/light_rays.png`} alt="" />
        </div>
        {/* z25 burst */}
        <div className="mw-anchor mw-anchor--wheel" style={{ zIndex: 25 }}>
          <img className="mw-fx mw-burst" style={d(T.burst)} src={`${A}/multiwin_burst.png`} alt="" />
        </div>
        {/* z28 glow ring */}
        <div className="mw-anchor mw-anchor--wheel" style={{ zIndex: 28 }}>
          <img className="mw-fx mw-glow" style={d(T.glow)} src={`${A}/glow_ring.png`} alt="" />
        </div>
        {/* z32 debris */}
        <div className="mw-anchor mw-anchor--wheel" style={{ zIndex: 32 }}>
          <img className="mw-fx mw-debris" style={d(T.debris)} src={`${A}/explosion_debris.png`} alt="" />
        </div>
        {/* z34 sparks */}
        <div className="mw-anchor mw-anchor--wheel" style={{ zIndex: 34 }}>
          <img className="mw-fx mw-spark" style={d(T.spark)} src={`${A}/spark_layer.png`} alt="" />
        </div>
        {/* star burst behind the title */}
        <div className="mw-anchor mw-anchor--title" style={{ zIndex: 36 }}>
          <img className="mw-fx mw-star" style={d(T.star)} src={`${A}/star_burst.png`} alt="" />
        </div>
      </div>

      {/* z35 gold particles rising */}
      <div className="mw-anchor mw-anchor--wheel" style={{ zIndex: 35 }}>
        <img className="mw-fx mw-particles" style={d(T.particles)} src={`${A}/gold_particles.png`} alt="" />
      </div>

      {/* z40 camera-flash */}
      <img className="mw-flash" style={d(T.flash)} src={`${A}/multiwin_flash.png`} alt="" />

      {/* z50 MULTIPLE WINS! hero title (asset carries the wordmark) */}
      <div className={`mw-title-wrap${settling ? " mw-title-wrap--shift" : ""}`}>
        <img className="mw-title mw-anim" style={d(T.title)} src={`${A}/multiwin_title_frame.png`} alt="Multiple wins!" />
      </div>

      {/* z52 count "2" + INSTANT PRIZES UNLOCKED subtitle (asset carries copy) */}
      <div className={`mw-subgroup${settling ? " mw-faded" : ""}`}>
        <span className="mw-count mw-anim" style={d(T.subtitle)}>
          2
        </span>
        <img className="mw-subtitle mw-anim" style={d(T.subtitle)} src={`${A}/multiwin_subtitle_frame.png`} alt="Instant prizes unlocked" />
      </div>

      {/* z60 confetti */}
      {confettiEnabled && (
        <img className="mw-confetti mw-anim" style={d(T.confetti)} src={`${A}/confetti_foreground.png`} alt="" />
      )}

      {/* z55 prize rows */}
      <div className="mw-prizes">
        <div className="mw-row mw-row--l mw-anim" style={d(T.row1)}>
          <div className="mw-row-inner" style={d(T.pulse)}>
            <img className="mw-row-img" src={`${A}/bonus_prize_row_credit.png`} alt="" />
            <div className="mw-row-text">
              <span className="mw-row-value">£5</span>
              <span className="mw-row-label mw-row-label--credit">WTF CREDIT</span>
            </div>
            <span className="mw-shine" style={d(T.pulse)}>
              <img src={`${A}/shine_sweep.png`} alt="" />
            </span>
          </div>
        </div>

        <div className="mw-row mw-row--r mw-anim" style={d(T.row2)}>
          <div className="mw-row-inner" style={d(T.pulse)}>
            <img className="mw-row-img" src={`${A}/bonus_prize_row_spin.png`} alt="" />
            <div className="mw-row-text">
              <span className="mw-row-value">1</span>
              <span className="mw-row-label mw-row-label--spin">FREE SPIN</span>
            </div>
            <span className="mw-shine" style={d(T.pulse)}>
              <img src={`${A}/shine_sweep.png`} alt="" />
            </span>
          </div>
        </div>
      </div>

      {/* z70 CONTINUE (asset carries the label). Only interactive element. */}
      <button type="button" className="mw-continue" onClick={onContinue} aria-label="Continue">
        <img className="mw-continue-img mw-anim" style={d(T.continueBtn)} src={`${A}/continue_button.png`} alt="Continue" />
      </button>
      {/* eslint-enable @next/next/no-img-element */}
    </div>
  )
}
