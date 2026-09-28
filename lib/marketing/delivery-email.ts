import 'server-only'
import {
  renderWtfEmailShell,
  renderWtfEmailText,
  WTF_SITE_URL,
  type WtfEmailContent,
  type WtfEmailLayout,
} from './email-shell'
import { formatMarketingPence, formatMarketingCount } from './money'

/**
 * WTF Marketing — Stage 029 SAFE EMAIL RENDERER (isolated infrastructure).
 *
 * Consumes the ALREADY-PREPARED Version-1 snapshots frozen by the earlier
 * preparation stage and renders them into safe HTML + plain text suitable for
 * marketing delivery. It performs NO placeholder substitution (that happened
 * during preparation), NO database access, and mints NO unsubscribe token — the
 * caller must pass an already-created `unsubscribeUrl`.
 *
 * Trust posture: FAIL CLOSED. Even though SQL validated these snapshots earlier,
 * this module re-validates every field in TypeScript and rejects anything that
 * looks unprepared, malformed, or unsafe. Presentation is delegated to the
 * reusable branded shell (./email-shell), which HTML-escapes every dynamic value
 * again before interpolation and treats `bodyText` as TEXT (newlines become
 * <br /> only AFTER escaping). There is no dangerouslySetInnerHTML and no
 * raw-HTML template support anywhere in either module.
 *
 * This module is deliberately UNREFERENCED by production runtime after Stage 029
 * (only the provider adapter, the admin preview renderer, and tests import it).
 */

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface MarketingTemplateSnapshotV1 {
  schemaVersion: 1
  templateKey: string
  templateVersion: number
  subject: string
  previewText: string | null
  heading: string
  bodyText: string
  ctaLabel: string
}

export interface MarketingCampaignContextV1 {
  title: string
  url: string
}

export interface MarketingContextSnapshotV1 {
  schemaVersion: 1
  opportunityType: string
  /**
   * Present ONLY for campaign-specific opportunity types. Null for non-campaign
   * types (WTF Credit, new-account welcome, lapsed), whose context is frozen by
   * preparation as `{ schemaVersion, opportunityType }` with no campaign block.
   */
  campaign: MarketingCampaignContextV1 | null
}

// ---------------------------------------------------------------------------
// Stage 043 — VERSION-2 snapshot contract (commercial extension)
//
// V2 is a MINIMAL, ADDITIVE superset of V1. It carries the SAME identity-free
// shape plus frozen COMMERCIAL FACTS so the SAME renderer can show real ticket
// price, remaining tickets, remaining instant wins / values and the customer's
// available WTF credit. Every commercial field is nullable and MUST be null when
// the underlying value is unavailable or untrustworthy (fail closed — never a
// zero-implies-known). No PII is added: no name, email, user id, losing history,
// near misses, gambling behaviour, vouchers or AI decisions.
// ---------------------------------------------------------------------------

export interface MarketingCampaignContextV2 {
  title: string
  url: string
  /** Frozen campaign artwork URL (http/https) or null when unavailable. */
  imageUrl: string | null
  /** Entry price in integer pence, or null. */
  ticketPricePence: number | null
  /** Total ticket allocation, or null when the campaign has no fixed cap. */
  ticketsTotal: number | null
  /** Tickets sold so far, or null when the counter row is missing (fail closed). */
  ticketsSold: number | null
  /** Tickets remaining, or null unless a cap AND counter are both known. */
  ticketsRemaining: number | null
  /** Campaign end timestamp (ISO string) or null. Display-only; never parsed for logic. */
  endAt: string | null
  /** Count of genuinely remaining instant-win slots, or null. */
  instantWinsRemaining: number | null
  /**
   * Total value (integer pence) of genuinely remaining instant prizes, or null.
   * MUST be null if ANY genuinely remaining slot has an unknown value.
   */
  remainingInstantPrizeValuePence: number | null
  /**
   * Highest remaining instant prize (integer pence), or null. MUST be null under
   * the same trustworthiness rule as the total.
   */
  highestRemainingInstantPrizePence: number | null
}

