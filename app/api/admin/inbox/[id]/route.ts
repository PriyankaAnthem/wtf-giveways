import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  getInboxServiceClient,
  loadEnquiry,
  isValidAssignee,
  UUID_RE,
} from '@/lib/admin/inbox/service'
import { INBOX_STATUSES, isInboxEnquiryType, type InboxStatus } from '@/lib/admin/inbox/types'

export const runtime = 'nodejs'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

/**
 * PATCH /api/admin/inbox/[id]
 *
 * Updates INBOX metadata only — `inbox_status` and/or `inbox_assigned_to`. It
 * NEVER touches `contact_enquiries.status` (the payout workflow column).
 *
 * Body (any subset):
 *   { inbox_status?: 'open'|'waiting'|'resolved',
 *     assignee?: string(uuid) | null }
 *
 * Status bookkeeping:
 *   - always sets inbox_status_updated_at = now(), inbox_status_updated_by = admin
 *   - resolved            => inbox_resolved_at = now()
 *   - open/waiting        => inbox_resolved_at = null
 *
 * Assignment bookkeeping:
 *   - assign   => inbox_assigned_to set, inbox_assigned_at = now(), inbox_assigned_by = admin
 *   - unassign => inbox_assigned_to = null (assigned_at/by left as historical)
 *   - the requested assignee MUST appear in admin_list_inbox_assignees().
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400, ...NO_STORE })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400, ...NO_STORE })
  }

  const hasStatus = 'inbox_status' in body && body.inbox_status !== undefined
  const hasAssignee = 'assignee' in body && body.assignee !== undefined
  if (!hasStatus && !hasAssignee) {
    return NextResponse.json({ ok: false, error: 'nothing_to_update' }, { status: 400, ...NO_STORE })
  }

  // Validate status up front.
  let nextStatus: InboxStatus | null = null
  if (hasStatus) {
    if (!INBOX_STATUSES.includes(body.inbox_status)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400, ...NO_STORE })
    }
    nextStatus = body.inbox_status as InboxStatus
  }

  // Validate assignee shape up front (null = unassign; uuid = assign).
  let assigneeChange: { value: string | null } | null = null
  if (hasAssignee) {
    if (body.assignee === null) {
      assigneeChange = { value: null }
    } else if (typeof body.assignee === 'string' && UUID_RE.test(body.assignee)) {
      assigneeChange = { value: body.assignee }
    } else {
      return NextResponse.json({ ok: false, error: 'invalid_assignee' }, { status: 400, ...NO_STORE })
    }
  }

  const svc = getInboxServiceClient()
  if (!svc) {
    return NextResponse.json({ ok: false, error: 'server_config' }, { status: 500, ...NO_STORE })
  }

  // Enquiry must exist.
  const enquiry = await loadEnquiry(svc, id)
  if (!enquiry) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  // Payout enquiries are not Inbox tickets — treat as not found so Inbox status
  // and assignment changes can never be applied to a payout record.
  if (!isInboxEnquiryType(enquiry.enquiry_type)) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }

  const nowIso = new Date().toISOString()
  const update: Record<string, unknown> = {}

  if (nextStatus) {
    update.inbox_status = nextStatus
    update.inbox_status_updated_at = nowIso
    update.inbox_status_updated_by = user.id
    update.inbox_resolved_at = nextStatus === 'resolved' ? nowIso : null
  }

  if (assigneeChange) {
    if (assigneeChange.value === null) {
      update.inbox_assigned_to = null
    } else {
      // Never persist an arbitrary UUID — must be a current allowed assignee.
      const valid = await isValidAssignee(svc, assigneeChange.value)
      if (!valid) {
        return NextResponse.json({ ok: false, error: 'invalid_assignee' }, { status: 400, ...NO_STORE })
      }
      update.inbox_assigned_to = assigneeChange.value
      update.inbox_assigned_at = nowIso
      update.inbox_assigned_by = user.id
    }
  }

  const { error: updateError } = await svc.from('contact_enquiries').update(update).eq('id', id)
  if (updateError) {
    console.error('[admin/inbox PATCH] update error:', (updateError.message || '').slice(0, 200))
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500, ...NO_STORE })
  }

  return NextResponse.json({ ok: true }, NO_STORE)
}
