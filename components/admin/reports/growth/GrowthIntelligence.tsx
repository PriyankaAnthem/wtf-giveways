'use client'

import { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { AlertTriangle, CheckCircle2, Lightbulb, Sparkles } from 'lucide-react'
import {
  buildGrowthQuery,
  growthSwrKey,
  type GrowthDashboardPayload,
} from '@/lib/admin/reporting/growth'
import {
  selectTopRecommendations,
  type GrowthRecommendation,
} from '@/lib/admin/reporting/recommendations'
import { cn } from '@/lib/utils'

/**
 * Growth Intelligence — up to 3 deterministic, plain-English recommendations.
 *
 * Two modes:
 *  - EMBEDDED: pass `payload` (and optional `loading`). Reuses the caller's
 *    already-loaded Growth data — no extra request. Used inside the Growth tab.
 *  - STANDALONE: omit `payload`. Fetches /api/admin/growth for the last 7 days
 *    itself. Used as the headline block on /admin.
 *
 * Deliberately shows NO visitor / conversion / revenue-per-visitor figures —
 * those wait for the first-party traffic system to go live.
 */
export function GrowthIntelligence({
  payload,
  loading = false,
  className,
}: {
  payload?: GrowthDashboardPayload | null
  loading?: boolean
  className?: string
}) {
  const embedded = payload !== undefined

  const query = useMemo(() => buildGrowthQuery({ range: 'last_7_days' }), [])
  // Standalone only: fetch its own 7-day window. Embedded => key null => no request.
  const key = growthSwrKey(!embedded, query)

  const fetcher = useCallback(async (url: string) => {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `request_failed_${res.status}`)
    return json.data as GrowthDashboardPayload
  }, [])

  const { data: fetched, isLoading: swrLoading } = useSWR<GrowthDashboardPayload>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    dedupingInterval: 120_000,
  })

  const active = embedded ? payload : fetched
  const isLoading = embedded ? loading : swrLoading

  const recommendations = useMemo(() => selectTopRecommendations(active), [active])

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label="Growth Intelligence">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-tight text-foreground">Growth Intelligence</h2>
          <p className="text-xs text-muted-foreground">
            What&apos;s happening, what needs attention, and what to do — last 7 days.
          </p>
        </div>
      </div>

      {isLoading && !active ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="text-sm text-muted-foreground text-pretty">
            No urgent signals right now. Buyers, checkout and live campaigns are steady for the last 7
            days.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </section>
  )
}

function RecommendationCard({ rec }: { rec: GrowthRecommendation }) {
  const positive = rec.kind === 'positive'
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        positive
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            positive
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
          )}
        >
          {positive ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          )}
          {rec.status}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground text-balance">{rec.headline}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{rec.detail}</p>
      </div>

      <div className="mt-auto flex items-start gap-1.5 border-t border-border/60 pt-3 text-xs text-foreground">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-pretty">
          <span className="sr-only">Recommended action: </span>
          {rec.action}
        </p>
      </div>
    </article>
  )
}
