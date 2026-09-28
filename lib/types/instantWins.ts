export type InstantWinTier = 'small' | 'medium' | 'big'

export type InstantWinsOverviewStats = {
  inventoryRemaining: number
  topTierStatus: 'locked' | 'eligible'
  nextUnlock: string
  mainPrizeDrawAt: string
}

export type InstantWinsCampaignLite = {
  id: string
  title: string
  endAt: string
  status: 'draft' | 'live' | 'paused' | 'ended'
}

export type InstantWinPrize = {
  id: string
  campaignId: string
  name: string
  tier: InstantWinTier
  valueLabel: string
  totalQty: number
  remainingQty: number
  weight: number
  isActive: boolean
}

export type ReleaseRuleType = 'tickets_sold_percent' | 'time'

export type ReleaseRule = {
  id: string
  campaignId: string
  type: ReleaseRuleType
  thresholdLabel: string
  eligibleTiers: InstantWinTier[]
}

/** Fulfilment method for an instant-win prize. Chosen explicitly by the admin. */
export type InstantWinFulfilmentType = 'cash' | 'wallet_credit' | 'manual'

/** DB-aligned row from instant_win_prizes table */
export type InstantWinPrizeRow = {
  id: string
  campaign_id: string
  prize_title: string
  prize_value_text: string | null
  unlock_ratio: number
  image_url: string | null
  quantity: number
  is_high_value: boolean
  created_at: string
  /** Explicit fulfilment method. cash/wallet_credit require a positive amount. */
  fulfilment_type: InstantWinFulfilmentType
  /** Authoritative prize value in integer pence. Never parsed from the title. */
  prize_value_pence: number | null
}

export type InstantWinAttemptLog = {
  id: string
  campaignId: string
  createdAt: string
  userLabel: string
  eligibleSetHashShort: string
  outcome: 'won' | 'lost'
  prizeName?: string
  tier?: InstantWinTier
}

// Admin payout tracking type - matches API response shape
export type AdminInstantWinAward = {
  award_id: string
  awarded_at: string
  campaign_id: string
  /** Campaign title for the Campaign column (null when unavailable). */
  campaign_title: string | null
  /** Campaign slug for secondary context (null when unavailable). */
  campaign_slug: string | null
  giveaway_id: string | null
  prize_id: string
  prize_title: string
  checkout_intent_id: string
  checkout_ref: string
  user_id: string | null
  customer_name: string
  /** Public display name / TikTok username (secondary customer identity). */
  display_name: string | null
  customer_email: string
  customer_mobile: string
  start_ticket: number | null
  end_ticket: number | null
  winning_ticket: number | null
  payout_amount_pence: number | null
  is_paid: boolean
  paid_at: string | null
  payout_notes: string | null
}
