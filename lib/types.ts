// Mock types for UI scaffolding
export interface GiveawayPublic {
  slug: string
  title: string
  prizeTitle: string
  imageUrl: string
  ticketPrice: number
  endsAt: Date
  /** Canonical campaign statuses from DB. UI should not use "active"/"completed". */
  status: "draft" | "live" | "paused" | "ended"
  prizeValue?: string
  images?: string[]
  bundles?: { qty: number; price: number; label?: string }[]
  socialProof?: {
    entrantCountBucket: string
    recentAvatars: string[]
  }
  rulesText: string
  faqSnippet?: string
  ticketsSold?: number
  nextTicket?: number
  hardCapTotalTickets?: number
}

export interface WinnerSnapshot {
  name: string
  avatarUrl?: string
  prizeTitle: string
  giveawayTitle: string
  announcedAt: string
  giveawaySlug?: string
  quote?: string
  kind?: 'main' | 'instant'
  /**
   * Stable, unique per-row identity from `winners_feed.feed_id`
   * ('main:<uuid>' / 'instant:<uuid>'). Drives deterministic pagination and
   * client dedup. Optional because mock rows may not carry one.
   */
  feedId?: string | null
  /**
   * Optional fields populated defensively from the existing `winners_feed`
   * response only where already supplied. They are never invented.
   */
  fulfilmentType?: 'cash' | 'wallet_credit' | 'manual' | null
  prizeValuePence?: number | null
  prizeValueText?: string | null
  campaignFormat?: string | null
}

export interface Profile {
  name: string
  email: string
  avatarUrl?: string
  bio?: string
  publicVisible: boolean
}
