"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"

export function SiteFooter() {
  // The checkout review screen is a focused conversion flow, so the full
  // marketing footer is suppressed there (mirrors MobileNav's per-route
  // self-suppression). Every other page keeps the footer unchanged.
  const pathname = usePathname()
  if (pathname === "/checkout/review") return null

  return (
    <footer className="pb-20 md:pb-0">
      {/* Gold separator bar */}
      <div className="h-1 bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-400" />
      
      {/* Main footer content with purple background */}
      <div className="bg-[#1a0a2e]">
        <div className="container px-4 py-8 md:py-12">
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-10 lg:grid-cols-5">
            {/* Logo section */}
            <div className="lg:col-span-1">
              <Link href="/" prefetch={false} className="inline-block">
                <Image
                  src="/images/wtf-logo-main.png"
                  alt="WTF Giveaways"
                  width={180}
                  height={65}
                  className="h-auto w-[180px]"
                />
              </Link>
            </div>

            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-amber-400">Company</h3>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="/contact" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-amber-400">Support</h3>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="/faq" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    FAQ
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-amber-400">Legal</h3>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="/terms" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/legal/website-terms-of-use" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    Website Terms of Use
                  </Link>
                </li>
                <li>
                  <Link href="/legal/cookies" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    Cookie Policy
                  </Link>
                </li>
                <li>
                  <Link href="/acceptable" prefetch={false} className="text-white/80 transition-colors hover:text-amber-400">
                    Acceptable Use Policy
                  </Link>
                </li>
              </ul>
            </div>

            {/* Follow Us + Payment Types: heavier content (incl. a remote image)
                hidden on mobile to lighten the footer. Legal/support/contact
                links above remain visible on all screen sizes. */}
            <div className="hidden md:block">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-amber-400">Follow Us</h3>
              <p className="text-sm leading-relaxed text-white/80">Stay updated with our latest giveaways and winners.</p>
              
              <h3 className="mb-4 mt-6 text-xs font-semibold uppercase tracking-wider text-amber-400">Payment Types</h3>
              <Image
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Untitled%20design%20%2818%29-8FEYI4LGhbATnHZxSbQGUzlEQ01oWe.png"
                alt="We accept Mastercard, Visa, Apple Pay, and Google Pay"
                width={200}
                height={40}
              />
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-8 text-center text-sm text-white/60">
            <p>&copy; {new Date().getFullYear()} WTF Giveaways. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
