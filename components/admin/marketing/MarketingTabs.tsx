'use client'

import Link from 'next/link'
import { Mail } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OperationsConsole } from '@/components/admin/marketing/ops/OperationsConsole'
import { MarketingOverview } from '@/components/admin/marketing/analytics/MarketingOverview'
import type { OpsSummaryResponse } from '@/components/admin/marketing/ops/types'

/**
 * Admin Marketing shell — ADMIN ONLY.
 *
 * Tabs:
 *   • Overview   — read-only performance analytics (deliverability, engagement,
 *                  and REAL attributed revenue). Lazy-fetches its own data from
 *                  /api/admin/marketing/analytics the first time it is shown.
 *   • Automations — the existing Stage 034 Operations Console, hydrated from the
 *                  server-rendered snapshot.
 *
 * Tracking Links has its own dedicated page (/admin/marketing/links) and is no
 * longer a tab here. The Overview tab is purely observational: it has NO
 * sending / discovery / enqueue / claim capability. Every mutating control
 * continues to live only in the Automations console behind the narrow
 * admin-gated ops endpoints.
 */
export function MarketingTabs({ initialOps }: { initialOps: OpsSummaryResponse }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">Marketing</h1>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Lifecycle email performance and automation controls.
          </p>
        </div>
        <Link
          href="/admin/marketing/preview"
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          Email preview
        </Link>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <MarketingOverview />
        </TabsContent>

        <TabsContent value="automations" className="mt-0">
          <OperationsConsole initial={initialOps} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
