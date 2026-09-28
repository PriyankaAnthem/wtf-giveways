import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export function AboutCta() {
  return (
    <section
      className="relative overflow-hidden py-20 md:py-28"
      style={{
        background: "linear-gradient(135deg, #ec4899 0%, #f43f5e 50%, #e11d48 100%)",
      }}
    >
      {/* Glow overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.12) 0%, transparent 60%)",
        }}
      />

      <div className="container relative z-10 mx-auto max-w-3xl px-4 text-center">
        <h2 className="text-balance text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
          Ready to Win?
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-pretty text-lg leading-relaxed text-white/80">
          Browse our live giveaways and join the community winning real prizes.
        </p>

        <div className="mt-8">
          <Button
            size="lg"
            className="rounded-2xl bg-white px-8 py-6 text-base font-bold text-pink-600 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-xl"
            asChild
          >
            <Link href="/giveaways">
              Browse Giveaways
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
