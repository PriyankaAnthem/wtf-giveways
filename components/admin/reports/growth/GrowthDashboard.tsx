'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { CreditCard, RefreshCw, Repeat, ShoppingBag, Users } from 'lucide-react'
import { KpiCard } from '../KpiCard'
import { ReportFilterBar, type FilterState } from '../ReportFilterBar'
import { CheckoutHealthCard } from './CheckoutHealthCard'
import { WalletImpactCard } from './WalletImpactCard'
import { LiveCampaignCard } from './LiveCampaignCard'
import { GrowthIntelligence } from './GrowthIntelligence'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import {
  buildGrowthQuery,
  formatRatio,
  growthSwrKey,
  toCampaignViewModels,
  type GrowthDashboardPayload,
} from '@/lib/admin/reporting/growth'
import type { ReportRange } from '@/lib/admin/reporting/types'

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}

const REFRESH_INTERVAL_MS = 60_000
const COMPARISON_LABEL = 'previous period'

/**
 * Growth analytics view. Shares the exact reporting filters + Europe/London date
 * semantics as Overview. SWR key is null unless `active` (Growth is the selected
 * view) so NO request is made while Overview is showing. One aggregated request
 * per filter state; stale requests are aborted before a new one starts.
 */
export function GrowthDashboard({
  active,
  initialRange = 'today' as ReportRange,
}: {
  active: boolean
  initialRange?: ReportRange
}) {
  const [filters, setFilters] = useState<FilterState>({
    range: initialRange,
    from: todayISO(),
    to: todayISO(),
    campaign: '',
    provider: '',
  })

  const query = useMemo(() => buildGrowthQuery(filters), [filters])
  const ready = filters.range !== 'custom' || (Boolean(filters.from) && Boolean(filters.to))
  const key = growthSwrKey(active && ready, query)

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
    return json.data as GrowthDashboardPayload
  }, [])

  const { data, error, isLoading, isValidating, mutate } = useSWR<GrowthDashboardPayload>(
    key,
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      refreshInterval: REFRESH_INTERVAL_MS,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      dedupingInterval: REFRESH_INTERVAL_MS,
    },
  )

  const refreshing = isValidating && Boolean(data)
  const c = data?.customers
  const campaigns = useMemo(() => toCampaignViewModels(data?.liveCampaigns ?? []), [data])

  return (
    <div className="flex flex-col gap-4">
      <ReportFilterBar
        value={filters}
        onChange={setFilters}
        campaigns={data?.available.campaigns ?? []}
        providers={data?.available.providers ?? []}
        exportHref="#"
        showExport={false}
        disabled={isLoading && !data}
      />

      <div className="flex items-center justify-between gap-2 px-1">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-live="polite">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${refreshing ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'}`}
            aria-hidden="true"
          />
          {error && data ? 'Showing last good data · retry failed' : 'Customer, checkout & credit insight'}
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
          Could not load growth data. Please adjust the filters and try again.
        </div>
      ) : (
        <>
          {/* Deterministic recommendations from this filter's data (no extra request). */}
          <GrowthIntelligence payload={data ?? null} loading={isLoading && !data} />

          {/* Customer KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Unique buyers"
              value={formatCount(c?.uniqueBuyers.current ?? 0)}
              pct={c?.uniqueBuyers.changePct ?? null}
              comparisonLabel={COMPARISON_LABEL}
              hint="Distinct customers with an eligible confirmed order in this period."
              icon={Users}
              primary
              loading={isLoading && !data}
            />
            <KpiCard
              label="Orders per buyer"
              value={formatRatio(c?.ordersPerBuyer.current ?? null)}
              pct={c?.ordersPerBuyer.changePct ?? null}
              comparisonLabel={COMPARISON_LABEL}
              hint="Eligible confirmed orders ÷ unique buyers."
              icon={Repeat}
              loading={isLoading && !data}
            />
            <KpiCard
              label="External £ per buyer"
              value={formatPence(c?.externalRevenuePerBuyerPence.current ?? 0)}
              pct={c?.externalRevenuePerBuyerPence.changePct ?? null}
              comparisonLabel={COMPARISON_LABEL}
              hint="Eligible external cash revenue ÷ unique buyers."
              icon={CreditCard}
              loading={isLoading && !data}
            />
            <KpiCard
              label="Avg order value"
              value={formatPence(c?.averageOrderValuePence.current ?? 0)}
              pct={c?.averageOrderValuePence.changePct ?? null}
              comparisonLabel={COMPARISON_LABEL}
              hint="Eligible external cash revenue ÷ eligible confirmed orders."
              icon={ShoppingBag}
              loading={isLoading && !data}
            />
          </div>

          {data ? (
            <>
              {/* Checkout health + WTF Credit impact side by side on desktop */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <CheckoutHealthCard health={data.checkoutHealth} />
                <WalletImpactCard w={data.walletImpact} />
              </div>

              {/* Live campaign performance */}
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Live campaign performance</h2>
                  <p className="text-xs text-muted-foreground">
                    Sales, sell-through and recent momentum for every live competition.
                  </p>
                </div>
                {campaigns.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
                    No live competitions right now.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {campaigns.map((c) => (
                      <LiveCampaignCard key={c.campaignId} c={c} />
                    ))}
                  </div>
                )}
              </section>

              <p className="px-1 text-[11px] text-muted-foreground">
                Times shown in Europe/London. Showing {formatCount(campaigns.length)} live competition
                {campaigns.length === 1 ? '' : 's'}.
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
