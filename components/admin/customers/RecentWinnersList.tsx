"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, ChevronLeft, ChevronRight, ChevronRight as RowChevron, RefreshCw } from "lucide-react"
import { CustomerAvatar } from "./CustomerAvatar"
import { WinStatusBadge } from "./WinStatusBadge"
import {
  formatDayTime,
  formatRelativeTime,
  resolveCustomerName,
  resolveWinPrizeLabel,
  type WinRecord,
} from "./format"

type Winner = {
  win_kind: string | null
  record_id: string | null
  occurred_at: string | null
  user_id: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  real_name: string | null
  email: string | null
  mobile: string | null
  campaign_id: string | null
  campaign_title: string | null
  prize_title: string | null
  prize_value_pence: number | null
  fulfilment_type: string | null
  winning_ticket: number | null
  is_paid: boolean
  fulfilled_at: string | null
  placed: number | null
}

type PageSize = 25 | 50 | 100

/** Adapt a winner row to the shared WinRecord shape for the prize-label
 *  resolver (fields the feed doesn't carry are nulled out). */
function toWinRecord(w: Winner): WinRecord {
  return {
    win_kind: w.win_kind,
    record_id: w.record_id,
    occurred_at: w.occurred_at,
    campaign_id: w.campaign_id,
    campaign_title: w.campaign_title,
    prize_title: w.prize_title,
    prize_value_pence: w.prize_value_pence,
    fulfilment_type: w.fulfilment_type,
    winning_ticket: w.winning_ticket,
    is_paid: w.is_paid,
    paid_at: null,
    fulfilled_at: w.fulfilled_at,
    payout_amount_pence: null,
    checkout_intent_id: null,
    placed: w.placed,
  }
}

function mapError(code: unknown): string {
  switch (code) {
    case "Not authenticated":
      return "Your session has expired. Please sign in again."
    case "invalid_limit":
    case "invalid_offset":
      return "Something went wrong loading recent winners. Please refresh and try again."
    default:
      return "Recent winners are temporarily unavailable. Please try again."
  }
}

export function RecentWinnersList() {
  const router = useRouter()

  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [offset, setOffset] = useState(0)
  // Manual refresh trigger — an explicit, one-shot refetch of THIS view only.
  const [refreshKey, setRefreshKey] = useState(0)

  const [winners, setWinners] = useState<Winner[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset paging whenever the page size changes.
  useEffect(() => {
    setOffset(0)
  }, [pageSize])

  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set("limit", String(pageSize))
    params.set("offset", String(offset))

    ;(async () => {
      try {
        const res = await fetch(`/api/admin/customers/recent-winners?${params.toString()}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (requestId !== requestIdRef.current) return

        if (!res.ok || !json.ok) {
          setError(mapError(json?.error))
          setWinners([])
          setHasNext(false)
          return
        }
        setWinners(json.winners ?? [])
        setHasNext(json.hasNext === true)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setError("Recent winners are temporarily unavailable. Please try again.")
        setWinners([])
        setHasNext(false)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [pageSize, offset, refreshKey])

  const goNext = () => {
    if (!hasNext) return
    setOffset((o) => o + pageSize)
  }
  const goPrev = () => {
    setOffset((o) => Math.max(0, o - pageSize))
  }

  const refresh = useCallback(() => {
    // Refetch this ONE view only. If not already on the newest page, jump back
    // to it so a manual refresh surfaces the latest wins.
    if (offset !== 0) setOffset(0)
    else setRefreshKey((k) => k + 1)
  }, [offset])

  const openCustomer = (userId: string) => router.push(`/admin/customers/${userId}`)

  const pageNumber = Math.floor(offset / pageSize) + 1

  return (
    <div className="space-y-4">
      {/* No customer status filter and no directory search here — this is a
          winners feed, not a customer directory. Page size + manual refresh. */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v) as PageSize)}>
          <SelectTrigger className="h-10 w-[130px]" aria-label="Results per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 per page</SelectItem>
            <SelectItem value="50">50 per page</SelectItem>
            <SelectItem value="100">100 per page</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 py-16 text-center text-destructive">
          {error}
        </div>
      ) : loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[112px] w-full rounded-xl" />
          ))}
        </div>
      ) : winners.length === 0 ? (
        <div className="rounded-xl border py-20 text-center text-muted-foreground">No recent winners.</div>
      ) : (
        <div className="space-y-2.5">
          {winners.map((w, i) => {
            const name = resolveCustomerName(w)
            const prize = resolveWinPrizeLabel(toWinRecord(w))
            const key = w.record_id ?? `${w.user_id}-${w.occurred_at ?? i}`
            return (
              <div
                key={key}
                onClick={() => openCustomer(w.user_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openCustomer(w.user_id)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open ${name}, winner of ${prize}`}
                className="group flex cursor-pointer items-start gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-5"
              >
                <CustomerAvatar name={name} seed={w.user_id} />

                <div className="min-w-0 flex-1">
                  {/* CUSTOMER — prominent. */}
                  <div className="truncate font-semibold text-foreground">{name}</div>

                  {/* PRIZE + COMPETITION — the other dominant piece. */}
                  <div className="mt-1 font-semibold uppercase tracking-wide text-primary">{prize}</div>
                  {w.campaign_title && (
                    <div className="truncate text-sm text-muted-foreground">{w.campaign_title}</div>
                  )}

                  {/* TICKET / PLACEMENT + TIME. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {w.winning_ticket !== null && (
                      <span className="tabular-nums">Ticket #{w.winning_ticket}</span>
                    )}
                    {w.placed !== null && <span className="tabular-nums">Placed {w.placed}</span>}
                    <span title={formatDayTime(w.occurred_at)}>{formatRelativeTime(w.occurred_at)}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="tabular-nums">{formatDayTime(w.occurred_at)}</span>
                  </div>

                  {/* STATUS. */}
                  <div className="mt-2">
                    <WinStatusBadge win={w} />
                  </div>
                </div>

                <RowChevron
                  className="mt-1 size-5 shrink-0 self-center text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <p className="text-sm text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </span>
          ) : (
            <>Page {pageNumber}</>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={goPrev} disabled={offset === 0 || loading}>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={goNext} disabled={!hasNext || loading}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
