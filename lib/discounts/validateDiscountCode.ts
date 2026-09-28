import 'server-only'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  evaluateDiscount,
  normalizeDiscountCode,
  type DiscountResult,
  type DiscountCodeRow,
} from './discountCalc'

/**
 * Server-only discount-code validator.
 *
 * WHY SERVICE ROLE: `public.discount_codes` has RLS enabled with NO browser
 * policies — that is deliberate, so promotion codes can never be read (or
 * enumerated) directly from the browser. The RLS-scoped anon/authenticated
 * client therefore sees ZERO rows for every code, which would make every valid
 * discount fail as "invalid". Discount codes are global/campaign entities (not
 * user-owned rows), so the trusted server reads them with a service-role client
 * that bypasses RLS. This module imports `server-only`, so it can never be
 * bundled into a client component, and the service-role key never reaches the
 * browser. The calling route is responsible for authenticating the user.
 *
 * It receives ALREADY-AUTHORITATIVE values (campaign id + server-computed
 * subtotal). It never accepts a discount amount, type, scope or id from the
 * client — only the raw submitted code string. Every decision is delegated to
 * the pure `evaluateDiscount` logic, and raw database errors are never returned
 * to the caller (they surface as `discount_code_validation_failed`).
 */

/** Fresh service-role client per call (matches the existing repo pattern). */
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('missing_supabase_service_config')
  }
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

export async function validateDiscountCode(params: {
  campaignId: string
  subtotalPence: number
  submittedCode?: string | null
}): Promise<DiscountResult> {
  const { campaignId, subtotalPence, submittedCode } = params

  // No code supplied -> a valid "no discount" result (total = subtotal).
  const hasCode = typeof submittedCode === 'string' && submittedCode.trim().length > 0
  if (!hasCode) {
    if (!Number.isSafeInteger(subtotalPence) || subtotalPence <= 0) {
      return { ok: false, code: 'discount_code_invalid', status: 400 }
    }
    return { ok: true, discount: null, subtotalPence, totalPence: subtotalPence }
  }

  // Normalize + reject malformed input BEFORE querying the database.
  const normalized = normalizeDiscountCode(submittedCode)
  if (!normalized.ok) {
    return { ok: false, code: 'discount_code_invalid', status: 400 }
  }

  // Look up the code (stored normalized/uppercased) with the service-role client
  // so RLS does not silently hide it. An UNEXPECTED database error is a system
  // failure, not a bad code, so it surfaces as `discount_code_validation_failed`
  // (500) — never leaking the raw error and never mislabelling a real code as
  // invalid. A clean "no row" result is handled below as an unknown code.
  let row: DiscountCodeRow | null = null
  try {
    const supabase = getServiceSupabase()
    const { data, error } = await supabase
      .from('discount_codes')
      .select(
        'id, code, discount_type, discount_value, scope, campaign_id, is_active, starts_at, expires_at',
      )
      .eq('code', normalized.code)
      .maybeSingle()

    if (error) {
      console.error('[discounts] discount_codes lookup failed:', error.message)
      return { ok: false, code: 'discount_code_validation_failed', status: 500 }
    }

    row = (data as DiscountCodeRow | null) ?? null
  } catch (err) {
    console.error(
      '[discounts] discount validation threw:',
      err instanceof Error ? err.message : String(err),
    )
    return { ok: false, code: 'discount_code_validation_failed', status: 500 }
  }

  // A clean "not found" (null row, no error) is evaluated as an unknown code and
  // surfaces as `discount_code_invalid`, indistinguishable from a malformed one.
  return evaluateDiscount({
    row,
    campaignId,
    subtotalPence,
    now: new Date(),
  })
}
