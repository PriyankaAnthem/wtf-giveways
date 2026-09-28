import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit, getClientIp } from "@/lib/marketing/rate-limit"
import { buildContactConfirmationEmail } from "@/lib/contact/confirmation-email"

export const runtime = "nodejs"

// Conservative per-IP fixed window. A genuine enquirer never submits this many
// times in ten minutes, so legitimate behaviour is unaffected; this only blunts
// rapid automated/abusive submissions. Best-effort (per instance), layered on
// the existing honeypot and validation.
const CONTACT_RATE_LIMIT = { limit: 8, windowMs: 10 * 60 * 1000 }

const ALLOWED_ENQUIRY_TYPES = ['general', 'winner_payout', 'ticket_order_problem', 'account_login_issue', 'other']
const ALLOWED_PAYOUT_METHODS = ['bank_transfer', 'paypal', 'other']

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function sendResendEmail(args: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  /** Optional branded HTML part. Omitted => the existing text-only behaviour. */
  html?: string
}) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      ...(args.html ? { html: args.html } : {}),
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    console.error("Resend email failed:", res.status, errText)
  }
}

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const RESEND_FROM = process.env.RESEND_FROM
    const NOTIFY_TO = process.env.CONTACT_NOTIFY_TO

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Server misconfigured" },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
    }

    // Honeypot check - if filled, silently succeed without inserting
    const honeypot = String(body.company_website ?? "").trim()
    if (honeypot) {
      return NextResponse.json({ ok: true })
    }

    // Conservative rate limit (after honeypot so silent bot-successes don't
    // consume a legitimate visitor's budget on a shared IP).
    const rl = rateLimit(`contact:${getClientIp(req)}`, CONTACT_RATE_LIMIT)
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many submissions. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      )
    }

    // Parse and sanitize fields
    const enquiry_type = String(body.enquiry_type ?? "").trim()
    const full_name = String(body.full_name ?? "").trim()
    const first_name = String(body.first_name ?? "").trim() || null
    const last_name = String(body.last_name ?? "").trim() || null
    const email = String(body.email ?? "").trim().toLowerCase()
    const phone = String(body.phone ?? "").trim() || null
    const giveaway_name = String(body.giveaway_name ?? "").trim() || null
    const order_reference = String(body.order_reference ?? "").trim() || null
    const tiktok_username = String(body.tiktok_username ?? "").trim() || null
    let message = String(body.message ?? "").trim()

    // For winner_payout, set default message if empty
    if (enquiry_type === 'winner_payout' && !message) {
      message = "Winner payout details submitted"
    }

    // Amount claimed - convert from pounds to pence if provided
    let amount_claimed_pence: number | null = null
    if (body.amount_claimed != null && body.amount_claimed !== '') {
      const amountPounds = parseFloat(String(body.amount_claimed))
      if (!isNaN(amountPounds) && amountPounds > 0) {
        amount_claimed_pence = Math.round(amountPounds * 100)
      }
    }

    // Payout fields
    const preferred_payout_method = String(body.preferred_payout_method ?? "").trim() || null
    const payout_account_holder_name = String(body.payout_account_holder_name ?? "").trim() || null
    // Strip spaces and hyphens from sort code and account number
    const payout_sort_code = String(body.payout_sort_code ?? "").replace(/[\s-]/g, "").trim() || null
    const payout_account_number = String(body.payout_account_number ?? "").replace(/[\s-]/g, "").trim() || null
    const payout_paypal_email = String(body.payout_paypal_email ?? "").trim().toLowerCase() || null
    const payout_contact_detail = String(body.payout_contact_detail ?? "").trim() || null

    // Validate required fields
    if (!enquiry_type || !ALLOWED_ENQUIRY_TYPES.includes(enquiry_type)) {
      return NextResponse.json({ ok: false, error: "Invalid enquiry type" }, { status: 400 })
    }
    if (!full_name || full_name.length < 2) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 })
    }
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "Valid email is required" }, { status: 400 })
    }
    if (!phone) {
      return NextResponse.json({ ok: false, error: "Phone number is required" }, { status: 400 })
    }
    // Message validation - required for non-payout, optional for payout
    if (enquiry_type !== 'winner_payout') {
      if (!message || message.length < 10) {
        return NextResponse.json({ ok: false, error: "Message must be at least 10 characters" }, { status: 400 })
      }
    }
    if (message.length > 2000) {
      return NextResponse.json({ ok: false, error: "Message too long" }, { status: 400 })
    }

    // Winner payout validation
    if (enquiry_type === 'winner_payout') {
      if (!first_name) {
        return NextResponse.json({ ok: false, error: "First name is required for winner payouts" }, { status: 400 })
      }
      if (!last_name) {
        return NextResponse.json({ ok: false, error: "Last name is required for winner payouts" }, { status: 400 })
      }
      if (!tiktok_username) {
        return NextResponse.json({ ok: false, error: "TikTok username is required for winner payouts" }, { status: 400 })
      }
      if (!amount_claimed_pence || amount_claimed_pence <= 0) {
        return NextResponse.json({ ok: false, error: "Amount claimed is required for winner payouts" }, { status: 400 })
      }
      if (!preferred_payout_method || !ALLOWED_PAYOUT_METHODS.includes(preferred_payout_method)) {
        return NextResponse.json({ ok: false, error: "Please select a payout method" }, { status: 400 })
      }
      
      if (preferred_payout_method === 'bank_transfer') {
        if (!payout_account_holder_name) {
          return NextResponse.json({ ok: false, error: "Account holder name is required" }, { status: 400 })
        }
        if (!payout_sort_code) {
          return NextResponse.json({ ok: false, error: "Sort code is required" }, { status: 400 })
        }
        if (!payout_account_number) {
          return NextResponse.json({ ok: false, error: "Account number is required" }, { status: 400 })
        }
      }
      
      if (preferred_payout_method === 'paypal') {
        if (!payout_paypal_email || !isValidEmail(payout_paypal_email)) {
          return NextResponse.json({ ok: false, error: "Valid PayPal email is required" }, { status: 400 })
        }
      }
      
      if (preferred_payout_method === 'other') {
        if (!payout_contact_detail) {
          return NextResponse.json({ ok: false, error: "Please describe your preferred payment method" }, { status: 400 })
        }
      }
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    })

    // Insert into contact_enquiries
    const { data, error } = await supabase
      .from("contact_enquiries")
      .insert({
        enquiry_type,
        full_name,
        first_name,
        last_name,
        email,
        phone,
        giveaway_name,
        order_reference,
        tiktok_username,
        amount_claimed_pence: enquiry_type === 'winner_payout' ? amount_claimed_pence : null,
        preferred_payout_method: enquiry_type === 'winner_payout' ? preferred_payout_method : null,
        payout_account_holder_name: enquiry_type === 'winner_payout' && preferred_payout_method === 'bank_transfer' ? payout_account_holder_name : null,
        payout_sort_code: enquiry_type === 'winner_payout' && preferred_payout_method === 'bank_transfer' ? payout_sort_code : null,
        payout_account_number: enquiry_type === 'winner_payout' && preferred_payout_method === 'bank_transfer' ? payout_account_number : null,
        payout_paypal_email: enquiry_type === 'winner_payout' && preferred_payout_method === 'paypal' ? payout_paypal_email : null,
        payout_contact_detail: enquiry_type === 'winner_payout' && preferred_payout_method === 'other' ? payout_contact_detail : null,
        message,
        status: 'new',
      })
      .select("id, created_at")
      .single()

    if (error) {
      console.error("Contact enquiry insert failed:", error)
      return NextResponse.json({ ok: false, error: "Failed to submit enquiry" }, { status: 500 })
    }

    // Send admin notification email (best-effort)
    if (RESEND_API_KEY && RESEND_FROM && NOTIFY_TO) {
      const enquiryTypeLabels: Record<string, string> = {
        general: 'General enquiry',
        winner_payout: 'Winner payout details',
        ticket_order_problem: 'Problem with tickets/order',
        account_login_issue: 'Account/login issue',
        other: 'Other',
      }

      let emailBody = `New contact enquiry received:\n\n`
      emailBody += `Type: ${enquiryTypeLabels[enquiry_type] || enquiry_type}\n`
      emailBody += `Name: ${full_name}\n`
      if (first_name && last_name) emailBody += `(First: ${first_name}, Last: ${last_name})\n`
      emailBody += `Email: ${email}\n`
      if (phone) emailBody += `Phone: ${phone}\n`
      if (giveaway_name) emailBody += `Giveaway: ${giveaway_name}\n`
      if (tiktok_username) emailBody += `TikTok Username: ${tiktok_username}\n`
      if (order_reference && order_reference !== tiktok_username) emailBody += `Order Ref: ${order_reference}\n`
      emailBody += `\nMessage:\n${message}\n`

      if (enquiry_type === 'winner_payout') {
        emailBody += `\n--- Payout Details ---\n`
        if (amount_claimed_pence) {
          emailBody += `Amount Claimed: £${(amount_claimed_pence / 100).toFixed(2)}\n`
        }
        emailBody += `Method: ${preferred_payout_method}\n`
        
        if (preferred_payout_method === 'bank_transfer') {
          emailBody += `Account Holder: ${payout_account_holder_name}\n`
          // DO NOT include sort code or account number in email for security
          emailBody += `Bank payout details were submitted and stored in Supabase. For safety, they are not included in this email.\n`
        } else if (preferred_payout_method === 'paypal') {
          emailBody += `PayPal Email: ${payout_paypal_email}\n`
        } else if (preferred_payout_method === 'other') {
          emailBody += `Contact Detail: ${payout_contact_detail}\n`
        }
      }

      emailBody += `\nSubmitted at: ${data.created_at}\n`
      emailBody += `Enquiry ID: ${data.id}\n`

      await sendResendEmail({
        apiKey: RESEND_API_KEY,
        from: RESEND_FROM,
        to: NOTIFY_TO,
        subject: `Contact Enquiry: ${enquiryTypeLabels[enquiry_type] || enquiry_type}`,
        text: emailBody,
      })
    }

    // Customer confirmation email (best-effort, strictly after the successful
    // insert). This is transactional: one email, no list subscription, no
    // marketing preference is read or written. A failure here must never undo
    // the stored enquiry or make a successful submission look failed, so it is
    // isolated in its own try/catch and only logged. NOTIFY_TO is deliberately
    // not required — the customer email must still send if only the admin
    // notification is unconfigured.
    if (RESEND_API_KEY && RESEND_FROM) {
      try {
        const confirmation = buildContactConfirmationEmail({
          kind: enquiry_type === 'winner_payout' ? 'winner_payout' : 'general',
          firstName: first_name,
          enquiryId: data.id,
        })

        await sendResendEmail({
          apiKey: RESEND_API_KEY,
          from: RESEND_FROM,
          to: email,
          subject: confirmation.subject,
          text: confirmation.text,
          html: confirmation.html,
        })
      } catch (emailErr) {
        console.error(
          "[contact] Customer confirmation email failed (enquiry was stored successfully):",
          { enquiryId: data.id, enquiryType: enquiry_type, error: emailErr }
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Contact API error:", err)
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 })
  }
}
