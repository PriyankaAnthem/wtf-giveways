/**
 * WTF Marketing Hub — Stage 2 shared types + PURE helpers.
 *
 * This module has NO server-only / React imports so it can be used by the API
 * route, the client components AND the node test environment. The payload shape
 * mirrors public.get_admin_marketing_audience_overview() in
 * scripts/marketing/004-marketing-audience-counts.sql (camelCase, aggregate
 * only, NO identity fields, NO customer rows).
 *
 * Nothing in this module can send email or mutate anything — it only shapes,
 * labels and formats aggregate counts.
 */

// ---------------------------------------------------------------------------
// Types (mirror the RPC payload exactly).
// ---------------------------------------------------------------------------

export interface MarketingProfileFreshness {
  profileCount: number
  backfillComplete: boolean
  backfillStartedAt: string | null
  lastSuccessAt: string | null
  lastIncrementalAt: string | null
  lastProcessedUsers: number
  stale: boolean
}

export interface MarketingAudienceHealth {
  totalProfiles: number
  currentlyEligible: number
  marketingEnabled: number
  activelySuppressed: number
  emailUnconfirmed: number
  inactiveAccounts: number
  customersWithOrders: number
  customersWithoutOrders: number
}

export interface AudienceCount {
  key: string
  matchedCount: number
  eligibleCount: number
}

export interface CreditAudienceCount extends AudienceCount {
  totalAvailableCreditPence: number
  eligibleAvailableCreditPence: number
}

export interface MarketingAudiences {
  recentBuyersNotToday: AudienceCount
  oneTimeBuyers: AudienceCount
  lapsed7Days: AudienceCount
  lapsed14Days: AudienceCount
  lapsed30Days: AudienceCount
  lapsed60Days: AudienceCount
  frequentBuyers: AudienceCount
  vipBuyers: AudienceCount
  highValueBuyers: AudienceCount
  customersWithCredit: CreditAudienceCount
  customersWithCredit5Plus: AudienceCount
  newAccountsWithoutPurchase: AudienceCount
  allEligibleBuyers: AudienceCount
  eligibleNonBuyers: AudienceCount
}

export interface MarketingAudienceOverview {
  generatedAt: string
  freshness: MarketingProfileFreshness
  health: MarketingAudienceHealth
  audiences: MarketingAudiences
}

// ---------------------------------------------------------------------------
// Audience catalogue metadata (friendly titles + plain-English definitions).
// The ORDER here is the display order of the full catalogue. Copy is
// intentionally non-technical: no SQL, no raw thresholds-as-code.
// ---------------------------------------------------------------------------

/** Keys of `MarketingAudiences`, used to iterate the catalogue type-safely. */
export type AudienceKey = keyof MarketingAudiences

export interface AudienceMeta {
  /** Object key on the audiences payload. */
  field: AudienceKey
  /** Stable snake_case identifier returned by the RPC (audience.key). */
  key: string
  title: string
  description: string
}

