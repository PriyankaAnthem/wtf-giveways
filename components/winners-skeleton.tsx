import { Card, CardContent } from "@/components/ui/card"

export function WinnersSkeleton() {
  return (
    <div className="space-y-8">
      {/* Featured winner skeleton */}
      <Card className="overflow-hidden border-2">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
            <div className="h-24 w-24 animate-pulse rounded-full bg-muted md:h-32 md:w-32" />
            <div className="flex-1 space-y-3">
              <div className="h-6 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-64 animate-pulse rounded bg-muted" />
              <div className="h-20 w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
