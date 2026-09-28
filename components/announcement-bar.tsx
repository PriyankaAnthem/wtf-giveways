"use client"

import { Gift, X } from "lucide-react"
import { useState } from "react"

export function AnnouncementBar() {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) return null

  return (
    // Thin premium gaming strip (~40px): deep purple gradient with a faint gold
    // lower seam so it reads as one shell with the casino header. Copy centred,
    // dismiss retained. Behaviour unchanged.
    <div className="relative bg-gradient-to-b from-[#1b0440] to-[#11002a] px-10 py-2 text-center shadow-[inset_0_-1px_0_rgba(251,191,36,0.18)]">
      <p className="flex items-center justify-center gap-2 text-xs font-medium text-white/90 sm:text-sm">
        <Gift className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="truncate">
          New Winners Every Day! Win £1000&apos;s! <span className="font-semibold text-amber-300 underline underline-offset-2">Enter now</span>
        </span>
      </p>
      <button
        onClick={() => setIsVisible(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-white/70 opacity-80 transition-opacity hover:opacity-100"
        aria-label="Dismiss announcement"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
