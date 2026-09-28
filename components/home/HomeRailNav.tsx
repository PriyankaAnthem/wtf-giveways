"use client"

import { useEffect, useRef, useState } from "react"
import { RailIcon } from "@/components/home/rail-icons"
import type { RailIconKey } from "@/lib/admin/homepage-rails"

export interface HomeNavItem {
  key: string
  label: string
  icon: RailIconKey
  /** Kept for caller compatibility. Visual styling is owned by this component. */
  activeClass: string
  /** Kept for caller compatibility. Visual styling is owned by this component. */
  idleClass: string
}

interface RoomStyle {
  width: string
  activeBorder: string
  idleBorder: string
  activeSurface: string
  idleSurface: string
  activeLabel: string
  idleLabel: string
  activeEmblem: string
  idleEmblem: string

  /** Large low-frequency glow behind the whole room tile. */
  bloom: string
  /** Mid-frequency coloured halo close to the tile edge. */
  halo: string
  /** White-hot highlight on the upper edge. */
  topFlare: string
  /** White-hot highlight on the lower edge. */
  bottomFlare: string
  /** Reflected light beneath the tile. */
  reflection: string
  /** Fine internal metallic highlight. */
  innerHighlight: string
  /** Crisp multi-stage edge illumination on the active tile itself. */
  activeShadow: string
  idleShadow: string
}

