import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

export const runtime = "nodejs"

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function getIP(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  return "0.0.0.0"
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function sendResendEmail(args: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
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
    }),
  })

  if (!res.ok) {
    // Don't fail the registration if email fails; just log the response
    // (Vercel logs will capture this)
    const errText = await res.text().catch(() => "")
    console.error("Resend email failed:", res.status, errText)
  }
}

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    const IP_SALT = process.env.PRE_REGISTER_IP_SALT

    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const RESEND_FROM = process.env.RESEND_FROM
    const NOTIFY_TO = process.env.PRE_REGISTER_NOTIFY_TO

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Server misconfigured (supabase)" },
        { status: 500 }
      )
    }
    if (!IP_SALT) {
      return NextResponse.json(
        { ok: false, error: "Server misconfigured (ip salt)" },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
    }

    const first_name = String(body.first_name ?? "").trim()
    const last_name = String(body.last_name ?? "").trim()
    const tiktok_nickname = String(body.tiktok_nickname ?? "").trim()
    const mobileRaw = String(body.mobile ?? "")
    const mobile = mobileRaw.replace(/[^\d]/g, "")
    const emailRaw = String(body.email ?? "").trim()
    const consent = Boolean(body.consent)

    const email = emailRaw.toLowerCase()

    if (!first_name || !last_name || !tiktok_nickname || !mobile || !email) {
      return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 })
    }
    if (!/^\d{10,11}$/.test(mobile)) {
      return NextResponse.json({ ok: false, error: "Mobile must be 10–11 digits" }, { status: 400 })
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 })
    }
    if (!consent) {
      return NextResponse.json({ ok: false, error: "Consent is required" }, { status: 400 })
    }

    const ip = getIP(req)
    const ip_hash = sha256(`${ip}:${IP_SALT}`)
    const user_agent = req.headers.get("user-agent") ?? null

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    })

    // Rate limit: max 5 per hour per IP hash
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { count, error: countError } = await supabase
      .from("pre_registrations")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ip_hash)
      .gte("created_at", oneHourAgo)

    if (countError) {
      return NextResponse.json({ ok: false, error: "Rate limit check failed" }, { status: 500 })
    }
    if ((count ?? 0) >= 5) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 })
    }

    // Insert. Duplicate email => do NOT update; return success.
    const { data, error } = await supabase
      .from("pre_registrations")
      .insert({
        first_name,
        last_name,
        tiktok_nickname,
        mobile,
        email,
        consent: true,
        ip_hash,
        user_agent,
      })
      .select("id, created_at")
      .single()

    if (error) {
      // unique violation
      if ((error as any).code === "23505") {
        return NextResponse.json({ ok: true, alreadyRegistered: true })
      }
      return NextResponse.json({ ok: false, error: "Insert failed" }, { status: 500 })
    }

    // Email notify (best-effort)
    if (RESEND_API_KEY && RESEND_FROM && NOTIFY_TO) {
      await sendResendEmail({
        apiKey: RESEND_API_KEY,
        from: RESEND_FROM,
        to: NOTIFY_TO,
        subject: "New pre-registration",
        text:
          `New pre-registration:\n\n` +
          `Name: ${first_name} ${last_name}\n` +
          `TikTok: ${tiktok_nickname}\n` +
          `Mobile: ${mobile}\n` +
          `Email: ${email}\n` +
          `At: ${data.created_at}\n`,
      })
    }

    return NextResponse.json({ ok: true, alreadyRegistered: false })
  } catch {
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 })
  }
}