export interface MarketingCustomerValueV2 {
  /** Available WTF credit in integer pence (balance - reserved, floored at 0), or null. */
  walletCreditPence: number | null
}

export interface MarketingContextSnapshotV2 {
  schemaVersion: 2
  opportunityType: string
  /** Campaign block for campaign-specific types; null for non-campaign types. */
  campaign: MarketingCampaignContextV2 | null
  /** Customer commercial value (currently just wallet credit); null when absent. */
  customerValue: MarketingCustomerValueV2 | null
}

/** The union of every supported prepared context snapshot version. */
export type MarketingContextSnapshot = MarketingContextSnapshotV1 | MarketingContextSnapshotV2

export interface RenderMarketingEmailInput {
  templateSnapshot: unknown
  contextSnapshot: unknown
  unsubscribeUrl: unknown
}

export interface RenderedMarketingEmail {
  subject: string
  html: string
  text: string
  templateKey: string
  templateVersion: number
  opportunityType: string
}

/**
 * Thrown for ANY invalid/unsafe render input. Carries a bounded, safe,
 * machine-readable `code` (never customer data). The provider adapter converts
 * any thrown render error into the single non-retryable code
 * `marketing_render_invalid`, so these codes are for diagnostics/tests only.
 */
export class MarketingRenderError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'MarketingRenderError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Opportunity-type presentation (data-driven; keyed by opportunity type only)
// ---------------------------------------------------------------------------

/**
 * Per-opportunity-type presentation config. This is BRAND CHROME keyed on the
 * opportunity type (which is data, from the frozen snapshot) — never on any
 * customer string. The conversion copy itself (subject/heading/body/ctaLabel)
 * always comes from the frozen template snapshot; only the eyebrow kicker and
 * the trust strip vary here so each of the six emails reads distinctly.
 */
interface OpportunityPresentation {
  eyebrow: string | null
  trustItems: readonly string[]
}

/**
 * The three CAMPAIGN-SPECIFIC opportunity types (authoritative:
 * marketing_opportunity_definitions.campaign_specific = true in script 009).
 * These carry a frozen `campaign {title,url}` and the CTA points at that URL.
 */
const CAMPAIGN_SPECIFIC_OPPORTUNITY_TYPES: ReadonlySet<string> = new Set([
  'abandoned_checkout',
  'vip_early_access',
  'regular_buyer_campaign_alert',
])

/**
 * The three NON-campaign opportunity types (campaign_specific = false). Their
 * context has no campaign, so the CTA is resolved to a fixed, brand-owned public
 * destination — the live competitions listing.
 */
const NON_CAMPAIGN_CTA_URL: Readonly<Record<string, string>> = {
  wtf_credit_waiting: `${WTF_SITE_URL}/giveaways`,
  new_account_no_purchase: `${WTF_SITE_URL}/giveaways`,
  lapsed_14_days: `${WTF_SITE_URL}/giveaways`,
}

/**
 * The complete set of opportunity types this renderer supports in production:
 * the three campaign-specific plus the three known non-campaign types. There is
 * NO catch-all fallback — any type outside this set FAILS CLOSED
 * (`unsupported_opportunity_type`) rather than rendering to a generic homepage.
 */
const SUPPORTED_OPPORTUNITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...CAMPAIGN_SPECIFIC_OPPORTUNITY_TYPES,
  ...Object.keys(NON_CAMPAIGN_CTA_URL),
])

const OPPORTUNITY_PRESENTATION: Readonly<Record<string, OpportunityPresentation>> = {
  abandoned_checkout: {
    eyebrow: 'STILL LIVE',
    trustItems: ['Secure checkout', 'Instant confirmation', 'Live competitions'],
  },
  vip_early_access: {
    eyebrow: 'VIP EARLY ACCESS',
    trustItems: ['VIP window open', 'Enter before public', 'Live competitions'],
  },
  regular_buyer_campaign_alert: {
    eyebrow: 'JUST LANDED',
    trustItems: ['Just went live', 'Secure checkout', 'Instant confirmation'],
  },
  wtf_credit_waiting: {
    eyebrow: 'CREDIT WAITING',
    trustItems: ['Credit ready to use', 'Spend anytime', 'Live competitions'],
  },
  new_account_no_purchase: {
    eyebrow: 'WELCOME TO WTF',
    trustItems: ['Quick to enter', 'Secure checkout', 'Live competitions'],
  },
  lapsed_14_days: {
    eyebrow: "WHAT'S NEW?",
    trustItems: ['Fresh competitions', 'Secure checkout', 'Live now'],
  },
}

