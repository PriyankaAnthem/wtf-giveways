"use client"

import Script from "next/script"
import { Analytics } from "@vercel/analytics/next"
import { useEffect, useState } from "react"
import { MetaPixel } from "@/components/meta/MetaPixel"
import { TrafficTracker } from "@/components/analytics/TrafficTracker"
import { ConsentBanner } from "@/components/analytics/ConsentBanner"
import { CONSENT_CHANGE_EVENT, getConsent, type ConsentDecision } from "@/lib/analytics/consent"

// Public GA measurement id (ships to every browser regardless).
const GA_MEASUREMENT_ID = "G-X74JFX5GVM"

/**
 * Single consent-aware analytics gate for the whole site.
 *
 * ALL analytics — first-party (`TrafficTracker` → /api/track) and third-party
 * (Google Analytics, Meta Pixel, Vercel Analytics) — mount here and ONLY once
 * the visitor has granted analytics consent. Until then nothing analytics-
 * related loads and no identifiers are created; the only persisted state is the
 * consent decision itself (written by the banner).
 *
 * Consent is read from the `wtf_consent` cookie on mount and kept live via the
 * {@link CONSENT_CHANGE_EVENT}, so accepting or rejecting takes effect
 * immediately without a reload. Both the initial SSR output and the first
 * client render are empty (state resolves in an effect), avoiding any hydration
 * mismatch.
 */
export function AnalyticsSuite() {
  const [decision, setDecision] = useState<ConsentDecision | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setDecision(getConsent())
    setReady(true)
    const onChange = () => setDecision(getConsent())
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange)
  }, [])

  const granted = decision === "granted"

  return (
    <>
      {granted && (
        <>
          <MetaPixel />
          <TrafficTracker />
          <Analytics />
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}');
            `}
          </Script>
        </>
      )}
      {ready && decision === null && <ConsentBanner />}
    </>
  )
}
