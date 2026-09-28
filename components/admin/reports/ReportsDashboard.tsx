'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Banknote, CreditCard, Receipt, RefreshCw, Ticket, TrendingUp, Wallet } from 'lucide-react'
import { KpiCard } from './KpiCard'
import { ReportFilterBar, type FilterState } from './ReportFilterBar'
import { RevenueChart } from './RevenueChart'
import { CampaignTable } from './CampaignTable'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import type { DashboardPayload, ReportRange } from '@/lib/admin/reporting/types'

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}

// Poll only every 60s, never more often (audit requirement).
const REFRESH_INTERVAL_MS = 60_000

function formatAgo(ms: number | null): string {
  if (ms == null) return 'not yet'
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  return `${hrs}h ago`
}

function buildQuery(f: FilterState): string {
  const p = new URLSearchParams()
  p.set('range', f.range)
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  }
  if (f.campaign) p.set('campaign', f.campaign)
  if (f.provider) p.set('provider', f.provider)
  return p.toString()
}

export function ReportsDashboard({
  initialRange = 'today' as ReportRange,
  active = true,
}: {
  initialRange?: ReportRange
  /** When false (Growth tab showing), pause polling so only one view polls. */
  active?: boolean
}) {
  const [filters, setFilters] = useState<FilterState>({
    range: initialRange,
    from: todayISO(),
    to: todayISO(),
    campaign: '',
    provider: '',
  })

  const query = useMemo(() => buildQuery(filters), [filters])
  // Custom range only fires once both dates are set.
  const ready = filters.range !== 'custom' || (Boolean(filters.from) && Boolean(filters.to))

  // Abort the previous in-flight request before starting another, so a slow
  // response can never overwrite a newer one (and overlap is impossible).
  const abortRef = useRef<AbortController | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

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
    return json.data as DashboardPayload
  }, [])

  const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardPayload>(
    ready && active ? `/api/admin/reports?${query}` : null,
    fetcher,
    {
      keepPreviousData: true, // retain last successful payload during refresh + on error
      revalidateOnFocus: false,
      refreshInterval: active ? REFRESH_INTERVAL_MS : 0, // poll every 60s while active only...
      refreshWhenHidden: false, // ...but only while the tab is visible (pause when hidden)
      refreshWhenOffline: false,
      dedupingInterval: REFRESH_INTERVAL_MS, // never hit the API more than once per 60s window
      onSuccess: () => setLastUpdated(Date.now()),
    },
  )

  // Re-render the "updated Xs ago" label roughly once a second while visible.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (lastUpdated == null) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => forceTick((n) => n + 1), 1000)
    }
    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [lastUpdated])

  const refreshing = isValidating && Boolean(data)

  const totals = data?.totals
  const changes = data?.changes
  const comparisonLabel = data?.comparison.label ?? 'previous period'
  const exportHref = `/api/admin/reports/export?${query}`

  return (
    <div className="flex flex-col gap-4">
      <ReportFilterBar
        value={filters}
        onChange={setFilters}
        campaigns={data?.available.campaigns ?? []}
        providers={data?.available.providers ?? []}
        exportHref={exportHref}
        disabled={isLoading && !data}
      />

      {/* Live-refresh status: "updated X ago" + manual refresh. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-live="polite">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${refreshing ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'}`}
            aria-hidden="true"
          />
          {error && data
            ? `Showing last good data · retry failed`
            : `Updated ${formatAgo(lastUpdated)}`}
        </p>
        <button
          type="button"
          onClick={() => mutate()}
          disabled={isValidating}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && !data ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          Could not load reporting data. Please adjust the filters and try again.
        </div>
      ) : (
        <>
          {/* KPI grid — 2-up on mobile, 3-up on desktop. External revenue is primary. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard
              label="External revenue"
              value={formatPence(totals?.external_pence ?? 0)}
              pct={changes?.external_pct ?? null}
              comparisonLabel={comparisonLabel}
              hint="Cash actually charged via a payment provider (card etc). Excludes WTF Credit — this is real money received."
              icon={CreditCard}
              primary
              loading={isLoading && !data}
            />
            <KpiCard
              label="Gross ticket sales"
              value={formatPence(totals?.gross_pence ?? 0)}
              pct={changes?.gross_pct ?? null}
              comparisonLabel={comparisonLabel}
              hint="Total order value of confirmed tickets, including any amount paid with WTF Credit."
              icon={Banknote}
              loading={isLoading && !data}
            />
            <KpiCard
              label="WTF Credit redeemed"
              value={formatPence(totals?.credit_pence ?? 0)}
              pct={changes?.credit_pct ?? null}
              comparisonLabel={comparisonLabel}
              hint="Portion of gross sales paid using existing WTF Credit. Not new external cash."
              icon={Wallet}
              loading={isLoading && !data}
            />
            <KpiCard
              label="Confirmed orders"
              value={formatCount(totals?.confirmed_orders ?? 0)}
              pct={changes?.orders_pct ?? null}
              comparisonLabel={comparisonLabel}
              hint="Number of confirmed checkouts (excludes pending, failed, and test orders)."
              icon={Receipt}
              loading={isLoading && !data}
            />
            <KpiCard
              label="Tickets sold"
              value={formatCount(totals?.tickets_sold ?? 0)}
              pct={changes?.tickets_pct ?? null}
              comparisonLabel={comparisonLabel}
              hint="Total tickets across all confirmed orders in this period."
              icon={Ticket}
              loading={isLoading && !data}
            />
            <KpiCard
              label="Avg order value"
              value={formatPence(totals?.aov_pence ?? 0)}
              pct={null}
              comparisonLabel={comparisonLabel}
              hint="Gross ticket sales divided by confirmed orders."
              icon={TrendingUp}
              loading={isLoading && !data}
            />
          </div>

          {data ? (
            <>
              <RevenueChart points={data.chart.points} unit={data.chart.unit} />
              <CampaignTable rows={data.campaigns} />
              <p className="px-1 text-[11px] text-muted-foreground">
                Times shown in Europe/London.
                {data.meta.last_refresh_at
                  ? ` Rollup last refreshed ${new Date(data.meta.last_refresh_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}.`
                  : ''}
              </p>
            </>
          ) : (
            <div className="h-[240px] animate-pulse rounded-xl border border-border bg-card" />
          )}
        </>
      )}
    </div>
  )
}