const ROOM_STYLES: Record<string, RoomStyle> = {
  featured: {
    width: "w-[168px]",
    activeBorder: "border-[#FFD24D]",
    idleBorder: "border-[#76520E]",
    activeSurface:
      "bg-[linear-gradient(145deg,#2D1C00_0%,#150C00_48%,#070008_100%)]",
    idleSurface:
      "bg-[linear-gradient(145deg,#160D01_0%,#0B0600_50%,#070008_100%)]",
    activeLabel: "text-[#FFF0B2]",
    idleLabel: "text-[#D0AE63]",
    activeEmblem:
      "border-[#F0C239] bg-[radial-gradient(circle_at_35%_28%,#735000_0%,#2B1900_55%,#0B0600_100%)] text-[#FFE36E] shadow-[inset_0_1px_0_rgba(255,250,218,0.34),0_0_8px_rgba(255,204,55,0.50),0_0_18px_rgba(255,168,0,0.22)]",
    idleEmblem:
      "border-[#76520E] bg-[#110A00] text-[#B38423]",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(255,211,70,0.78)_0%,rgba(255,177,0,0.40)_30%,rgba(255,127,0,0.16)_54%,transparent_76%)]",
    halo:
      "bg-[radial-gradient(ellipse_at_center,rgba(255,233,144,0.48)_0%,rgba(255,194,45,0.24)_48%,transparent_72%)]",
    topFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(255,170,0,0.12)_16%,#FFD84A_36%,#FFF0A0_46%,#FFFCEB_50%,#FFF0A0_54%,#FFD84A_64%,rgba(255,170,0,0.12)_84%,transparent_100%)]",
    bottomFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(255,147,0,0.12)_14%,#FFBE1F_34%,#FFE46F_45%,#FFF7C2_50%,#FFE46F_55%,#FFBE1F_66%,rgba(255,147,0,0.12)_86%,transparent_100%)]",
    reflection:
      "bg-[radial-gradient(ellipse_at_center,rgba(255,191,0,0.48)_0%,rgba(255,152,0,0.22)_34%,transparent_72%)]",
    innerHighlight:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(255,232,161,0.12)_15%,rgba(255,251,229,0.36)_50%,rgba(255,232,161,0.12)_85%,transparent_100%)]",
    activeShadow:
      "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055),inset_0_1px_0_rgba(255,255,255,0.18),0_0_3px_rgba(255,247,211,0.70),0_0_9px_rgba(255,205,60,0.52),0_0_24px_rgba(255,165,0,0.28)]",
    idleShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_0_7px_rgba(156,103,0,0.10)]",
  },

  balloon_pop: {
    width: "w-[182px]",
    activeBorder: "border-[#FF4FC4]",
    idleBorder: "border-[#6C2256]",
    activeSurface:
      "bg-[linear-gradient(145deg,#300020_0%,#16000F_48%,#070008_100%)]",
    idleSurface:
      "bg-[linear-gradient(145deg,#17000F_0%,#0C0008_50%,#070008_100%)]",
    activeLabel: "text-[#FFC1E9]",
    idleLabel: "text-[#CF86B6]",
    activeEmblem:
      "border-[#F149BA] bg-[radial-gradient(circle_at_35%_28%,#711254_0%,#2D001F_55%,#0C0008_100%)] text-[#FF79D3] shadow-[inset_0_1px_0_rgba(255,221,242,0.28),0_0_8px_rgba(255,84,198,0.44),0_0_18px_rgba(255,40,178,0.20)]",
    idleEmblem:
      "border-[#6C2256] bg-[#110009] text-[#AD548E]",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(255,95,210,0.74)_0%,rgba(255,38,184,0.36)_30%,rgba(193,0,125,0.14)_54%,transparent_76%)]",
    halo:
      "bg-[radial-gradient(ellipse_at_center,rgba(255,188,229,0.42)_0%,rgba(255,83,201,0.21)_48%,transparent_72%)]",
    topFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(255,44,186,0.12)_16%,#FF63CB_36%,#FFABE1_46%,#FFF0FA_50%,#FFABE1_54%,#FF63CB_64%,rgba(255,44,186,0.12)_84%,transparent_100%)]",
    bottomFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(255,24,173,0.12)_14%,#FF3DBB_34%,#FF82D6_45%,#FFD6F0_50%,#FF82D6_55%,#FF3DBB_66%,rgba(255,24,173,0.12)_86%,transparent_100%)]",
    reflection:
      "bg-[radial-gradient(ellipse_at_center,rgba(255,48,186,0.44)_0%,rgba(211,0,139,0.19)_34%,transparent_72%)]",
    innerHighlight:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(255,175,227,0.10)_15%,rgba(255,231,247,0.30)_50%,rgba(255,175,227,0.10)_85%,transparent_100%)]",
    activeShadow:
      "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_0_rgba(255,255,255,0.15),0_0_3px_rgba(255,227,246,0.55),0_0_9px_rgba(255,82,199,0.48),0_0_24px_rgba(242,27,168,0.25)]",
    idleShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_7px_rgba(135,20,99,0.09)]",
  },

  instant_cash: {
    width: "w-[196px]",
    activeBorder: "border-[#33DBFF]",
    idleBorder: "border-[#15566E]",
    activeSurface:
      "bg-[linear-gradient(145deg,#00212B_0%,#001016_48%,#070008_100%)]",
    idleSurface:
      "bg-[linear-gradient(145deg,#001118_0%,#00090D_50%,#070008_100%)]",
    activeLabel: "text-[#B9F5FF]",
    idleLabel: "text-[#84BBC7]",
    activeEmblem:
      "border-[#2BCBE9] bg-[radial-gradient(circle_at_35%_28%,#07505F_0%,#001F29_55%,#00090D_100%)] text-[#71ECFF] shadow-[inset_0_1px_0_rgba(217,251,255,0.28),0_0_8px_rgba(61,225,255,0.40),0_0_18px_rgba(20,192,232,0.18)]",
    idleEmblem:
      "border-[#15566E] bg-[#000C11] text-[#479BAF]",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(87,233,255,0.70)_0%,rgba(15,204,242,0.34)_30%,rgba(0,134,177,0.13)_54%,transparent_76%)]",
    halo:
      "bg-[radial-gradient(ellipse_at_center,rgba(192,247,255,0.38)_0%,rgba(62,221,251,0.20)_48%,transparent_72%)]",
    topFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(33,208,243,0.12)_16%,#6EEBFF_36%,#B9F6FF_46%,#F3FEFF_50%,#B9F6FF_54%,#6EEBFF_64%,rgba(33,208,243,0.12)_84%,transparent_100%)]",
    bottomFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(18,193,230,0.12)_14%,#35DFFF_34%,#78ECFF_45%,#DDFBFF_50%,#78ECFF_55%,#35DFFF_66%,rgba(18,193,230,0.12)_86%,transparent_100%)]",
    reflection:
      "bg-[radial-gradient(ellipse_at_center,rgba(26,211,249,0.40)_0%,rgba(0,153,199,0.17)_34%,transparent_72%)]",
    innerHighlight:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(151,238,255,0.10)_15%,rgba(225,252,255,0.28)_50%,rgba(151,238,255,0.10)_85%,transparent_100%)]",
    activeShadow:
      "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045),inset_0_1px_0_rgba(255,255,255,0.14),0_0_3px_rgba(226,251,255,0.50),0_0_9px_rgba(69,225,255,0.43),0_0_24px_rgba(16,184,224,0.22)]",
    idleShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.028),0_0_7px_rgba(14,91,115,0.09)]",
  },

  games: {
    width: "w-[156px]",
    activeBorder: "border-violet-400",
    idleBorder: "border-violet-900",
    activeSurface:
      "bg-[linear-gradient(145deg,#1A062E_0%,#0E0318_48%,#070008_100%)]",
    idleSurface: "bg-[#0C0312]",
    activeLabel: "text-violet-100",
    idleLabel: "text-violet-300/65",
    activeEmblem:
      "border-violet-400 bg-violet-950/80 text-violet-200",
    idleEmblem:
      "border-violet-900 bg-[#0C0312] text-violet-400/60",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(167,139,250,0.60)_0%,rgba(124,58,237,0.25)_34%,transparent_75%)]",
    halo:
      "bg-[radial-gradient(ellipse_at_center,rgba(221,214,254,0.30)_0%,rgba(139,92,246,0.16)_50%,transparent_72%)]",
    topFlare:
      "bg-[linear-gradient(90deg,transparent_0%,#A78BFA_40%,#F5F3FF_50%,#A78BFA_60%,transparent_100%)]",
    bottomFlare:
      "bg-[linear-gradient(90deg,transparent_0%,#8B5CF6_40%,#EDE9FE_50%,#8B5CF6_60%,transparent_100%)]",
    reflection:
      "bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.32)_0%,transparent_72%)]",
    innerHighlight:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(221,214,254,0.22)_50%,transparent_100%)]",
    activeShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_3px_rgba(237,233,254,0.35),0_0_9px_rgba(167,139,250,0.35),0_0_22px_rgba(124,58,237,0.18)]",
    idleShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]",
  },

  cash: {
    width: "w-[152px]",
    activeBorder: "border-emerald-400",
    idleBorder: "border-emerald-900",
    activeSurface:
      "bg-[linear-gradient(145deg,#052519_0%,#03120C_48%,#070008_100%)]",
    idleSurface: "bg-[#03100A]",
    activeLabel: "text-emerald-100",
    idleLabel: "text-emerald-300/65",
    activeEmblem:
      "border-emerald-400 bg-emerald-950/80 text-emerald-200",
    idleEmblem:
      "border-emerald-900 bg-[#03100A] text-emerald-400/60",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(52,211,153,0.54)_0%,rgba(16,185,129,0.22)_34%,transparent_75%)]",
    halo:
      "bg-[radial-gradient(ellipse_at_center,rgba(209,250,229,0.28)_0%,rgba(52,211,153,0.14)_50%,transparent_72%)]",
    topFlare:
      "bg-[linear-gradient(90deg,transparent_0%,#6EE7B7_40%,#ECFDF5_50%,#6EE7B7_60%,transparent_100%)]",
    bottomFlare:
      "bg-[linear-gradient(90deg,transparent_0%,#34D399_40%,#D1FAE5_50%,#34D399_60%,transparent_100%)]",
    reflection:
      "bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.30)_0%,transparent_72%)]",
    innerHighlight:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(209,250,229,0.20)_50%,transparent_100%)]",
    activeShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.11),0_0_3px_rgba(209,250,229,0.30),0_0_9px_rgba(52,211,153,0.32),0_0_22px_rgba(16,185,129,0.16)]",
    idleShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.024)]",
  },

  luxury: {
    width: "w-[176px]",
    activeBorder: "border-[#33DBFF]",
    idleBorder: "border-[#15566E]",
    activeSurface:
      "bg-[linear-gradient(145deg,#00212B_0%,#001016_48%,#070008_100%)]",
    idleSurface:
      "bg-[linear-gradient(145deg,#001118_0%,#00090D_50%,#070008_100%)]",
    activeLabel: "text-[#B9F5FF]",
    idleLabel: "text-[#84BBC7]",
    activeEmblem:
      "border-[#2BCBE9] bg-[#001F29] text-[#71ECFF]",
    idleEmblem:
      "border-[#15566E] bg-[#000C11] text-[#479BAF]",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(87,233,255,0.70)_0%,rgba(15,204,242,0.34)_30%,rgba(0,134,177,0.13)_54%,transparent_76%)]",
    halo:
      "bg-[radial-gradient(ellipse_at_center,rgba(192,247,255,0.38)_0%,rgba(62,221,251,0.20)_48%,transparent_72%)]",
    topFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(33,208,243,0.12)_16%,#6EEBFF_36%,#B9F6FF_46%,#F3FEFF_50%,#B9F6FF_54%,#6EEBFF_64%,rgba(33,208,243,0.12)_84%,transparent_100%)]",
    bottomFlare:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(18,193,230,0.12)_14%,#35DFFF_34%,#78ECFF_45%,#DDFBFF_50%,#78ECFF_55%,#35DFFF_66%,rgba(18,193,230,0.12)_86%,transparent_100%)]",
    reflection:
      "bg-[radial-gradient(ellipse_at_center,rgba(26,211,249,0.40)_0%,rgba(0,153,199,0.17)_34%,transparent_72%)]",
    innerHighlight:
      "bg-[linear-gradient(90deg,transparent_0%,rgba(151,238,255,0.10)_15%,rgba(225,252,255,0.28)_50%,rgba(151,238,255,0.10)_85%,transparent_100%)]",
    activeShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_3px_rgba(226,251,255,0.50),0_0_9px_rgba(69,225,255,0.43),0_0_24px_rgba(16,184,224,0.22)]",
    idleShadow:
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.028)]",
  },
}

function JackpotGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 8.2 7.2 11 12 5.4l4.8 5.6L20 8.2l-1.35 8.15H5.35L4 8.2Z"
        fill="currentColor"
      />
      <path d="M6.1 18.3h11.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="4" cy="6.4" r="1.2" fill="currentColor" />
      <circle cx="12" cy="3.5" r="1.2" fill="currentColor" />
      <circle cx="20" cy="6.4" r="1.2" fill="currentColor" />
    </svg>
  )
}

function BalloonGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.1c-3.45 0-6.05 2.78-6.05 6.35 0 3.43 2.38 6.28 5.23 6.95l-.78 1.65h3.2l-.78-1.65c2.85-.67 5.23-3.52 5.23-6.95C18.05 5.88 15.45 3.1 12 3.1Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M12 18.05c.05 1.1-.55 1.8-1.25 2.55"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <path
        d="m18.75 4.1.65-1.2M20.1 6.2l1.35-.25M17.2 2.95l-.15-1.4"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DiamondGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="m4.2 8.2 3.15-4h9.3l3.15 4L12 20.1 4.2 8.2Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
      <path
        d="M4.7 8.25h14.6M8 4.5l4 15M16 4.5l-4 15M8.1 8.2 12 4.35l3.9 3.85"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RoomGlyph({
  railKey,
  fallback,
}: {
  railKey: string
  fallback: RailIconKey
}) {
  if (railKey === "featured") return <JackpotGlyph className="h-[22px] w-[22px]" />
  if (railKey === "balloon_pop") return <BalloonGlyph className="h-[22px] w-[22px]" />

  if (railKey === "instant_cash" || railKey === "luxury") {
    return <DiamondGlyph className="h-[22px] w-[22px]" />
  }

  return <RailIcon name={fallback} className="h-[20px] w-[20px]" />
}

