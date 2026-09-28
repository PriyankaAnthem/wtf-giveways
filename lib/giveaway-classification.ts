/**
 * Shared PUBLIC giveaway classification for the homepage and /giveaways.
 *
 * This is the SINGLE source of truth for splitting live giveaway snapshots into
 * customer-facing product categories. Both surfaces import from here so their
 * category logic can never drift. Classification runs on the server against the
 * already-fetched `list` snapshot payloads — it adds NO query, NO request, and
 * NO per-card detail fetch.
 */

export type GiveawayCategory = "live_balloon" | "instant_cash" | "other"

/**
 * Approved Balloon competition campaign slugs (exact casing preserved — routing
 * and matching are case-sensitive).
 *
 * Genuine balloon campaigns currently use MIXED `presentation_type` values
 * (some `balloon_pop`, some `instant_cash`), so `presentation_type` alone cannot
 * be trusted to detect balloons. This explicit slug allow-list is the trusted
 * fallback, mirroring the same approach already used on the winners feed. Titles
 * are NEVER used for classification.
 */
export const BALLOON_CAMPAIGN_SLUGS = [
  "salli3",
  "rosslizzy",
  "Salli2",
  "Salli",
  "ch8june",
  "grandballoon",
] as const

/** True when the campaign slug is in the approved balloon allow-list. */
function isBalloonSlug(slug: unknown): boolean {
  return typeof slug === "string" && (BALLOON_CAMPAIGN_SLUGS as readonly string[]).includes(slug)
}

/**
 * Classify a single `list` snapshot payload into a public category.
 *
 * Priority (a known balloon slug ALWAYS wins over presentation_type):
 *   1. LIVE BALLOON  — slug is in the balloon allow-list, OR presentation_type === "balloon_pop"
 *   2. INSTANT CASH  — presentation_type === "instant_cash" (and NOT already a balloon)
 *   3. OTHER         — null / unknown / unsupported presentation type and not a balloon slug
 *
 * We never label an unknown campaign as Instant Cash, and we never classify by title.
 */
export function classifyGiveaway(giveaway: any): GiveawayCategory {
  if (isBalloonSlug(giveaway?.slug) || giveaway?.presentation_type === "balloon_pop") {
    return "live_balloon"
  }
  if (giveaway?.presentation_type === "instant_cash") {
    return "instant_cash"
  }
  return "other"
}

/**
 * Sort within a category using ONLY existing snapshot fields:
 *   1. Soonest `ends_at` first (ascending). Campaigns without a usable closing
 *      time are placed AFTER those that have one.
 *   2. Tie-break by percentage sold descending (tickets_sold / hard_cap_total_tickets).
 *
 * Never sorts by snapshot `generated_at`; never uses popularity/revenue ranking.
 * Returns a new array (does not mutate the input).
 */
export function sortGiveaways<T extends Record<string, any>>(giveaways: T[]): T[] {
  const endMs = (g: any): number => {
    if (!g?.ends_at) return Number.POSITIVE_INFINITY
    const t = new Date(g.ends_at).getTime()
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }
  const percentSold = (g: any): number => {
    const sold = Number(g?.tickets_sold ?? 0)
    const cap = Number(g?.hard_cap_total_tickets ?? 0)
    return cap > 0 ? Math.min(100, (sold / cap) * 100) : 0
  }

  return [...giveaways].sort((a, b) => {
    const ea = endMs(a)
    const eb = endMs(b)
    if (ea !== eb) return ea - eb
    return percentSold(b) - percentSold(a)
  })
}

/**
 * Split an array of live snapshot payloads into the three public categories,
 * each already sorted with {@link sortGiveaways}. Single pass, no extra I/O.
 */
export function groupGiveawaysByCategory<T extends Record<string, any>>(
  giveaways: T[],
): { live_balloon: T[]; instant_cash: T[]; other: T[] } {
  const buckets: { live_balloon: T[]; instant_cash: T[]; other: T[] } = {
    live_balloon: [],
    instant_cash: [],
    other: [],
  }
  for (const g of giveaways) {
    buckets[classifyGiveaway(g)].push(g)
  }
  return {
    live_balloon: sortGiveaways(buckets.live_balloon),
    instant_cash: sortGiveaways(buckets.instant_cash),
    other: sortGiveaways(buckets.other),
  }
}
