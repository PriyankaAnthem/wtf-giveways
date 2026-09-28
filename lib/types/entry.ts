// Admin entry type - matches API response shape
export type AdminEntry = {
  id: string
  created_at: string
  user_id: string
  campaign_id: string
  giveaway_id: string | null
  qty: number
  checkout_ref: string | null
  checkout_state: string | null
  total_pence: number | null
  currency: string | null
  provider: string | null
  confirmed_at: string | null
  start_ticket: number | null
  end_ticket: number | null
  // Customer contact details
  customer_name: string
  customer_email: string
  customer_mobile: string
}

// Legacy types kept for compatibility if needed elsewhere
export type EntrySource = 'free' | 'paid'

export type EntryStatus = 'valid' | 'flagged' | 'refunded'

export type Entry = {
  id: string
  campaignId: string
  createdAt: string
  userLabel: string // masked, e.g. "user_***91"
  emailMasked: string // e.g. "b***@g***.com"
  source: EntrySource
  quantity: number // number of tickets purchased or 1 for free
  amountPaidPence: number // 0 for free
  status: EntryStatus
}

export type EntriesCampaignLite = {
  id: string
  title: string
  status: 'draft' | 'live' | 'paused' | 'ended'
}
