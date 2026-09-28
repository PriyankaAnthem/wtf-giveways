"use client"

import { useRef, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

/**
 * Thin client wrapper around ONE horizontal card rail.
 *
 * The cards themselves are rendered on the SERVER and passed in as `children`,
 * so the giveaway payloads are never serialized into client props — this
 * component ships only the scroll/arrow behaviour. No carousel state machine,
 * no drag physics, no autoplay: the arrows just call native
 * `element.scrollBy({ behavior: "smooth" })`, and everything else is native CSS
 * scroll-snap.
 */
export function RailScroller({
  children,
  label,
  topGutter = false,
}: {
  children: ReactNode
  label: string
  /**
   * Reserves vertical room inside the horizontal scrollport for a controlled
   * "breakout" foreground layer. Scroll behaviour is otherwise unchanged.
   */
  topGutter?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  const nudge = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" })
  }

  return (
    <div className="relative">
      {/*
        Horizontal rail. `overflow-x-auto` + `overscroll-x-contain` keep the
        gesture on the X axis so diagonal/vertical swipes fall through to the
        page (the rail never traps vertical scroll). `touch-action` is left at
        its default (auto) so native vertical scrolling is unaffected. Scrollbar
        hidden; `-mx-4 px-4` bleeds the rail to the screen edge while keeping the
        first/last card aligned to the container. `py-2` preserves card hover
        shadow instead of clipping it.
      */}
      <div
        ref={ref}
        className={`-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-smooth px-4 [scrollbar-width:none] md:gap-5 [&::-webkit-scrollbar]:hidden ${
          topGutter ? "pb-2 pt-[76px]" : "py-2"
        }`}
      >
        {children}
      </div>

      {/* Subtle edge fades hint at more content. Pure CSS, pointer-events-none,
          desktop only so they never sit under a thumb on mobile. */}
      <div
        className={`pointer-events-none absolute bottom-2 left-0 hidden w-10 bg-gradient-to-r from-black/25 to-transparent md:block ${
          topGutter ? "top-[76px]" : "top-2"
        }`}
        aria-hidden="true"
      />
      <div
        className={`pointer-events-none absolute bottom-2 right-0 hidden w-10 bg-gradient-to-l from-black/25 to-transparent md:block ${
          topGutter ? "top-[76px]" : "top-2"
        }`}
        aria-hidden="true"
      />

      {/* Desktop-only arrows — native smooth scrollBy, no state machine. */}
      <button
        type="button"
        onClick={() => nudge(-1)}
        aria-label={`Scroll ${label} left`}
        className={`absolute left-1 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 md:inline-flex ${
          topGutter ? "top-[calc(50%+34px)]" : "top-1/2"
        }`}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => nudge(1)}
        aria-label={`Scroll ${label} right`}
        className={`absolute right-1 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 md:inline-flex ${
          topGutter ? "top-[calc(50%+34px)]" : "top-1/2"
        }`}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}