/**
 * Sticky, horizontally-scrollable casino-lobby category navigation.
 *
 * FUNCTIONAL BEHAVIOUR IS UNCHANGED:
 * - no scroll listeners
 * - exactly one IntersectionObserver
 * - active state is one string
 * - native horizontal scrolling
 * - native smooth scroll to section
 */
export function HomeRailNav({ items }: { items: HomeNavItem[] }) {
  const [active, setActive] = useState(items[0]?.key ?? "")
  const navRef = useRef<HTMLDivElement | null>(null)
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (items.length <= 1) return

    const sections = items
      .map((it) => document.getElementById(`home-rail-${it.key}`))
      .filter((el): el is HTMLElement => Boolean(el))

    if (sections.length === 0) return

    const visible = new Set<string>()
    const order = items.map((it) => it.key)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = entry.target.getAttribute("data-rail-key") ?? ""
          if (!key) continue

          if (entry.isIntersecting) visible.add(key)
          else visible.delete(key)
        }

        for (const key of order) {
          if (visible.has(key)) {
            setActive((prev) => (prev === key ? prev : key))
            return
          }
        }
      },
      {
        rootMargin: "-120px 0px -70% 0px",
        threshold: 0,
      },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [items])

  useEffect(() => {
    const nav = navRef.current
    const chip = chipRefs.current[active]

    if (!nav || !chip) return

    const chipLeft = chip.offsetLeft
    const chipRight = chipLeft + chip.offsetWidth
    const viewLeft = nav.scrollLeft
    const viewRight = viewLeft + nav.clientWidth

    if (chipLeft < viewLeft) {
      nav.scrollTo({
        left: Math.max(0, chipLeft - 16),
        behavior: "smooth",
      })
    } else if (chipRight > viewRight) {
      nav.scrollTo({
        left: chipRight - nav.clientWidth + 16,
        behavior: "smooth",
      })
    }
  }, [active])

  const go = (key: string) => {
    const el = document.getElementById(`home-rail-${key}`)

    if (!el) return

    setActive(key)

    el.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
  }

  if (items.length <= 1) return null

  return (
    <nav
      aria-label="Competition categories"
      className="sticky top-16 z-40 -mx-4 mb-6 border-y border-white/[0.06] bg-[#040006]/[0.985] shadow-[0_12px_34px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.025),inset_0_-1px_0_rgba(255,196,37,0.06)] backdrop-blur-md md:mb-8"
    >
      {/* Right-edge fade — a subtle "more categories" affordance on mobile,
          where the rail scrolls horizontally with the scrollbar hidden. Purely
          decorative; desktop keeps the original look. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 bg-gradient-to-l from-[#040006] to-transparent md:hidden"
      />
      <div
        ref={navRef}
        className="flex h-[86px] items-center gap-[10px] overflow-x-auto px-4 py-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:h-[104px] md:py-[20px]"
      >
        {items.map((item) => {
          const isActive = item.key === active
          const room = ROOM_STYLES[item.key] ?? ROOM_STYLES.featured

          return (
            <div
              key={item.key}
              className={[
                "relative h-[64px] shrink-0",
                room.width,
              ].join(" ")}
            >
              {/* LARGE SOFT BLOOM — behind the tile, but still inside scrollport. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute -inset-x-[9px] -inset-y-[7px] rounded-[20px] blur-[10px]",
                  "transition-opacity duration-150",
                  room.bloom,
                  isActive ? "opacity-[0.72]" : "opacity-[0.10]",
                ].join(" ")}
              />

              {/* TIGHTER HALO — this gives the edge its lit-tube density. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute -inset-[3px] rounded-[16px] blur-[5px]",
                  "transition-opacity duration-150",
                  room.halo,
                  isActive ? "opacity-[0.68]" : "opacity-[0.10]",
                ].join(" ")}
              />

              {/* REFLECTED LIGHT BELOW THE ACTIVE TILE. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute -bottom-[10px] left-[9%] right-[9%] h-[16px] blur-[8px]",
                  room.reflection,
                  isActive ? "opacity-[0.76]" : "opacity-0",
                ].join(" ")}
              />

              {/* TOP WHITE-HOT FLARE. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute left-[8%] right-[8%] top-[1px] z-20 h-[2px] rounded-full blur-[0.4px]",
                  room.topFlare,
                  isActive ? "opacity-100" : "opacity-[0.12]",
                ].join(" ")}
              />

              {/* Concentrated top flare node. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute left-[49%] top-[-2px] z-20 h-[7px] w-[34px] -translate-x-1/2 rounded-full blur-[4px]",
                  room.topFlare,
                  isActive ? "opacity-[0.82]" : "opacity-0",
                ].join(" ")}
              />

              {/* BOTTOM WHITE-HOT FLARE. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute bottom-[1px] left-[7%] right-[7%] z-20 h-[2px] rounded-full blur-[0.5px]",
                  room.bottomFlare,
                  isActive ? "opacity-100" : "opacity-[0.10]",
                ].join(" ")}
              />

              {/* Bottom hotspot node. */}
              <span
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute bottom-[-3px] left-[50%] z-20 h-[8px] w-[38px] -translate-x-1/2 rounded-full blur-[5px]",
                  room.bottomFlare,
                  isActive ? "opacity-[0.76]" : "opacity-0",
                ].join(" ")}
              />

              <button
                ref={(element) => {
                  chipRefs.current[item.key] = element
                }}
                type="button"
                aria-current={isActive ? "true" : undefined}
                onClick={() => go(item.key)}
                className={[
                  "absolute inset-x-0 top-[2px] z-10 h-[60px] overflow-hidden rounded-[12px] border",
                  "transition-[border-color,background-color,box-shadow,color] duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-[#040006]",
                  isActive ? room.activeBorder : room.idleBorder,
                  isActive ? room.activeSurface : room.idleSurface,
                  isActive ? room.activeShadow : room.idleShadow,
                ].join(" ")}
              >
                {/* Fine metallic highlight inside the crisp tile edge. */}
                <span
                  aria-hidden="true"
                  className={[
                    "pointer-events-none absolute left-[6%] right-[6%] top-0 h-px",
                    room.innerHighlight,
                    isActive ? "opacity-100" : "opacity-[0.20]",
                  ].join(" ")}
                />

                {/* Partial illuminated side tubing. */}
                <span
                  aria-hidden="true"
                  className={[
                    "pointer-events-none absolute -left-px top-[11px] h-[27px] w-[2px] rounded-full blur-[0.35px]",
                    room.topFlare,
                    isActive ? "opacity-[0.80]" : "opacity-[0.10]",
                  ].join(" ")}
                />
                <span
                  aria-hidden="true"
                  className={[
                    "pointer-events-none absolute -right-px bottom-[9px] h-[22px] w-[2px] rounded-full blur-[0.35px]",
                    room.bottomFlare,
                    isActive ? "opacity-[0.72]" : "opacity-[0.08]",
                  ].join(" ")}
                />

                <span className="relative z-10 flex h-full items-center gap-[9px] px-[12px]">
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border",
                      "transition-[border-color,background-color,box-shadow,color] duration-150",
                      isActive ? room.activeEmblem : room.idleEmblem,
                    ].join(" ")}
                  >
                    <RoomGlyph railKey={item.key} fallback={item.icon} />
                  </span>

                  {/* IMPORTANT: no truncate / ellipsis.
                      Room widths are explicitly sized so primary labels fit fully. */}
                  <span
                    className={[
                      "whitespace-nowrap text-left text-[13px] font-black uppercase leading-none tracking-[0.012em]",
                      "transition-colors duration-150",
                      isActive ? room.activeLabel : room.idleLabel,
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
