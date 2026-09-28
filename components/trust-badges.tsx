import { ShieldCheck, Trophy, Zap } from "lucide-react"

export function TrustBadges() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-6 py-8">
      <div className="flex items-center gap-2 text-muted-foreground">
        <ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        <span className="text-sm font-medium">Secure Payments</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Trophy className="h-5 w-5 text-brand" aria-hidden="true" />
        <span className="text-sm font-medium">Verified Winners</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Zap className="h-5 w-5 text-brand" aria-hidden="true" />
        <span className="text-sm font-medium">Instant Entry</span>
      </div>
    </div>
  )
}
