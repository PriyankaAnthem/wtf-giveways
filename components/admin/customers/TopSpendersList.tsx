"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, ChevronLeft, ChevronRight, ChevronRight as RowChevron, Ban, Trophy } from "lucide-react"
import { CustomerAvatar } from "./CustomerAvatar"
import {
  formatPence,
  formatDate,
  formatCount,
  formatUkMobile,
  resolveCustomerName,
  buildListWinningsSummary,
  type CustomerWinningsParts,
} from "./format"

type Spender = {
  user_id: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  real_name: string | null
  email: string | null
  mobile: string | null
  is_self_excluded: boolean
  confirmed_order_count: number
  lifetime_external_pence: number
  last_confirmed_at: string | null
  wallet_available_pence: number
  instant_win_count: number
  main_draw_win_count: number
  cash_won_pence: number
  site_credit_won_pence: number
}

/** The top-spenders RPC exposes instant/draw counts + cash/credit pence, but
 *  not the total/per-kind win counts. Derive a total for the winnings headline
 *  from the two count fields it does return. */
function winningsFromSpender(s: Spender): CustomerWinningsParts {
  return {
    total_win_count: s.instant_win_count + s.main_draw_win_count,
    main_draw_win_count: s.main_draw_win_count,
    instant_win_count: s.instant_win_count,
    cash_win_count: 0,
    site_credit_win_count: 0,
    cash_won_pence: s.cash_won_pence,
    site_credit_won_pence: s.site_credit_won_pence,
  }
}

type Cursor = { afterSpendPence: number; afterUserId: string }
type PageSize = 25 | 50 | 100

function mapError(code: unknown): string {
  switch (code) {
    case "Not authenticated":
      return "Your session has expired. Please sign in again."
    case "invalid_limit":
    case "invalid_cursor":
      return "Something went wrong loading top spenders. Please refresh and try again."
    default:
      return "Top spenders are temporarily unavailable. Please try again."
  }
}

