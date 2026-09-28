"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"
import { analyticsAllowed } from "@/lib/analytics/consent"

/**
 * First-party page-view tracker.
 *
 * Fires exactly one `/api/track` beacon per genuine App Router pathname
 * navigation (including the initial landing view, which is the most important
 * one for a first-party funnel). It is deliberately tiny and defensive:
 *
 *   - Uses `usePathname` ONLY — query strings are never read or sent, so it
 *     needs no Suspense boundary and never fires on a bare `?query` change.
 *   - De-duplicates React re-renders and StrictMode double-invokes via a ref,
 *     so a single navigation never sends twice.
 *   - Generates ONE `event_id` per navigation and reuses it on the single
 *     retry, so a transient network blip can't create duplicate events (the
 *     server is also idempotent on `event_id`).
 *   - Skips the admin console entirely.
 *   - Is entirely fire-and-forget: any failure is swallowed and can NEVER
 *     affect navigation, checkout, or rendering. Renders nothing.
 */
export function TrafficTracker() {
  const pathname = usePathname()
  const lastSentPath = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    // Defense-in-depth: never fire without analytics consent. The suite only
    // mounts this component once consent is granted; the server also refuses a
    // POST without the consent cookie. This is the third, belt-and-braces gate.
    if (!analyticsAllowed()) return
    // Never track the admin console (defense-in-depth; the server also refuses).
    if (pathname.startsWith("/admin")) return
    // Same path as last time (re-render / StrictMode double-invoke): skip.
    if (lastSentPath.current === pathname) return
    lastSentPath.current = pathname

    // One id per navigation, reused across the retry below.
    const eventId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const payload = JSON.stringify({
      eventId,
      path: pathname,
      referrer: typeof document !== "undefined" ? document.referrer : "",
    })

    const send = (attempt: number): void => {
      try {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => {
          // Network failure: retry exactly once, reusing the same event_id.
          if (attempt === 0) send(1)
        })
      } catch {
        // Synchronous throw (very old browsers): retry once, then give up.
        if (attempt === 0) send(1)
      }
    }

    send(0)
  }, [pathname])

  return null
}