/**
 * DETERMINISTIC body-layout selection, keyed ONLY on the opportunity type. This
 * is the single source of truth for "which composition does this email use".
 * No layout HTML lives in the DB and template copy never controls structure.
 * Any type outside this map FAILS CLOSED (defence in depth; validateContext-
 * Snapshot already rejects unsupported types upstream).
 */
const LAYOUT_BY_OPPORTUNITY: Readonly<Record<string, WtfEmailLayout>> = {
  abandoned_checkout: 'return_to_comp',
  vip_early_access: 'vip_pass',
  regular_buyer_campaign_alert: 'new_drop',
  wtf_credit_waiting: 'wallet_credit',
  new_account_no_purchase: 'welcome_onboarding',
  lapsed_14_days: 'comeback_whatsnew',
}

/**
 * Resolve the deterministic email body layout for an opportunity type. Throws
 * (fail closed) for anything unsupported. Exported for tests that assert the
 * exact layout variant selected per opportunity type.
 */
export function resolveEmailLayout(opportunityType: string): WtfEmailLayout {
  const layout = LAYOUT_BY_OPPORTUNITY[opportunityType]
  if (!layout) {
    throw new MarketingRenderError('unsupported_opportunity_type')
  }
  return layout
}

function isSupportedOpportunityType(opportunityType: string): boolean {
  return SUPPORTED_OPPORTUNITY_TYPES.has(opportunityType)
}

function isCampaignSpecificType(opportunityType: string): boolean {
  return CAMPAIGN_SPECIFIC_OPPORTUNITY_TYPES.has(opportunityType)
}

/**
 * Resolve the fixed CTA for a KNOWN non-campaign type. Never falls back to the
 * homepage: an unmapped type throws (fail closed). In practice
 * validateContextSnapshot has already rejected unsupported types before this is
 * reached, so this is defence in depth.
 */
function resolveNonCampaignCtaUrl(opportunityType: string): string {
  const url = NON_CAMPAIGN_CTA_URL[opportunityType]
  if (!url) {
    throw new MarketingRenderError('unsupported_opportunity_type')
  }
  return url
}

/** Presentation for a supported type; throws for anything else (fail closed). */
function presentationFor(opportunityType: string): OpportunityPresentation {
  const presentation = OPPORTUNITY_PRESENTATION[opportunityType]
  if (!presentation) {
    throw new MarketingRenderError('unsupported_opportunity_type')
  }
  return presentation
}

// ---------------------------------------------------------------------------
// Validation helpers (pure, fail-closed)
// ---------------------------------------------------------------------------

const UNRESOLVED_OPEN = '{{'
const UNRESOLVED_CLOSE = '}}'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject content that still contains an unresolved placeholder delimiter. */
function assertResolved(value: string, field: string): void {
  if (value.includes(UNRESOLVED_OPEN) || value.includes(UNRESOLVED_CLOSE)) {
    throw new MarketingRenderError(`unresolved_placeholder_${field}`)
  }
}

/** Required non-empty string, trimmed length capped, and fully resolved. */
function requiredResolvedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new MarketingRenderError(`invalid_${field}`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new MarketingRenderError(`empty_${field}`)
  }
  if (trimmed.length > max) {
    throw new MarketingRenderError(`too_long_${field}`)
  }
  assertResolved(trimmed, field)
  return trimmed
}

/** Optional (null/undefined) or a resolved string within the length cap. */
function optionalResolvedString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new MarketingRenderError(`invalid_${field}`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) {
    throw new MarketingRenderError(`too_long_${field}`)
  }
  assertResolved(trimmed, field)
  return trimmed
}

