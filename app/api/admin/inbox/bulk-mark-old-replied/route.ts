import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { getInboxServiceClient } from '@/lib/admin/inbox/service'
import {
  bulkMarkRepliedCutoffIso,
  buildInboxExclusionOrFilter,
} from '@/lib/admin/inbox/types'

export const runtime = 'nodejs'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

/**
 * POST /api/admin/inbox/bulk-mark-old-replied
 *
 * ONE-TIME historical cleanup. Marks currently-OPEN support enquiries that are
 * older than 48 hours (by original `created_at`) as `waiting` — the same status
 * a real reply sets ("we replied; awaiting the customer"). Intended for a
 * backlog already answered manually outside the Inbox.
 *
 * This is a MANUAL admin action only. There is NO schedule, cron, or trigger
 * that calls it — future enquiries are never silently aged.
 *
 * Server-side eligibility is enforced entirely in the UPDATE's WHERE clause and
 * NEVER trusts the client. The filters mirror `isEligibleForBulkMarkReplied`:
 *   - inbox_status = 'open'                    (never waiting/resolved)
 *   - created_at   < now() - 48h               (original enquiry age)
 *   - NULL-safe payout exclusion               (winner_payout never touched;
 *                                               null/legacy type included)
 *
 * The transition matches the reply route exactly: inbox_status -> 'waiting',
 * stamp updated_at/by, and clear inbox_resolved_at.
 */
export async function POST(_request: NextRequest) {
  // Same allow-list as every other Inbox write. Hosts (ops) / read_only rejected.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const svc = getInboxServiceClient()
  if (!svc) {
    return NextResponse.json({ ok: false, error: 'server_config' }, { status: 500, ...NO_STORE })
  }

  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const cutoffIso = bulkMarkRepliedCutoffIso(nowMs)

  // Single UPDATE ... WHERE. `.eq`/`.lt` are AND-ed with the `.or()` exclusion
  // group (same composition the list query relies on). `.select('id')` returns
  // exactly the rows that were updated, so its length is the affected count.
  const { data, error } = await svc
    .from('contact_enquiries')
    .update({
      inbox_status: 'waiting',
      inbox_status_updated_at: nowIso,
      inbox_status_updated_by: user.id,
      inbox_resolved_at: null,
    })
    .eq('inbox_status', 'open')
    .lt('created_at', cutoffIso)
    .or(buildInboxExclusionOrFilter())
    .select('id')

  if (error) {
    console.error('[admin/inbox bulk-mark-old-replied] update error:', (error.message || '').slice(0, 200))
    return NextResponse.json({ ok: false, error: 'bulk_failed' }, { status: 500, ...NO_STORE })
  }

  const updated = Array.isArray(data) ? data.length : 0
  return NextResponse.json({ ok: true, updated }, NO_STORE)
}
