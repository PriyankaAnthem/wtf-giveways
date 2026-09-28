"use client"

import { useEffect, useRef, useState } from "react"
import { useCountUp } from "../lib/use-count-up"

/** Brief "value went up" flag used to pulse a cell after a win. */
function useBump(value: number): boolean {
  const [bump, setBump] = useState(false)
  const prev = useRef(value)
  useEffect(() => {
    if (value > prev.current) {
      setBump(true)
      const t = window.setTimeout(() => setBump(false), 900)
      prev.current = value
      return () => window.clearTimeout(t)
    }
    prev.current = value
  }, [value])
  return bump
}

/**
 * Persistent casino-style status bar. Always visible (never hidden during a
 * spin or reveal) so the player keeps a running sense of progress:
 *   YOUR SPINS · WINNINGS (cash) · WTF CREDIT (site credit).
 * Cash and site credit are kept as SEPARATE numbers by design.
 */
export function StatusBar({ spins, cash, credit }: { spins: number; cash: number; credit: number }) {
  const cashAnim = useCountUp(cash, 1200)
  const creditAnim = useCountUp(credit, 1200)
  const spinsBump = useBump(spins)
  const cashBump = useBump(cash)
  const creditBump = useBump(credit)

  return (
    <div className="stw-status" data-stw-counter role="status" aria-live="polite">
      <div className="stw-status-cell">
        <span className="stw-status-label">YOUR SPINS</span>
        <span className="stw-status-value" data-kind="spins" data-bump={spinsBump || undefined}>
          {spins}
        </span>
      </div>

      <span className="stw-status-sep" aria-hidden="true" />

      <div className="stw-status-cell">
        <span className="stw-status-label">CASH WON</span>
        <span className="stw-status-value" data-kind="cash" data-bump={cashBump || undefined}>
          £{cashAnim.toFixed(2)}
        </span>
      </div>

      <span className="stw-status-sep" aria-hidden="true" />

      <div className="stw-status-cell">
        <span className="stw-status-label">WTF CREDIT</span>
        <span className="stw-status-value" data-kind="credit" data-bump={creditBump || undefined}>
          £{creditAnim.toFixed(2)}
        </span>
      </div>
    </div>
  )
}
