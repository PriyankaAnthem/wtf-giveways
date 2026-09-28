import { ShieldCheck, Trophy, Zap } from "lucide-react"

/**
 * Winners page banner header.
 * No user data -- just branding + trust messaging.
 */
export function WinnersHeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/5 via-background to-primary/5">
      {/* Decorative pattern */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]" aria-hidden="true">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative flex flex-col items-center gap-4 px-6 py-10 text-center md:py-14">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-balance text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
            Our Winners
          </h1>
          <p className="mx-auto max-w-xl text-pretty text-muted-foreground md:text-lg">
            Celebrating all our winners - from main prize draws to instant wins. Every winner is verified and announced publicly.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Verified winners
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
            Main prize draws
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-500" aria-hidden="true" />
            Instant wins
          </span>
        </div>
      </div>
    </div>
  )
}
