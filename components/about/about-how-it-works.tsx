import { Ticket, CreditCard, Lock, Zap, Award } from "lucide-react"

const steps = [
  {
    icon: Ticket,
    step: "01",
    title: "Choose Your Tickets",
    description:
      "Browse our live giveaways and pick how many tickets you want. More tickets means more chances to win.",
  },
  {
    icon: CreditCard,
    step: "02",
    title: "Your Payment Is Confirmed",
    description:
      "Your payment is securely processed and confirmed before anything else happens. No grey areas.",
  },
  {
    icon: Lock,
    step: "03",
    title: "Tickets Are Locked In",
    description:
      "Once payment is confirmed, your tickets are automatically generated and locked to you. No edits, no tampering.",
  },
  {
    icon: Zap,
    step: "04",
    title: "Instant Wins Are Immediate",
    description:
      "If you land on an instant-win ticket, you find out straight away. No waiting, no delays.",
  },
  {
    icon: Award,
    step: "05",
    title: "Main Draws Are Verified",
    description:
      "All main draws are randomly selected using a verified system. Winners are publicly announced.",
  },
]

export function AboutHowItWorks() {
  return (
    <section className="bg-background py-16 md:py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            How Our Giveaways Work
          </h2>
          <p className="mt-2 text-pretty text-muted-foreground">In plain English, no jargon.</p>
        </div>

        {/* Step cards */}
        <div className="mx-auto mt-12 max-w-2xl space-y-6">
          {steps.map((step) => (
            <div
              key={step.step}
              className="group relative flex gap-5 rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md sm:p-6"
            >
              {/* Step number accent */}
              <div className="flex shrink-0 flex-col items-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-sm font-bold text-white shadow-sm">
                  {step.step}
                </span>
                {/* Connecting line (hidden on last item) */}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <step.icon className="h-5 w-5 text-pink-500" aria-hidden="true" />
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Trust paragraph */}
        <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-pink-200/40 bg-pink-50/50 p-6 text-center">
          <p className="text-sm leading-relaxed text-foreground/80">
            {"We\u2019ve built our system so a prize cannot be awarded unless a payment is fully confirmed. Everything is logged, verified and auditable. Your trust is the foundation of everything we do."}
          </p>
        </div>
      </div>
    </section>
  )
}
