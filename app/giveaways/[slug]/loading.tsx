import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"

export default function GiveawayLoading() {
  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8">
      {/* Hero Section */}
      <section className="border-b bg-muted/30">
        <div className="container max-w-5xl px-4 py-8">
          <div className="grid gap-8 md:grid-cols-2">
            {/* Image skeleton */}
            <div className="space-y-4">
              <Skeleton className="aspect-[4/3] w-full rounded-lg" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="aspect-square rounded-md" />
                <Skeleton className="aspect-square rounded-md" />
                <Skeleton className="aspect-square rounded-md" />
              </div>
            </div>

            {/* Details skeleton */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 pb-3">
                  <Skeleton className="h-6 w-28 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-9 w-4/5 rounded-md" />
                <Skeleton className="mt-2 h-6 w-3/5 rounded-md" />
                <div className="mt-3 flex items-baseline gap-2">
                  <Skeleton className="h-4 w-20 rounded-md" />
                  <Skeleton className="h-8 w-24 rounded-md" />
                </div>
              </div>

              <Separator />

              {/* Ticket selector skeleton */}
              <div className="space-y-4">
                <Skeleton className="h-5 w-32 rounded-md" />
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-md" />
                  <Skeleton className="h-10 w-16 rounded-md" />
                  <Skeleton className="size-10 rounded-md" />
                </div>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-20 rounded-md" />
                  <Skeleton className="h-7 w-16 rounded-md" />
                </div>
                <Skeleton className="h-12 w-full rounded-md" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Content sections */}
      <div className="container max-w-5xl px-4 py-8">
        <div className="space-y-8">
          {/* Instant win disclosure skeleton */}
          <div className="rounded-lg border p-4">
            <Skeleton className="h-5 w-48 rounded-md" />
            <Skeleton className="mt-2 h-4 w-full rounded-md" />
            <Skeleton className="mt-1 h-4 w-4/5 rounded-md" />
          </div>

          {/* Trust section skeleton */}
          <section className="space-y-4">
            <Skeleton className="h-6 w-56 rounded-md" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex gap-3 rounded-lg border bg-card p-4">
                <Skeleton className="size-5 shrink-0 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-32 rounded-md" />
                  <Skeleton className="h-4 w-full rounded-md" />
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                </div>
              </div>
              <div className="flex gap-3 rounded-lg border bg-card p-4">
                <Skeleton className="size-5 shrink-0 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-40 rounded-md" />
                  <Skeleton className="h-4 w-full rounded-md" />
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                </div>
              </div>
            </div>
          </section>

          {/* Rules skeleton */}
          <div className="rounded-lg border p-4">
            <Skeleton className="h-5 w-36 rounded-md" />
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA skeleton */}
      <div className="fixed bottom-16 left-0 right-0 border-t bg-background p-4 shadow-lg md:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Skeleton className="h-3 w-16 rounded-md" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>
          <Skeleton className="h-11 w-28 rounded-md" />
        </div>
      </div>
    </div>
  )
}
