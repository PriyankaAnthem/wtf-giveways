"use client"

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react"

export type ScratchCardHandle = {
  reset: () => void
}

type ScratchCardProps = {
  /** Called once when the scratched threshold is crossed */
  onComplete: () => void
  /** Whether the card has been revealed (disables further scratching) */
  revealed: boolean
  /** The hidden content shown beneath the foil */
  children: React.ReactNode
  /** Completion threshold 0..1 (default 0.6) */
  threshold?: number
  /** Foil tint: 'silver' | 'gold' */
  foil?: "silver" | "gold"
  /** Disable scratch interactions (e.g. reduced motion auto-reveal) */
  disabled?: boolean
}

/**
 * Canvas-based scratch card. Fully self-contained — no external libraries,
 * no data calls. Supports mouse + touch with a generous brush.
 */
export const ScratchCard = forwardRef<ScratchCardHandle, ScratchCardProps>(function ScratchCard(
  { onComplete, revealed, children, threshold = 0.6, foil = "silver", disabled = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDrawing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const completedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const checkRafRef = useRef<number | null>(null)
  const shineRef = useRef(0)
  const [flakes, setFlakes] = useState<Array<{ id: number; x: number; y: number; dx: number; dy: number }>>([])
  const flakeId = useRef(0)

  // Initialize + handle resize
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const setup = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      // paint using CSS-pixel dimensions
      paintFoilCss(rect.width, rect.height)
    }

    const paintFoilCss = (w: number, h: number) => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const base = ctx.createLinearGradient(0, 0, w, h)
      if (foil === "gold") {
        base.addColorStop(0, "#7a5a12")
        base.addColorStop(0.25, "#d9b14a")
        base.addColorStop(0.5, "#f7e08c")
        base.addColorStop(0.75, "#c8992f")
        base.addColorStop(1, "#6e4f0f")
      } else {
        base.addColorStop(0, "#6b6f78")
        base.addColorStop(0.25, "#aeb4bf")
        base.addColorStop(0.5, "#e9edf3")
        base.addColorStop(0.75, "#9aa0ab")
        base.addColorStop(1, "#5f636c")
      }
      ctx.globalCompositeOperation = "source-over"
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)

      ctx.globalAlpha = 0.06
      ctx.strokeStyle = "#000"
      for (let i = 0; i < w; i += 3) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + 8, h)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      for (let i = 0; i < (w * h) / 700; i++) {
        const x = Math.random() * w
        const y = Math.random() * h
        ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"
        ctx.fillRect(x, y, 1.5, 1.5)
      }
    }

    completedRef.current = false
    setup()

    const ro = new ResizeObserver(() => {
      if (!completedRef.current && !revealed) setup()
    })
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foil])

  // Imperative reset
  useImperativeHandle(ref, () => ({
    reset: () => {
      completedRef.current = false
      isDrawing.current = false
      lastPoint.current = null
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      const rect = container.getBoundingClientRect()
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.globalCompositeOperation = "source-over"
      // repaint full foil
      const w = rect.width
      const h = rect.height
      const base = ctx.createLinearGradient(0, 0, w, h)
      if (foil === "gold") {
        base.addColorStop(0, "#7a5a12")
        base.addColorStop(0.25, "#d9b14a")
        base.addColorStop(0.5, "#f7e08c")
        base.addColorStop(0.75, "#c8992f")
        base.addColorStop(1, "#6e4f0f")
      } else {
        base.addColorStop(0, "#6b6f78")
        base.addColorStop(0.25, "#aeb4bf")
        base.addColorStop(0.5, "#e9edf3")
        base.addColorStop(0.75, "#9aa0ab")
        base.addColorStop(1, "#5f636c")
      }
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 0.06
      ctx.strokeStyle = "#000"
      for (let i = 0; i < w; i += 3) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + 8, h)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      for (let i = 0; i < (w * h) / 700; i++) {
        const x = Math.random() * w
        const y = Math.random() * h
        ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"
        ctx.fillRect(x, y, 1.5, 1.5)
      }
    },
  }))

  const getRelativePos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const computeScratchedRatio = () => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const ctx = canvas.getContext("2d")
    if (!ctx) return 0
    const { width, height } = canvas
    // sample for performance
    const step = 16
    const image = ctx.getImageData(0, 0, width, height).data
    let cleared = 0
    let total = 0
    for (let i = 0; i < image.length; i += 4 * step) {
      total++
      if (image[i + 3] === 0) cleared++
    }
    return total === 0 ? 0 : cleared / total
  }

  const spawnFlakes = (x: number, y: number) => {
    setFlakes((prev) => {
      const next = [...prev]
      for (let i = 0; i < 3; i++) {
        flakeId.current += 1
        next.push({
          id: flakeId.current,
          x,
          y,
          dx: (Math.random() - 0.5) * 40,
          dy: 20 + Math.random() * 40,
        })
      }
      return next.slice(-24)
    })
  }

  const scratchLine = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const brush = Math.max(26, Math.min(canvas.width, canvas.height) * 0.06)
    ctx.globalCompositeOperation = "destination-out"
    ctx.lineWidth = brush
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    const start = from ?? to
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(to.x, to.y, brush / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const beginScratch = (clientX: number, clientY: number) => {
    if (disabled || revealed || completedRef.current) return
    isDrawing.current = true
    document.body.style.overflow = "hidden"
    const p = getRelativePos(clientX, clientY)
    lastPoint.current = p
    scratchLine(null, p)
    spawnFlakes(p.x, p.y)
  }

  const moveScratch = (clientX: number, clientY: number) => {
    if (!isDrawing.current || disabled || revealed || completedRef.current) return
    const p = getRelativePos(clientX, clientY)
    scratchLine(lastPoint.current, p)
    lastPoint.current = p
    spawnFlakes(p.x, p.y)

    // Throttle ratio checks
    if (checkRafRef.current == null) {
      checkRafRef.current = requestAnimationFrame(() => {
        checkRafRef.current = null
        const ratio = computeScratchedRatio()
        if (ratio >= threshold && !completedRef.current) {
          completedRef.current = true
          onComplete()
        }
      })
    }
  }

  const endScratch = () => {
    isDrawing.current = false
    lastPoint.current = null
    document.body.style.overflow = ""
  }

  // Cleanup overflow lock on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = ""
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (checkRafRef.current) cancelAnimationFrame(checkRafRef.current)
    }
  }, [])

  // Animated shine sweep across the unscratched layer
  useEffect(() => {
    if (revealed) return
    const el = containerRef.current?.querySelector("[data-shine]") as HTMLElement | null
    if (!el) return
    let mounted = true
    const loop = () => {
      if (!mounted) return
      shineRef.current = (shineRef.current + 0.6) % 200
      el.style.backgroundPosition = `${shineRef.current - 100}% 0`
      rafRef.current = requestAnimationFrame(loop)
    }
    const id = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(id)
    }
  }, [revealed])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-[28px]">
      {/* Hidden prize content */}
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>

      {/* Foil canvas */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 touch-none transition-opacity duration-700 ${
          revealed ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden="true"
        onMouseDown={(e) => beginScratch(e.clientX, e.clientY)}
        onMouseMove={(e) => moveScratch(e.clientX, e.clientY)}
        onMouseUp={endScratch}
        onMouseLeave={endScratch}
        onTouchStart={(e) => {
          const t = e.touches[0]
          beginScratch(t.clientX, t.clientY)
        }}
        onTouchMove={(e) => {
          const t = e.touches[0]
          moveScratch(t.clientX, t.clientY)
        }}
        onTouchEnd={endScratch}
        onTouchCancel={endScratch}
      />

      {/* Moving shine overlay (visual only, ignores pointer) */}
      {!revealed && (
        <div
          data-shine
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-screen"
          style={{
            background:
              "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.55) 48%, rgba(255,255,255,0.0) 60%)",
            backgroundSize: "200% 100%",
          }}
        />
      )}

      {/* Scratch flakes */}
      {flakes.map((f) => (
        <span
          key={f.id}
          className="pointer-events-none absolute h-1.5 w-1.5 rounded-[1px] bg-white/70"
          style={
            {
              left: f.x,
              top: f.y,
              animation: "flake-fall 600ms ease-out forwards",
              ["--fx" as any]: `${f.dx}px`,
              ["--fy" as any]: `${f.dy}px`,
            } as React.CSSProperties
          }
          onAnimationEnd={() => setFlakes((prev) => prev.filter((x) => x.id !== f.id))}
        />
      ))}
    </div>
  )
})
