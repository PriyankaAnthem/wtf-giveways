"use client"

import { useMemo } from "react"

type Variant = "gold" | "purple" | "cash"

const COLORS: Record<Variant, string[]> = {
  gold: ["#f7d774", "#fff2c2", "#c8961f", "#ffffff"],
  purple: ["#a06bff", "#f7d774", "#e6d3ff", "#ffffff"],
  cash: ["#f7d774", "#d8f5d0", "#ffffff", "#c8961f"],
}

/**
 * Lightweight CSS confetti burst. `runId` re-seeds the particles so each win
 * gets a fresh burst; `enabled` lets the demo controls disable it.
 */
export function Confetti({
  active,
  enabled,
  variant = "gold",
  runId,
}: {
  active: boolean
  enabled: boolean
  variant?: Variant
  runId: number
}) {
  const bits = useMemo(() => {
    const palette = COLORS[variant]
    return Array.from({ length: 70 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      dur: 1.6 + Math.random() * 1.8,
      size: 6 + Math.random() * 8,
      rot: Math.random() * 360,
      color: palette[i % palette.length],
      note: variant === "cash" && i % 6 === 0,
      drift: (Math.random() * 2 - 1) * 120,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, runId])

  if (!active || !enabled) return null

  return (
    <div className="stw-confetti" aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          className={b.note ? "stw-confetti-bit stw-confetti-note" : "stw-confetti-bit"}
          style={
            {
              left: `${b.left}%`,
              width: b.note ? 22 : b.size,
              height: b.note ? 13 : b.size,
              background: b.note ? undefined : b.color,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.dur}s`,
              // custom props consumed by the keyframes
              ["--stw-rot" as string]: `${b.rot}deg`,
              ["--stw-drift" as string]: `${b.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
