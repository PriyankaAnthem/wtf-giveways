"use client"

import { forwardRef, useImperativeHandle, useRef } from "react"

export interface WheelPointerHandle {
  /** Physical peg flick. intensity 0..1 controls angle + snap-back speed. */
  flick: (intensity: number) => void
}

export const WheelPointer = forwardRef<WheelPointerHandle>(function WheelPointer(_props, ref) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const backRef = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    flick(intensity) {
      const el = elRef.current
      if (!el) return
      const deg = 5 + intensity * 9
      el.style.transition = "transform 40ms cubic-bezier(0.2,0.8,0.3,1)"
      el.style.transform = `translateX(-50%) rotate(${deg}deg)`
      if (backRef.current) window.clearTimeout(backRef.current)
      backRef.current = window.setTimeout(() => {
        if (!el) return
        el.style.transition = `transform ${90 + intensity * 90}ms cubic-bezier(0.34,1.56,0.64,1)`
        el.style.transform = "translateX(-50%) rotate(0deg)"
      }, 45)
    },
  }))

  return (
    <div ref={elRef} className="stw-pointer" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/demo/wtf-spin/wheel_pointer_clean.png" alt="" draggable={false} />
    </div>
  )
})
