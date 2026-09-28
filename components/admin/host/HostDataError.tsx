import Link from "next/link"
import { AlertTriangle } from "lucide-react"

/**
 * Concise, self-contained error state for the Host area when the initial
 * server load fails. Keeps the host in the app (never a blank/broken screen)
 * with a simple retry. Auth failures are handled upstream by requireAdmin.
 */
export function HostDataError({
  reason,
  title = "We couldn't load your dashboard",
  retryHref = "/admin/host",
}: {
  reason?: string
  title?: string
  retryHref?: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center">
      <AlertTriangle aria-hidden="true" className="h-7 w-7 text-muted-foreground" />
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {reason === "service_unavailable"
          ? "The reporting service is temporarily unavailable. Please try again in a moment."
          : "Something went wrong loading your figures. Please try again."}
      </p>
      <Link
        href={retryHref}
        className="mt-1 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Try again
      </Link>
    </div>
  )
}
