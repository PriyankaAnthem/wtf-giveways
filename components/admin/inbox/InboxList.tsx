"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
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
import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronRight as RowChevron,
  Banknote,
  UserRound,
  RefreshCw,
  CheckCheck,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { CustomerAvatar } from "@/components/admin/customers/CustomerAvatar"
import { resolveCustomerName, formatRelativeTime } from "@/components/admin/customers/format"
import { InboxStatusBadge } from "./InboxStatusBadge"
import { enquiryTypeLabel, isWinnerPayout, resolveStaffName } from "@/lib/admin/inbox/format"
import {
  INBOX_ENQUIRY_TYPES,
  type InboxListRow,
  type InboxCursor,
  type InboxStatusFilter,
} from "@/lib/admin/inbox/types"

type PageSize = 25 | 50
const DEBOUNCE_MS = 300
const POLL_MS = 30000

type Assignee = {
  user_id: string
  role: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
}

function mapError(code: unknown): string {
  switch (code) {
    case "invalid_search":
    case "invalid_status":
    case "invalid_type":
    case "invalid_assignee":
    case "invalid_limit":
    case "invalid_cursor":
      return "Something went wrong loading the inbox. Please refresh and try again."
    case "Not authenticated":
      return "Your session has expired. Please sign in again."
    default:
      return "The inbox is temporarily unavailable. Please try again."
  }
}

const assigneesFetcher = (url: string) =>
  fetch(url).then((r) => r.json())

