"use client"

import Script from "next/script"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef } from "react"

// Public Meta Pixel ID. This is NOT secret (it ships to every browser anyway).
// The Meta CAPI access token is deliberately NOT referenced anywhere in this
// file or this component — Phase 1 is browser Pixel + PageView only.
const META_PIXEL_ID = "1062933412908123"

// Minimum-safe typing for the global injected by the Meta base script.
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    _fbq?: unknown
  }
}

// Fires a PageView on genuine App Router client-side navigations. The initial
// PageView is emitted by the base script below, so the very first effect run is
// intentionally skipped to avoid sending two PageView events on first load.
// useSearchParams must live under a Suspense boundary, hence the split.
function MetaPixelPageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isInitialLoad = useRef(true)

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false
      return
    }
    if (typeof window.fbq === "function") {
      window.fbq("track", "PageView")
    }
  }, [pathname, searchParams])

  return null
}

export function MetaPixel() {
  return (
    <>
      {/*
        Official Meta Pixel base snippet, loaded exactly once via next/script
        (the `id` guarantees a single execution and the `if(f.fbq)return;` guard
        makes init idempotent). Initialises the Pixel once and fires the initial
        PageView.
      */}
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>

      {/* Official no-JS fallback, rendered once. */}
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>

      <Suspense fallback={null}>
        <MetaPixelPageViewTracker />
      </Suspense>
    </>
  )
}
