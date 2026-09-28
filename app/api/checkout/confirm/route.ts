import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { confirmPaymentAndAward } from '@/lib/payments/confirmPaymentAndAward'
import type { AwardPayload } from '@/lib/payments/confirmPaymentAndAward'
import { normalizeRevealType, type RevealType } from '@/lib/types/campaign'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

async function sendResendEmail(args: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  html: string
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  })

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '(unable to read body)')
    console.error('[checkout/confirm][email] Resend API error:', { status: res.status, body: errorBody })
    throw new Error(`Resend API returned ${res.status}`)
  }

  return res.json()
}

async function sendPostPurchaseConfirmationEmailBestEffort(
  svc: ReturnType<typeof getServiceSupabase>,
  intentId: string,
  intentRef: string,
  userId: string,
  campaignId: string,
  qty: number
) {
  try {
    // Step 1: Atomically claim the send right BEFORE any email work
    const claimedAt = new Date().toISOString()
    const { data: claimResult } = await svc
      .from('checkout_intents')
      .update({ confirmation_email_sent_at: claimedAt })
      .eq('id', intentId)
      .is('confirmation_email_sent_at', null)
      .select('id')

    if (!claimResult || claimResult.length === 0) {
      // Another request already claimed or sent
      console.log('[checkout/confirm][email] already claimed/sent for:', intentRef)
      return
    }

    // This request owns the send - proceed with email
    let sendSucceeded = false

    try {
      // a) Fetch purchaser email from auth
      const { data: authUserData, error: authUserError } = await svc.auth.admin.getUserById(userId)
      const purchaserEmail = authUserData?.user?.email ?? null

      if (authUserError) {
        console.error('[checkout/confirm][email] auth lookup error:', authUserError.message)
      }

      if (!purchaserEmail) {
        console.log('[checkout/confirm][email] no email found for user:', userId)
        // sendSucceeded stays false - rollback claim so retry can attempt if email is added later
      } else {
        // b) Fetch campaign title
        const { data: emailCampaign } = await svc
          .from('campaigns')
          .select('title')
          .eq('id', campaignId)
          .single()

        const campaignTitle = emailCampaign?.title ?? 'WTF Giveaway'

        // c) Fetch entry by checkout_intent_id
        const { data: entry } = await svc
          .from('entries')
          .select('id')
          .eq('checkout_intent_id', intentId)
          .single()

        let ticketLabel = ''
        if (entry) {
          // d) Fetch ticket allocation
          const { data: allocation } = await svc
            .from('ticket_allocations')
            .select('start_ticket, end_ticket')
            .eq('entry_id', entry.id)
            .single()

          if (allocation) {
            if (allocation.start_ticket === allocation.end_ticket) {
              ticketLabel = `Ticket number: ${allocation.start_ticket}`
            } else {
              ticketLabel = `Ticket numbers: ${allocation.start_ticket}-${allocation.end_ticket}`
            }
          }
        }

        // e) Build email content
        const subject = 'Your WTF Giveaways tickets are confirmed'
        const text = `Thank you for your purchase!\n\nCampaign: ${campaignTitle}\nQuantity: ${qty} ticket${qty > 1 ? 's' : ''}\n${ticketLabel}\nOrder ref: ${intentRef}\n\nGood luck!`
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Tickets Are Confirmed</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FDF2F8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #FDF2F8;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(236, 72, 153, 0.12);">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 32px 32px 24px 32px;">
              <img src="https://doapgvzlafwqtebezlqz.supabase.co/storage/v1/object/public/logo/wtf-logo.jpg" alt="WTF Giveaways" width="140" style="display: block; border: 0; border-radius: 8px;">
            </td>
          </tr>
          <!-- Heading -->
          <tr>
            <td align="center" style="padding: 0 32px 24px 32px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1F2937; line-height: 1.3;">Your Tickets Are Confirmed!</h1>
              <p style="margin: 12px 0 0 0; font-size: 15px; color: #6B7280; line-height: 1.5;">Thank you for your purchase</p>
            </td>
          </tr>
          <!-- Purchase Details -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; border-radius: 12px;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-bottom: 12px; border-bottom: 1px solid #E5E7EB;">
                          <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9CA3AF;">Campaign</p>
                          <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1F2937;">${campaignTitle}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB;">
                          <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9CA3AF;">Quantity</p>
                          <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1F2937;">${qty} ticket${qty > 1 ? 's' : ''}</p>
                        </td>
                      </tr>
                      ${ticketLabel ? `
                      <tr>
                        <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB;">
                          <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9CA3AF;">Your Ticket${qty > 1 ? 's' : ''}</p>
                          <p style="margin: 0; font-size: 20px; font-weight: 700; color: #EC4899; letter-spacing: 0.5px;">${ticketLabel.replace('Ticket number: ', '').replace('Ticket numbers: ', '')}</p>
                        </td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding-top: 12px;">
                          <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9CA3AF;">Order Reference</p>
                          <p style="margin: 0; font-size: 14px; font-weight: 500; color: #6B7280;">${intentRef}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Cash Winners Reminder -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #EC4899 0%, #F472B6 100%); border-radius: 12px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="text-align: center;">
                      <p style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #FFFFFF;">
                        CASH WINNERS - ACTION REQUIRED
                      </p>
                      <p style="margin: 0 0 16px 0; font-size: 14px; color: #FFFFFF; line-height: 1.6;">
                        For all cash payments, please email us at 
                        <a href="mailto:ben@wtf-giveaways.co.uk" style="color: #FFFFFF; font-weight: 700; text-decoration: underline;">
                          ben@wtf-giveaways.co.uk
                        </a>
                        with the following:
                      </p>
                      <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin: 0 auto 16px auto;">
                        <tr>
                          <td style="padding: 6px 0; font-size: 14px; color: #FFFFFF; font-weight: 600;">
                            Full Name (as on bank)
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0; font-size: 14px; color: #FFFFFF; font-weight: 600;">
                            Sort Code
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0; font-size: 14px; color: #FFFFFF; font-weight: 600;">
                            Account Number
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 0; font-size: 13px; color: #FDE68A; font-weight: 600;">
                        We aim to pay within 48 hours
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Good Luck -->
          <tr>
            <td align="center" style="padding: 0 32px 32px 32px;">
              <p style="margin: 0; font-size: 18px; font-weight: 600; color: #1F2937;">Good luck!</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F9FAFB; border-radius: 0 0 16px 16px; border-top: 1px solid #E5E7EB;">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #6B7280; text-align: center; line-height: 1.5;">Want help? Email <a href="mailto:ben@wtf-giveaways.co.uk" style="color: #EC4899; text-decoration: none; font-weight: 500;">ben@wtf-giveaways.co.uk</a></p>
              <p style="margin: 0; font-size: 12px; color: #9CA3AF; text-align: center;">WTF Giveaways</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `.trim()

        const resendApiKey = process.env.RESEND_API_KEY
        const resendFrom = process.env.RESEND_FROM

        if (!resendApiKey || !resendFrom) {
          console.warn('[checkout/confirm][email] RESEND_API_KEY or RESEND_FROM not configured')
          // sendSucceeded stays false - rollback claim so retry can attempt when config is fixed
        } else {
          // f) Send email
          await sendResendEmail({
            apiKey: resendApiKey,
            from: resendFrom,
            to: purchaserEmail,
            subject,
            text,
            html,
          })

          console.log('[checkout/confirm][email] sent to:', purchaserEmail)
          sendSucceeded = true
        }
      }
    } catch (sendErr: any) {
      console.error('[checkout/confirm][email] send failed:', sendErr?.message)
      sendSucceeded = false
    }

    // Step 2: If send failed, rollback the claim so another retry can attempt
    if (!sendSucceeded) {
      await svc
        .from('checkout_intents')
        .update({ confirmation_email_sent_at: null })
        .eq('id', intentId)
        .eq('confirmation_email_sent_at', claimedAt)
      console.log('[checkout/confirm][email] rolled back claim for retry:', intentRef)
    }
  } catch (emailErr: any) {
    // Log but do NOT fail checkout
    console.error('[checkout/confirm][email] error (non-fatal):', emailErr?.message)
  }
}

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE env vars for service role client')
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

export async function POST(request: Request) {
  // 1) Auth — a real authenticated Supabase user is REQUIRED in every
  //    environment (local, preview/staging, and production). There is no
  //    bypass/fallback/fixed user_id.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401, ...NO_STORE })
  }

  const resolvedUser = user

  console.log('[checkout/confirm] caller user:', resolvedUser.id)

  // 2) Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, ...NO_STORE })
  }

  // Treat the raw body value as untrusted. Require a string that is non-empty
  // after trimming and bounded to 128 chars; reject whitespace-only/unbounded
  // refs. All subsequent processing uses the trimmed value.
  const rawRef: unknown = body.ref
  const provider = body.provider as string | undefined

  if (typeof rawRef !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing or invalid ref' }, { status: 400, ...NO_STORE })
  }
  const ref = rawRef.trim()
  if (ref.length === 0 || ref.length > 128) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid ref' }, { status: 400, ...NO_STORE })
  }

  // 'acquired' is accepted so the browser can poll this route after returning
  // from Acquired Hosted Checkout, but confirmPaymentAndAward NEVER verifies or
  // fulfils Acquired from the browser — it only reads an already-confirmed
  // intent (confirmed by the verified Acquired webhook) or returns the 409
  // awaiting_provider_confirmation poll state.
  //
  // 'wallet' is accepted for fully WTF-credit-funded orders (external payment
  // of £0). No external PSP is involved, so the browser confirms directly.
  // confirmPaymentAndAward enforces that the intent is genuinely 100%
  // wallet-funded before it may run the award RPC, and the DB confirm
  // transaction captures the wallet reservation atomically (rolling everything
  // back if capture fails).
  if (
    provider !== 'sumup' &&
    provider !== 'paypal' &&
    provider !== 'debug' &&
    provider !== 'acquired' &&
    provider !== 'wallet'
  ) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid provider' }, { status: 400, ...NO_STORE })
  }

  // Safety: the unverified 'debug' provider (which awards without any external
  // payment verification) is only permitted outside production. In production
  // we refuse before confirmPaymentAndAward / the award RPC can ever run.
  // VERCEL_ENV is server-only; when it's unset (local dev) debug stays allowed.
  if (provider === 'debug' && process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'debug_provider_disabled' }, { status: 403, ...NO_STORE })
  }

  // 3) Call confirmPaymentAndAward
  console.log('[checkout/confirm] confirm attempt:', {
    ref,
    provider,
    callerUserId: resolvedUser.id,
  })

  try {
    const award: AwardPayload = await confirmPaymentAndAward({
      ref,
      userId: resolvedUser.id,
      provider,
    })

    // Safe confirmation metadata only — no PII, no provider secrets.
    console.log('[checkout/confirm] confirmed:', {
      checkout_ref: award.checkout_ref || ref,
      won: award.won,
      prize_count: award.prizes.length,
    })

    // Lightweight lookup to get campaign_slug for "Buy More Tickets" button
    // Uses service client to avoid auth issues, single indexed query
    let campaignSlug: string | null = null
    // Presentation-only: how the customer reveals their (already-decided) result.
    let campaignRevealType: RevealType = 'normal'
    let intentForEmail: {
      id: string
      user_id: string
      campaign_id: string
      qty: number
      external_payment_pence: number | null
      total_pence: number | null
      wallet_credit_pence: number | null
    } | null = null
    const svc = getServiceSupabase()
    try {
      const { data: intentData } = await svc
        .from('checkout_intents')
        .select('id, user_id, campaign_id, qty, external_payment_pence, total_pence, wallet_credit_pence')
        .eq('ref', ref)
        .single()

      if (intentData?.campaign_id) {
        intentForEmail = intentData as {
          id: string
          user_id: string
          campaign_id: string
          qty: number
          external_payment_pence: number | null
          total_pence: number | null
          wallet_credit_pence: number | null
        }

        const { data: campaignData } = await svc
          .from('campaigns')
          .select('slug, reveal_type')
          .eq('id', intentData.campaign_id)
          .single()

        campaignSlug = campaignData?.slug ?? null
        // Explicit allow-list; unknown/null → 'normal'. This runs AFTER the
        // award is fully determined and is attached to the response only for
        // presentation — it never feeds allocation or win logic.
        campaignRevealType = normalizeRevealType(campaignData?.reveal_type)
      }
    } catch {
      // Non-fatal - button just won't render
    }

    const awardWithSlug = {
      ...award,
      campaign_slug: campaignSlug,
      reveal_type: campaignRevealType,
      // Additive, presentation/analytics-only fields sourced from the same
      // already-loaded checkout_intents row (no extra query). Used by the
      // browser Meta Pixel Purchase event. Null when the intent lookup missed;
      // the client only fires when the derived paid amount is present and valid.
      // total_pence is the final checkout total; wallet_credit_pence is the
      // wallet portion; external_payment_pence (when set) is the externally
      // paid amount. The client derives the paid amount from these.
      campaign_id: intentForEmail?.campaign_id ?? null,
      external_payment_pence: intentForEmail?.external_payment_pence ?? null,
      total_pence: intentForEmail?.total_pence ?? null,
      wallet_credit_pence: intentForEmail?.wallet_credit_pence ?? null,
    }

    // === POST-PURCHASE CONFIRMATION EMAIL (best-effort, non-blocking) ===
    // Runs after successful confirmPaymentAndAward(), cannot fail checkout
    if (intentForEmail) {
      try {
        await sendPostPurchaseConfirmationEmailBestEffort(
          svc,
          intentForEmail.id,
          ref,
          intentForEmail.user_id,
          intentForEmail.campaign_id,
          intentForEmail.qty ?? 1
        )
      } catch (emailErr: any) {
        // Swallow completely - email must never affect checkout response
        console.error('[checkout/confirm][email] outer error (non-fatal):', emailErr?.message)
      }
    }
    // === END POST-PURCHASE CONFIRMATION EMAIL ===

    // === DETACHED BACKGROUND TASKS ===
    // Fully isolated from request lifecycle - cannot cause 500s or slow responses
    queueMicrotask(() => {
      void (async () => {
        try {
          const svc = getServiceSupabase()
          const cronSecret = process.env.CRON_SECRET
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

          // Get campaign_id from checkout_intent
          const { data: intent } = await svc
            .from('checkout_intents')
            .select('campaign_id')
            .eq('ref', ref)
            .single()

          if (!intent?.campaign_id || !cronSecret) return

          const campaignId = intent.campaign_id

          // --- DRAW TRIGGER ---
          try {
            const { data: campaign } = await svc
              .from('campaigns')
              .select('id, end_at, max_tickets_total, status')
              .eq('id', campaignId)
              .single()

            if (campaign && campaign.status !== 'ended') {
              const { data: counter } = await svc
                .from('giveaway_ticket_counters')
                .select('next_ticket')
                .eq('giveaway_id', campaign.id)
                .maybeSingle()

              const sold = Math.max(0, (counter?.next_ticket ?? 1) - 1)
              const cap = campaign.max_tickets_total ?? 0
              const isSoldOut = cap > 0 && sold >= cap
              const isPastEnd = new Date(campaign.end_at) <= new Date()

              if (isSoldOut || isPastEnd) {
                console.log('[checkout/confirm] triggering immediate draw:', {
                  campaignId: campaign.id,
                  isSoldOut,
                  isPastEnd,
                  sold,
                  cap,
                })

                const drawRes = await fetch(`${baseUrl}/api/jobs/run-draws`, {
                  method: 'GET',
                  headers: { Authorization: `Bearer ${cronSecret}` },
                })
                if (!drawRes.ok) {
                  console.error('[checkout/confirm] draw trigger returned non-ok:', drawRes.status)
                } else {
                  console.log('[checkout/confirm] draw trigger succeeded:', drawRes.status)
                }
              }
            }
          } catch (drawErr: any) {
            console.error('[checkout/confirm] draw trigger error (non-fatal):', drawErr?.message)
          }

          // --- SNAPSHOT REFRESH ---
          try {
            const refreshRes = await fetch(
              `${baseUrl}/api/jobs/refresh-giveaway-snapshots?campaignId=${campaignId}&token=${cronSecret}`,
              { method: 'GET' }
            )
            if (!refreshRes.ok) {
              console.error('[checkout/confirm] snapshot refresh returned non-ok:', refreshRes.status)
            } else {
              console.log('[checkout/confirm] snapshot refresh succeeded for campaign:', campaignId)
            }
          } catch (refreshErr: any) {
            console.error('[checkout/confirm] snapshot refresh error (non-fatal):', refreshErr?.message)
          }
        } catch (bgErr: any) {
          console.error('[checkout/confirm] background task error (non-fatal):', bgErr?.message)
        }
      })()
    })
    // === END DETACHED BACKGROUND TASKS ===

    return NextResponse.json({ ok: true, award: awardWithSlug }, NO_STORE)
  } catch (err: any) {
    const message = err?.message || ''

    if (message.includes('awaiting_provider_confirmation')) {
      return NextResponse.json({ ok: false, error: 'awaiting_provider_confirmation' }, { status: 409, ...NO_STORE })
    }

    if (message.includes('user_id mismatch') || message.includes('caller does not own')) {
      return NextResponse.json({ ok: false, error: 'forbidden_checkout_intent_owner' }, { status: 403, ...NO_STORE })
    }

    // Wallet-only fixed error → HTTP mapping. Applied ONLY for the wallet
    // provider so Acquired/SumUp/PayPal/debug error handling is unchanged. Each
    // fixed internal code maps to a 409 with the same code as the client error.
    if (provider === 'wallet') {
      const WALLET_409_ERRORS = new Set([
        'invalid_wallet_split',
        'wallet_reservation_invalid',
        'wallet_reservation_unavailable',
        'wallet_confirmation_invalid_state',
      ])
      if (WALLET_409_ERRORS.has(message)) {
        return NextResponse.json({ ok: false, error: message }, { status: 409, ...NO_STORE })
      }
    }

    console.error('[checkout/confirm] Error detail:', {
      message,
      ref,
      provider,
      callerUserId: resolvedUser.id,
    })
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500, ...NO_STORE })
  }
}
