"use client"

import { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"

interface FeedItem {
  id: string
  createdAt: string
  displayName: string | null
  realName: string | null
  mobile: string | null
  prizeTitle: string
}

const POLL_MS = 10000

function formatExactTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function formatRelativeTime(dateString: string): string {
  const diffSeconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
  return `${Math.floor(diffSeconds / 86400)}d ago`
}

export function CampaignActivityFeed({ campaignId }: { campaignId: string }) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Tracks whether a poll is currently running so overlapping polls are skipped
  // (one request per host at a time). Ref avoids re-render churn.
  const inFlightRef = useRef(false)
  // Whether we've ever loaded items successfully — used to keep last-good data
  // visible when a later poll fails.
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    let mounted = true
    const controller = new AbortController()

    async function fetchFeed() {
      // In-flight guard: never start a new poll while one is still running.
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const res = await fetch(`/api/admin/live-feed/${encodeURIComponent(campaignId)}`, {
          signal: controller.signal,
        })
        const data = await res.json()
        if (!mounted) return
        if (data.ok) {
          setItems(data.items)
          setError(null)
          setLastUpdated(new Date())
          hasLoadedRef.current = true
        } else {
          // Keep last-good items visible; just surface a small note.
          setError(data.error || "Failed to load feed")
        }
      } catch (err: any) {
        // Ignore aborts (unmount / cleanup); keep last-good items on real errors.
        if (err?.name === "AbortError") return
        if (mounted) setError("Network error")
      } finally {
        inFlightRef.current = false
        if (mounted) setLoading(false)
      }
    }

    fetchFeed()
    // Single interval, admin/host page only. Cleaned up on unmount.
    const interval = setInterval(fetchFeed, POLL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
      controller.abort()
    }
  }, [campaignId])

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-start gap-3 animate-pulse">
            <div className="h-5 w-5 rounded bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/4 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Only show a full error state if we have never loaded any items. Once we have
  // last-good data, we keep it visible and show a subtle reconnecting note.
  if (error && !hasLoadedRef.current) {
    return <div className="text-sm text-muted-foreground">Unable to load activity: {error}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {error ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">Reconnecting…</span>
        ) : (
          <span className="sr-only">Live</span>
        )}
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            Last updated {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No instant wins yet for this campaign.</div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">
                  {formatExactTime(item.createdAt)} {"\u00B7"} {formatRelativeTime(item.createdAt)}
                </p>
                <p className="text-sm">
                  <span className="font-medium">{item.realName || item.displayName || "Player"}</span> won{" "}
                  <span className="font-medium text-amber-600 dark:text-amber-400">{item.prizeTitle}</span>
                </p>
                {item.mobile && (
                  <p className="text-xs text-muted-foreground">Mobile: {item.mobile}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
