import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { getInboxServiceClient, loadEnquiry, UUID_RE } from '@/lib/admin/inbox/service'
import {
  sendInboxReplyEmail,
  buildReplyEmailText,
  buildReplySubject,
} from '@/lib/admin/inbox/email'
import { isInboxEnquiryType } from '@/lib/admin/inbox/types'

export const runtime = 'nodejs'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

/**
 * POST /api/admin/inbox/[id]/messages/[messageId]/retry
 *
 * Retries delivery of an EXISTING outbound message whose email previously
 * failed. It reuses the stored body and never creates a duplicate conversation
 * message. The recipient is always loaded from contact_enquiries.email — never
 * from the browser.
 *
 * Guards:
 *   - admin / operations_admin only
 *   - the message must belong to the given enquiry
 *   - the message direction must be 'outbound'
 *
 * On success the ticket is moved to 'waiting' (consistent with a first-time
 * successful reply). On failure the message stays 'failed' and inbox_status is
 * left unchanged.
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
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

  const { id, messageId } = await ctx.params
  if (!UUID_RE.test(id) || !UUID_RE.test(messageId)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400, ...NO_STORE })
  }

  const svc = getInboxServiceClient()
  if (!svc) {
    return NextResponse.json({ ok: false, error: 'server_config' }, { status: 500, ...NO_STORE })
  }

  const enquiry = await loadEnquiry(svc, id)
  if (!enquiry) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  // Payout enquiries are not Inbox tickets — treat as not found so the Inbox
  // retry workflow can never act on a payout record.
  if (!isInboxEnquiryType(enquiry.enquiry_type)) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  if (!enquiry.email) {
    return NextResponse.json({ ok: false, error: 'no_recipient' }, { status: 422, ...NO_STORE })
  }

  // Load the message and verify it belongs to this enquiry and is outbound.
  const { data: message, error: msgError } = await svc
    .from('contact_enquiry_messages')
    .select('id, enquiry_id, direction, body, email_status')
    .eq('id', messageId)
    .maybeSingle()

  if (msgError) {
    console.error('[admin/inbox retry] load error:', (msgError.message || '').slice(0, 200))
    return NextResponse.json({ ok: false, error: 'retry_failed' }, { status: 500, ...NO_STORE })
  }
  if (!message || (message as { enquiry_id: string }).enquiry_id !== id) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  if ((message as { direction: string }).direction !== 'outbound') {
    return NextResponse.json({ ok: false, error: 'not_outbound' }, { status: 400, ...NO_STORE })
  }

  const storedBody = (message as { body: string }).body

  // Set back to pending while we retry.
  await svc
    .from('contact_enquiry_messages')
    .update({ email_status: 'pending', email_error: null })
    .eq('id', messageId)

  const emailResult = await sendInboxReplyEmail({
    to: enquiry.email,
    subject: buildReplySubject({
      giveawayName: enquiry.giveaway_name,
      orderReference: enquiry.order_reference,
    }),
    text: buildReplyEmailText({
      customerFirstName: enquiry.first_name,
      customerFullName: enquiry.full_name,
      replyBody: storedBody,
    }),
  })

  const nowIso = new Date().toISOString()

  if (emailResult.ok) {
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
        inbox_resolved_at: null,
      })
      .eq('id', id)

    return NextResponse.json({ ok: true, emailStatus: 'sent', inboxStatus: 'waiting' }, NO_STORE)
  }

  await svc
    .from('contact_enquiry_messages')
    .update({
      email_status: 'failed',
      email_error: (emailResult.error || 'Email delivery failed').slice(0, 500),
    })
    .eq('id', messageId)

  return NextResponse.json(
    { ok: true, emailStatus: 'failed', inboxStatus: enquiry.inbox_status },
    NO_STORE,
  )
}
