"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Search, Loader2, ChevronLeft, ChevronRight, ChevronRight as RowChevron, Ban, Copy, Trophy } from "lucide-react"
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

type Customer = {
  user_id: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  real_name: string | null
  email: string | null
  mobile: string | null
  account_active: boolean
  is_self_excluded: boolean
  self_excluded_at: string | null
  account_created_at: string | null
  confirmed_order_count: number
  lifetime_external_pence: number
  last_confirmed_at: string | null
  wallet_available_pence: number
  instant_win_count: number
  main_draw_win_count: number
  total_win_count: number
  cash_win_count: number
  site_credit_win_count: number
  cash_won_pence: number
  site_credit_won_pence: number
}

type Cursor = { createdAt: string; userId: string }
type StatusFilter = "all" | "active" | "self_excluded"
type PageSize = 25 | 50 | 100

const MIN_SEARCH_LEN = 3
const DEBOUNCE_MS = 300

function mapError(code: unknown): string {
  switch (code) {
    case "invalid_search":
      return "That search contains invalid characters. Please try again."
    case "invalid_status":
    case "invalid_limit":
    case "invalid_cursor":
      return "Something went wrong loading customers. Please refresh and try again."
    case "Not authenticated":
      return "Your session has expired. Please sign in again."
    default:
      return "Customers are temporarily unavailable. Please try again."
  }
}

