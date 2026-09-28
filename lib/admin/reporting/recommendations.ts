/**
 * Growth Intelligence — deterministic recommendation engine.
 *
 * PURE module (no server / React / network imports) so it is shared by the API
 * route, client components and node tests. It turns the EXISTING, already
 * deployed get_admin_growth_dashboard() payload into at most a handful of
 * plain-English recommendations, each answering:
 *
 *   WHAT'S HAPPENING   -> headline
 *   WHY / EVIDENCE     -> detail (always backed by real numbers)
 *   WHAT SHOULD I DO   -> action
 *
 * Rules are 100% deterministic threshold checks over real figures. There is no
 * inference, no ML, no fabricated data. Anything that would require the (not yet
 * live) first-party traffic tables — visitors, visitor conversion,
 * revenue-per-visitor — is intentionally ABSENT here and must stay absent until
 * that data is flowing.
 */

import type { GrowthDashboardPayload, GrowthLiveCampaign } from './growth'
import { formatPence, formatCount } from './format'

export const MAX_RECOMMENDATIONS = 3

export type RecommendationKind = 'positive' | 'attention'

export interface GrowthRecommendation {
  /** Stable identifier for the rule that fired (used as React key + in tests). */
  id: string
  kind: RecommendationKind
  /** 0..100 ranking weight. Higher = surfaced first. */
  severity: number
  /** Short chip label, e.g. "Checkout issue". */
  status: string
  /** WHAT is happening. */
  headline: string
  /** WHY — always contains the supporting figures. */
  detail: string
  /** WHAT the owner should do about it. */
  action: string
}

// ---------------------------------------------------------------------------
// Tunable thresholds (exported so tests assert against the real numbers).
// ---------------------------------------------------------------------------
export const THRESHOLDS = {
  /** Ignore % swings unless the previous period had at least this many buyers. */
  minBuyersForTrend: 5,
  /** A material change in a customer metric (percentage points of change). */
  materialChangePct: 15,
  /** Checkout success below this (0..1) is flagged when volume is meaningful. */
  checkoutSuccessFloor: 0.85,
  /** Minimum completed attempts before checkout health is trustworthy. */
  minCompletedAttempts: 20,
  /** Abandonment rate (0..1) above this is flagged. */
  abandonmentCeiling: 0.35,
  /** Tickets in last 24h at/above this counts as real momentum. */
  strongMomentumTickets: 5,
  /** WTF Credit is "efficient" at or above this external-cash-per-£1 ratio. */
  walletLeverageStrong: 2,
  /** A live campaign selling this share is "nearly sold out" (don't push harder). */
  nearlySoldOutPct: 90,
  /** A live campaign below this share with zero 24h sales looks stalled. */
  stalledCeilingPct: 85,
} as const

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

/** Round to one decimal for display of a percentage-point / percent figure. */
function pct1(n: number): string {
  return `${n >= 0 ? '' : ''}${n.toFixed(1)}%`
}

/** Absolute magnitude of a possibly-null percentage change. */
function absChange(changePct: number | null | undefined): number {
  return changePct == null || !Number.isFinite(changePct) ? 0 : Math.abs(changePct)
}

