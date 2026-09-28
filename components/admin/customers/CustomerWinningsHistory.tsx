"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react"
import { WinStatusBadge } from "./WinStatusBadge"
import { formatDateTime, resolveWinPrizeLabel, type WinRecord } from "./format"

const PAGE_SIZE = 25

/** "1st place", "2nd place"… from a 1-based placement. */
function formatPlacement(placed: number | null): string | null {
  if (placed === null || placed <= 0) return null
  const mod100 = placed % 100
  const mod10 = placed % 10
  let suffix = "th"
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st"
    else if (mod10 === 2) suffix = "nd"
    else if (mod10 === 3) suffix = "rd"
  }
  return `${placed}${suffix} place`
}

export function CustomerWinningsHistory({ userId }: { userId: string }) {
  const [winnings, setWinnings] = useState<WinRecord[]>([])
  const [offset, setOffset] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const res = await fetch(`/api/admin/customers/${userId}/winnings?limit=${PAGE_SIZE}&offset=${offset}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (requestId !== requestIdRef.current) return
        if (!res.ok || !json.ok) {
          setError("Winnings history is temporarily unavailable.")
          setWinnings([])
          setHasNext(false)
          return
        }
        setWinnings(json.winnings ?? [])
        setHasNext(json.hasNext === true)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setError("Winnings history is temporarily unavailable.")
        setWinnings([])
        setHasNext(false)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [userId, offset])

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="size-5 text-amber-500" aria-hidden="true" />
          Winnings history
        </CardTitle>
        <p className="text-sm text-muted-foreground">Instant wins, site-credit prizes and main-draw wins.</p>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="py-12 text-center text-destructive">{error}</p>
        ) : loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : winnings.length === 0 && offset === 0 ? (
          <p className="py-12 text-center text-muted-foreground">This customer has not won anything yet.</p>
        ) : (
          <ul className="divide-y">
            {winnings.map((w, i) => {
              const prize = resolveWinPrizeLabel(w)
              const placement = w.win_kind === "main_draw" ? formatPlacement(w.placed) : null
              return (
                <li
                  key={w.record_id ?? `${w.win_kind}-${w.occurred_at}-${i}`}
                  className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold text-foreground">{prize}</div>
                    <div className="truncate text-sm text-muted-foreground" title={w.campaign_title ?? undefined}>
                      {w.campaign_title ?? "—"}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {placement ? (
                        <span>{placement}</span>
                      ) : w.winning_ticket !== null ? (
                        <span className="tabular-nums">Ticket #{w.winning_ticket}</span>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <span>{formatDateTime(w.occurred_at)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <WinStatusBadge win={w} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      {!error && (winnings.length > 0 || offset > 0) && (
        <div className="flex items-center justify-between border-t px-6 py-3">
          <p className="text-sm text-muted-foreground">Page {pageNumber}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasNext || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
