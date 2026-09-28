"use client"

import { useState } from "react"
import { PRIZES } from "../lib/prizes"

export interface DemoControlsProps {
  target: number
  onTargetChange: (i: number) => void
  onTest: () => void
  onRandom: () => void
  onSetSpins: (n: number) => void
  onAddSpin: () => void
  onSetCash: (n: number) => void
  onSetCredit: (n: number) => void
  onEndSession: (cash: number, credit: number) => void
  onTestMultiWin: () => void
  onReset: () => void
  busy: boolean
  soundOn: boolean
  onToggleSound: (v: boolean) => void
  confettiOn: boolean
  onToggleConfetti: (v: boolean) => void
}

export function DemoControls(props: DemoControlsProps) {
  const [open, setOpen] = useState(false)

  return (
    <section className="stw-demo" data-open={open}>
      <button type="button" className="stw-demo-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>DEMO CONTROLS</span>
        <span className="stw-demo-chevron" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="stw-demo-body">
          <label className="stw-demo-row">
            <span>Target prize</span>
            <select
              value={props.target}
              onChange={(e) => props.onTargetChange(Number(e.target.value))}
              disabled={props.busy}
            >
              {PRIZES.map((p) => (
                <option key={p.id} value={p.segmentIndex}>
                  {p.segmentIndex}. {p.label}
                  {p.sublabel ? ` ${p.sublabel}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="stw-demo-btns">
            <button type="button" onClick={props.onTest} disabled={props.busy}>
              Test Selected
            </button>
            <button type="button" onClick={props.onRandom} disabled={props.busy}>
              Random Result
            </button>
          </div>

          <div className="stw-demo-group">
            <span className="stw-demo-grouplabel">Set spins</span>
            <div className="stw-demo-btns">
              {[0, 1, 3, 10].map((n) => (
                <button key={n} type="button" onClick={() => props.onSetSpins(n)} disabled={props.busy}>
                  {n}
                </button>
              ))}
              <button type="button" onClick={props.onAddSpin} disabled={props.busy}>
                +1
              </button>
            </div>
          </div>

          <div className="stw-demo-group">
            <span className="stw-demo-grouplabel">Set cash winnings (£)</span>
            <div className="stw-demo-btns">
              {[0, 25, 75].map((n) => (
                <button key={n} type="button" onClick={() => props.onSetCash(n)} disabled={props.busy}>
                  £{n}
                </button>
              ))}
            </div>
          </div>

          <div className="stw-demo-group">
            <span className="stw-demo-grouplabel">Set WTF credit (£)</span>
            <div className="stw-demo-btns">
              {[0, 10, 20].map((n) => (
                <button key={n} type="button" onClick={() => props.onSetCredit(n)} disabled={props.busy}>
                  £{n}
                </button>
              ))}
            </div>
          </div>

          <div className="stw-demo-group">
            <span className="stw-demo-grouplabel">End session — preview summary</span>
            <div className="stw-demo-btns stw-demo-btns--stack">
              <button type="button" onClick={() => props.onEndSession(0, 0)} disabled={props.busy}>
                No wins
              </button>
              <button type="button" onClick={() => props.onEndSession(50, 0)} disabled={props.busy}>
                £50 cash
              </button>
              <button type="button" onClick={() => props.onEndSession(0, 10)} disabled={props.busy}>
                £10 credit
              </button>
              <button type="button" onClick={() => props.onEndSession(50, 10)} disabled={props.busy}>
                £50 cash + £10 credit
              </button>
            </div>
          </div>

          <div className="stw-demo-group">
            <span className="stw-demo-grouplabel">Multiple wins (visual test)</span>
            <div className="stw-demo-btns stw-demo-btns--stack">
              <button type="button" className="stw-demo-multiwin" onClick={props.onTestMultiWin} disabled={props.busy}>
                TEST MULTIPLE WINS
              </button>
            </div>
          </div>

          <div className="stw-demo-btns">
            <button type="button" onClick={props.onReset} disabled={props.busy}>
              Reset all
            </button>
          </div>

          <div className="stw-demo-toggles">
            <label className="stw-demo-check">
              <input type="checkbox" checked={props.soundOn} onChange={(e) => props.onToggleSound(e.target.checked)} />
              <span>Sound</span>
            </label>
            <label className="stw-demo-check">
              <input
                type="checkbox"
                checked={props.confettiOn}
                onChange={(e) => props.onToggleConfetti(e.target.checked)}
              />
              <span>Confetti</span>
            </label>
          </div>

          <p className="stw-demo-hint">Internal test controls only — not shown to players.</p>
        </div>
      )}
    </section>
  )
}
