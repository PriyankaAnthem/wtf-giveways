import { Building2, Users, ShieldCheck, Megaphone, FileText, CreditCard } from "lucide-react"

const trustBlocks = [
  {
    icon: Building2,
    title: "Registered UK Company",
    description: "Fully registered and operating within UK regulations.",
  },
  {
    icon: Users,
    title: "Real People, Real Winners",
    description: "Every winner is a real person, verified and announced publicly.",
  },
  {
    icon: ShieldCheck,
    title: "Secure Payment Providers",
    description: "We use trusted, PCI-compliant payment processors.",
  },
  {
    icon: Megaphone,
    title: "Public Winner Announcements",
    description: "All winners are shared on our site and social media.",
  },
  {
    icon: FileText,
    title: "Clear Terms & Conditions",
    description: "Everything is laid out clearly. No hidden surprises.",
  },
  {
    icon: CreditCard,
    title: "Trusted Payment Methods",
    description: "Visa, Mastercard, and more accepted securely.",
  },
]

export function AboutTrust() {
  return (
    <section
      className="relative overflow-hidden py-16 md:py-24"
      style={{
        background: "linear-gradient(135deg, #831843 0%, #be185d 40%, #ec4899 100%)",
      }}
    >
      {/* Subtle texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 80%, rgba(255,255,255,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.1) 0%, transparent 50%)",
        }}
      />

      <div className="container relative z-10 mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
            Built for Transparency
          </h2>
          <p className="mt-2 text-pretty text-pink-100/80">
            Everything we do is designed to earn your trust.
          </p>
        </div>

        {/* Trust grid */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {trustBlocks.map((block) => (
            <div
              key={block.title}
              className="group rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.15]"
            >
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-white">
                <block.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-white">{block.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-pink-100/70">
                {block.description}
              </p>
            </div>
          ))}
        </div>

        {/* Payment badges placeholder */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
          {["Visa", "Mastercard", "PayPal"].map((method) => (
            <div
              key={method}
              className="flex h-10 items-center rounded-lg border border-white/20 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur-sm"
            >
              {method}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
