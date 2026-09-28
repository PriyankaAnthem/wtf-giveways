"use client"

import { useEffect, useState } from "react"

/**
 * Tiny, unobtrusive freshness line: "Updated 2 min ago" based on when the
 * reporting aggregates last refreshed. Re-renders on a light 30s interval so
 * the relative time stays roughly correct without any data fetching.
 */
export function RefreshMeta({
  lastRefreshAt,
  isRefreshing,
}: {
  lastRefreshAt: string | null
  isRefreshing: boolean
}) {
  const [, force] = useState(0)

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const label = relativeLabel(lastRefreshAt)

  return (
    <p className="text-xs text-muted-foreground">
      {isRefreshing ? "Updating…" : label ? `Updated ${label}` : "Live figures"}
    </p>
  )
}

function relativeLabel(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const diffMs = Date.now() - then
  if (diffMs < 0) return "just now"
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
