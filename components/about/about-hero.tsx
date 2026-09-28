import Image from "next/image"
import { Badge } from "@/components/ui/badge"

export function AboutHero() {
  return (
    <section className="relative overflow-hidden bg-background py-16 md:py-24">
      {/* Subtle pink glow background */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 70% 50%, rgba(236,72,153,0.08) 0%, transparent 70%)",
        }}
      />

      <div className="container relative z-10 mx-auto max-w-6xl px-4">
        <div className="flex flex-col items-center gap-10 md:flex-row md:items-center md:gap-16">
          {/* Text content */}
          <div className="flex-1 text-center md:text-left">
            <Badge
              variant="secondary"
              className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-pink-200/60 bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-700"
            >
              Registered UK Company
            </Badge>

            <h1 className="text-balance text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {"Hi, I\u2019m Choleigh"}
              <br />
              <span className="bg-gradient-to-r from-pink-500 to-rose-500 bg-clip-text text-transparent">
                Co-Founder of WTF Giveaways
              </span>
            </h1>

            <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
              WTF Giveaways was built to make winning feel exciting, fair and
              completely transparent.
            </p>

            <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
              I started WTF because I was tired of entering giveaways that felt
              shady. No one showed their winners. No one explained how their
              draws worked. I wanted to build something different &mdash; a
              platform where every draw is verifiable, every winner is real, and
              the whole community can feel the excitement together.
            </p>
          </div>

          {/* Hero banner image */}
          <div className="relative flex shrink-0 items-center justify-center">
            <div
              className="absolute -inset-4 rounded-3xl opacity-60 blur-2xl"
              aria-hidden="true"
              style={{
                background:
                  "radial-gradient(circle, rgba(236,72,153,0.25) 0%, transparent 70%)",
              }}
            />
            <div className="relative aspect-[3/2] w-72 overflow-hidden rounded-3xl border-2 border-pink-200/40 shadow-xl sm:w-80 md:w-[28rem]">
              <Image
                src="/images/about-hero-banner.png"
                alt="Excited winner next to a prize wheel with cash amounts from £5,000 to £100,000"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 288px, (max-width: 1024px) 320px, 448px"
                priority
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
