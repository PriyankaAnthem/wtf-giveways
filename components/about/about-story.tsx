import { ShieldCheck, Trophy, Building2 } from "lucide-react"

const trustCards = [
  {
    icon: ShieldCheck,
    title: "Secure Payments",
    description: "Every transaction is encrypted and processed through trusted payment providers.",
  },
  {
    icon: Trophy,
    title: "Verified Winners",
    description: "All winners are publicly announced and independently verified.",
  },
  {
    icon: Building2,
    title: "UK Registered Business",
    description: "We are a fully registered UK company operating with complete transparency.",
  },
]

export function AboutStory() {
  return (
    <section className="bg-secondary/50 py-16 md:py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            Why We Built WTF
          </h2>
          <div className="mx-auto mt-6 max-w-2xl space-y-4 text-pretty leading-relaxed text-muted-foreground">
            <p>
              {"People don\u2019t trust giveaways \u2014 and honestly, we get it. Too many competition sites feel anonymous, with hidden owners and no proof that anyone ever wins."}
            </p>
            <p>
              We wanted to change that. WTF Giveaways is built on transparency,
              excitement, and real results. We show our winners publicly, we
              verify every single win, and we never hide behind a logo.
            </p>
            <p>
              {"This isn\u2019t just a business for us \u2014 it\u2019s a community. And we\u2019re here to prove that giveaways can be done the right way."}
            </p>
          </div>
        </div>

        {/* Trust icon cards */}
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {trustCards.map((card) => (
            <div
              key={card.title}
              className="group relative overflow-hidden rounded-2xl border border-pink-200/30 bg-card p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              {/* Glass shimmer */}
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                aria-hidden="true"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(236,72,153,0.04) 0%, transparent 60%)",
                }}
              />
              <div className="relative z-10">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-pink-50 text-pink-500">
                  <card.icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
