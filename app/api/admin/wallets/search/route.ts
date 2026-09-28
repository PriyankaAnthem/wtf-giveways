import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

// Admin wallet APIs must never be cached by shared/proxy caches.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_QUERY_LEN = 200
const MIN_QUERY_LEN = 3
const MAX_RESULTS = 25

// Control characters are rejected from every non-UUID query.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/

/** Coerce a DB integer into a finite, safe, non-negative integer (defensive). */
function safeNonNegInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return null
  return n
}

type SearchResult = {
  user_id: string
  customer_name: string
  email: string
  mobile: string | null
  balance_pence: number
  reserved_pence: number
  available_pence: number
}

export async function GET(request: NextRequest) {
  // Super Admins and Operations Admins. Hosts (ops) and read_only are rejected.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/wallets/search] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // === Request validation (before any RPC call) ===
  const { searchParams } = new URL(request.url)
  const rawQuery = searchParams.get('q')
  if (typeof rawQuery !== 'string') {
    return NextResponse.json({ ok: false, error: 'invalid_query' }, { status: 400, ...NO_STORE })
  }
  const q = rawQuery.trim()

  if (q.length === 0) {
    return NextResponse.json({ ok: true, results: [], notice: null }, NO_STORE)
  }
  if (q.length > MAX_QUERY_LEN) {
    return NextResponse.json({ ok: false, error: 'query_too_long' }, { status: 400, ...NO_STORE })
  }
  if (CONTROL_CHAR_RE.test(q)) {
    return NextResponse.json({ ok: false, error: 'invalid_query' }, { status: 400, ...NO_STORE })
  }
  // Exact UUIDs are always valid regardless of length. Every other query must
  // meet the minimum length before we hit the database.
  const isUuid = UUID_RE.test(q)
  if (!isUuid && q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ ok: false, error: 'query_too_short' }, { status: 400, ...NO_STORE })
  }

  try {
    // === Exactly ONE database round-trip: the production search RPC. ===
    const { data, error } = await svc.rpc('admin_search_wallet_users', {
      p_query: q,
      p_limit: MAX_RESULTS,
    })

    if (error) {
      // Never surface the raw RPC message to the client.
      const rawMessage = typeof error.message === 'string' ? error.message : ''
      console.error('[admin/wallets/search] RPC error:', rawMessage.slice(0, 300))

      if (rawMessage.includes('admin_wallet_search_invalid_query')) {
        return NextResponse.json({ ok: false, error: 'invalid_query' }, { status: 400, ...NO_STORE })
      }
      if (rawMessage.includes('admin_wallet_search_email_must_be_complete')) {
        return NextResponse.json({ ok: false, error: 'complete_email_required' }, { status: 400, ...NO_STORE })
      }
      if (rawMessage.includes('admin_wallet_search_not_authorized')) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, ...NO_STORE })
      }
      return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
    }

    // === RPC response validation. Treat `data` as fully untrusted. ===
    if (!Array.isArray(data)) {
      console.error('[admin/wallets/search] RPC returned a non-array payload')
      return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
    }
    if (data.length > MAX_RESULTS) {
      console.error('[admin/wallets/search] RPC returned more than MAX_RESULTS rows')
      return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
    }

    const results: SearchResult[] = []
    for (const row of data as unknown[]) {
      if (typeof row !== 'object' || row === null) {
        console.error('[admin/wallets/search] Malformed RPC row (not an object)')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }
      const r = row as Record<string, unknown>

      // user_id must be a UUID string.
      if (typeof r.user_id !== 'string' || !UUID_RE.test(r.user_id)) {
        console.error('[admin/wallets/search] Malformed RPC row (user_id)')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }
      // email / real_name / mobile must each be string or null.
      if (r.email !== null && typeof r.email !== 'string') {
        console.error('[admin/wallets/search] Malformed RPC row (email)')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }
      if (r.real_name !== null && typeof r.real_name !== 'string') {
        console.error('[admin/wallets/search] Malformed RPC row (real_name)')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }
      if (r.mobile !== null && typeof r.mobile !== 'string') {
        console.error('[admin/wallets/search] Malformed RPC row (mobile)')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }

      // Monetary fields must be finite, safe, non-negative integers.
      const balance = safeNonNegInt(r.balance_pence)
      const reserved = safeNonNegInt(r.reserved_pence)
      const available = safeNonNegInt(r.available_pence)
      if (balance === null || reserved === null || available === null) {
        console.error('[admin/wallets/search] Malformed RPC row (monetary field)')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }
      // available must equal max(balance - reserved, 0).
      if (available !== Math.max(balance - reserved, 0)) {
        console.error('[admin/wallets/search] RPC row failed available-pence invariant')
        return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
      }

      results.push({
        user_id: r.user_id,
        customer_name: (r.real_name as string | null) || 'Unknown',
        email: (r.email as string | null) || '-',
        mobile: (r.mobile as string | null) ?? null,
        balance_pence: balance,
        reserved_pence: reserved,
        available_pence: available,
      })
    }

    return NextResponse.json({ ok: true, results, notice: null }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/wallets/search] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'search_failed' }, { status: 500, ...NO_STORE })
  }
}