export function TopSpendersList() {
  const router = useRouter()

  const [pageSize, setPageSize] = useState<PageSize>(25)

  // Forward-keyset pagination with a client-side cursor stack for "Previous".
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [stack, setStack] = useState<(Cursor | null)[]>([])

  const [spenders, setSpenders] = useState<Spender[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset pagination whenever the page size changes.
  useEffect(() => {
    setCursor(null)
    setStack([])
  }, [pageSize])

  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set("limit", String(pageSize))
    if (cursor) {
      params.set("afterSpendPence", String(cursor.afterSpendPence))
      params.set("afterUserId", cursor.afterUserId)
    }

    ;(async () => {
      try {
        const res = await fetch(`/api/admin/customers/top-spenders?${params.toString()}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (requestId !== requestIdRef.current) return

        if (!res.ok || !json.ok) {
          setError(mapError(json?.error))
          setSpenders([])
          setHasNext(false)
          setNextCursor(null)
          return
        }
        setSpenders(json.customers ?? [])
        setHasNext(json.hasNext === true)
        setNextCursor(json.nextCursor ?? null)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setError("Top spenders are temporarily unavailable. Please try again.")
        setSpenders([])
        setHasNext(false)
        setNextCursor(null)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [pageSize, cursor])

  const goNext = () => {
    if (!hasNext || !nextCursor) return
    setStack((s) => [...s, cursor])
    setCursor(nextCursor)
  }

  const goPrev = () => {
    if (stack.length === 0) return
    const prev = stack[stack.length - 1]
    setStack((s) => s.slice(0, -1))
    setCursor(prev)
  }

  const openCustomer = (userId: string) => router.push(`/admin/customers/${userId}`)

  // Rank is derived from position, NOT a COUNT(*). Each page starts at
  // (page index * page size) + 1; the RPC is already sorted by spend desc.
  const pageNumber = stack.length + 1
  const rankBase = stack.length * pageSize

  return (
    <div className="space-y-4">
      {/* No search / status controls here: the ranking RPC supports neither, and
          client-filtering a single page would corrupt the ranking. Only the
          page size is adjustable. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Ranked by lifetime cash paid.</p>
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
            <Skeleton key={i} className="h-[96px] w-full rounded-xl" />
          ))}
        </div>
      ) : spenders.length === 0 ? (
        <div className="rounded-xl border py-20 text-center text-muted-foreground">
          No customers with confirmed cash spend yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {spenders.map((s, i) => {
            const name = resolveCustomerName(s)
            const rank = rankBase + i + 1
            return (
              <div
                key={s.user_id}
                onClick={() => openCustomer(s.user_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openCustomer(s.user_id)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Rank ${rank}: open ${name}`}
                className="group cursor-pointer rounded-xl border bg-card transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {/* Desktop: rank + identity + dominant value + supporting stats. */}
                <div className="hidden items-center gap-5 px-5 py-4 lg:flex">
                  <RankBadge rank={rank} />

                  <div className="flex min-w-0 flex-[1.4] items-center gap-3">
                    <CustomerAvatar name={name} seed={s.user_id} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{name}</div>
                      <div className="truncate text-sm text-muted-foreground">{s.email ?? "No email"}</div>
                      <div className="text-sm text-muted-foreground">
                        {s.mobile ? formatUkMobile(s.mobile) : "No mobile"}
                      </div>
                    </div>
                  </div>

                  {/* DOMINANT VALUE — Cash Paid. */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Cash Paid
                    </span>
                    <span className="text-xl font-bold tabular-nums text-foreground">
                      {formatPence(s.lifetime_external_pence)}
                    </span>
                  </div>

                  <Zone label="Orders">
                    <div className="font-medium tabular-nums text-foreground">
                      {formatCount(s.confirmed_order_count)}
                    </div>
                    <div className="text-sm text-muted-foreground">Last {formatDate(s.last_confirmed_at)}</div>
                  </Zone>

                  <Zone label="Winnings">
                    <WinningsInline w={winningsFromSpender(s)} />
                  </Zone>

                  <Zone label="Wallet">
                    <div className="tabular-nums text-foreground">{formatPence(s.wallet_available_pence)}</div>
                  </Zone>

                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge selfExcluded={s.is_self_excluded} />
                    <RowChevron
                      className="size-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                </div>

                {/* Mobile / tablet: ranked card with the value made dominant. */}
                <div className="flex flex-col gap-3 p-4 lg:hidden">
                  <div className="flex items-start gap-3">
                    <RankBadge rank={rank} compact />
                    <CustomerAvatar name={name} seed={s.user_id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate font-semibold">{name}</div>
                        <StatusBadge selfExcluded={s.is_self_excluded} compact />
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{s.email ?? "No email"}</div>
                    </div>
                  </div>

                  <div className="border-t pt-3">
                    <div className="text-2xl font-bold tabular-nums text-foreground">
                      {formatPence(s.lifetime_external_pence)}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Cash paid</div>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <span className="tabular-nums">{formatCount(s.confirmed_order_count)} orders</span>
                    {" · "}
                    <span>Last {formatDate(s.last_confirmed_at)}</span>
                    <div className="mt-1 tabular-nums">{formatPence(s.wallet_available_pence)} wallet</div>
                  </div>

                  {winningsFromSpender(s).total_win_count > 0 && (
                    <div className="border-t pt-3">
                      <WinningsInline w={winningsFromSpender(s)} />
                    </div>
                  )}
                </div>
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
          <Button variant="outline" size="sm" onClick={goPrev} disabled={stack.length === 0 || loading}>
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

/** Restrained ranking. Top 3 get a subtle gold/silver/bronze tint; the rest a
 *  quiet neutral chip. Never gaudy. */
function RankBadge({ rank, compact = false }: { rank: number; compact?: boolean }) {
  const top = rank <= 3
  const tint =
    rank === 1
      ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : rank === 2
        ? "border-slate-400/40 bg-slate-400/15 text-slate-700 dark:text-slate-300"
        : rank === 3
          ? "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300"
          : "border-border bg-muted text-muted-foreground"
  return (
    <div
      className={`flex ${compact ? "size-8 text-xs" : "size-10 text-sm"} shrink-0 items-center justify-center rounded-full border font-bold tabular-nums ${tint}`}
      aria-hidden="true"
    >
      {top ? `#${rank}` : rank}
    </div>
  )
}

/** A labelled information zone in a desktop row. */
function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="hidden min-w-0 flex-1 flex-col gap-0.5 lg:flex">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <div className="text-sm leading-snug">{children}</div>
    </div>
  )
}

/** Compact winnings summary. Cash and site credit are shown separately and
 *  never summed; main-draw wins are surfaced as a count only. */
function WinningsInline({ w }: { w: CustomerWinningsParts }) {
  const summary = buildListWinningsSummary(w)
  if (!summary) {
    return <span className="text-sm text-muted-foreground">No wins</span>
  }
  return (
    <div className="space-y-0.5">
      <div className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Trophy className="size-3.5 text-amber-500" aria-hidden="true" />
        {summary.headline}
      </div>
      {summary.money && <div className="text-sm text-muted-foreground tabular-nums">{summary.money}</div>}
      {summary.draws && <div className="text-sm text-muted-foreground">{summary.draws}</div>}
    </div>
  )
}

function StatusBadge({ selfExcluded, compact = false }: { selfExcluded: boolean; compact?: boolean }) {
  if (selfExcluded) {
    return (
      <div className={compact ? "" : "text-right"}>
        <Badge variant="destructive" className="gap-1 uppercase tracking-wide">
          <Ban className="h-3 w-3" aria-hidden="true" />
          Self-Excluded
        </Badge>
        {!compact && <p className="mt-1 text-xs text-muted-foreground">Purchasing disabled</p>}
      </div>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-500/30 bg-emerald-500/10 uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
    >
      Active
    </Badge>
  )
}