/** Parse + require an http(s) URL. Rejects javascript:, data:, etc. */
function requiredHttpUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MarketingRenderError(`invalid_${field}`)
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new MarketingRenderError(`invalid_${field}_url`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MarketingRenderError(`unsafe_${field}_protocol`)
  }
  return parsed.toString()
}

/** Optional http(s) URL: null/undefined => null; anything malformed FAILS closed. */
function optionalHttpUrl(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return requiredHttpUrl(value, field)
}

/**
 * Optional NON-NEGATIVE INTEGER (pence or count): null/undefined => null. A
 * present value MUST be a finite, integer, >= 0 number; anything else FAILS
 * closed. Never coerces a bad value to zero — that is the caller's fail-closed
 * contract (a missing/untrustworthy value must arrive as null, not 0).
 */
function optionalNonNegativeInt(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new MarketingRenderError(`invalid_${field}`)
  }
  return value
}

// ---------------------------------------------------------------------------
// Snapshot validation
// ---------------------------------------------------------------------------

function validateTemplateSnapshot(input: unknown): MarketingTemplateSnapshotV1 {
  if (!isPlainObject(input)) {
    throw new MarketingRenderError('template_snapshot_not_object')
  }
  if (input.schemaVersion !== 1) {
    throw new MarketingRenderError('template_schema_version_invalid')
  }
  const version = input.templateVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MarketingRenderError('template_version_invalid')
  }
  const templateKey = requiredResolvedString(input.templateKey, 'template_key', 100)
  const subject = requiredResolvedString(input.subject, 'subject', 300)
  const previewText = optionalResolvedString(input.previewText, 'preview_text', 300)
  const heading = requiredResolvedString(input.heading, 'heading', 300)
  const bodyText = requiredResolvedString(input.bodyText, 'body_text', 5000)
  const ctaLabel = requiredResolvedString(input.ctaLabel, 'cta_label', 100)

  return {
    schemaVersion: 1,
    templateKey,
    templateVersion: version,
    subject,
    previewText,
    heading,
    bodyText,
    ctaLabel,
  }
}

function validateContextSnapshot(input: unknown): MarketingContextSnapshot {
  if (!isPlainObject(input)) {
    throw new MarketingRenderError('context_snapshot_not_object')
  }
  // FAIL CLOSED on any schema version other than the two we support.
  if (input.schemaVersion === 1) {
    return validateContextSnapshotV1(input)
  }
  if (input.schemaVersion === 2) {
    return validateContextSnapshotV2(input)
  }
  throw new MarketingRenderError('context_schema_version_invalid')
}

function validateContextSnapshotV1(input: Record<string, unknown>): MarketingContextSnapshotV1 {
  const opportunityType = requiredResolvedString(input.opportunityType, 'opportunity_type', 100)

  // FAIL CLOSED on any opportunity type outside the six supported production
  // types. There is no homepage fallback: an unknown type is never rendered.
  if (!isSupportedOpportunityType(opportunityType)) {
    throw new MarketingRenderError('unsupported_opportunity_type')
  }

  // Campaign-specific types MUST carry a valid campaign block (fail closed);
  // non-campaign types MUST NOT — their context is frozen with no campaign.
  if (isCampaignSpecificType(opportunityType)) {
    const campaign = input.campaign
    if (!isPlainObject(campaign)) {
      throw new MarketingRenderError('campaign_missing')
    }
    const title = requiredResolvedString(campaign.title, 'campaign_title', 300)
    const url = requiredHttpUrl(campaign.url, 'campaign')
    return {
      schemaVersion: 1,
      opportunityType,
      campaign: { title, url },
    }
  }

  // Non-campaign: reject a stray campaign block so a mismatched snapshot cannot
  // slip a campaign into a non-campaign email (fail closed).
  if (input.campaign !== undefined && input.campaign !== null) {
    throw new MarketingRenderError('unexpected_campaign_for_non_campaign_type')
  }

  return {
    schemaVersion: 1,
    opportunityType,
    campaign: null,
  }
}

