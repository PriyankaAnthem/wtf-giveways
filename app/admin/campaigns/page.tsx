import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CampaignsTable, type CampaignRow } from "@/components/admin/campaigns/CampaignsTable"
import {
  CampaignsControls,
  type FormatKey,
  type StatusKey,
} from "@/components/admin/campaigns/CampaignsControls"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/admin/auth"
import { BALLOON_CAMPAIGN_SLUGS, classifyGiveaway } from "@/lib/giveaway-classification"

// Explicit column allow-list. No entry/order/counter reads and no per-row
// detail query — everything the list needs comes from this single projection.
const LIST_COLUMNS =
  "id, status, title, slug, start_at, end_at, ticket_price_pence, presentation_type"

const STATUS_KEYS: StatusKey[] = [
  "all",
  "live",
  "draft",
  "ended",
  "paused",
  "sold_out",
  "closed",
]

const PAGE_SIZES = [25, 50, 100]

// Comma-joined balloon slug allow-list for PostgREST `in.(...)` filters.
const BALLOON_SLUGS_CSV = BALLOON_CAMPAIGN_SLUGS.join(",")

function normalizeStatus(raw?: string): StatusKey {
  return (STATUS_KEYS as string[]).includes(raw ?? "") ? (raw as StatusKey) : "all"
}

function normalizeFormat(raw?: string): FormatKey {
  return raw === "live" || raw === "instant" || raw === "other" ? raw : "all"
}

function sanitizeSearch(raw?: string): string {
  if (!raw) return ""
  // Strip characters that would break a PostgREST `or()` filter, cap length.
  return raw.replace(/[,()*%]/g, " ").trim().slice(0, 100)
}

/**
 * Apply search + format filters (NOT status) to a campaigns query. Used
 * identically by the data query and every count query so counts and rows stay
 * consistent. Format rules mirror the shared classifier: a known balloon slug
 * always wins over presentation_type.
 */
// Minimal structural view of the PostgREST filter builder methods we call here.
// Typing against this local shape (instead of Supabase's deeply-recursive generic
// builder type) avoids TS2589 "excessively deep" instantiation. The return is
// deliberately `any` so callers keep the real builder (await, .order, .range).
type FilterableQuery = {
  or: (filters: string) => FilterableQuery
  eq: (column: string, value: string) => FilterableQuery
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyListFilters(
  query: any,
  { search, format }: { search: string; format: FormatKey },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let q = query as FilterableQuery
  if (search) {
    q = q.or(`title.ilike.*${search}*,slug.ilike.*${search}*`)
  }
  if (format === "live") {
    // Balloon slug OR balloon_pop presentation.
    q = q.or(`slug.in.(${BALLOON_SLUGS_CSV}),presentation_type.eq.balloon_pop`)
  } else if (format === "instant") {
    // instant_cash presentation AND not a known balloon slug.
    q = q
      .eq("presentation_type", "instant_cash")
      .or(`slug.is.null,slug.not.in.(${BALLOON_SLUGS_CSV})`)
  } else if (format === "other") {
    // Neither a balloon (slug or presentation) nor instant_cash.
    q = q
      .or(`slug.is.null,slug.not.in.(${BALLOON_SLUGS_CSV})`)
      .or(
        `presentation_type.is.null,and(presentation_type.neq.balloon_pop,presentation_type.neq.instant_cash)`,
      )
  }
  return q
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    search?: string
    format?: string
    page?: string
    pageSize?: string
  }>
}) {
  await requireAdmin({ roles: ["admin"] })

  const sp = await searchParams
  const status = normalizeStatus(sp.status)
  const format = normalizeFormat(sp.format)
  const search = sanitizeSearch(sp.search)

  const pageSize = PAGE_SIZES.includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 25
  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const supabase = await createClient()

  // --- Status counts (filter-consistent: search + format applied). Each is a
  // HEAD + exact-count request — no rows are transferred. Runs in parallel. ---
  const countPromises = STATUS_KEYS.map(async (key) => {
    let q = applyListFilters(
      supabase.from("campaigns").select("id", { count: "exact", head: true }),
      { search, format },
    )
    if (key !== "all") q = q.eq("status", key)
    const { count } = await q
    return [key, count ?? 0] as const
  })

  // --- Bounded data query: exact total for the current view + range page. ---
  const total = await (async () => {
    let q = applyListFilters(
      supabase.from("campaigns").select("id", { count: "exact", head: true }),
      { search, format },
    )
    if (status !== "all") q = q.eq("status", status)
    const { count } = await q
    return count ?? 0
  })()

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let dataQuery = applyListFilters(supabase.from("campaigns").select(LIST_COLUMNS), {
    search,
    format,
  })
  if (status !== "all") dataQuery = dataQuery.eq("status", status)
  // Stable ordering: newest created first, id tie-breaker.
  const { data: rows, error } = await dataQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)

  const countEntries = await Promise.all(countPromises)
  const counts = Object.fromEntries(countEntries) as Record<StatusKey, number>

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold tracking-tight">Campaigns</h2>
        <p className="text-destructive">Failed to load campaigns: {error.message}</p>
      </div>
    )
  }

  const campaigns: CampaignRow[] = (rows ?? []).map((r: any) => ({
    id: String(r.id),
    title: r.title ?? "",
    slug: r.slug ?? "",
    status: r.status ?? "draft",
    category: classifyGiveaway({ slug: r.slug, presentation_type: r.presentation_type }),
    startAt: r.start_at ?? "",
    endAt: r.end_at ?? "",
    ticketPricePence: r.ticket_price_pence ?? 0,
  }))

  // Build pagination hrefs preserving the current filter params.
  const baseParams = new URLSearchParams()
  if (status !== "all") baseParams.set("status", status)
  if (format !== "all") baseParams.set("format", format)
  if (search) baseParams.set("search", search)
  if (pageSize !== 25) baseParams.set("pageSize", String(pageSize))
  const pageHref = (p: number) => {
    const next = new URLSearchParams(baseParams.toString())
    if (p > 1) next.set("page", String(p))
    const qs = next.toString()
    return qs ? `/admin/campaigns?${qs}` : "/admin/campaigns"
  }

  const rangeStart = total === 0 ? 0 : from + 1
  const rangeEnd = Math.min(from + pageSize, total)

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Campaigns</h2>

      <CampaignsControls
        status={status}
        search={search}
        format={format}
        pageSize={pageSize}
        counts={counts}
      />

      {campaigns.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No campaigns match the current filters.
        </p>
      ) : (
        <>
          <CampaignsTable campaigns={campaigns} />

          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              Showing {rangeStart}–{rangeEnd} of {total} campaign{total === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                asChild={page > 1}
                disabled={page <= 1}
                className="bg-transparent"
              >
                {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                asChild={page < totalPages}
                disabled={page >= totalPages}
                className="bg-transparent"
              >
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)}>Next</Link>
                ) : (
                  <span>Next</span>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
