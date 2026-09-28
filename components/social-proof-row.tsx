import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Users } from "lucide-react"

interface SocialProofRowProps {
  entrantCountBucket: string
  recentAvatars: string[]
}

export function SocialProofRow({ entrantCountBucket, recentAvatars }: SocialProofRowProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {recentAvatars.slice(0, 4).map((url, i) => (
              <Avatar key={i} className="h-10 w-10 border-2 border-background">
                <AvatarImage src={url || "/placeholder.svg"} alt="" />
                <AvatarFallback>U{i + 1}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          <div>
            <div className="flex items-center gap-1 text-sm font-semibold">
              <Users className="h-4 w-4 text-brand" aria-hidden="true" />
              <span>{entrantCountBucket} people entered</span>
            </div>
            <p className="text-xs text-muted-foreground">Join thousands of participants</p>
          </div>
        </div>
      </div>
    </div>
  )
}
