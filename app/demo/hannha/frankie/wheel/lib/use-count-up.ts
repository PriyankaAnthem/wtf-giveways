"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Slot-machine style count-up. Whenever `target` changes, the returned value
 * eases from its current displayed amount to the new target over `duration`.
 * Uses a single requestAnimationFrame loop; safe for money or integer values.
 */
export function useCountUp(target: number, duration = 1200): number {
  const [display, setDisplay] = useState(target)
  const currentRef = useRef(target)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = currentRef.current
    if (from === target) return

    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      currentRef.current = target
      setDisplay(target)
      return
    }

    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      const v = from + (target - from) * eased
      currentRef.current = v
      setDisplay(v)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        currentRef.current = target
        setDisplay(target)
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return display
}
