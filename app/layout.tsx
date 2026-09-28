import type React from "react"
import type { Metadata } from "next"
import { Roboto, Geist_Mono } from "next/font/google"
import { headers } from "next/headers"
import "./globals.css"
import { SiteHeader } from "@/components/site-header"
import { MobileNav } from "@/components/mobile-nav"
import { SiteFooter } from "@/components/site-footer"
import { AnnouncementBar } from "@/components/announcement-bar"
import { AnalyticsSuite } from "@/components/analytics/AnalyticsSuite"

// Customer-facing typography: Roboto, self-hosted automatically by next/font
// (no runtime request to Google).
//
// Split into two instances so we only download the faces actually used:
// upright text needs 400/500/700/900, and the sole italic in the design is the
// 900 promotional display treatment. Requesting normal+italic across all four
// weights would fetch four italic faces where only one is ever rendered.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  style: ["normal"],
  display: "swap",
  variable: "--font-roboto",
})

// Roboto Black Italic only — used exclusively by `.wtf-display`.
const robotoDisplay = Roboto({
  subsets: ["latin"],
  weight: ["900"],
  style: ["italic"],
  display: "swap",
  variable: "--font-roboto-display",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
})

const siteDescription =
  "Win insane prizes with WTF Giveaways. Enter giveaways, instant wins, and see real winners."

export const metadata: Metadata = {
  metadataBase: new URL("https://wtf-giveaways.co.uk"),
  title: {
    default: "WTF Giveaways",
    template: "%s | WTF Giveaways",
  },
  description: siteDescription,
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "WTF Giveaways",
    url: "https://wtf-giveaways.co.uk",
    title: "WTF Giveaways",
    description: siteDescription,
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "WTF Giveaways",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WTF Giveaways",
    description: siteDescription,
    images: ["/og.jpg"],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const hdrs = await headers()
  const pathname = hdrs.get("x-next-pathname") ?? hdrs.get("x-invoke-path") ?? ""
  // Admin routes render inside their own full-viewport AdminShell, so the public
  // site chrome (announcement bar, header, footer, mobile bottom nav) must not
  // wrap them. These elements remain untouched on all customer-facing routes.
  const isAdminRoute = pathname.startsWith("/admin")
  const isBarePage = pathname.startsWith("/pre-register") || isAdminRoute
  // Homepage-only dark casino header skin. Presentation flag only — same header
  // component, same auth/wallet/menu behaviour; every other route keeps the
  // default header untouched.
  const isHome = pathname === "/"

  return (
    <html lang="en">
      {/*
        The Roboto font variables are always defined so next/font emits its
        stylesheet, but the customer typography is only *activated* by the
        `wtf-type` marker class, which is withheld on /admin. Admin therefore
        keeps its existing (unchanged) font-sans system stack.
      */}
      <body
        className={`${roboto.variable} ${robotoDisplay.variable} ${geistMono.variable} ${
          isAdminRoute ? "" : "wtf-type"
        } font-sans antialiased`}
      >
        {!isBarePage && <AnnouncementBar />}
        {!isBarePage && <SiteHeader variant={isHome ? "casino" : "default"} />}
        <main className={isBarePage ? "" : "min-h-[calc(100vh-4rem)]"}>{children}</main>
        {!isBarePage && <SiteFooter />}
        {!isBarePage && <MobileNav />}
        <AnalyticsSuite />
      </body>
    </html>
  )
}
