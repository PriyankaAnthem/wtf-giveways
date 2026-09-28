'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  Banknote,
  CreditCard,
  MousePointerClick,
  Receipt,
  RefreshCw,
  TrendingUp,
  Trophy,
  Wallet,
} from 'lucide-react'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import {
  ATTRIBUTION_LABEL,
  DEFAULT_MARKETING_PERIOD,
  formatRatePct,
  isRevenueWinner,
  periodToDays,
  type MarketingAnalyticsPayload,
  type MarketingPeriod,
} from '@/lib/admin/marketing/analytics'
import { cn } from '@/lib/utils'
import { MarketingStatCard, MarketingSecondaryStat } from './MarketingStatCard'
import { MarketingCampaignTable } from './MarketingCampaignTable'
import { MarketingAutomationTable } from './MarketingAutomationTable'

const PERIODS: { value: MarketingPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
]

/**
 * Marketing Overview — the commercial analytics dashboard.
 *
 * Answers, in order: how much CASH did marketing generate, which CAMPAIGN made
 * it, which AUTOMATION made it, and how many people clicked/purchased. All data
 * comes from the admin-only `/api/admin/marketing/analytics` endpoint (which
 * runs the service-role RPC server-side); the browser never touches Supabase.
 * Switching the period re-fetches via SWR — no full-page navigation.
 */
export function MarketingOverview({ active = true }: { active?: boolean }) {
  const [period, setPeriod] = useState<MarketingPeriod>(DEFAULT_MARKETING_PERIOD)
  const days = periodToDays(period)

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
    return json.data as MarketingAnalyticsPayload
  }, [])

  const { data, error, isLoading, isValidating, mutate } = useSWR<MarketingAnalyticsPayload>(
    active ? `/api/admin/marketing/analytics?days=${days}` : null,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const summary = data?.summary
  const refreshing = isValidating && Boolean(data)
  const loading = isLoading && !data

  const hasActivity = useMemo(
    () => Boolean(summary && (summary.sent > 0 || summary.delivered > 0 || summary.clicked > 0)),
    [summary],
  )
  const hasRevenue = Boolean(
    summary && (summary.externalCashPence > 0 || summary.attributedOrders > 0),
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Header + period selector */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Commercial overview
          </h2>
          <p className="text-sm text-muted-foreground">
            Conservative {ATTRIBUTION_LABEL}. Figures are attributed, not causal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Analytics period"
            className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted/50 p-1"
          >
            {PERIODS.map((p) => {
              const isActive = period === p.value
              return (
                <button
                  key={p.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setPeriod(p.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isValidating}
            aria-label="Refresh analytics"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && !data ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          Could not load marketing analytics. Please try again in a moment.
        </div>
      ) : (
        <>
          {!loading && !hasActivity ? (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              No marketing activity occurred in the selected range. Delivery and revenue figures
              below are all zero.
            </div>
          ) : null}

          {/* Primary KPI row — External Cash is the headline. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MarketingStatCard
              label="Attributed Cash"
              value={formatPence(summary?.externalCashPence)}
              subtext={ATTRIBUTION_LABEL}
              icon={CreditCard}
              primary
              loading={loading}
            />
            <MarketingStatCard
              label="Attributed Orders"
              value={formatCount(summary?.attributedOrders)}
              subtext="Orders from click-attributed recipients"
              icon={Receipt}
              loading={loading}
            />
            <MarketingStatCard
              label="Click → Purchase"
              value={formatRatePct(summary?.purchaseConversionPct)}
              subtext="Clickers who then purchased"
              icon={MousePointerClick}
              loading={loading}
            />
            <MarketingStatCard
              label="Revenue / Delivered"
              value={formatPence(summary?.revenuePerDeliveredPence)}
              subtext="External cash per delivered email"
              icon={TrendingUp}
              loading={loading}
            />
          </div>

          {/* Revenue-zero note (activity present, but nothing purchased yet). */}
          {!loading && hasActivity && !hasRevenue ? (
            <p className="-mt-2 px-1 text-xs text-muted-foreground">
              No attributed purchases yet in this period — delivery and click metrics below are
              still live.
            </p>
          ) : null}

          {/* Secondary metrics — deliberately subordinate. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <MarketingSecondaryStat label="Delivered" value={formatCount(summary?.delivered)} loading={loading} />
            <MarketingSecondaryStat label="Clicked" value={formatCount(summary?.clicked)} loading={loading} />
            <MarketingSecondaryStat label="CTR" value={formatRatePct(summary?.ctrPct)} loading={loading} />
            <MarketingSecondaryStat label="Gross Sales" value={formatPence(summary?.grossSalesPence)} loading={loading} />
            <MarketingSecondaryStat label="WTF Credit Used" value={formatPence(summary?.walletCreditPence)} loading={loading} />
          </div>

          {/* Commercial winners */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <WinnerCard
              title="Best Automation"
              name={isRevenueWinner(data?.topAutomation) ? data?.topAutomation?.name : null}
              cashPence={data?.topAutomation?.externalCashPence}
              loading={loading}
            />
            <WinnerCard
              title="Best Campaign"
              name={isRevenueWinner(data?.topCampaign) ? data?.topCampaign?.title : null}
              cashPence={data?.topCampaign?.externalCashPence}
              href={
                isRevenueWinner(data?.topCampaign) && data?.topCampaign?.campaignId
                  ? `/admin/campaigns/${data.topCampaign.campaignId}`
                  : undefined
              }
              loading={loading}
            />
          </div>

          {/* Tables */}
          {loading ? (
            <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
          ) : (
            <>
              <MarketingCampaignTable rows={data?.byCampaign ?? []} />
              <MarketingAutomationTable rows={data?.byAutomation ?? []} />
            </>
          )}

          {data ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              {ATTRIBUTION_LABEL}. External Cash is real money received; Gross Sales includes WTF
              Credit and is not new cash. Snapshot{' '}
              {new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * A commercial "winner" tile. Only renders a named winner when it produced
 * external cash; otherwise it states plainly that nothing has been attributed
 * yet — a zero-revenue automation/campaign is never declared a winner.
 */
function WinnerCard({
  title,
  name,
  cashPence,
  href,
  loading,
}: {
  title: string
  name: string | null | undefined
  cashPence: number | null | undefined
  href?: string
  loading: boolean
}) {
  const isWinner = Boolean(name)
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
          {title}
        </span>
        {loading ? (
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        ) : isWinner ? (
          href ? (
            <a
              href={href}
              className="truncate text-base font-semibold text-foreground underline-offset-2 hover:underline"
            >
              {name}
            </a>
          ) : (
            <span className="truncate text-base font-semibold text-foreground">{name}</span>
          )
        ) : (
          <span className="text-sm text-muted-foreground">No attributed revenue yet</span>
        )}
      </div>
      {!loading && isWinner ? (
        <span className="shrink-0 text-lg font-bold tabular-nums text-foreground">
          {formatPence(cashPence)}
        </span>
      ) : null}
    </div>
  )
}