/** Clamp a raw severity into the 0..100 ranking band. */
function clampSeverity(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** Pick the single most commercially interesting live campaign for a rule. */
function topBy(
  campaigns: GrowthLiveCampaign[],
  score: (c: GrowthLiveCampaign) => number,
): GrowthLiveCampaign | null {
  let best: GrowthLiveCampaign | null = null
  let bestScore = -Infinity
  for (const c of campaigns) {
    const s = score(c)
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Individual rules. Each returns a recommendation or null.
// ---------------------------------------------------------------------------

function ruleCheckoutHealth(p: GrowthDashboardPayload): GrowthRecommendation | null {
  const h = p.checkoutHealth
  if (h.successRate == null) return null
  if (h.completedAttempts < THRESHOLDS.minCompletedAttempts) return null
  if (h.successRate >= THRESHOLDS.checkoutSuccessFloor) return null

  const failedOrAbandoned = h.failed + h.abandoned
  const gap = (THRESHOLDS.checkoutSuccessFloor - h.successRate) * 100
  return {
    id: 'checkout_health',
    kind: 'attention',
    // Big weight: money is being lost at the last step.
    severity: clampSeverity(60 + gap * 1.5),
    status: 'Checkout issue',
    headline: 'Checkout completion needs attention',
    detail: `Only ${(h.successRate * 100).toFixed(1)}% of completed checkouts are succeeding — ${formatCount(failedOrAbandoned)} of ${formatCount(h.completedAttempts)} attempts failed or were abandoned.`,
    action:
      'Test the payment step end-to-end and check for provider errors before spending more on traffic — you are losing buyers you already attracted.',
  }
}

function ruleAbandonment(p: GrowthDashboardPayload): GrowthRecommendation | null {
  const h = p.checkoutHealth
  if (h.completedAttempts < THRESHOLDS.minCompletedAttempts) return null
  const abandonmentRate = h.completedAttempts > 0 ? h.abandoned / h.completedAttempts : 0
  if (abandonmentRate <= THRESHOLDS.abandonmentCeiling) return null

  return {
    id: 'abandonment',
    kind: 'attention',
    severity: clampSeverity(45 + abandonmentRate * 60),
    status: 'Drop-off',
    headline: 'High checkout abandonment',
    detail: `${(abandonmentRate * 100).toFixed(1)}% of completed checkouts were abandoned (${formatCount(h.abandoned)} of ${formatCount(h.completedAttempts)}).`,
    action:
      'Shorten the checkout, reassure on payment security, and consider a reminder to customers who leave items behind.',
  }
}

function ruleBuyersTrend(p: GrowthDashboardPayload): GrowthRecommendation | null {
  const m = p.customers.uniqueBuyers
  if (m.previous == null || m.previous < THRESHOLDS.minBuyersForTrend) return null
  const change = m.changePct
  if (change == null || absChange(change) < THRESHOLDS.materialChangePct) return null

  if (change < 0) {
    return {
      id: 'buyers_down',
      kind: 'attention',
      severity: clampSeverity(40 + absChange(change)),
      status: 'Buyers down',
      headline: 'Fewer customers are buying',
      detail: `Unique buyers are down ${pct1(change)} versus the previous period (${formatCount(m.current ?? 0)} vs ${formatCount(m.previous)}).`,
      action:
        'Check whether traffic or a key campaign has dropped off, and prioritise re-engaging recent customers.',
    }
  }
  return {
    id: 'buyers_up',
    kind: 'positive',
    severity: clampSeverity(25 + absChange(change) * 0.6),
    status: 'Growing',
    headline: 'Customer base is growing',
    detail: `Unique buyers are up ${pct1(change)} versus the previous period (${formatCount(m.current ?? 0)} vs ${formatCount(m.previous)}).`,
    action: 'Keep the current traffic and campaign mix running — it is working.',
  }
}

function ruleAov(p: GrowthDashboardPayload): GrowthRecommendation | null {
  const m = p.customers.averageOrderValuePence
  if (m.current == null || m.previous == null) return null
  const change = m.changePct
  if (change == null || absChange(change) < THRESHOLDS.materialChangePct) return null
  if (change >= 0) return null // only flag a falling basket as attention

  return {
    id: 'aov_down',
    kind: 'attention',
    severity: clampSeverity(30 + absChange(change) * 0.7),
    status: 'Basket down',
    headline: 'Average order value is falling',
    detail: `Average order value is down ${pct1(change)} versus the previous period (${formatPence(m.current)} vs ${formatPence(m.previous)}).`,
    action:
      'Review bundle sizes and ticket pricing, and consider promoting higher-value competitions.',
  }
}

function ruleCampaignMomentum(p: GrowthDashboardPayload): GrowthRecommendation | null {
  const strong = topBy(p.liveCampaigns, (c) =>
    c.ticketsLast24Hours >= THRESHOLDS.strongMomentumTickets &&
    (c.soldPercentage == null || c.soldPercentage < THRESHOLDS.nearlySoldOutPct)
      ? c.externalRevenueLast24HoursPence
      : -Infinity,
  )
  if (!strong || strong.externalRevenueLast24HoursPence <= 0) return null

  return {
    id: `campaign_strong:${strong.campaignId}`,
    kind: 'positive',
    severity: clampSeverity(30 + Math.min(30, strong.ticketsLast24Hours)),
    status: 'Performing strongly',
    headline: `${strong.title} is gaining momentum`,
    detail: `${formatPence(strong.externalRevenueLast24HoursPence)} external revenue and ${formatCount(strong.ticketsLast24Hours)} tickets in the last 24 hours${strong.soldPercentage != null ? `, at ${strong.soldPercentage.toFixed(0)}% sold` : ''}.`,
    action: 'Momentum is strong — keep promoting it. No discount recommended.',
  }
}

function ruleCampaignStalling(p: GrowthDashboardPayload): GrowthRecommendation | null {
  // A campaign with meaningful capacity sold but zero sales in the last 24h.
  const stalled = topBy(p.liveCampaigns, (c) => {
    const pctSold = c.soldPercentage ?? 0
    const eligible =
      c.ticketsLast24Hours === 0 &&
      pctSold >= 10 &&
      pctSold < THRESHOLDS.stalledCeilingPct &&
      c.lifetimeTicketsSold > 0
    return eligible ? pctSold : -Infinity
  })
  if (!stalled) return null

  return {
    id: `campaign_stalled:${stalled.campaignId}`,
    kind: 'attention',
    severity: clampSeverity(35 + (stalled.soldPercentage ?? 0) * 0.2),
    status: 'Stalling',
    headline: `${stalled.title} has stalled`,
    detail: `No tickets sold in the last 24 hours, with ${stalled.soldPercentage != null ? `${stalled.soldPercentage.toFixed(0)}% ` : ''}of tickets already gone.`,
    action:
      'Give it a promotional push (email/social) to rebuild momentum before the draw date pressure builds.',
  }
}

function ruleWalletLeverage(p: GrowthDashboardPayload): GrowthRecommendation | null {
  const w = p.walletImpact
  if (w.externalCashPerCreditPound == null) return null
  if (w.walletCreditRedeemedPence <= 0) return null
  if (w.externalCashPerCreditPound < THRESHOLDS.walletLeverageStrong) return null

  return {
    id: 'wallet_leverage',
    kind: 'positive',
    severity: clampSeverity(20 + Math.min(20, w.externalCashPerCreditPound * 4)),
    status: 'Credit working',
    headline: 'WTF Credit is driving external cash',
    detail: `Every £1 of WTF Credit redeemed is accompanying £${w.externalCashPerCreditPound.toFixed(2)} of external cash across ${formatCount(w.walletOrders)} wallet-assisted orders.`,
    action: 'WTF Credit is pulling its weight — safe to keep issuing it as a retention lever.',
  }
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

const RULES: ((p: GrowthDashboardPayload) => GrowthRecommendation | null)[] = [
  ruleCheckoutHealth,
  ruleAbandonment,
  ruleBuyersTrend,
  ruleAov,
  ruleCampaignStalling,
  ruleCampaignMomentum,
  ruleWalletLeverage,
]

/**
 * Evaluate every rule and return the fired recommendations, sorted by severity
 * (desc) then id (stable). Does NOT truncate — callers cap the display count.
 */
export function buildGrowthRecommendations(
  payload: GrowthDashboardPayload | null | undefined,
): GrowthRecommendation[] {
  if (!payload) return []
  const fired: GrowthRecommendation[] = []
  for (const rule of RULES) {
    const rec = rule(payload)
    if (rec) fired.push(rec)
  }
  return fired.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))
}

/** Convenience: the top `max` recommendations for display (default 3). */
export function selectTopRecommendations(
  payload: GrowthDashboardPayload | null | undefined,
  max: number = MAX_RECOMMENDATIONS,
): GrowthRecommendation[] {
  return buildGrowthRecommendations(payload).slice(0, Math.max(0, max))
}
