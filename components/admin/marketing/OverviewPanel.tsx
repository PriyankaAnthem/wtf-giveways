'use client'

import { useCallback, useRef } from 'react'
import useSWR from 'swr'
import { RefreshCw } from 'lucide-react'
import {
  marketingAudiencesSwrKey,
  type MarketingAudienceOverview,
} from '@/lib/admin/marketing/audiences'
import {
  AudienceCatalogue,
  AudienceHealth,
  OpportunityCards,
  ProfileStatus,
} from './MarketingSections'

/**
 * Overview tab: the audience opportunity view.
 *
 * Makes EXACTLY ONE browser request to /api/admin/marketing/audiences when the
 * tab first mounts, then never polls: no refreshInterval, no revalidate-on-focus
 * and no revalidate-when-hidden/offline. The user can re-fetch on demand with
 * the Refresh button, and previous data is kept on screen while a manual refresh
 * is in flight. Stale requests are aborted before a new one begins.
 *
 * Pure aggregate display only — there is no send capability here.
 */
export function OverviewPanel() {
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
    return json.data as MarketingAudienceOverview
  }, [])

  const { data, error, isValidating, mutate } = useSWR<MarketingAudienceOverview>(
    marketingAudiencesSwrKey(true),
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    },
  )

  const refreshing = isValidating && Boolean(data)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          Audience opportunities based on current customer activity, WTF Credit and marketing
          eligibility.
        </p>
        <button
          type="button"
          onClick={() => mutate()}
          disabled={isValidating}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {error && !data ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400"
        >
          Could not load marketing audiences. Please refresh and try again.
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-5" aria-hidden="true">
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <ProfileStatus freshness={data.freshness} />
          <AudienceHealth health={data.health} />
          <OpportunityCards audiences={data.audiences} />
          <AudienceCatalogue audiences={data.audiences} />
          <p className="text-[11px] text-muted-foreground">
            Times shown in Europe/London. Sending capability is not part of this stage.
          </p>
        </>
      )}
    </div>
  )
}