/**
 * Validate a VERSION-2 context snapshot (Stage 043). Reuses EXACTLY the same
 * opportunity-type + campaign-presence rules as V1 (fail closed on unsupported
 * types, campaign required for campaign-specific types, forbidden otherwise),
 * then validates the additive commercial fields. Every commercial field is
 * optional and nullable; a present value is bounds-checked and a bad value fails
 * closed (never silently coerced).
 */
function validateContextSnapshotV2(input: Record<string, unknown>): MarketingContextSnapshotV2 {
  const opportunityType = requiredResolvedString(input.opportunityType, 'opportunity_type', 100)
  if (!isSupportedOpportunityType(opportunityType)) {
    throw new MarketingRenderError('unsupported_opportunity_type')
  }

  // customerValue (optional). Only walletCreditPence is recognised; it must be a
  // non-negative integer or null. A stray/malformed customerValue fails closed.
  let customerValue: MarketingCustomerValueV2 | null = null
  if (input.customerValue !== undefined && input.customerValue !== null) {
    if (!isPlainObject(input.customerValue)) {
      throw new MarketingRenderError('invalid_customer_value')
    }
    customerValue = {
      walletCreditPence: optionalNonNegativeInt(input.customerValue.walletCreditPence, 'wallet_credit_pence'),
    }
  }

  if (isCampaignSpecificType(opportunityType)) {
    const campaign = input.campaign
    if (!isPlainObject(campaign)) {
      throw new MarketingRenderError('campaign_missing')
    }
    const validated: MarketingCampaignContextV2 = {
      title: requiredResolvedString(campaign.title, 'campaign_title', 300),
      url: requiredHttpUrl(campaign.url, 'campaign'),
      imageUrl: optionalHttpUrl(campaign.imageUrl, 'campaign_image'),
      ticketPricePence: optionalNonNegativeInt(campaign.ticketPricePence, 'ticket_price_pence'),
      ticketsTotal: optionalNonNegativeInt(campaign.ticketsTotal, 'tickets_total'),
      ticketsSold: optionalNonNegativeInt(campaign.ticketsSold, 'tickets_sold'),
      ticketsRemaining: optionalNonNegativeInt(campaign.ticketsRemaining, 'tickets_remaining'),
      endAt: optionalResolvedString(campaign.endAt, 'campaign_end_at', 100),
      instantWinsRemaining: optionalNonNegativeInt(campaign.instantWinsRemaining, 'instant_wins_remaining'),
      remainingInstantPrizeValuePence: optionalNonNegativeInt(
        campaign.remainingInstantPrizeValuePence,
        'remaining_instant_prize_value_pence',
      ),
      highestRemainingInstantPrizePence: optionalNonNegativeInt(
        campaign.highestRemainingInstantPrizePence,
        'highest_remaining_instant_prize_pence',
      ),
    }
    return { schemaVersion: 2, opportunityType, campaign: validated, customerValue }
  }

  // Non-campaign types must NOT carry a campaign block (fail closed).
  if (input.campaign !== undefined && input.campaign !== null) {
    throw new MarketingRenderError('unexpected_campaign_for_non_campaign_type')
  }
  return { schemaVersion: 2, opportunityType, campaign: null, customerValue }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Map the validated Version-1 snapshots into the reusable branded WTF email
 * shell content contract. Only DYNAMIC, frozen values flow from the snapshots;
 * brand chrome (eyebrow, trust strip, legal links, logo, palette) is supplied
 * by the shell defaults so every marketing email stays visually consistent.
 * The shell re-escapes every field, so raw validated strings are passed here.
 */
/**
 * Build the compact commercial-facts strip (Stage 043 V2) from a validated V2
 * campaign block. Facts are prioritised (price, tickets remaining, instant wins
 * remaining, top instant, remaining value) and CAPPED AT THREE — we never dump
 * every available fact. Only trustworthy, present values become facts; nulls are
 * skipped entirely (a missing value never renders as "0" or an empty fact).
 */
function buildCommercialFacts(campaign: MarketingCampaignContextV2): string[] {
  const facts: string[] = []
  if (campaign.ticketPricePence !== null) {
    facts.push(`${formatMarketingPence(campaign.ticketPricePence).toUpperCase()} AN ENTRY`)
  }
  if (campaign.ticketsRemaining !== null) {
    facts.push(`${formatMarketingCount(campaign.ticketsRemaining)} TICKETS REMAIN`)
  }
  if (campaign.instantWinsRemaining !== null) {
    facts.push(`${formatMarketingCount(campaign.instantWinsRemaining)} INSTANT PRIZES REMAIN`)
  }
  if (campaign.highestRemainingInstantPrizePence !== null) {
    facts.push(`TOP INSTANT: ${formatMarketingPence(campaign.highestRemainingInstantPrizePence)}`)
  }
  if (campaign.remainingInstantPrizeValuePence !== null) {
    facts.push(`${formatMarketingPence(campaign.remainingInstantPrizeValuePence)} IN INSTANT PRIZES`)
  }
  return facts.slice(0, 3)
}

function toShellContent(
  template: MarketingTemplateSnapshotV1,
  context: MarketingContextSnapshot,
  unsubscribeUrl: string,
): WtfEmailContent {
  const presentation = presentationFor(context.opportunityType)

  // CTA destination is DATA-DRIVEN: campaign-specific emails point at the frozen
  // campaign URL; non-campaign emails point at a fixed brand-owned destination
  // resolved from the opportunity type. Never a hard-coded customer string.
  const ctaUrl = context.campaign
    ? context.campaign.url
    : resolveNonCampaignCtaUrl(context.opportunityType)

  // V2-only commercial enhancements. V1 snapshots carry none of these, so the
  // shell renders EXACTLY as before (fields left undefined).
  let campaignImageUrl: string | null = null
  let commercialFacts: readonly string[] | undefined
  let walletCreditText: string | null = null
  if (context.schemaVersion === 2) {
    if (context.campaign) {
      campaignImageUrl = context.campaign.imageUrl
      const facts = buildCommercialFacts(context.campaign)
      if (facts.length > 0) commercialFacts = facts
    }
    // Only the WTF-credit email surfaces the wallet amount, and only when the
    // frozen available credit is strictly positive (fail closed otherwise).
    const credit = context.customerValue?.walletCreditPence ?? null
    if (context.opportunityType === 'wtf_credit_waiting' && credit !== null && credit > 0) {
      walletCreditText = formatMarketingPence(credit)
    }
  }

  return {
    subject: template.subject,
    preheader: template.previewText,
    // Deterministic composition selected in code from the opportunity type.
    layout: resolveEmailLayout(context.opportunityType),
    eyebrow: presentation.eyebrow,
    heading: template.heading,
    // Campaign module only for campaign-specific emails; null drops it.
    campaignTitle: context.campaign ? context.campaign.title : null,
    bodyText: template.bodyText,
    cta: { label: template.ctaLabel, url: ctaUrl },
    trustItems: presentation.trustItems,
    // heroImageUrl intentionally omitted: the top-hero contract is unchanged.
    // V2 campaign artwork flows through the DISTINCT campaignImageUrl field so
    // existing behaviour (and its tests) are untouched.
    campaignImageUrl,
    commercialFacts,
    walletCreditText,
    unsubscribeUrl,
  }
}

/**
 * Validate the prepared Version-1 snapshots and render a safe marketing email.
 * Throws {@link MarketingRenderError} on any invalid/unsafe input (fail closed).
 */
export function renderMarketingEmail(input: RenderMarketingEmailInput): RenderedMarketingEmail {
  if (!isPlainObject(input)) {
    throw new MarketingRenderError('render_input_not_object')
  }
  const template = validateTemplateSnapshot(input.templateSnapshot)
  const context = validateContextSnapshot(input.contextSnapshot)
  const unsubscribeUrl = requiredHttpUrl(input.unsubscribeUrl, 'unsubscribe')

  const shellContent = toShellContent(template, context, unsubscribeUrl)

  return {
    subject: template.subject,
    html: renderWtfEmailShell(shellContent),
    text: renderWtfEmailText(shellContent),
    templateKey: template.templateKey,
    templateVersion: template.templateVersion,
    opportunityType: context.opportunityType,
  }
}
