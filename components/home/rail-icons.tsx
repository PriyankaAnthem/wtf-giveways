import type { RailIconKey } from "@/lib/admin/homepage-rails"

/**
 * Bespoke, restrained category icons for the casino lobby. Pure inline SVG —
 * NO icon package, NO per-icon network request, NO emoji. Every path uses
 * `currentColor`, so the colour comes from the parent's text class (the
 * per-rail accent). Safe in both server (section headers) and client (nav)
 * components because there is no client-only code here.
 *
 * Icons are crisp/geometric to read well at 14–20px:
 *   hot      — jackpot burst / four-point spark
 *   balloon  — balloon with tie + string
 *   instant  — angular lightning bolt
 *   games    — arcade game tile with a reveal play mark
 *   cash     — banknote with a pound roundel
 *   luxury   — faceted gem
 */
export function RailIcon({
  name,
  className,
}: {
  name: RailIconKey
  className?: string
}) {
  const common = {
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true as const,
    focusable: false as const,
  }

  switch (name) {
    case "hot":
      // Four-point jackpot spark with a small offset sparkle.
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 2.2c.28 2.53 1.02 4.3 2.26 5.54C15.5 8.98 17.27 9.72 19.8 10c-2.53.28-4.3 1.02-5.54 2.26C13.02 13.5 12.28 15.27 12 17.8c-.28-2.53-1.02-4.3-2.26-5.54C8.5 11.02 6.73 10.28 4.2 10c2.53-.28 4.3-1.02 5.54-2.26C10.98 6.5 11.72 4.73 12 2.2Z" />
          <path d="M18.6 15.3c.14 1.02.44 1.73.98 2.27.54.54 1.25.84 2.27.98-1.02.14-1.73.44-2.27.98-.54.54-.84 1.25-.98 2.27-.14-1.02-.44-1.73-.98-2.27-.54-.54-1.25-.84-2.27-.98 1.02-.14 1.73-.44 2.27-.98.54-.54.84-1.25.98-2.27Z" />
        </svg>
      )
    case "balloon":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3c3 0 5.2 2.3 5.2 5.4 0 3.6-3 6.4-5.2 7.6-2.2-1.2-5.2-4-5.2-7.6C6.8 5.3 9 3 12 3Z" />
          <path d="M12 16v1.4" />
          <path d="M12 17.4c-.9.5-.9 1.4 0 1.9s.9 1.4 0 1.9" />
        </svg>
      )
    case "instant":
      return (
        <svg {...common} fill="currentColor">
          <path d="M13.5 2 4 13.2h6l-1.5 8.8L20 10.8h-6l-.5-8.8Z" />
        </svg>
      )
    case "games":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
          <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4" />
          <path d="M10 8.6 15.2 12 10 15.4V8.6Z" fill="currentColor" stroke="none" />
        </svg>
      )
    case "cash":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
          <rect x="2.6" y="6" width="18.8" height="12" rx="2.4" />
          <circle cx="12" cy="12" r="3" />
          <path d="M5.4 9.2v5.6M18.6 9.2v5.6" strokeLinecap="round" />
        </svg>
      )
    case "luxury":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
          <path d="M6 3.6h12l3 4.2-9 12.6-9-12.6 3-4.2Z" />
          <path d="M3 7.8h18M9 3.6l-1.8 4.2L12 20.4l4.8-12.6L15 3.6" />
        </svg>
      )
    default:
      return null
  }
}
