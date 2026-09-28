import 'server-only'

/**
 * Downstream snapshot refresh that must run after a main/end-prize winner is
 * resolved, or after a campaign is closed.
 *
 * Extracted verbatim from the existing behaviour in
 * `app/api/jobs/run-draws/route.ts` so the automatic worker and the admin
 * manual-draw endpoint stay identical: a manually drawn winner appears in
 * exactly the same places as an automatically drawn one.
 *
 * Deliberately cheap and failure-tolerant:
 *   - both calls are best-effort; a failure is returned as a string for the
 *     caller's error summary and never thrown.
 *   - no customer-facing page work happens here. These endpoints regenerate the
 *     pre-computed `giveaway_snapshots` / winner snapshots the customer pages
 *     already read, so no new per-request aggregation is introduced.
 */
export async function refreshWinnerDownstream(
  baseUrl: string,
  token: string | undefined,
  label: string,
): Promise<string[]> {
  const errors: string[] = []
  const qs = token ? `?token=${encodeURIComponent(token)}` : ''

  try {
    await fetch(`${baseUrl}/api/jobs/refresh-winner-snapshots${qs}`)
  } catch (e: any) {
    errors.push(`${label}: winner snapshot refresh failed - ${e?.message}`)
  }

  try {
    await fetch(`${baseUrl}/api/jobs/run${qs}`)
  } catch (e: any) {
    errors.push(`${label}: giveaway snapshot refresh failed - ${e?.message}`)
  }

  return errors
}
