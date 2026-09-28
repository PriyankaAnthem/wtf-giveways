import 'server-only'

/**
 * Stable, client-safe error code + message for a self-excluded / purchase-
 * restricted account. Server routes return these; the customer UI maps the code
 * to friendly copy (it never shows raw errors).
 */
export const ACCOUNT_SELF_EXCLUDED_ERROR = 'ACCOUNT_SELF_EXCLUDED' as const
export const ACCOUNT_SELF_EXCLUDED_MESSAGE =
  'Purchasing has been disabled on this account.' as const

/**
 * A minimal structural type for the Supabase clients used across our checkout
 * routes — both the RLS-scoped `@/lib/supabase/server` client and the
 * service-role client expose `.rpc(fn, params)`. We depend only on that method
 * so this helper works with either without importing a concrete client type.
 */
type RpcCapableClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
}

/**
 * FAIL-CLOSED POLICY.
 *
 * When the restriction status cannot be conclusively determined — a missing
 * userId, an RPC error (including "function does not exist"), or a result we
 * cannot read as a strict boolean — we treat the user as RESTRICTED.
 *
 * Rationale: this is a protective self-exclusion gate. A false "allowed" would
 * let a self-excluded customer start a NEW purchase (the exact harm we are
 * preventing), whereas a false "restricted" only blocks a NEW purchase and
 * never touches existing entries, winnings, wallet balance, transaction
 * history, or the ability to log in and view historical account information.
 *
 * OPERATIONAL CONSEQUENCE: because this fails closed, the database function
 * `public.is_user_purchase_restricted(uuid)` MUST exist before (or be deployed
 * together with) this code. If the function is absent every RPC call errors and
 * ALL new checkouts are blocked. See the completion report / section L.
 *
 * To switch to a fail-OPEN posture (allow on unknown), flip this single
 * constant to `false`.
 */
const RESTRICTED_WHEN_UNKNOWN = true

/**
 * Read a Postgres BOOLEAN scalar function result. Supabase may surface a scalar
 * RETURNS boolean directly (`true`), as a single-row array (`[true]`), or as an
 * object keyed by the function name (`{ is_user_purchase_restricted: true }`).
 * Anything else is treated as indeterminate.
 */
function readBooleanResult(data: unknown): boolean | null {
  const value = Array.isArray(data) ? data[0] : data
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>).is_user_purchase_restricted
    if (typeof nested === 'boolean') return nested
  }
  return null
}

/**
 * Returns TRUE when the customer's account is self-excluded / purchase-
 * restricted and must NOT be allowed to start a new purchase.
 *
 * Enforcement is SERVER-SIDE only and delegates entirely to the authoritative
 * database function `public.is_user_purchase_restricted(p_user_id uuid)` — this
 * helper NEVER decides the restriction itself, it only calls the contract and
 * normalises/guards the result. It never throws; on any failure it applies the
 * fail-closed policy above.
 *
 * @param supabase Any Supabase client exposing `.rpc` (RLS-scoped or service
 *   role). Callers pass whichever client that route already uses.
 * @param userId The account to check (`auth.users.id`).
 */
export async function isUserPurchaseRestricted(
  supabase: RpcCapableClient,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId || typeof userId !== 'string') {
    // No identifiable user → cannot verify → fail closed.
    return RESTRICTED_WHEN_UNKNOWN
  }

  try {
    const { data, error } = await supabase.rpc('is_user_purchase_restricted', {
      p_user_id: userId,
    })

    if (error) {
      console.error(
        '[account-restrictions] is_user_purchase_restricted RPC error:',
        error.message ?? error,
      )
      return RESTRICTED_WHEN_UNKNOWN
    }

    const parsed = readBooleanResult(data)
    if (parsed === null) {
      console.error(
        '[account-restrictions] is_user_purchase_restricted returned an unreadable result',
      )
      return RESTRICTED_WHEN_UNKNOWN
    }

    return parsed
  } catch (err) {
    console.error('[account-restrictions] is_user_purchase_restricted threw:', err)
    return RESTRICTED_WHEN_UNKNOWN
  }
}
