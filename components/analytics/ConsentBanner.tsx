"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { setConsent } from "@/lib/analytics/consent"

/**
 * Minimal analytics-consent banner.
 *
 * Presentational + a single side effect: recording the visitor's decision via
 * `setConsent`, which writes the functional `wtf_consent` cookie and notifies
 * the surrounding {@link AnalyticsSuite} to mount/skip analytics live. It does
 * NOT decide its own visibility — the suite renders it only while the decision
 * is undecided — so there is one source of truth for consent state.
 *
 * Essential site functionality never depends on either choice.
 */
export function ConsentBanner() {
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Analytics cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          We use essential cookies to make this site work. With your permission we&apos;d also use
          analytics cookies to understand how the site is used and improve it. See our{" "}
          <Link href="/legal/cookies" className="font-medium text-foreground underline underline-offset-4">
            Cookie Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setConsent("denied")}>
            Reject non-essential
          </Button>
          <Button size="sm" onClick={() => setConsent("granted")}>
            Accept analytics
          </Button>
        </div>
      </div>
    </div>
  )
}
