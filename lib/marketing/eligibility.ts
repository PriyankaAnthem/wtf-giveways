import 'server-only'
import { getMarketingServiceClient, normalizeEmail } from './service'

/**
 * Shared marketing eligibility helper for FUTURE marketing jobs.
 *
 * It answers exactly one question — "may this user receive a MARKETING email?"
 * — by calling the is_marketing_email_eligible RPC once and returning a boolean.
 * It fails CLOSED to false on any error.
 *
 * IMPORTANT — transactional email is OUTSIDE marketing suppression.
 * Order confirmations, instant-win notifications, password resets and other
 * transactional messages are NOT gated by this helper and must never call it.
 * Marketing suppression (unsubscribe / bounce / complaint / manual / invalid)
 * only governs marketing campaigns.
 *
 * Constraints (enforced by convention + `server-only`):
 *   - Never import this into a client component.
 *   - Never call it from checkout or any public page.
 */
export async function isMarketingEmailEligible(
  userId: string,
  emailLc: string,
): Promise<boolean> {
  try {
    const supabase = getMarketingServiceClient()
    const { data, error } = await supabase.rpc('is_marketing_email_eligible', {
      p_user_id: userId,
      p_email_lc: normalizeEmail(emailLc),
    })
    if (error) {
      // Fail closed — never treat an error as "eligible".
      console.error('[marketing] eligibility check failed:', error.message)
      return false
    }
    return data === true
  } catch (err) {
    console.error(
      '[marketing] eligibility check threw:',
      err instanceof Error ? err.message : 'unknown_error',
    )
    return false
  }
}