export const AUDIENCE_CATALOGUE: AudienceMeta[] = [
  {
    field: 'recentBuyersNotToday',
    key: 'recent_buyers_not_today',
    title: 'Recent buyers',
    description: 'Customers active in the last 7 days who have not purchased today.',
  },
  {
    field: 'oneTimeBuyers',
    key: 'one_time_buyers',
    title: 'One-time buyers',
    description: 'Customers who bought once but have not returned.',
  },
  {
    field: 'lapsed7Days',
    key: 'lapsed_7_days',
    title: 'Lapsed 7+ days',
    description: 'Previous customers with no purchase for at least 7 days.',
  },
  {
    field: 'lapsed14Days',
    key: 'lapsed_14_days',
    title: 'Lapsed 14+ days',
    description: 'Previous customers with no purchase for at least 14 days.',
  },
  {
    field: 'lapsed30Days',
    key: 'lapsed_30_days',
    title: 'Lapsed 30+ days',
    description: 'Customers whose last purchase was over 30 days ago.',
  },
  {
    field: 'lapsed60Days',
    key: 'lapsed_60_days',
    title: 'Lapsed 60+ days',
    description: 'Customers whose last purchase was over 60 days ago.',
  },
  {
    field: 'frequentBuyers',
    key: 'frequent_buyers',
    title: 'Frequent buyers',
    description: 'Customers with 5 or more orders.',
  },
  {
    field: 'vipBuyers',
    key: 'vip_buyers',
    title: 'VIP buyers',
    description: 'Customers with 10+ orders or at least £250 external spend.',
  },
  {
    field: 'highValueBuyers',
    key: 'high_value_buyers',
    title: 'High-value buyers',
    description: 'Customers who have spent at least £100 externally.',
  },
  {
    field: 'customersWithCredit',
    key: 'customers_with_credit',
    title: 'Customers with WTF Credit',
    description: 'Customers with WTF Credit available to spend.',
  },
  {
    field: 'customersWithCredit5Plus',
    key: 'customers_with_credit_5_plus',
    title: 'Customers with £5+ WTF Credit',
    description: 'Customers with at least £5 of WTF Credit available.',
  },
  {
    field: 'newAccountsWithoutPurchase',
    key: 'new_accounts_without_purchase',
    title: 'New accounts, no purchase',
    description: 'Accounts created in the last 7 days that have not bought yet.',
  },
  {
    field: 'allEligibleBuyers',
    key: 'all_eligible_buyers',
    title: 'Eligible buyers',
    description: 'Previous customers currently eligible to receive marketing.',
  },
  {
    field: 'eligibleNonBuyers',
    key: 'eligible_non_buyers',
    title: 'Eligible non-buyers',
    description: 'Registered customers with no orders who are eligible for marketing.',
  },
]

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * Staleness rule (mirrors the SQL): stale when there has never been a
 * successful refresh, or the last success is more than 15 minutes old. The RPC
 * already computes `stale`; this pure copy exists so the client can re-derive /
 * test the rule without trusting a single field.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000

export function isFreshnessStale(
  lastSuccessAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSuccessAt) return true
  const t = Date.parse(lastSuccessAt)
  if (!Number.isFinite(t)) return true
  return nowMs - t > STALE_AFTER_MS
}

/** Format integer pence as GBP, e.g. 12345 -> "£123.45". Null/invalid -> "£0.00". */
export function formatCreditPence(pence: number | null | undefined): string {
  const n = typeof pence === 'number' && Number.isFinite(pence) ? pence : 0
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100)
}

/** Whole-number formatter with thousands separators. */
export function formatCount(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(v)
}

/**
 * Type guard for the credit audience so the UI can render the two extra credit
 * sums without an unsafe cast.
 */
export function isCreditAudience(a: AudienceCount): a is CreditAudienceCount {
  return (
    typeof (a as CreditAudienceCount).totalAvailableCreditPence === 'number' &&
    typeof (a as CreditAudienceCount).eligibleAvailableCreditPence === 'number'
  )
}

// ---------------------------------------------------------------------------
// Data-fetching contract (shared by client + tests). Exactly ONE endpoint,
// fetched once when the Marketing page opens; no polling.
// ---------------------------------------------------------------------------

export const MARKETING_AUDIENCES_ENDPOINT = '/api/admin/marketing/audiences'

/**
 * SWR key. Returns the endpoint only when `active`, so no request is ever made
 * from any other admin page or before the Marketing page decides to load.
 */
export function marketingAudiencesSwrKey(active: boolean): string | null {
  return active ? MARKETING_AUDIENCES_ENDPOINT : null
}

// ---------------------------------------------------------------------------
// Privacy guard. The payload must never carry a customer identity. This is a
// defensive deep-scan used by the server before responding AND by tests.
// ---------------------------------------------------------------------------

const FORBIDDEN_IDENTITY_KEYS = [
  'user_id',
  'userId',
  'user_ids',
  'userIds',
  'email',
  'email_lc',
  'emailLc',
  'name',
  'full_name',
  'fullName',
  'first_name',
  'last_name',
  'phone',
]

/**
 * Deep-scan an arbitrary payload for forbidden identity keys. Returns the list
 * of offending key paths (empty when clean).
 */
export function findIdentityFields(value: unknown, path = ''): string[] {
  const hits: string[] = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findIdentityFields(v, `${path}[${i}]`)))
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_IDENTITY_KEYS.includes(key)) {
        hits.push(path ? `${path}.${key}` : key)
      }
      hits.push(...findIdentityFields(v, path ? `${path}.${key}` : key))
    }
  }
  return hits
}
