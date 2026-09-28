import 'server-only'

/**
 * Inbox-specific outbound email, built on the SAME raw-fetch Resend approach
 * used elsewhere in the repo (app/api/contact, checkout/confirm, webhooks). It
 * deliberately does NOT refactor those callers — it only adds a small helper
 * that RETURNS the provider message id and a safe error string, which the reply
 * flow needs to persist onto contact_enquiry_messages.
 *
 * Security:
 *  - The recipient is always passed in by the server from the enquiry row.
 *    This helper never reads a recipient from client input.
 *  - Internal/provider error text is never surfaced to the browser; callers
 *    store a short diagnostic on the message row and log the detail server-side.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export interface InboxEmailResult {
  ok: boolean
  /** Resend message id when the provider returned one. */
  providerMessageId: string | null
  /** Short, safe diagnostic for storage on the message row (never a stack). */
  error: string | null
}

/**
 * Sends a plain-text Inbox reply email through Resend.
 *
 * Returns a structured result rather than throwing so the caller can persist
 * the exact delivery outcome (sent / failed) against the stored message without
 * losing the reply on failure.
 */
export async function sendInboxReplyEmail(args: {
  to: string
  subject: string
  text: string
  replyTo?: string
}): Promise<InboxEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM

  if (!apiKey || !from) {
    console.error('[inbox/email] RESEND_API_KEY or RESEND_FROM not configured')
    return { ok: false, providerMessageId: null, error: 'Email service not configured' }
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      // Log the provider detail server-side; return only a safe summary.
      const detail = await res.text().catch(() => '')
      console.error('[inbox/email] Resend send failed:', res.status, detail.slice(0, 500))
      return {
        ok: false,
        providerMessageId: null,
        error: `Email provider returned ${res.status}`,
      }
    }

    const json = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, providerMessageId: json?.id ?? null, error: null }
  } catch (err) {
    console.error('[inbox/email] Unexpected send error:', (err as Error)?.message)
    return { ok: false, providerMessageId: null, error: 'Email delivery error' }
  }
}

/**
 * Builds the plain-text reply email body with a professional WTF sign-off.
 * NEVER includes sensitive payout/bank fields.
 */
export function buildReplyEmailText(args: {
  customerFirstName: string | null
  customerFullName: string | null
  replyBody: string
}): string {
  const greetingName = (args.customerFirstName || args.customerFullName || '').trim()
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi,'
  return [
    greeting,
    '',
    args.replyBody.trim(),
    '',
    'Best wishes,',
    'The WTF Giveaways Team',
  ].join('\n')
}

/** A recognisable subject line, optionally scoped to a giveaway/order. */
export function buildReplySubject(args: {
  giveawayName?: string | null
  orderReference?: string | null
}): string {
  const ref = (args.giveawayName || args.orderReference || '').trim()
  return ref ? `Re: Your WTF Giveaways enquiry — ${ref}` : 'Re: Your WTF Giveaways enquiry'
}
