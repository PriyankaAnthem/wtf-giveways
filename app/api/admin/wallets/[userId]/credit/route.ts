import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Strict GBP: optional whole pounds with optional 1-2 decimal places. No signs,
// symbols, commas, exponents, or surrounding whitespace (caller must pre-trim).
const GBP_RE = /^\d{1,7}(\.\d{1,2})?$/

const MAX_CREDIT_PENCE = 1_000_000 // £10,000.00 per request
const REASON_MIN = 3
const REASON_MAX = 500
const REFERENCE_MAX = 200

type ParsedPence = { ok: true; pence: number } | { ok: false }

/** Strictly parse a GBP string into a positive integer number of pence. */
function parseGbpToPence(raw: unknown): ParsedPence {
  if (typeof raw !== 'string') return { ok: false }
  // Reject any leading/trailing whitespace by comparing to the trimmed form.
  if (raw !== raw.trim() || raw.length === 0) return { ok: false }
  if (!GBP_RE.test(raw)) return { ok: false }

  const [poundsPart, fracPartRaw = ''] = raw.split('.')
  const fracPadded = (fracPartRaw + '00').slice(0, 2)
  const pounds = Number(poundsPart)
  const pence = Number(fracPadded)
  if (!Number.isFinite(pounds) || !Number.isFinite(pence)) return { ok: false }

  const total = pounds * 100 + pence
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false }
  return { ok: true, pence: total }
}

/** Known DB exception -> fixed client code + HTTP status. */
const ERROR_MAP: Record<string, { code: string; status: number }> = {
  admin_wallet_credit_user_not_found: { code: 'customer_not_found', status: 404 },
  admin_wallet_credit_admin_not_allowed: { code: 'forbidden', status: 403 },
  admin_wallet_credit_invalid_amount: { code: 'invalid_amount', status: 400 },
  admin_wallet_credit_invalid_reason: { code: 'invalid_reason', status: 400 },
  admin_wallet_credit_reference_too_long: { code: 'invalid_reference', status: 400 },
  admin_wallet_credit_idempotency_mismatch: { code: 'request_conflict', status: 409 },
}

function safeNonNegInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return null
  return n
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  // Super Admins and Operations Admins. Hosts (ops) and read_only are rejected.
  // Sensitive write: this explicit per-handler check runs before the
  // service-role client is created below.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, ...NO_STORE })
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400, ...NO_STORE })
  }

  // requestId (idempotency) must be a UUID generated once per confirmation attempt.
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  if (!UUID_RE.test(requestId)) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400, ...NO_STORE })
  }

  // Strict GBP -> pence (never trust client-calculated pence).
  const parsed = parseGbpToPence(body.amountGbp)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: 'invalid_amount' }, { status: 400, ...NO_STORE })
  }
  if (parsed.pence > MAX_CREDIT_PENCE) {
    return NextResponse.json({ ok: false, error: 'amount_too_large' }, { status: 400, ...NO_STORE })
  }

  // Reason: required, trimmed, 3-500 chars.
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return NextResponse.json({ ok: false, error: 'invalid_reason' }, { status: 400, ...NO_STORE })
  }

  // Internal reference: optional, trimmed, <= 200 chars. Empty => null.
  let internalReference: string | null = null
  if (body.internalReference != null) {
    if (typeof body.internalReference !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_reference' }, { status: 400, ...NO_STORE })
    }
    const ref = body.internalReference.trim()
    if (ref.length > REFERENCE_MAX) {
      return NextResponse.json({ ok: false, error: 'invalid_reference' }, { status: 400, ...NO_STORE })
    }
    internalReference = ref.length > 0 ? ref : null
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/wallets/credit] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'credit_failed' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // The ONLY wallet mutation path: the atomic admin_credit_wallet RPC.
  const { data, error } = await svc.rpc('admin_credit_wallet', {
    p_user_id: userId,
    p_admin_user_id: user.id,
    p_amount_pence: parsed.pence,
    p_reason: reason,
    p_request_id: requestId,
    p_internal_reference: internalReference,
  })

  if (error) {
    const rawMessage = typeof error.message === 'string' ? error.message : ''
    console.error('[admin/wallets/credit] RPC error:', rawMessage.slice(0, 300))
    for (const [token, mapped] of Object.entries(ERROR_MAP)) {
      if (rawMessage.includes(token)) {
        return NextResponse.json({ ok: false, error: mapped.code }, { status: mapped.status, ...NO_STORE })
      }
    }
    return NextResponse.json({ ok: false, error: 'credit_failed' }, { status: 500, ...NO_STORE })
  }

  // Treat the RPC response as untrusted; normalise a single record from it.
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') {
    console.error('[admin/wallets/credit] Malformed RPC response (not an object)')
    return NextResponse.json({ ok: false, error: 'credit_failed' }, { status: 500, ...NO_STORE })
  }

  const transactionId = (row as Record<string, unknown>).transaction_id
  const creditedPence = safeNonNegInt((row as Record<string, unknown>).credited_pence)
  const balancePence = safeNonNegInt((row as Record<string, unknown>).balance_pence)
  const reservedPence = safeNonNegInt((row as Record<string, unknown>).reserved_pence)
  const availablePence = safeNonNegInt((row as Record<string, unknown>).available_pence)
  const alreadyCredited = (row as Record<string, unknown>).already_credited

  if (
    typeof transactionId !== 'string' ||
    !UUID_RE.test(transactionId) ||
    creditedPence === null ||
    creditedPence !== parsed.pence ||
    balancePence === null ||
    reservedPence === null ||
    availablePence === null ||
    typeof alreadyCredited !== 'boolean'
  ) {
    console.error('[admin/wallets/credit] Malformed RPC response (field validation failed)')
    return NextResponse.json({ ok: false, error: 'credit_failed' }, { status: 500, ...NO_STORE })
  }

  return NextResponse.json(
    {
      ok: true,
      transactionId,
      creditedPence,
      balancePence,
      reservedPence,
      availablePence,
      alreadyCredited,
    },
    NO_STORE,
  )
}
