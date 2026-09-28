"use client"

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react"
import { cn } from "@/lib/utils"
import "./just-launched.css"

/**
 * Wraps a card / banner with the flame-led "Just Launched" perimeter.
 *
 * The animated ring layers are absolutely-positioned siblings placed AFTER
 * the wrapped content, with pointer-events:none, so the child (e.g. the whole
 * card Link, or the purchase banner) stays fully interactive underneath.
 *
 * Performance: animations run only while the `wtf-jl--active` class is set. An
 * IntersectionObserver removes it when the element scrolls off-screen so a
 * grid of many launched cards does not keep repainting the perimeter. Defaults
 * to active for SSR / no-IO environments so the effect is never missing.
 */
export function JustLaunchedFrame({
  children,
  radius = 22,
  ringWidth = 2.5,
  className,
}: {
  children: ReactNode
  /** Border radius in px — match the wrapped element (22 card, 16 banner). */
  radius?: number
  ringWidth?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn("wtf-jl", active && "wtf-jl--active", className)}
      style={
        {
          "--wtf-jl-radius": `${radius}px`,
          "--wtf-jl-ring": `${ringWidth}px`,
        } as CSSProperties
      }
    >
      {children}
      <span className="wtf-jl-glow" aria-hidden="true" />
      <span className="wtf-jl-heatring" aria-hidden="true" />
      <span className="wtf-jl-halo" aria-hidden="true" />
      <span className="wtf-jl-ring" aria-hidden="true" />
      <span className="wtf-jl-flarehead" aria-hidden="true" />
    </div>
  )
}
