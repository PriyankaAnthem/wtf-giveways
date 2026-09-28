/**
 * Minimal shape of the Supabase query chain this helper depends on. The snapshot
 * writers build service-role clients inline whose `SupabaseClient<...>` generic
 * arguments (schema, PostgrestVersion, etc.) are constrained in a way that makes
 * the concrete client not assignable to a plain `SupabaseClient` reference.
 * Matching the codebase's existing convention for these writers (which cast rows
 * to `any`), we type the client loosely here; the helper's RETURN value stays
 * fully typed via `CampaignAwardCounts`.
 */
type AwardQueryClient = {
  from: (table: string) => any
}

/**
 * Shared, server-only helper for loading instant-win award counts used by the
 * giveaway snapshot writers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase / PostgREST caps a single `select` at a default maximum number of
 * rows (1,000 on this project). The snapshot writers previously did:
 *
 *     const { data: awards } = await supabase
 *       .from('instant_win_awards')
 *       .select('prize_id')
 *       .eq('campaign_id', campaignId)
 *
 * For a campaign such as "Every Ticket Wins" with 10,000 award rows, only the
 * first 1,000 came back, so `awarded_count` was computed from an incomplete
 * subset and the public snapshot under-counted awards (e.g. showed prizes as
 * still available when they were fully awarded).
 *
 * This helper fetches EVERY matching award row using explicit, deterministic
 * pagination and aggregates the complete result by `prize_id`. It NEVER treats
 * a failed query as "zero awards" — any Supabase error is thrown so the caller
 * can fail closed and avoid overwriting a valid snapshot with incomplete data.
 *
 * This is a read-only aggregation. It does not create, modify, or delete any
 * award, slot, prize, or snapshot row.
 */

/** PostgREST default row cap on this project. Never page larger than this. */
export const AWARD_PAGE_SIZE = 1000

export interface CampaignAwardCounts {
  /** Complete award count per prize id (only prizes with >= 1 award appear). */
  awardCountByPrize: Record<string, number>
  /** Total award rows loaded across all pages (for logging / verification). */
  totalAwards: number
  /** Number of paginated requests issued (for logging / verification). */
  pageCount: number
  /** Number of distinct prize ids that received at least one award. */
  prizeIdCount: number
}

/**
 * Load ALL `instant_win_awards` rows for a campaign and aggregate by prize id.
 *
 * @param supabase   A Supabase client (the snapshot writers pass a service-role
 *                   client). Only `.from().select().eq().order().range()` is used.
 * @param campaignId The campaign whose awards should be counted.
 * @param options.pageSize Optional page size; clamped to `1..AWARD_PAGE_SIZE`.
 *
 * @throws If any page returns a Supabase error. Callers MUST let this propagate
 *         (or handle it) rather than writing a snapshot with partial counts.
 */
export async function loadCampaignAwardCounts(
  supabase: AwardQueryClient,
  campaignId: string,
  options?: { pageSize?: number },
): Promise<CampaignAwardCounts> {
  // Clamp the page size into a sane range. Never exceed the PostgREST cap,
  // and never allow a zero/negative page size that would loop forever.
  const requested = options?.pageSize ?? AWARD_PAGE_SIZE
  const pageSize = Math.max(1, Math.min(AWARD_PAGE_SIZE, Math.floor(requested)))

  const awardCountByPrize: Record<string, number> = {}
  let totalAwards = 0
  let pageCount = 0

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1 // .range() indexes are inclusive on both ends

    const { data, error } = await supabase
      .from('instant_win_awards')
      .select('id, prize_id')
      // Deterministic ordering on a unique, stable column guarantees that
      // successive pages never overlap or skip rows at page boundaries.
      .order('id', { ascending: true })
      .eq('campaign_id', campaignId)
      .range(from, to)

    pageCount += 1

    if (error) {
      throw new Error(
        `[giveaway-snapshot-awards] Failed to load instant-win awards for campaign ${campaignId}, range ${from}-${to}: ${error.message}`,
      )
    }

    const rows = data ?? []

    for (const row of rows) {
      // Awards should always carry a prize_id, but guard defensively so a
      // stray null cannot become the string "null" bucket.
      if (!row.prize_id) continue
      awardCountByPrize[row.prize_id] = (awardCountByPrize[row.prize_id] ?? 0) + 1
      totalAwards += 1
    }

    // A short (or empty) page means we've reached the end of the result set.
    if (rows.length < pageSize) break
  }

  return {
    awardCountByPrize,
    totalAwards,
    pageCount,
    prizeIdCount: Object.keys(awardCountByPrize).length,
  }
}
