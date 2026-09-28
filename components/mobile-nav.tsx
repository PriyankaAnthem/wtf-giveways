"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Gift, Trophy, User, Mail } from "lucide-react"
import { cn } from "@/lib/utils"

// 5 items: Home, Winners on left | Giveaways center | Account, Contact on right
const leftItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/winners", label: "Winners", icon: Trophy },
]

const centerItem = { href: "/giveaways", label: "Giveaways", icon: Gift }

const rightItems = [
  { href: "/me", label: "Account", icon: User },
  { href: "/contact", label: "Contact", icon: Mail },
]

export function MobileNav() {
  const pathname = usePathname()
  const isCasinoHome = pathname === "/"

  // On individual giveaway detail pages (/giveaways/[slug]) the mobile sticky
  // purchase bar becomes the primary bottom action, so the normal bottom nav is
  // suppressed there to avoid two stacked fixed bars. The /giveaways index and
  // all other pages keep the nav. Scoped here so nothing global changes.
  const isGiveawayDetail = pathname.startsWith("/giveaways/") && pathname !== "/giveaways"
  // On the checkout Review page the checkout-specific sticky Pay CTA owns the
  // bottom of the viewport, so the global nav is suppressed to keep checkout
  // focused and remove unnecessary exit points. Only this exact route changes.
  const isCheckoutReview = pathname === "/checkout/review"
  // The auth flow (sign-up wizard, login) is a focused, full-screen journey with
  // its own primary CTAs at the bottom of each step. The global bottom nav both
  // competes with those CTAs and — via its protruding centre button — overlaps
  // centred form fields, so it is suppressed across /auth/*. Same rationale and
  // pattern as the giveaway-detail and checkout-review suppressions above.
  const isAuthFlow = pathname.startsWith("/auth")
  if (isGiveawayDetail || isCheckoutReview || isAuthFlow) return null

  const renderNavItem = (item: typeof leftItems[0], isCenter = false) => {
    const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
    const Icon = item.icon

    if (isCenter) {
      return (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          className="relative -mt-6 flex flex-col items-center"
        >
          {/* Elevated center button */}
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-full transition-all duration-200",
              isCasinoHome
                ? "border-[3px] border-[#6C278A] bg-[linear-gradient(180deg,#FFE36B_0%,#FFC32F_46%,#FFA100_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.70),0_0_4px_rgba(255,247,211,0.60),0_0_13px_rgba(255,186,14,0.52),0_0_28px_-6px_rgba(171,57,255,0.72)]"
                : "border-4 border-purple-950 bg-gradient-to-b from-[#FFD46A] to-[#F7A600] shadow-lg",
              isCasinoHome
                ? "hover:brightness-105"
                : "hover:scale-105 hover:shadow-[0_0_20px_rgba(247,166,0,0.5)]",
              isActive &&
                (isCasinoHome
                  ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.74),0_0_5px_rgba(255,249,220,0.68),0_0_16px_rgba(255,186,14,0.58),0_0_32px_-5px_rgba(171,57,255,0.80)]"
                  : "shadow-[0_0_25px_rgba(247,166,0,0.6)] scale-105")
            )}
          >
            <Icon className="h-7 w-7 text-purple-950" aria-hidden="true" />
          </div>
          <span className={cn(
            "mt-1 text-[10px] font-bold uppercase tracking-wide",
            isActive ? "text-amber-400" : isCasinoHome ? "text-white/78" : "text-white/90"
          )}>
            {item.label}
          </span>
        </Link>
      )
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        className={cn(
          "flex flex-col items-center justify-center gap-1 min-w-[60px] py-1 transition-colors",
          isActive ? "text-amber-400" : isCasinoHome ? "text-white/72 hover:text-white" : "text-white/80 hover:text-white"
        )}
      >
        <div className={cn(
          "flex items-center justify-center rounded-lg p-2 transition-all",
          isActive && (isCasinoHome ? "bg-[#2A0A38]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_10px_rgba(123,36,181,0.15)]" : "bg-white/15")
        )}>
          <Icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
        </div>
        <span className={cn(
          "text-[11px] font-semibold tracking-wide",
          isActive && "font-bold"
        )}>
          {item.label}
        </span>
      </Link>
    )
  }

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the nav. Matches the
          bar's effective height: the 80px curved bar PLUS the iOS home-indicator
          safe area we reserve below it. */}
      <div
        className="md:hidden"
        style={{ height: "calc(5rem + env(safe-area-inset-bottom))" }}
        aria-hidden="true"
      />

      {/* Reserve the home-indicator safe area below the bar so tap targets sit
          above it (paddingBottom lifts the whole bar), then paint just that
          bottom strip to match the bar so nothing shows through on gesture-nav
          iPhones. The curved notch above the bar stays transparent. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0",
            isCasinoHome ? "bg-[#07000d]" : "bg-purple-950",
          )}
          style={{ height: "env(safe-area-inset-bottom)" }}
        />
        {/* Curved notch background using SVG */}
        <div className="relative">
          {/* SVG curved background */}
          <svg
            className="absolute bottom-0 left-0 right-0 h-20 w-full"
            viewBox="0 0 400 80"
            preserveAspectRatio="none"
            fill="none"
          >
            <path
              d="M0 20 L160 20 Q175 20 180 35 Q200 70 220 35 Q225 20 240 20 L400 20 L400 80 L0 80 Z"
              className={isCasinoHome ? "fill-[#07000d]" : "fill-purple-950"}
            />
            {/* Subtle top border/glow line */}
            <path
              d="M0 20 L160 20 Q175 20 180 35 Q200 70 220 35 Q225 20 240 20 L400 20"
              className={isCasinoHome ? "stroke-[#6E2589]/80" : "stroke-purple-700/50"}
              strokeWidth="1"
              fill="none"
            />
          </svg>

          {isCasinoHome && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 top-[19px] h-px bg-[linear-gradient(90deg,transparent_0%,#6D218C_22%,#A52ED0_50%,#6D218C_78%,transparent_100%)] opacity-70"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-[41%] right-[41%] top-[17px] h-[5px] rounded-full bg-[#BF47E7]/25 blur-[5px]"
              />
            </>
          )}

          {/* Nav content */}
          <div className="relative z-10 flex items-center justify-between px-2 pb-2 pt-6">
            {/* Left items */}
            <div className="flex flex-1 justify-evenly">
              {leftItems.map((item) => renderNavItem(item))}
            </div>

            {/* Center item (elevated) */}
            <div className="flex-shrink-0 px-1">
              {renderNavItem(centerItem, true)}
            </div>

            {/* Right items */}
            <div className="flex flex-1 justify-evenly">
              {rightItems.map((item) => renderNavItem(item))}
            </div>
          </div>
        </div>
      </nav>
    </>
  )
}
