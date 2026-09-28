'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import {
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  Banknote,
  Receipt,
  Users,
  Calculator,
  Coins,
  TicketPercent,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatPence, formatCount } from '@/lib/admin/reporting/format'
import {
  PERFORMANCE_RANGES,
  PERFORMANCE_RANGE_LABELS,
  DEFAULT_PERFORMANCE_RANGE,
  affiliatePerformanceSwrKey,
  isEmptyAffiliatePeriod,
  describeCommission,
  formatPct,
  type AffiliatePerformancePayload,
  type AffiliateSummary,
  type CommissionFields,
  type PerformanceRange,
} from '@/lib/admin/marketing/affiliate-performance'
import { cn } from '@/lib/utils'
import { AffiliateLeaderboard } from './AffiliateLeaderboard'
import { AffiliateDrilldown } from './AffiliateDrilldown'

// Alias so the intent reads clearly in this file.
type Range = PerformanceRange

interface FilterState {
  range: Range
  from: string
  to: string
}

/**
 * Affiliate Performance (client).
 *
 * Leaderboard vs detail is driven by the `?affiliate=<uuid>` URL param so the
 * view is shareable and the browser back button works. One SWR request per
 * (filter + affiliate) -> one RPC call -> one compact payload; the browser
 * never touches Supabase and never does financial maths. Date filters persist
 * across drill-in/out because this component stays mounted.
 */
