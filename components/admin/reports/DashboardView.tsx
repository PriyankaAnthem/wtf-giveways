'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ReportsDashboard } from './ReportsDashboard'
import { GrowthDashboard } from './growth/GrowthDashboard'
import { parseDashboardView, type DashboardView as View } from '@/lib/admin/reporting/growth'
import { cn } from '@/lib/utils'

const TABS: { value: View; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'growth', label: 'Growth' },
]

/**
 * Segmented control that switches between the existing Overview dashboard and
 * the additive Growth dashboard. Both stay mounted so each view keeps its own
 * filter state; Growth's SWR key is null while inactive, so it performs no
 * request until it is the selected view. The selected view is reflected in
 * ?view= so refresh + browser navigation restore it.
 */
export function DashboardView({ initialView = 'overview' as View }: { initialView?: View }) {
  const router = useRouter()
  const [view, setView] = useState<View>(parseDashboardView(initialView))

  const select = useCallback(
    (next: View) => {
      setView(next)
      const params = new URLSearchParams(
        typeof window !== 'undefined' ? window.location.search : '',
      )
      if (next === 'overview') params.delete('view')
      else params.set('view', next)
      const qs = params.toString()
      router.replace(qs ? `/admin?${qs}` : '/admin', { scroll: false })
    },
    [router],
  )

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Dashboard view"
        className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted/50 p-1"
      >
        {TABS.map((t) => {
          const activeTab = view === t.value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={activeTab}
              onClick={() => select(t.value)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors',
                activeTab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Overview stays mounted; polling pauses while it is not the active view. */}
      <div className={cn(view !== 'overview' && 'hidden')}>
        <ReportsDashboard initialRange="today" active={view === 'overview'} />
      </div>

      {/* Growth mounts but only fetches while it is the active view. */}
      <div className={cn(view !== 'growth' && 'hidden')}>
        <GrowthDashboard active={view === 'growth'} initialRange="today" />
      </div>
    </div>
  )
}
