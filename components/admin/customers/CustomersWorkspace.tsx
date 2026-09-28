"use client"

import { useCallback, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Users, Crown, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import { CustomersList } from "./CustomersList"
import { TopSpendersList } from "./TopSpendersList"
import { RecentWinnersList } from "./RecentWinnersList"
import { CUSTOMER_VIEWS, DEFAULT_VIEW, type CustomerView } from "./views"

const VIEW_META: Record<
  CustomerView,
  { label: string; icon: typeof Users; heading: string; blurb: string }
> = {
  newest: {
    label: "Newest",
    icon: Users,
    heading: "Newest Customers",
    blurb: "Recently registered customer accounts.",
  },
  "top-spenders": {
    label: "Top Spenders",
    icon: Crown,
    heading: "Top Spenders",
    blurb: "Highest lifetime cash paid — your most valuable customers.",
  },
  "recent-winners": {
    label: "Recent Winners",
    icon: Trophy,
    heading: "Recent Winners",
    blurb: "Live feed of the latest prize activity.",
  },
}

/**
 * The three-mode Customers workspace. Renders a single segmented switcher and
 * then mounts ONLY the currently selected view.
 *
 * LAZY BY CONSTRUCTION: because just one view component is ever mounted, only
 * that view issues a data request. There is no prefetch, no parallel fetch, and
 * no background dashboard query — switching unmounts the previous view (whose
 * effect cleanup aborts any in-flight request) and mounts the next, which then
 * fetches for the first time. This preserves the benchmarked one-request-per-
 * view architecture.
 */
export function CustomersWorkspace({ initialView }: { initialView: CustomerView }) {
  const router = useRouter()
  const pathname = usePathname()
  const [view, setView] = useState<CustomerView>(initialView)

  const selectView = useCallback(
    (next: CustomerView) => {
      if (next === view) return
      setView(next)
      // Make the view URL-addressable (bookmark/refresh/share) without a
      // navigation/scroll jump. `newest` is the canonical default => clean URL.
      const query = next === DEFAULT_VIEW ? "" : `?view=${next}`
      router.replace(`${pathname}${query}`, { scroll: false })
    },
    [view, pathname, router],
  )

  const meta = VIEW_META[view]

  return (
    <div className="space-y-6">
      {/* Segmented view switcher — three modes of one workspace, not three
          unrelated buttons. */}
      <div
        role="tablist"
        aria-label="Customer views"
        className="inline-flex w-full flex-col gap-1 rounded-xl border bg-muted/40 p-1 sm:w-auto sm:flex-row"
      >
        {CUSTOMER_VIEWS.map((v) => {
          const m = VIEW_META[v]
          const Icon = m.icon
          const active = v === view
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectView(v)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {m.label}
            </button>
          )
        })}
      </div>

      {/* Per-view heading/context. */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">{meta.heading}</h3>
        <p className="text-sm text-muted-foreground">{meta.blurb}</p>
      </div>

      {/* EXACTLY ONE view is mounted. */}
      {view === "newest" && <CustomersList />}
      {view === "top-spenders" && <TopSpendersList />}
      {view === "recent-winners" && <RecentWinnersList />}
    </div>
  )
}