export function AffiliatePerformance() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedAffiliate = searchParams.get('affiliate')

  const [filter, setFilter] = useState<FilterState>({
    range: DEFAULT_PERFORMANCE_RANGE,
    from: '',
    to: '',
  })

  const abortRef = useRef<AbortController | null>(null)
  const fetcher = useCallback(async (url: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error ?? `request_failed_${res.status}`)
    }
    return json.data as AffiliatePerformancePayload
  }, [])

  const swrKey = affiliatePerformanceSwrKey({
    range: filter.range,
    from: filter.from,
    to: filter.to,
    affiliate: selectedAffiliate,
  })

  const { data, error, isLoading, isValidating, mutate } = useSWR<AffiliatePerformancePayload>(
    swrKey,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const loading = isLoading && !data
  const refreshing = isValidating && Boolean(data)
  const empty = !loading && !error && isEmptyAffiliatePeriod(data)
  const isDetail = Boolean(selectedAffiliate)

  const openAffiliate = useCallback(
    (affiliateId: string) => {
      const q = new URLSearchParams(searchParams.toString())
      q.set('affiliate', affiliateId)
      router.push(`${pathname}?${q.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const backToLeaderboard = useCallback(() => {
    const q = new URLSearchParams(searchParams.toString())
    q.delete('affiliate')
    const qs = q.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  // Detail header name: prefer the affiliate object, else the leaderboard row.
  const detailName =
    data?.affiliate?.affiliateName ??
    data?.byAffiliate.find((r) => r.affiliateId === selectedAffiliate)?.affiliateName ??
    'Affiliate'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-2xl font-bold tracking-tight">Affiliate Performance</h3>
        <p className="text-sm text-muted-foreground">
          Genuine confirmed revenue and commission attributed to each affiliate from the marketing
          snapshot captured at checkout. Voucher usage is measured over known orders only.
        </p>
      </div>

      <FilterBar
        filter={filter}
        onChange={setFilter}
        onRefresh={() => mutate()}
        refreshing={refreshing}
        disabled={isValidating}
      />

      {isDetail ? (
        <button
          type="button"
          onClick={backToLeaderboard}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to all affiliates
        </button>
      ) : null}

      {error && !data ? (
        <ErrorState onRetry={() => mutate()} />
      ) : empty ? (
        <EmptyState detail={isDetail} />
      ) : isDetail ? (
        <DetailView name={detailName} data={data} loading={loading} />
      ) : (
        <LeaderboardView data={data} loading={loading} onSelect={openAffiliate} />
      )}

      {data ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          Snapshot{' '}
          {new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}. Commission
          shown as &quot;Not configured&quot; means no rate was set — it is never treated as £0.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leaderboard + detail bodies.
// ---------------------------------------------------------------------------

function LeaderboardView({
  data,
  loading,
  onSelect,
}: {
  data: AffiliatePerformancePayload | undefined
  loading: boolean
  onSelect: (id: string) => void
}) {
  return (
    <>
      <LeaderboardKpis summary={data?.summary} loading={loading} />
      {loading ? (
        <div className="h-56 animate-pulse rounded-xl border border-border bg-card" />
      ) : data ? (
        <AffiliateLeaderboard rows={data.byAffiliate} onSelect={onSelect} />
      ) : null}
    </>
  )
}

function DetailView({
  name,
  data,
  loading,
}: {
  name: string
  data: AffiliatePerformancePayload | undefined
  loading: boolean
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Affiliate</span>
        <h4 className="text-xl font-bold tracking-tight text-foreground">{loading ? '…' : name}</h4>
      </div>
      <DetailKpis summary={data?.summary} loading={loading} />
      {loading ? (
        <div className="h-56 animate-pulse rounded-xl border border-border bg-card" />
      ) : data ? (
        <AffiliateDrilldown detail={data.affiliate} />
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// KPI cards (mode-specific).
// ---------------------------------------------------------------------------

function LeaderboardKpis({ summary, loading }: { summary?: AffiliateSummary; loading: boolean }) {
  const s = summary
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Affiliate Revenue" value={formatPence(s?.netRevenuePence)} icon={Banknote} primary loading={loading} />
      <StatCard label="Orders" value={formatCount(s?.orders)} icon={Receipt} loading={loading} />
      <StatCard label="Affiliates" value={formatCount(s?.affiliates)} icon={Users} loading={loading} />
      <CommissionStatCard summary={s} loading={loading} />
      <StatCard label="AOV" value={formatPence(s?.aovPence)} icon={Calculator} loading={loading} />
    </div>
  )
}

function DetailKpis({ summary, loading }: { summary?: AffiliateSummary; loading: boolean }) {
  const s = summary
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Revenue" value={formatPence(s?.netRevenuePence)} icon={Banknote} primary loading={loading} />
      <StatCard label="Orders" value={formatCount(s?.orders)} icon={Receipt} loading={loading} />
      <CommissionStatCard summary={s} loading={loading} />
      <StatCard label="AOV" value={formatPence(s?.aovPence)} icon={Calculator} loading={loading} />
      <StatCard label="Voucher %" value={formatPct(s?.voucherUsagePct)} icon={TicketPercent} loading={loading}>
        {s ? (
          <span className="text-[11px] text-muted-foreground/80">
            {formatCount(s.voucherOrders)} of {formatCount(s.voucherKnownOrders)} known orders
          </span>
        ) : null}
      </StatCard>
    </div>
  )
}

/**
 * Commission KPI. Honours the null-vs-0 rule: "Not configured" when no rate is
 * set anywhere; the amount otherwise; and a warning line when SOME orders in
 * the period are missing a rate. Never silently shows £0 for unconfigured data.
 */
function CommissionStatCard({ summary, loading }: { summary?: CommissionFields; loading: boolean }) {
  const c = summary ? describeCommission(summary) : null
  const value = !c || c.kind === 'not_configured' ? 'Not configured' : formatPence(c.pence)
  const valueMuted = !c || c.kind === 'not_configured'
  return (
    <StatCard label="Commission" value={value} valueMuted={valueMuted} icon={Coins} loading={loading}>
      {c && c.kind === 'partial' ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {formatCount(c.missingOrders)} order{c.missingOrders === 1 ? '' : 's'} missing a rate
        </span>
      ) : null}
    </StatCard>
  )
}

function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  primary = false,
  valueMuted = false,
  loading,
  children,
}: {
  label: string
  value: string
  subtext?: string
  icon: LucideIcon
  primary?: boolean
  valueMuted?: boolean
  loading: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        primary ? 'border-primary/30 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <span className={cn('text-2xl font-bold tabular-nums', valueMuted ? 'text-muted-foreground' : 'text-foreground')}>
          {value}
        </span>
      )}
      {!loading && subtext ? <span className="text-xs text-muted-foreground">{subtext}</span> : null}
      {!loading ? children : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter bar (mirrors Marketing Performance semantics).
// ---------------------------------------------------------------------------

function FilterBar({
  filter,
  onChange,
  onRefresh,
  refreshing,
  disabled,
}: {
  filter: FilterState
  onChange: (next: FilterState) => void
  onRefresh: () => void
  refreshing: boolean
  disabled: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          {PERFORMANCE_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ ...filter, range: r })}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                filter.range === r
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
              aria-pressed={filter.range === r}
            >
              {PERFORMANCE_RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          aria-label="Refresh affiliate performance"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
        </button>
      </div>

      {filter.range === 'custom' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>From</span>
            <input
              type="date"
              value={filter.from}
              max={filter.to || undefined}
              onChange={(e) => onChange({ ...filter, from: e.target.value })}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>To</span>
            <input
              type="date"
              value={filter.to}
              min={filter.from || undefined}
              onChange={(e) => onChange({ ...filter, to: e.target.value })}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            />
          </label>
          {(!filter.from || !filter.to) && (
            <span className="text-xs text-muted-foreground">Select both dates to load.</span>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({ detail }: { detail: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {detail ? 'No affiliate orders in this period.' : 'No affiliate revenue in this period.'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Try a wider date range to see revenue and commission.</p>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Could not load affiliate performance.
      </div>
      <p className="text-xs text-muted-foreground">
        The request failed. This has not been turned into zeroes — the figures are simply unavailable
        until the request succeeds.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </button>
    </div>
  )
}
