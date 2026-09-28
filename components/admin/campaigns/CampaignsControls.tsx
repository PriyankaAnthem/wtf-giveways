"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type StatusKey =
  | "all"
  | "live"
  | "draft"
  | "ended"
  | "paused"
  | "sold_out"
  | "closed"

export type FormatKey = "all" | "live" | "instant" | "other"

const STATUS_TABS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "draft", label: "Draft" },
  { key: "ended", label: "Ended" },
  { key: "paused", label: "Paused" },
  { key: "sold_out", label: "Sold out" },
  { key: "closed", label: "Closed" },
]

const FORMAT_OPTIONS: { key: FormatKey; label: string }[] = [
  { key: "all", label: "All formats" },
  { key: "live", label: "TikTok Live / Balloon Pop" },
  { key: "instant", label: "Instant Cash" },
  { key: "other", label: "Other" },
]

const PAGE_SIZES = [25, 50, 100]

interface CampaignsControlsProps {
  status: StatusKey
  search: string
  format: FormatKey
  pageSize: number
  counts: Record<StatusKey, number>
}

/**
 * Builds a URL for /admin/campaigns preserving current params, applying the
 * given overrides. Any filter change (except page navigation) resets page=1.
 */
function buildHref(
  base: URLSearchParams,
  overrides: Record<string, string | number | undefined>,
): string {
  const next = new URLSearchParams(base.toString())
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "" || v === "all") next.delete(k)
    else next.set(k, String(v))
  }
  const qs = next.toString()
  return qs ? `/admin/campaigns?${qs}` : "/admin/campaigns"
}

export function CampaignsControls({
  status,
  search,
  format,
  pageSize,
  counts,
}: CampaignsControlsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(search)

  // Keep the local input in sync if the URL search changes externally.
  useEffect(() => {
    setSearchInput(search)
  }, [search])

  const hasActiveFilters =
    status !== "all" || format !== "all" || (search?.trim().length ?? 0) > 0

  function pushWith(overrides: Record<string, string | number | undefined>) {
    // Any filter change resets pagination to the first page.
    router.push(buildHref(searchParams, { ...overrides, page: undefined }))
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    pushWith({ search: searchInput.trim() || undefined })
  }

  return (
    <div className="space-y-4">
      {/* Control bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <form onSubmit={submitSearch} className="flex-1 sm:min-w-[220px]">
          <label htmlFor="campaign-search" className="sr-only">
            Search campaigns by title or slug
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="campaign-search"
              type="search"
              inputMode="search"
              placeholder="Search title or slug"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
        </form>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Format</span>
          <Select value={format} onValueChange={(v) => pushWith({ format: v })}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => pushWith({ pageSize: v })}
          >
            <SelectTrigger className="w-full sm:w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {hasActiveFilters ? (
            <Button variant="outline" asChild>
              <Link href="/admin/campaigns">Clear filters</Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/admin/campaigns/new">Create Campaign</Link>
          </Button>
        </div>
      </div>

      {/* Status tabs — horizontally scrollable on small screens */}
      <nav
        aria-label="Filter campaigns by status"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-px"
      >
        {STATUS_TABS.map((tab) => {
          const isActive = tab.key === status
          return (
            <Link
              key={tab.key}
              href={buildHref(searchParams, { status: tab.key, page: undefined })}
              aria-current={isActive ? "page" : undefined}
              className={
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                (isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {tab.label}
              <span
                className={
                  "rounded-full px-1.5 py-0.5 text-xs " +
                  (isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground")
                }
              >
                {counts[tab.key] ?? 0}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
