import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isUserPurchaseRestricted } from '@/lib/account-restrictions'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TX_DEFAULT_LIMIT = 50
const TX_MAX_LIMIT = 100
const RESERVATIONS_LIMIT = 50

function safeNonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return 0
  return n
}

/** Signed integer (transaction amounts can be negative for debits/spends). */
function safeSignedInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return 0
  return n
}

async function fetchEmails(svc: SupabaseClient, userIds: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const unique = [...new Set(userIds.filter(Boolean))].slice(0, 25)
  if (unique.length === 0) return out
  const results = await Promise.allSettled(
    unique.map(async (id) => {
      const { data, error } = await svc.auth.admin.getUserById(id)
      if (error) return { id, email: null }
      return { id, email: data?.user?.email ?? null }
    }),
  )
  for (const r of results) {
    if (r.status === 'fulfilled') out[r.value.id] = r.value.email
  }
  return out
}

/** Extract only the internal reference from a transaction metadata blob. */
function extractInternalReference(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const ref = (metadata as Record<string, unknown>).internal_reference
  return typeof ref === 'string' && ref.trim().length > 0 ? ref : null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  // Super Admins and Operations Admins. Hosts (ops) and read_only are rejected.
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/wallets/detail] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(TX_MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(TX_DEFAULT_LIMIT), 10) || TX_DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  try {
    // === Identity ===
    let customerName = 'Unknown'
    let mobile: string | null = null
    const { data: profile, error: profErr } = await svc
      .from('profiles_private')
      .select('user_id, real_name, mobile')
      .eq('user_id', userId)
      .maybeSingle()
    if (profErr) {
      console.error('[admin/wallets/detail] profiles_private error (non-fatal):', profErr.message)
    } else if (profile) {
      customerName = profile.real_name || 'Unknown'
      mobile = profile.mobile || null
    }

    let email: string | null = null
    try {
      const { data: authData } = await svc.auth.admin.getUserById(userId)
      email = authData?.user?.email ?? null
    } catch (e: any) {
      console.error('[admin/wallets/detail] email lookup error (non-fatal):', e?.message)
    }

    // === Balances (missing row => zeros) ===
    let balance = 0
    let reserved = 0
    const { data: account, error: accErr } = await svc
      .from('wallet_accounts')
      .select('balance_pence, reserved_pence')
      .eq('user_id', userId)
      .maybeSingle()
    if (accErr) {
      console.error('[admin/wallets/detail] wallet_accounts error:', accErr.message)
      return NextResponse.json({ ok: false, error: 'detail_failed' }, { status: 500, ...NO_STORE })
    }
    if (account) {
      balance = safeNonNegInt(account.balance_pence)
      reserved = safeNonNegInt(account.reserved_pence)
    }
    const available = Math.max(balance - reserved, 0)

    // === Transactions (newest first, bounded page + 1 to detect next) ===
    const { data: txRows, error: txErr } = await svc
      .from('wallet_transactions')
      .select(
        'id, transaction_type, amount_pence, balance_after_pence, source_award_id, source_checkout_intent_id, admin_user_id, reason, idempotency_key, metadata, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit) // fetch limit + 1
    if (txErr) {
      console.error('[admin/wallets/detail] wallet_transactions error:', txErr.message)
      return NextResponse.json({ ok: false, error: 'detail_failed' }, { status: 500, ...NO_STORE })
    }
    let txPage = txRows ?? []
    let hasNext = false
    if (txPage.length > limit) {
      hasNext = true
      txPage = txPage.slice(0, limit)
    }

    // Resolve acting-admin emails for the current page only (bounded).
    const adminEmailById = await fetchEmails(
      svc,
      txPage.map((t) => t.admin_user_id).filter(Boolean) as string[],
    )

    const transactions = txPage.map((t) => ({
      id: t.id,
      transaction_type: t.transaction_type,
      amount_pence: safeSignedInt(t.amount_pence),
      balance_after_pence: safeNonNegInt(t.balance_after_pence),
      source_award_id: t.source_award_id ?? null,
      source_checkout_intent_id: t.source_checkout_intent_id ?? null,
      admin_user_id: t.admin_user_id ?? null,
      admin_email: t.admin_user_id ? adminEmailById[t.admin_user_id] ?? null : null,
      reason: t.reason ?? null,
      idempotency_key: t.idempotency_key ?? null,
      internal_reference: extractInternalReference(t.metadata),
      created_at: t.created_at,
    }))

    // === Reservations (read-only, recent) ===
    const { data: resvRows, error: resvErr } = await svc
      .from('wallet_reservations')
      .select('id, checkout_intent_id, amount_pence, status, expires_at, captured_at, released_at, release_reason, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(RESERVATIONS_LIMIT)
    if (resvErr) {
      console.error('[admin/wallets/detail] wallet_reservations error (non-fatal):', resvErr.message)
    }
    const reservations = (resvRows ?? []).map((r) => ({
      id: r.id,
      checkout_intent_id: r.checkout_intent_id ?? null,
      amount_pence: safeNonNegInt(r.amount_pence),
      status: r.status,
      expires_at: r.expires_at ?? null,
      captured_at: r.captured_at ?? null,
      released_at: r.released_at ?? null,
      release_reason: r.release_reason ?? null,
      created_at: r.created_at,
    }))

    // === Account status: purchase restriction (self-exclusion) ===
    // Read-only display flag via the same verified helper the checkout
    // enforcement uses. It fails closed (unknown => restricted), which for an
    // admin display errs toward showing "self-excluded" rather than masking a
    // real restriction.
    const restricted = await isUserPurchaseRestricted(svc, userId)

    return NextResponse.json(
      {
        ok: true,
        restricted,
        customer: {
          user_id: userId,
          name: customerName,
          email: email || '-',
          mobile: mobile || null,
        },
        balances: {
          balance_pence: balance,
          reserved_pence: reserved,
          available_pence: available,
        },
        transactions,
        transactionsPage: page,
        transactionsHasNext: hasNext,
        reservations,
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/wallets/detail] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'detail_failed' }, { status: 500, ...NO_STORE })
  }
}
