import { Anton, Montserrat } from "next/font/google"

/**
 * MANDATORY fonts for this demo (see brief). Do not substitute.
 * - Anton  = all hero / game-show display text
 * - Montserrat = support text, labels, counters, secondary buttons
 * Exposed as CSS variables so the scoped stylesheet can reference them.
 */
export const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--stw-font-anton",
})

export const montserrat = Montserrat({
  weight: ["700", "800", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--stw-font-montserrat",
})
