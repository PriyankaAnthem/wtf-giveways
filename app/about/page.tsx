// trigger redeploy
import type { Metadata } from "next"
import { AboutHero } from "@/components/about/about-hero"
import { AboutStory } from "@/components/about/about-story"
import { AboutHowItWorks } from "@/components/about/about-how-it-works"
import { AboutSocial } from "@/components/about/about-social"
import { AboutTrust } from "@/components/about/about-trust"
import { AboutQuote } from "@/components/about/about-quote"
import { AboutCta } from "@/components/about/about-cta"

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Meet Choleigh, co-founder of WTF Giveaways. Learn why we built a transparent, exciting giveaway platform you can trust.",
}

export default function AboutPage() {
  return (
    <>
      <AboutHero />
      <AboutStory />
      <AboutHowItWorks />
      <AboutSocial />
      <AboutTrust />
      <AboutQuote />
      <AboutCta />
    </>
  )
}
