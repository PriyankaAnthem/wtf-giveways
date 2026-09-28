"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, Home, Gift, Trophy, Mail, User, LogOut, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
  SheetFooter,
} from "@/components/ui/sheet"

const NAV_LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/giveaways", label: "Giveaways", icon: Gift },
  { href: "/winners", label: "Winners", icon: Trophy },
  { href: "/contact", label: "Contact", icon: Mail },
]

export function MobileAuthMenu({
  isSignedIn = false,
  variant = "default",
}: {
  isSignedIn?: boolean
  // "casino" swaps ONLY the trigger button skin to a dark, gold/purple
  // illuminated square (homepage gaming shell). Menu behaviour, links, sign-out
  // and the drawer are identical in both variants.
  variant?: "default" | "casino"
}) {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/auth/login"
  }

  const triggerClass =
    variant === "casino"
      ? "sm:hidden h-11 w-11 rounded-xl border border-amber-400/40 bg-[#12002c] text-white shadow-[0_0_16px_-4px_rgba(251,191,36,0.5),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-[#1b0440] hover:border-amber-300/60"
      : "sm:hidden h-11 w-11 rounded-lg border-2 border-purple-300/50 bg-white text-purple-700 shadow-md hover:bg-purple-50 hover:text-purple-800"

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className={triggerClass} aria-label="Open menu">
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-[300px] flex-col bg-[#0a0118] border-purple-900/50 text-white"
      >
        <SheetHeader className="border-b border-purple-900/30 pb-4">
          <SheetTitle className="text-white text-lg">Menu</SheetTitle>
        </SheetHeader>

        {/* Signed-in: prominent My Account card at the top of the drawer. */}
        {isSignedIn ? (
          <SheetClose asChild>
            <Link
              href="/me"
              className="mt-4 flex items-center gap-3 rounded-xl border border-purple-700/50 bg-gradient-to-r from-purple-800/60 to-purple-900/40 px-4 py-4 shadow-[0_0_20px_rgba(147,51,234,0.25)] transition-colors hover:from-purple-700/70 hover:to-purple-800/50"
            >
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#FFD46A] to-[#F7A600] text-purple-950">
                <User className="h-6 w-6" aria-hidden="true" />
              </span>
              <span className="flex flex-col">
                <span className="text-base font-bold text-white">My Account</span>
                <span className="text-xs text-purple-200">View tickets, wins &amp; details</span>
              </span>
              <ChevronRight className="ml-auto h-5 w-5 text-purple-300" aria-hidden="true" />
            </Link>
          </SheetClose>
        ) : null}

        <nav className="flex flex-1 flex-col gap-1 py-4">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => (
            <SheetClose asChild key={href}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-lg px-4 py-3.5 text-sm font-medium text-purple-100 transition-colors hover:bg-purple-900/30"
              >
                <Icon className="h-5 w-5 text-purple-300" aria-hidden="true" />
                {label}
              </Link>
            </SheetClose>
          ))}
        </nav>

        {isSignedIn ? (
          <SheetFooter className="border-t border-purple-900/30 pt-4">
            <Button
              variant="outline"
              disabled={signingOut}
              onClick={handleSignOut}
              className="w-full border-purple-700 bg-transparent text-white hover:bg-purple-900/30"
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              {signingOut ? "Signing out..." : "Sign out"}
            </Button>
          </SheetFooter>
        ) : (
          <SheetFooter className="border-t border-purple-900/30 pt-4 flex-col gap-3">
            <SheetClose asChild>
              <Button
                asChild
                className="w-full bg-red-600 text-white hover:bg-red-700 font-semibold"
              >
                <Link href="/auth/sign-up">Create account</Link>
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button
                variant="outline"
                asChild
                className="w-full border-purple-700 bg-transparent text-white hover:bg-purple-900/30"
              >
                <Link href="/auth/login">Log in</Link>
              </Button>
            </SheetClose>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
