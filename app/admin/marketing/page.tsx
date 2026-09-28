import { requireAdmin } from '@/lib/admin/auth'
import { getServiceSupabase, assembleOpsSummary } from '@/lib/admin/marketing/ops-queries'
import { MarketingTabs } from '@/components/admin/marketing/MarketingTabs'
import type { OpsSummaryResponse } from '@/components/admin/marketing/ops/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Admin Marketing — ADMIN-ONLY control centre.
 *
 * Thin server shell: enforces authorization, then reads the single bounded
 * operational snapshot for the Automations console (authoritative config +
 * aggregate/masked operational data) and hydrates the tabbed client shell.
 *
 * This page still has NO sending, discovery, enqueue, claim or worker
 * capability — those live only behind the narrow, admin-gated
 * /api/admin/marketing/ops/* mutation endpoints. The Overview tab is strictly
 * read-only analytics, served by the admin-gated
 * /api/admin/marketing/analytics endpoint.
 *
 * Access model: ADMIN ONLY (Overview + Automations). Tracking Links moved to
 * its own dedicated page at /admin/marketing/links, which Operations Admin may
 * also reach; this shell is never exposed to operations_admin.
 */
export default async function AdminMarketingPage() {
  await requireAdmin({ roles: ['admin'] })

  const svc = getServiceSupabase()
  const summary = await assembleOpsSummary(svc)
  const initial: OpsSummaryResponse = { ok: true, ...summary }

  return <MarketingTabs initialOps={initial} />
}
