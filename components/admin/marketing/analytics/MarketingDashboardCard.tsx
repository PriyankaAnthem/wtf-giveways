'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Megaphone } from 'lucide-react'
import { formatCount, formatPence } from '@/lib/admin/reporting/format'
import {
  ATTRIBUTION_LABEL,
  formatRatePct,
  isRevenueWinner,
  type MarketingAnalyticsPayload,
} from '@/lib/admin/marketing/analytics'

/**
 * Compact Marketing performance summary for the Super-Admin dashboard.
 *
 * Read-only, fixed 7-day window (spec: uses get_marketing_admin_analytics(7)).
 * Shows the headline commercial figures at a glance — external cash, attributed
 * orders, delivered and CTR — plus the best revenue-earning campaign. It holds
 * NO sending controls, and fails quietly: a summary card must never break the
 * dashboard. Deep-links into the full Marketing Overview.
 */
export function MarketingDashboardCard() {
  const [data, setData] = useState<MarketingAnalyticsPayload | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/admin/marketing/analytics?days=7', {
          signal: ac.signal,
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        if (active) {
          setData(json.data as MarketingAnalyticsPayload)
          setState('ready')
        }
      } catch {
        if (active && !ac.signal.aborted) setState('error')
      }
    })()
    return () => {
      active = false
      ac.abort()
    }
  }, [])

  const summary = data?.summary
  const campaignWinner = isRevenueWinner(data?.topCampaign)

  return (
    <section
      aria-labelledby="marketing-card-heading"
      className="rounded-xl border bg-card p-5 text-card-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 id="marketing-card-heading" className="text-sm font-semibold text-foreground">
              Marketing Revenue — 7 Days
            </h2>
            <p className="text-xs text-muted-foreground">{ATTRIBUTION_LABEL}</p>
          </div>
        </div>
        <Link
          href="/admin/marketing"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View Marketing Analytics
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {state === 'loading' ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : state === 'error' ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Performance data is unavailable right now.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-background p-3">
              <dt className="text-xs text-muted-foreground">External cash</dt>
              <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">
                {formatPence(summary?.externalCashPence)}
              </dd>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <dt className="text-xs text-muted-foreground">Attributed orders</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {formatCount(summary?.attributedOrders)}
              </dd>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <dt className="text-xs text-muted-foreground">Delivered</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {formatCount(summary?.delivered)}
              </dd>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <dt className="text-xs text-muted-foreground">CTR</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {formatRatePct(summary?.ctrPct)}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Best campaign:</span>
            {campaignWinner ? (
              <span className="font-medium text-foreground">{data?.topCampaign?.title}</span>
            ) : (
              <span className="text-muted-foreground">No attributed revenue yet</span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
