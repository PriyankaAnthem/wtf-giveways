import type { Metadata } from "next"
import { DgFootballDemo } from "@/components/reveal/dg-football/DgFootballDemo"
import { DG_FOOTBALL_CSS } from "@/components/reveal/dg-football/styles"

export const metadata: Metadata = {
  title: "DG'S BIG BALLERS — Reveal Prototype",
  description: "Isolated design + UX prototype. Mock data only.",
  robots: { index: false, follow: false },
}

/**
 * /dgfootballidea — fully isolated instant-win reveal prototype.
 *
 * PROTOTYPE ONLY: no Supabase, no checkout, no payments, no award allocation,
 * no API routes, no production reveal/checkout files touched. All data is mock.
 * Rendered as a fixed full-screen overlay so it never inherits the site header,
 * footer or navigation (same isolation pattern as the existing scratch-reveal).
 */
export default function DgFootballIdeaPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DG_FOOTBALL_CSS }} />
      <DgFootballDemo />
    </>
  )
}
