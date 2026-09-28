export function SkeletonBlock() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-3/4 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="overflow-hidden rounded-lg border bg-card">
            <div className="aspect-[3/2] animate-pulse bg-muted" />
            <div className="space-y-3 p-4">
              <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
