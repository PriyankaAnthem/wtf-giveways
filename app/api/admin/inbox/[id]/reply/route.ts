import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { getInboxServiceClient, loadEnquiry, UUID_RE } from '@/lib/admin/inbox/service'
import {
  sendInboxReplyEmail,
  buildReplyEmailText,
  buildReplySubject,
} from '@/lib/admin/inbox/email'
import { validateReplyBody } from '@/lib/admin/inbox/format'
import { isInboxEnquiryType } from '@/lib/admin/inbox/types'

export const runtime = 'nodejs'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

/**
 * POST /api/admin/inbox/[id]/reply
 *
 * Sends an admin reply to a support enquiry.
 *
 * Flow (order matters):
 *   1. authorize admin / operations_admin
 *   2. validate reply body (trimmed 1–10000, matches the DB CHECK)
 *   3. load the enquiry server-side — the recipient is ALWAYS
 *      contact_enquiries.email; a recipient is NEVER accepted from the browser
 *   4. insert an outbound contact_enquiry_messages row (email_status = 'pending',
 *      author_user_id = admin). A DB trigger bumps inbox_last_message_at.
 *   5. attempt the email through the existing Resend approach
 *   6. success => message: sent + provider id + sent_at; ticket => 'waiting'
 *   7. failure => message: failed + safe error; inbox_status left UNCHANGED
 *
 * The persisted reply is NEVER deleted on email failure — the admin must be
 * able to see "Email failed" and retry.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  // Only the reply content is accepted from the client. No recipient field.
  const validation = validateReplyBody((body as { body?: unknown }).body)
  if (!validation.ok) {
    const status = validation.error === 'too_long' ? 413 : 400
    return NextResponse.json({ ok: false, error: validation.error }, { status, ...NO_STORE })
  }
  const replyBody = validation.body

  const svc = getInboxServiceClient()
  if (!svc) {
    return NextResponse.json({ ok: false, error: 'server_config' }, { status: 500, ...NO_STORE })
  }

  const enquiry = await loadEnquiry(svc, id)
  if (!enquiry) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  // Payout enquiries are not Inbox tickets — treat as not found so the Inbox
  // reply workflow can never act on a payout record.
  if (!isInboxEnquiryType(enquiry.enquiry_type)) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  if (!enquiry.email) {
    return NextResponse.json({ ok: false, error: 'no_recipient' }, { status: 422, ...NO_STORE })
  }

  // 4) Persist the outbound message FIRST (pending). The DB trigger updates
  //    contact_enquiries.inbox_last_message_at — we never do that here.
  const { data: inserted, error: insertError } = await svc
    .from('contact_enquiry_messages')
    .insert({
      enquiry_id: id,
      direction: 'outbound',
      body: replyBody,
      author_user_id: user.id,
      email_status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[admin/inbox reply] insert error:', (insertError?.message || '').slice(0, 200))
    return NextResponse.json({ ok: false, error: 'reply_failed' }, { status: 500, ...NO_STORE })
  }
  const messageId = (inserted as { id: string }).id

  // 5) Attempt delivery. Recipient comes strictly from the enquiry row.
  const emailResult = await sendInboxReplyEmail({
    to: enquiry.email,
    subject: buildReplySubject({
      giveawayName: enquiry.giveaway_name,
      orderReference: enquiry.order_reference,
    }),
    text: buildReplyEmailText({
      customerFirstName: enquiry.first_name,
      customerFullName: enquiry.full_name,
      replyBody,
    }),
  })

  const nowIso = new Date().toISOString()

  if (emailResult.ok) {
    // 6) Mark sent, then move the ticket to 'waiting' (we replied; awaiting them).
    await svc
      .from('contact_enquiry_messages')
      .update({
        email_status: 'sent',
        email_sent_at: nowIso,
        email_provider_message_id: emailResult.providerMessageId,
        email_error: null,
      })
      .eq('id', messageId)

    await svc
      .from('contact_enquiries')
      .update({
        inbox_status: 'waiting',
        inbox_status_updated_at: nowIso,
        inbox_status_updated_by: user.id,
        // 'waiting' is not resolved; ensure any prior resolved timestamp clears.
        inbox_resolved_at: null,
      })
      .eq('id', id)

    return NextResponse.json(
      { ok: true, messageId, emailStatus: 'sent', inboxStatus: 'waiting' },
      NO_STORE,
    )
  }

  // 7) Email failed: persist the failure, DO NOT change inbox_status, DO NOT
  //    delete the reply. The admin sees "Email failed" and can retry.
  await svc
    .from('contact_enquiry_messages')
    .update({
      email_status: 'failed',
      email_error: (emailResult.error || 'Email delivery failed').slice(0, 500),
    })
    .eq('id', messageId)

  return NextResponse.json(
    { ok: true, messageId, emailStatus: 'failed', inboxStatus: enquiry.inbox_status },
    NO_STORE,
  )
}
