"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, Ban, Loader2, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"
import type { AdminRole } from "@/lib/admin/permissions"
import { CustomerAvatar } from "./CustomerAvatar"
import { SelfExcludeDialog } from "@/components/admin/wallets/SelfExcludeDialog"
import { RestrictionSourceBadge } from "./RestrictionHistory"
import {
  formatUkMobile,
  formatDateTime,
  resolveCustomerName,
  type CustomerNameParts,
} from "./format"

const MIN_SEARCH_LEN = 3
const DEBOUNCE_MS = 300
const ACTIVE_PAGE_SIZE = 20

type SearchRow = CustomerNameParts & {
  user_id: string
  mobile: string | null
  is_self_excluded: boolean
}

type ActiveRestriction = {
  id: string
  user_id: string
  source: string
  reason: string | null
  created_at: string | null
  created_by_name: string | null
  customer: CustomerNameParts & { user_id: string; mobile: string | null }
}

export function SelfExclusionsWorkspace({ role }: { role: AdminRole }) {
  const isAdmin = role === "admin"

  /* ---- Search ---- */
  const [searchInput, setSearchInput] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [results, setResults] = useState<SearchRow[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const trimmedInput = searchInput.trim()
  const pendingShortSearch = trimmedInput.length > 0 && trimmedInput.length < MIN_SEARCH_LEN

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim()
      if (trimmed.length >= MIN_SEARCH_LEN) setAppliedSearch(trimmed)
      else if (trimmed.length === 0) setAppliedSearch("")
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchInput])

  const runSearch = useCallback(async (term: string) => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    setSearching(true)
    setSearchError(null)
    try {
      const params = new URLSearchParams({ search: term, status: "all", limit: "25" })
      const res = await fetch(`/api/admin/customers?${params.toString()}`, { signal: controller.signal })
      const json = await res.json()
      if (requestId !== requestIdRef.current) return
      if (!res.ok || !json.ok) {
        setSearchError("Search is temporarily unavailable. Please try again.")
        setResults([])
        return
      }
      setResults(json.customers ?? [])
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      if (requestId !== requestIdRef.current) return
      setSearchError("Search is temporarily unavailable. Please try again.")
      setResults([])
    } finally {
      if (requestId === requestIdRef.current) setSearching(false)
    }
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!appliedSearch) {
      setResults([])
      setSearchError(null)
      requestIdRef.current++
      return
    }
    runSearch(appliedSearch)
  }, [appliedSearch, runSearch])

  /* ---- Active self-exclusions ---- */
  const [active, setActive] = useState<ActiveRestriction[] | null>(null)
  const [activeError, setActiveError] = useState<string | null>(null)
  const [activeLoading, setActiveLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasNext, setHasNext] = useState(false)

  const loadActive = useCallback(async (pageArg: number) => {
    setActiveLoading(true)
    setActiveError(null)
    try {
      const params = new URLSearchParams({ page: String(pageArg), limit: String(ACTIVE_PAGE_SIZE) })
      const res = await fetch(`/api/admin/customers/restrictions?${params.toString()}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setActiveError("Active self-exclusions are temporarily unavailable.")
        setActive([])
        setHasNext(false)
        return
      }
      setActive(json.restrictions ?? [])
      setHasNext(json.hasNext === true)
    } catch {
      setActiveError("Active self-exclusions are temporarily unavailable.")
      setActive([])
      setHasNext(false)
    } finally {
      setActiveLoading(false)
    }
  }, [])

  useEffect(() => {
    loadActive(page)
  }, [loadActive, page])

  const refreshAll = useCallback(() => {
    // Reset to first page of the active list and re-run the current search.
    if (page === 0) loadActive(0)
    else setPage(0)
    if (appliedSearch) runSearch(appliedSearch)
  }, [page, loadActive, appliedSearch, runSearch])

  return (
    <div className="space-y-8">
      {/* SEARCH */}
      <section className="space-y-4" aria-label="Search customers">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="h-11 pl-9 text-base"
            placeholder="Search customer by name, email or mobile..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search customer by name, email or mobile"
          />
        </div>

        {pendingShortSearch && (
          <p className="text-sm text-muted-foreground" role="status">
            Type at least {MIN_SEARCH_LEN} characters to search.
          </p>
        )}

        {searchError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {searchError}
          </div>
        )}

        {appliedSearch && !searchError && (
          <div className="space-y-2.5">
            {searching ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
            ) : results.length === 0 ? (
              <div className="rounded-xl border py-12 text-center text-sm text-muted-foreground">
                No customers match that search.
              </div>
            ) : (
              results.map((c) => {
                const name = resolveCustomerName(c)
                return (
                  <Card key={c.user_id}>
                    <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <CustomerAvatar name={name} seed={c.user_id} />
                        <div className="min-w-0 space-y-0.5">
                          <div className="truncate font-semibold">{name}</div>
                          <div className="truncate text-sm text-muted-foreground">{c.email || "No email"}</div>
                          <div className="text-sm text-muted-foreground">
                            {c.mobile ? formatUkMobile(c.mobile) : "No mobile"}
                          </div>
                          <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {c.user_id}
                          </code>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3 self-start sm:self-center">
                        {c.is_self_excluded ? (
                          <Badge variant="destructive" className="gap-1 uppercase tracking-wide">
                            <Ban className="size-3.5" aria-hidden="true" />
                            Self Excluded
                          </Badge>
                        ) : isAdmin ? (
                          <SelfExcludeDialog userId={c.user_id} customerName={name} onExcluded={refreshAll} />
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 bg-emerald-500/10 uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                          >
                            Active
                          </Badge>
                        )}
                        <Button asChild variant="ghost" size="sm" className="gap-1.5">
                          <Link href={`/admin/customers/${c.user_id}`}>
                            Open
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        )}
      </section>

      {/* ACTIVE SELF-EXCLUSIONS */}
      <section className="space-y-4" aria-label="Active self exclusions">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active Self Exclusions
          </h3>
          {activeLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
        </div>

        {activeError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 py-10 text-center text-destructive">
            {activeError}
          </div>
        ) : activeLoading && active === null ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : active && active.length === 0 ? (
          <div className="rounded-xl border py-16 text-center text-muted-foreground">
            No active self-exclusions.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-xl border lg:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 font-semibold">Source</th>
                    <th className="px-4 py-3 font-semibold">Reason</th>
                    <th className="px-4 py-3 font-semibold">Started</th>
                    <th className="px-4 py-3 font-semibold">Applied by</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(active ?? []).map((r) => {
                    const name = resolveCustomerName(r.customer)
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <CustomerAvatar name={name} seed={r.user_id} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{name}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {r.customer.email || "No email"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <RestrictionSourceBadge source={r.source} />
                        </td>
                        <td className="max-w-[16rem] px-4 py-3 text-muted-foreground">
                          <span className="line-clamp-2 break-words">{r.reason || "—"}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatDateTime(r.created_at)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.created_by_name || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant="destructive" className="uppercase tracking-wide">
                            Active
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button asChild variant="ghost" size="sm" className="gap-1.5">
                            <Link href={`/admin/customers/${r.user_id}`}>
                              Manage
                              <ExternalLink className="size-3.5" aria-hidden="true" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-2.5 lg:hidden">
              {(active ?? []).map((r) => {
                const name = resolveCustomerName(r.customer)
                return (
                  <Card key={r.id}>
                    <CardContent className="space-y-3 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CustomerAvatar name={name} seed={r.user_id} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.customer.email || "No email"}
                            </div>
                          </div>
                        </div>
                        <RestrictionSourceBadge source={r.source} />
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
                        <div className="col-span-2">
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Reason</dt>
                          <dd className="break-words">{r.reason || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Started</dt>
                          <dd>{formatDateTime(r.created_at)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Applied by</dt>
                          <dd>{r.created_by_name || "—"}</dd>
                        </div>
                      </dl>
                      <div className="flex items-center justify-between border-t pt-3">
                        <Badge variant="destructive" className="uppercase tracking-wide">
                          Active
                        </Badge>
                        <Button asChild variant="ghost" size="sm" className="gap-1.5">
                          <Link href={`/admin/customers/${r.user_id}`}>
                            Manage
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm text-muted-foreground">Page {page + 1}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || activeLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNext || activeLoading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
