"use client"

import { useEffect, useRef } from "react"

type ConfettiProps = {
  /** Trigger a burst whenever this key changes (and is > 0) */
  fireKey: number
  /** Disable entirely (reduced motion) */
  disabled?: boolean
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vrot: number
  color: string
  life: number
}

const COLORS = ["#FFD700", "#FFC400", "#FBBF24", "#FFE680", "#FFFFFF", "#F59E0B"]

/**
 * Lightweight canvas confetti. No external libraries. Renders a single
 * celebratory burst each time `fireKey` increments. Fully decorative.
 */
export function Confetti({ fireKey, disabled = false }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (disabled || fireKey <= 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const w = window.innerWidth
    const cx = w / 2
    const cy = window.innerHeight * 0.4
    const count = Math.min(180, Math.floor(w / 3))
    const batch: Particle[] = []
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 4 + Math.random() * 9
      batch.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        size: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      })
    }
    particles.current = batch

    const gravity = 0.18
    const drag = 0.992
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let alive = false
      for (const p of particles.current) {
        p.vx *= drag
        p.vy = p.vy * drag + gravity
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vrot
        p.life -= 0.008
        if (p.life > 0 && p.y < window.innerHeight + 40) {
          alive = true
          ctx.save()
          ctx.globalAlpha = Math.max(0, p.life)
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.fillStyle = p.color
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
          ctx.restore()
        }
      }
      if (alive) {
        rafRef.current = requestAnimationFrame(render)
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
    rafRef.current = requestAnimationFrame(render)

    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [fireKey, disabled])

  if (disabled) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50"
    />
  )
}
