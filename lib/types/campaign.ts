export type CampaignStatus = 'draft' | 'live' | 'paused' | 'ended'

/**
 * Presentation-only ticket reveal styles. These control ONLY how a customer
 * sees their already-decided checkout result — never allocation or win logic.
 * This list is the single source of truth for accepted `reveal_type` values
 * and mirrors the database `campaigns_reveal_type_check` constraint.
 */
export const REVEAL_TYPES = ['normal', 'scratch_card', 'treasure_chest', 'dg_football'] as const
export type RevealType = (typeof REVEAL_TYPES)[number]

/**
 * Coerce any value to a known reveal style. Missing, null, or unknown values
 * safely fall back to 'normal' so existing/legacy campaigns behave unchanged.
 */
export function normalizeRevealType(value: unknown): RevealType {
  return value === 'scratch_card' || value === 'treasure_chest' || value === 'dg_football'
    ? value
    : 'normal'
}

/**
 * How the MAIN/END-PRIZE winner (winner_records.placed = 1) is selected when a
 * campaign reaches its end condition (past end_at, or sold out).
 *
 *  - 'automatic': the draw worker calls draw_campaign_winner() and then ends
 *    the campaign. This is the historical behaviour and the default.
 *  - 'manual': the campaign is closed WITHOUT a main winner and an admin draws
 *    afterwards from the admin campaign screen.
 *
 * This has no effect whatsoever on instant wins, ticket allocation, or checkout.
 * Mirrors the database `campaigns_end_draw_mode_check` constraint.
 */
export const END_DRAW_MODES = ['automatic', 'manual'] as const
export type EndDrawMode = (typeof END_DRAW_MODES)[number]

/**
 * Coerce any value to a known draw mode. Missing, null, or unknown values fall
 * back to 'automatic' so existing/legacy campaigns behave exactly as before.
 */
export function normalizeEndDrawMode(value: unknown): EndDrawMode {
  return value === 'manual' ? 'manual' : 'automatic'
}

export interface Campaign {
  id: string
  status: CampaignStatus
  title: string
  slug: string
  summary: string
  description: string
  startAt: string
  endAt: string
  mainPrizeTitle: string
  mainPrizeDescription: string
  heroImageUrl: string
  ticketPricePence: number
  wasPricePence?: number | null
  maxTicketsTotal: number | null
  maxTicketsPerUser: number | null
  bundles?: { quantity: number; price_pence: number; label?: string }[] | null
  presentation_type?: 'balloon_pop' | 'instant_cash' | null
  reveal_type?: RevealType | null
  is_free_entry?: boolean
  free_entry_limit_per_user?: number
  end_draw_mode?: EndDrawMode
  /**
   * Optional promotional video (Video Phase 1). `promoVideoUrl` is the public
   * URL in the campaign-video bucket; `promoVideoDurationS` is the measured
   * clip length. Both null/absent = image-only campaign (unchanged behaviour).
   * The required `heroImageUrl` always remains the poster/fallback.
   */
  promoVideoUrl?: string | null
  promoVideoDurationS?: number | null
}