export function CustomersList() {
  const router = useRouter()
  const { toast } = useToast()

  const [searchInput, setSearchInput] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [pageSize, setPageSize] = useState<PageSize>(50)

  // Forward-keyset pagination with a client-side cursor stack for "Previous".
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [stack, setStack] = useState<(Cursor | null)[]>([])

  const [customers, setCustomers] = useState<Customer[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounce the search box. Applies only at >= 3 characters; 1–2 characters
  // are held (NOT sent as an empty/unfiltered request) so the full directory
  // never flashes back mid-type.
  const trimmedInput = searchInput.trim()
  const pendingShortSearch = trimmedInput.length > 0 && trimmedInput.length < MIN_SEARCH_LEN

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim()
      // Only two states ever reach the server: a >=3 char term, or "cleared".
      if (trimmed.length >= MIN_SEARCH_LEN) {
        setAppliedSearch(trimmed)
      } else if (trimmed.length === 0) {
        setAppliedSearch("")
      }
      // 1–2 chars: leave appliedSearch untouched (no new request).
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchInput])

  // Any change to search / status / page size resets pagination to page one.
  useEffect(() => {
    setCursor(null)
    setStack([])
  }, [appliedSearch, status, pageSize])

  // Latest-request guard, paired with an AbortController that cancels the
  // previous in-flight request outright.
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (appliedSearch) params.set("search", appliedSearch)
    params.set("status", status)
    params.set("limit", String(pageSize))
    if (cursor) {
      params.set("afterCreatedAt", cursor.createdAt)
      params.set("afterUserId", cursor.userId)
    }

    ;(async () => {
      try {
        const res = await fetch(`/api/admin/customers?${params.toString()}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (requestId !== requestIdRef.current) return

        if (!res.ok || !json.ok) {
          setError(mapError(json?.error))
          setCustomers([])
          setHasNext(false)
          setNextCursor(null)
          return
        }
        setCustomers(json.customers ?? [])
        setHasNext(json.hasNext === true)
        setNextCursor(json.nextCursor ?? null)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setError("Customers are temporarily unavailable. Please try again.")
        setCustomers([])
        setHasNext(false)
        setNextCursor(null)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [appliedSearch, status, pageSize, cursor])

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

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email)
      toast({ title: "Email copied", description: email })
    } catch {
      toast({ title: "Couldn't copy", description: "Copy is unavailable in this browser.", variant: "destructive" })
    }
  }

  const pageNumber = stack.length + 1
  const emptyMessage = appliedSearch
    ? "No customers match that search."
    : status === "self_excluded"
      ? "No self-excluded customers."
      : status === "active"
        ? "No active customers."
        : "No customers yet."

  return (
    <div className="space-y-4">
      {/* Compact CRM toolbar — search dominates, segmented status, page size. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="h-11 pl-9 text-base"
            placeholder="Search by name, email or mobile"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search customers by name, email or mobile"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList className="h-11">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger
                value="self_excluded"
                className="gap-1 data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground"
              >
                <Ban className="size-3.5" aria-hidden="true" />
                Self-Excluded
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v) as PageSize)}>
            <SelectTrigger className="h-11 w-[130px]" aria-label="Results per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25 per page</SelectItem>
              <SelectItem value="50">50 per page</SelectItem>
              <SelectItem value="100">100 per page</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pendingShortSearch && (
        <p className="text-sm text-muted-foreground" role="status">
          Type at least {MIN_SEARCH_LEN} characters to search.
        </p>
      )}

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 py-16 text-center text-destructive">
          {error}
        </div>
      ) : loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] w-full rounded-xl" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-xl border py-20 text-center text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="space-y-2.5">
          {customers.map((c) => {
            const name = resolveCustomerName(c)
            return (
              <div
                key={c.user_id}
                onClick={() => openCustomer(c.user_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openCustomer(c.user_id)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open ${name}`}
                className="group cursor-pointer rounded-xl border bg-card transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {/* Desktop: horizontal zoned CRM row. */}
                <div className="hidden items-center gap-5 px-5 py-4 lg:flex">
                  {/* IDENTITY */}
                  <div className="flex min-w-0 flex-[1.6] items-center gap-3">
                    <CustomerAvatar name={name} seed={c.user_id} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{name}</div>
                      {c.email ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyEmail(c.email as string)
                          }}
                          className="group/email inline-flex max-w-full items-center gap-1.5 truncate text-left text-sm text-muted-foreground hover:text-primary"
                          title={`Copy ${c.email}`}
                        >
                          <span className="truncate">{c.email}</span>
                          <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/email:opacity-100" />
                        </button>
                      ) : (
                        <div className="text-sm text-muted-foreground">No email</div>
                      )}
                      <div className="text-sm text-muted-foreground">
                        {c.mobile ? formatUkMobile(c.mobile) : "No mobile"}
                      </div>
                    </div>
                  </div>

                  {/* ACTIVITY */}
                  <Zone label="Activity">
                    {c.confirmed_order_count > 0 ? (
                      <>
                        <div className="font-medium tabular-nums text-foreground">
                          {formatCount(c.confirmed_order_count)}{" "}
                          {c.confirmed_order_count === 1 ? "order" : "orders"}
                        </div>
                        <div className="text-sm text-muted-foreground">Last {formatDate(c.last_confirmed_at)}</div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">No purchases</div>
                    )}
                  </Zone>

                  {/* VALUE */}
                  <Zone label="Value">
                    <div className="font-medium tabular-nums text-foreground">
                      {formatPence(c.lifetime_external_pence)}
                    </div>
                    <div className="text-sm text-muted-foreground">cash paid</div>
                    {c.wallet_available_pence > 0 && (
                      <div className="text-sm text-muted-foreground tabular-nums">
                        {formatPence(c.wallet_available_pence)} wallet
                      </div>
                    )}
                  </Zone>

                  {/* WINNINGS */}
                  <Zone label="Winnings">
                    <WinningsInline w={c} />
                  </Zone>

                  {/* STATUS + chevron */}
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge selfExcluded={c.is_self_excluded} />
                    <RowChevron
                      className="size-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                </div>

                {/* Mobile / tablet: full-width vertical card. */}
                <div className="flex flex-col gap-3 p-4 lg:hidden">
                  <div className="flex items-start gap-3">
                    <CustomerAvatar name={name} seed={c.user_id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate font-semibold">{name}</div>
                        <StatusBadge selfExcluded={c.is_self_excluded} compact />
                      </div>
                      {c.email ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyEmail(c.email as string)
                          }}
                          className="mt-0.5 block max-w-full truncate text-left text-sm text-muted-foreground"
                          title={`Copy ${c.email}`}
                        >
                          {c.email}
                        </button>
                      ) : (
                        <div className="mt-0.5 text-sm text-muted-foreground">No email</div>
                      )}
                      <div className="text-sm text-muted-foreground">
                        {c.mobile ? formatUkMobile(c.mobile) : "No mobile"}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-sm">
                    <div>
                      <span className="tabular-nums text-foreground">
                        {c.confirmed_order_count > 0
                          ? `${formatCount(c.confirmed_order_count)} ${c.confirmed_order_count === 1 ? "order" : "orders"}`
                          : "No purchases"}
                      </span>
                      {c.confirmed_order_count > 0 && (
                        <div className="text-xs text-muted-foreground">Last {formatDate(c.last_confirmed_at)}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-medium tabular-nums text-foreground">
                        {formatPence(c.lifetime_external_pence)} cash
                      </span>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatPence(c.wallet_available_pence)} wallet
                      </div>
                    </div>
                  </div>

                  {c.total_win_count > 0 && (
                    <div className="border-t pt-3">
                      <WinningsInline w={c} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
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

/** A labelled information zone in a desktop customer row. */
function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="hidden min-w-0 flex-1 flex-col gap-0.5 lg:flex">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <div className="text-sm leading-snug">{children}</div>
    </div>
  )
}

/**
 * Compact winnings summary for a list row. Cash and site credit are shown
 * separately and never summed; main-draw wins are surfaced as a count only
 * (they carry no canonical monetary value).
 */
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
