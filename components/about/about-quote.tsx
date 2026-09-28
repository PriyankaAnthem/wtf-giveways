import { Quote } from "lucide-react"

export function AboutQuote() {
  return (
    <section className="bg-background py-16 md:py-24">
      <div className="container mx-auto max-w-3xl px-4">
        <div className="relative rounded-3xl border border-pink-200/40 bg-card p-8 shadow-sm sm:p-12">
          {/* Decorative quote mark */}
          <Quote
            className="absolute -top-4 left-6 h-10 w-10 rotate-180 text-pink-300/50 sm:left-10"
            aria-hidden="true"
          />

          <blockquote className="relative z-10 text-center">
            <p className="text-xl font-semibold leading-relaxed text-foreground sm:text-2xl md:text-3xl">
              {"I don\u2019t want you to just enter. I want you to trust us."}
            </p>
            <footer className="mt-6">
              <p
                className="text-lg text-pink-500"
                style={{ fontFamily: "Georgia, serif", fontStyle: "italic" }}
              >
                Choleigh
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">Co-Founder, WTF Giveaways</p>
            </footer>
          </blockquote>
        </div>
      </div>
    </section>
  )
}
