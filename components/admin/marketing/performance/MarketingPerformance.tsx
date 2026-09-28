'use client'

import { useCallback, useRef, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import {
  DEFAULT_PERFORMANCE_RANGE,
  PERFORMANCE_RANGES,
  PERFORMANCE_RANGE_LABELS,
  isEmptyPeriod,
  performanceSwrKey,
  type PerformancePayload,
  type PerformanceRange,
} from '@/lib/admin/marketing/performance'
import { cn } from '@/lib/utils'
import { PerformanceKpiCards } from './PerformanceKpiCards'
import { ChannelTable } from './ChannelTable'
import { VoucherTable } from './VoucherTable'

interface FilterState {
  range: PerformanceRange
  from: string
  to: string
}

/**
 * Marketing Performance dashboard (client).
 *
 * One request per filter state via SWR -> one RPC call -> one compact aggregate
 * payload. The browser never touches Supabase and never aggregates raw orders;
 * the RPC payload is authoritative. API failures surface a retryable error
 * state (never silently coerced to zeros), and a genuinely empty period shows a
 * clean "no orders" message rather than NaN / broken tables.
 */
export function MarketingPerformance() {
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
    return json.data as PerformancePayload
  }, [])

  const swrKey = performanceSwrKey({ range: filter.range, from: filter.from, to: filter.to })

  const { data, error, isLoading, isValidating, mutate } = useSWR<PerformancePayload>(
    swrKey,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const loading = isLoading && !data
  const refreshing = isValidating && Boolean(data)
  const empty = !loading && !error && isEmptyPeriod(data)

  return (
    <div className="flex flex-col gap-5">
      <FilterBar
        filter={filter}
        onChange={setFilter}
        onRefresh={() => mutate()}
        refreshing={refreshing}
        disabled={isValidating}
      />

      {error && !data ? (
        <ErrorState onRetry={() => mutate()} />
      ) : empty ? (
        <EmptyState />
      ) : (
        <>
          <PerformanceKpiCards summary={data?.summary} loading={loading} />

          {loading ? (
            <>
              <div className="h-56 animate-pulse rounded-xl border border-border bg-card" />
              <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
            </>
          ) : data ? (
            <>
              <ChannelTable payload={data} />
              <VoucherTable rows={data.byVoucher} />
              <p className="px-1 text-[11px] text-muted-foreground">
                Genuine confirmed revenue attributed to the marketing snapshot captured at
                checkout. Voucher usage is measured over known orders only. Snapshot{' '}
                {new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}.
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

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
    <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-xl sm:border">
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
          aria-label="Refresh performance"
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

function EmptyState() {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-8 text-center">
      <p className="text-sm font-medium text-foreground">No confirmed orders in this period.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try a wider date range to see revenue and attribution.
      </p>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Could not load marketing performance.
      </div>
      <p className="text-xs text-muted-foreground">
        The request failed. This has not been turned into zeroes — the figures below are simply
        unavailable until the request succeeds.
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
