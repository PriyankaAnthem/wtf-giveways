import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isUserPurchaseRestricted } from '@/lib/account-restrictions'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeNonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return 0
  return n
}

/**
 * GET /api/admin/customers/[userId]
 *
 * Authoritative account header for the customer detail page. It reuses the same
 * verified restriction helper the checkout enforcement uses
 * (`isUserPurchaseRestricted`, fail-closed) so the detail view never relies on
 * a potentially stale list row for self-exclusion status.
 *
 * Deliberately LIGHTWEIGHT: it reads identity + wallet balances + restriction
 * only. It does NOT load wallet transaction history — the full ledger lives on
 * the dedicated wallet screen, and the purchase history has its own paginated
 * endpoint. Wallet mutation (Add Credit) is untouched and still goes through the
 * existing wallet credit API + AddCreditDialog.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
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

  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, ...NO_STORE })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/customers/detail] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    // === Identity (real_name handle + mobile) ===
    let realName: string | null = null
    let mobile: string | null = null
    const { data: profile, error: profErr } = await svc
      .from('profiles_private')
      .select('user_id, real_name, mobile')
      .eq('user_id', userId)
      .maybeSingle()
    if (profErr) {
      console.error('[admin/customers/detail] profiles_private error (non-fatal):', profErr.message)
    } else if (profile) {
      realName = profile.real_name || null
      mobile = profile.mobile || null
    }

    // === Email + joined date + genuine names from the auth admin API. ===
    // first_name / last_name / display_name are read from the EXISTING
    // raw_user_meta_data on the auth response — no schema access, no new query.
    let email: string | null = null
    let joined: string | null = null
    let firstName: string | null = null
    let lastName: string | null = null
    let displayName: string | null = null
    try {
      const { data: authData } = await svc.auth.admin.getUserById(userId)
      email = authData?.user?.email ?? null
      joined = authData?.user?.created_at ?? null
      const meta = (authData?.user?.user_metadata ?? {}) as Record<string, unknown>
      firstName = typeof meta.first_name === 'string' && meta.first_name.trim() ? meta.first_name.trim() : null
      lastName = typeof meta.last_name === 'string' && meta.last_name.trim() ? meta.last_name.trim() : null
      displayName = typeof meta.display_name === 'string' && meta.display_name.trim() ? meta.display_name.trim() : null
    } catch (e: any) {
      console.error('[admin/customers/detail] auth lookup error (non-fatal):', e?.message)
    }

    // === Wallet balances (read-only; missing row => zeros). ===
    let balance = 0
    let reserved = 0
    const { data: account, error: accErr } = await svc
      .from('wallet_accounts')
      .select('balance_pence, reserved_pence')
      .eq('user_id', userId)
      .maybeSingle()
    if (accErr) {
      console.error('[admin/customers/detail] wallet_accounts error (non-fatal):', accErr.message)
    } else if (account) {
      balance = safeNonNegInt(account.balance_pence)
      reserved = safeNonNegInt(account.reserved_pence)
    }
    const available = Math.max(balance - reserved, 0)

    // === Authoritative restriction status (fail-closed helper). ===
    const restricted = await isUserPurchaseRestricted(svc, userId)

    return NextResponse.json(
      {
        ok: true,
        restricted,
        customer: {
          user_id: userId,
          // Raw name parts; the UI resolves the primary display name via the
          // shared resolveCustomerName helper (same as the list).
          first_name: firstName,
          last_name: lastName,
          display_name: displayName,
          real_name: realName,
          email: email || null,
          mobile: mobile || null,
          joined,
        },
        balances: {
          balance_pence: balance,
          reserved_pence: reserved,
          available_pence: available,
        },
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/customers/detail] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'detail_failed' }, { status: 500, ...NO_STORE })
  }
}