export function InboxList() {
  const router = useRouter()
  const { toast } = useToast()

  // One-time historical cleanup ("Mark old enquiries replied").
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)

  const [searchInput, setSearchInput] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [status, setStatus] = useState<InboxStatusFilter>("open")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all")
  const [pageSize, setPageSize] = useState<PageSize>(25)

  const [cursor, setCursor] = useState<InboxCursor | null>(null)
  const [stack, setStack] = useState<(InboxCursor | null)[]>([])

  const [rows, setRows] = useState<InboxListRow[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [nextCursor, setNextCursor] = useState<InboxCursor | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lightweight assignees list (for turning UUID -> staff name + the filter).
  const { data: assigneesData } = useSWR<{ ok: boolean; assignees: Assignee[] }>(
    "/api/admin/inbox/assignees",
    assigneesFetcher,
    { revalidateOnFocus: false },
  )
  const assignees = assigneesData?.assignees ?? []
  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of assignees) map.set(a.user_id, resolveStaffName(a))
    return map
  }, [assignees])

  // Debounce search (>=2 chars applies, cleared applies; 1 char is held).
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim()
      if (trimmed.length >= 2) setAppliedSearch(trimmed)
      else if (trimmed.length === 0) setAppliedSearch("")
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchInput])

  // Any filter change resets to page one.
  useEffect(() => {
    setCursor(null)
    setStack([])
  }, [appliedSearch, status, typeFilter, assigneeFilter, pageSize])

  const buildParams = useCallback(
    (c: InboxCursor | null) => {
      const params = new URLSearchParams()
      if (appliedSearch) params.set("search", appliedSearch)
      params.set("status", status)
      if (typeFilter !== "all") params.set("type", typeFilter)
      if (assigneeFilter !== "all") params.set("assignee", assigneeFilter)
      params.set("limit", String(pageSize))
      if (c) {
        params.set("afterLastMessageAt", c.lastMessageAt)
        params.set("afterId", c.id)
      }
      return params
    },
    [appliedSearch, status, typeFilter, assigneeFilter, pageSize],
  )

  const requestIdRef = useRef(0)

  const load = useCallback(
    (opts?: { silent?: boolean }) => {
      const requestId = ++requestIdRef.current
      const controller = new AbortController()
      if (opts?.silent) setRefreshing(true)
      else setLoading(true)
      setError(null)

      ;(async () => {
        try {
          const res = await fetch(`/api/admin/inbox?${buildParams(cursor).toString()}`, {
            signal: controller.signal,
          })
          const json = await res.json()
          if (requestId !== requestIdRef.current) return
          if (!res.ok || !json.ok) {
            setError(mapError(json?.error))
            setRows([])
            setHasNext(false)
            setNextCursor(null)
            return
          }
          setRows(json.rows ?? [])
          setHasNext(json.hasNext === true)
          setNextCursor(json.nextCursor ?? null)
        } catch (err) {
          if ((err as Error).name === "AbortError") return
          if (requestId !== requestIdRef.current) return
          setError("The inbox is temporarily unavailable. Please try again.")
          setRows([])
          setHasNext(false)
          setNextCursor(null)
        } finally {
          if (requestId === requestIdRef.current) {
            setLoading(false)
            setRefreshing(false)
          }
        }
      })()

      return () => controller.abort()
    },
    [buildParams, cursor],
  )

  useEffect(() => {
    const cleanup = load()
    return cleanup
  }, [load])

  // Periodic silent refresh of the current page (no realtime, no hammering).
  useEffect(() => {
    const handle = setInterval(() => {
      if (document.visibilityState === "visible") load({ silent: true })
    }, POLL_MS)
    return () => clearInterval(handle)
  }, [load])

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

  const openTicket = (id: string) => router.push(`/admin/inbox/${id}`)

  // Runs the one-time cleanup, then refreshes the list and reports the count.
  const runBulkMarkReplied = useCallback(async () => {
    setBulkRunning(true)
    try {
      const res = await fetch("/api/admin/inbox/bulk-mark-old-replied", { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        toast({
          title: "Couldn't update enquiries",
          description: "Please try again.",
          variant: "destructive",
        })
        return
      }
      const updated: number = typeof json.updated === "number" ? json.updated : 0
      toast({
        title:
          updated === 0
            ? "No enquiries needed updating"
            : `${updated} ${updated === 1 ? "enquiry" : "enquiries"} marked as Waiting`,
        description:
          updated === 0
            ? "Nothing open was older than 2 days."
            : "They have moved from Open to Waiting.",
      })
      setBulkConfirmOpen(false)
      load({ silent: true }) // affected rows leave the Open view
    } catch {
      toast({
        title: "Couldn't update enquiries",
        description: "Please try again.",
        variant: "destructive",
      })
    } finally {
      setBulkRunning(false)
    }
  }, [toast, load])

  const pageNumber = stack.length + 1
  const pendingShortSearch = searchInput.trim().length === 1
  const emptyMessage = appliedSearch
    ? "No enquiries match that search."
    : status === "resolved"
      ? "No resolved enquiries."
      : status === "waiting"
        ? "No enquiries are awaiting a customer reply."
        : status === "all"
          ? "No enquiries yet."
          : "Nothing open — you're all caught up."

  return (
    <div className="space-y-4">
      {/* Toolbar: search dominates; status segmented; type + assignee selects. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="h-11 pl-9 text-base"
              placeholder="Search name, email, phone, order or giveaway"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search enquiries"
            />
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0 gap-2"
            onClick={() => load({ silent: true })}
            disabled={loading || refreshing}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </Button>
          <Button
            variant="outline"
            className="h-11 shrink-0 gap-2"
            onClick={() => setBulkConfirmOpen(true)}
            disabled={bulkRunning}
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            Mark old enquiries replied
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={status} onValueChange={(v) => setStatus(v as InboxStatusFilter)}>
            <TabsList className="h-11">
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="waiting">Waiting</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-11 w-[180px]" aria-label="Filter by enquiry type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {INBOX_ENQUIRY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {enquiryTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="h-11 w-[190px]" aria-label="Filter by assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {assignees.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {resolveStaffName(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v) as PageSize)}>
            <SelectTrigger className="h-11 w-[130px]" aria-label="Results per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25 per page</SelectItem>
              <SelectItem value="50">50 per page</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pendingShortSearch && (
        <p className="text-sm text-muted-foreground" role="status">
          Type at least 2 characters to search.
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
      ) : rows.length === 0 ? (
        <div className="rounded-xl border py-20 text-center text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <InboxRow
              key={row.id}
              row={row}
              assigneeName={row.inbox_assigned_to ? assigneeNameById.get(row.inbox_assigned_to) ?? null : null}
              onOpen={openTicket}
            />
          ))}
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

      <AlertDialog open={bulkConfirmOpen} onOpenChange={(o) => !bulkRunning && setBulkConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark old enquiries as replied?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all currently <strong>open</strong> support enquiries older than 2 days
              as <strong>Waiting</strong>. Use this only for enquiries you have already replied to
              outside the Inbox. Payout enquiries and anything already Waiting or Resolved are not
              affected. This is a one-off cleanup — it does not create an automatic rule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // keep the dialog open until the request resolves
                runBulkMarkReplied()
              }}
              disabled={bulkRunning}
            >
              {bulkRunning ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Updating…
                </span>
              ) : (
                "Mark as Waiting"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** A single ticket row — desktop zoned layout + mobile card. Whole row opens the
 *  conversation. */
function InboxRow({
  row,
  assigneeName,
  onOpen,
}: {
  row: InboxListRow
  assigneeName: string | null
  onOpen: (id: string) => void
}) {
  const name = resolveCustomerName({ first_name: null, last_name: null, display_name: row.full_name, email: row.email })
  const payout = isWinnerPayout(row.enquiry_type)
  const reference = row.giveaway_name || row.order_reference

  return (
    <div
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(row.id)
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open enquiry from ${name}`}
      className="group cursor-pointer rounded-xl border bg-card transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Desktop */}
      <div className="hidden items-center gap-5 px-5 py-4 lg:flex">
        {/* IDENTITY */}
        <div className="flex min-w-0 flex-[1.5] items-center gap-3">
          <CustomerAvatar name={name} seed={row.email || row.id} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-foreground">{name}</span>
              {payout && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400"
                >
                  <Banknote className="size-3" aria-hidden="true" />
                  Payout
                </Badge>
              )}
            </div>
            <div className="truncate text-sm text-muted-foreground">{row.email || "No email"}</div>
            <Badge variant="secondary" className="mt-1 font-normal">
              {enquiryTypeLabel(row.enquiry_type)}
            </Badge>
          </div>
        </div>

        {/* MESSAGE PREVIEW */}
        <div className="hidden min-w-0 flex-[2] flex-col gap-0.5 xl:flex">
          <p className="line-clamp-2 text-sm leading-snug text-foreground/90">{row.message_preview}</p>
          {reference && <p className="truncate text-xs text-muted-foreground">{reference}</p>}
        </div>

        {/* ASSIGNEE */}
        <div className="hidden min-w-0 flex-1 flex-col gap-0.5 lg:flex">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Assignee
          </span>
          {assigneeName ? (
            <span className="inline-flex items-center gap-1.5 truncate text-sm text-foreground">
              <UserRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {assigneeName}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Unassigned</span>
          )}
        </div>

        {/* STATUS + activity */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <InboxStatusBadge status={row.inbox_status} />
          <span className="text-xs text-muted-foreground">{formatRelativeTime(row.inbox_last_message_at)}</span>
        </div>
        <RowChevron
          className="size-5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      {/* Mobile / tablet card */}
      <div className="flex flex-col gap-3 p-4 lg:hidden">
        <div className="flex items-start gap-3">
          <CustomerAvatar name={name} seed={row.email || row.id} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="truncate font-semibold">{name}</span>
              <InboxStatusBadge status={row.inbox_status} />
            </div>
            <div className="truncate text-sm text-muted-foreground">{row.email || "No email"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal">
                {enquiryTypeLabel(row.enquiry_type)}
              </Badge>
              {payout && (
                <Badge
                  variant="outline"
                  className="gap-1 border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400"
                >
                  <Banknote className="size-3" aria-hidden="true" />
                  Payout
                </Badge>
              )}
            </div>
          </div>
        </div>

        <p className="line-clamp-2 border-t pt-3 text-sm leading-snug text-foreground/90">
          {row.message_preview}
        </p>
        {reference && <p className="-mt-1 truncate text-xs text-muted-foreground">{reference}</p>}

        <div className="flex items-center justify-between text-sm">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <UserRound className="size-3.5" aria-hidden="true" />
            {assigneeName ?? "Unassigned"}
          </span>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(row.inbox_last_message_at)}</span>
        </div>
      </div>
    </div>
  )
}
