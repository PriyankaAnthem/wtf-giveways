/**
 * WTF Marketing — Stage 038/039 ADMIN PREVIEW SAMPLE PAYLOADS.
 *
 * REPRESENTATIVE, fully-resolved snapshot payloads used ONLY to power the
 * admin-only email preview. They contain NO customer identity, NO recipient
 * email, NO real per-recipient token and NO database data — just brand-safe
 * placeholder copy so an operator can SEE the exact production email design for
 * every automation without sending anything or exposing anyone.
 *
 * The shapes here deliberately match the delivery renderer's Version-1 snapshot
 * contract so the preview feeds the SAME `renderMarketingEmail` used by live
 * delivery. Values are already resolved (no `{{placeholders}}`) because the
 * renderer fails closed on any unresolved delimiter. Campaign-specific samples
 * carry a representative campaign; non-campaign samples carry no campaign block,
 * exactly as the preparation layer freezes them.
 */

import { WTF_SITE_URL } from './email-shell'
import type { RenderMarketingEmailInput } from './delivery-email'

/** Display-only metadata for the admin preview UI (never customer data). */
export interface MarketingPreviewMeta {
  key: string
  label: string
  opportunityType: string
  campaignSpecific: boolean
  subject: string
  previewText: string | null
  heading: string
  /** Null for non-campaign emails (no campaign card). */
  campaignTitle: string | null
  ctaLabel: string
  ctaUrl: string
}

export interface MarketingPreviewSample {
  /** Stable id for the preview selector / tests. */
  key: string
  /** Human label shown in the admin UI. */
  label: string
  /** Opportunity type this sample represents. */
  opportunityType: string
  /** Exactly the input shape accepted by `renderMarketingEmail`. */
  input: RenderMarketingEmailInput
  /** Display metadata for the preview UI. */
  meta: MarketingPreviewMeta
}

/** Representative campaign shared by the campaign-specific previews. */
const SAMPLE_CAMPAIGN_TITLE = '£30,000 Tax-Free Cash'
const SAMPLE_CAMPAIGN_URL = `${WTF_SITE_URL}/giveaways/30k-tax-free-cash`
/** Fixed public listing destination for non-campaign CTAs. */
const GIVEAWAYS_URL = `${WTF_SITE_URL}/giveaways`
/** Representative, NON-personal unsubscribe URL (live pipeline mints the real one). */
const SAMPLE_UNSUBSCRIBE_URL = `${WTF_SITE_URL}/api/marketing/unsubscribe?token=preview-sample`

// ---------------------------------------------------------------------------
// Campaign-specific samples (carry a campaign block; CTA -> campaign URL)
// ---------------------------------------------------------------------------

export const ABANDONED_CHECKOUT_PREVIEW: MarketingPreviewSample = {
  key: 'abandoned_checkout',
  label: 'Abandoned checkout',
  opportunityType: 'abandoned_checkout',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'abandoned_checkout_v1',
      templateVersion: 1,
      subject: 'Still thinking about £30,000 Tax-Free Cash?',
      previewText: 'Your entry for £30,000 Tax-Free Cash was not completed.',
      heading: 'Still thinking about £30,000 Tax-Free Cash?',
      bodyText:
        'It looks like your checkout was not completed. If you still want to enter, you can head '
        + `back to the competition and pick up right where you left off. Complete your entry at ${SAMPLE_CAMPAIGN_URL}.`,
      ctaLabel: 'Finish my entry',
    },
    contextSnapshot: {
      schemaVersion: 1,
      opportunityType: 'abandoned_checkout',
      campaign: { title: SAMPLE_CAMPAIGN_TITLE, url: SAMPLE_CAMPAIGN_URL },
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'abandoned_checkout',
    label: 'Abandoned checkout',
    opportunityType: 'abandoned_checkout',
    campaignSpecific: true,
    subject: 'Still thinking about £30,000 Tax-Free Cash?',
    previewText: 'Your entry for £30,000 Tax-Free Cash was not completed.',
    heading: 'Still thinking about £30,000 Tax-Free Cash?',
    campaignTitle: SAMPLE_CAMPAIGN_TITLE,
    ctaLabel: 'Finish my entry',
    ctaUrl: SAMPLE_CAMPAIGN_URL,
  },
}

export const VIP_EARLY_ACCESS_PREVIEW: MarketingPreviewSample = {
  key: 'vip_early_access',
  label: 'VIP early access',
  opportunityType: 'vip_early_access',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'vip_early_access_v1',
      templateVersion: 1,
      subject: 'Your VIP early access to £30,000 Tax-Free Cash',
      previewText: 'You can enter £30,000 Tax-Free Cash before it opens to everyone.',
      heading: 'Early access: £30,000 Tax-Free Cash',
      bodyText:
        'As one of our VIP members, you can enter £30,000 Tax-Free Cash ahead of everyone else. '
        + `Take a look while your early access window is open and enter here: ${SAMPLE_CAMPAIGN_URL}.`,
      ctaLabel: 'View the competition',
    },
    contextSnapshot: {
      schemaVersion: 1,
      opportunityType: 'vip_early_access',
      campaign: { title: SAMPLE_CAMPAIGN_TITLE, url: SAMPLE_CAMPAIGN_URL },
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'vip_early_access',
    label: 'VIP early access',
    opportunityType: 'vip_early_access',
    campaignSpecific: true,
    subject: 'Your VIP early access to £30,000 Tax-Free Cash',
    previewText: 'You can enter £30,000 Tax-Free Cash before it opens to everyone.',
    heading: 'Early access: £30,000 Tax-Free Cash',
    campaignTitle: SAMPLE_CAMPAIGN_TITLE,
    ctaLabel: 'View the competition',
    ctaUrl: SAMPLE_CAMPAIGN_URL,
  },
}

export const REGULAR_BUYER_CAMPAIGN_ALERT_PREVIEW: MarketingPreviewSample = {
  key: 'regular_buyer_campaign_alert',
  label: 'Regular buyer — campaign alert',
  opportunityType: 'regular_buyer_campaign_alert',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'regular_buyer_campaign_alert_v1',
      templateVersion: 1,
      subject: 'Now live: £30,000 Tax-Free Cash',
      previewText: 'A new competition, £30,000 Tax-Free Cash, has just gone live.',
      heading: '£30,000 Tax-Free Cash is now live',
      bodyText:
        'A new competition has just gone live and we thought you would want to know. If you would '
        + `like to take part, you can see the full details and enter £30,000 Tax-Free Cash here: ${SAMPLE_CAMPAIGN_URL}.`,
      ctaLabel: 'See the competition',
    },
    contextSnapshot: {
      schemaVersion: 1,
      opportunityType: 'regular_buyer_campaign_alert',
      campaign: { title: SAMPLE_CAMPAIGN_TITLE, url: SAMPLE_CAMPAIGN_URL },
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'regular_buyer_campaign_alert',
    label: 'Regular buyer — campaign alert',
    opportunityType: 'regular_buyer_campaign_alert',
    campaignSpecific: true,
    subject: 'Now live: £30,000 Tax-Free Cash',
    previewText: 'A new competition, £30,000 Tax-Free Cash, has just gone live.',
    heading: '£30,000 Tax-Free Cash is now live',
    campaignTitle: SAMPLE_CAMPAIGN_TITLE,
    ctaLabel: 'See the competition',
    ctaUrl: SAMPLE_CAMPAIGN_URL,
  },
}

// ---------------------------------------------------------------------------
// Non-campaign samples (NO campaign block; CTA -> fixed public listing)
// ---------------------------------------------------------------------------

export const WTF_CREDIT_WAITING_PREVIEW: MarketingPreviewSample = {
  key: 'wtf_credit_waiting',
  label: 'WTF credit waiting',
  opportunityType: 'wtf_credit_waiting',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'wtf_credit_waiting_v1',
      templateVersion: 1,
      subject: 'You have WTF credit ready to use',
      previewText: 'There is credit waiting in your WTF Giveaways account.',
      heading: 'You have credit waiting',
      bodyText:
        'This is a friendly reminder that you have credit available in your WTF Giveaways account. '
        + 'You can put it towards any of our live competitions whenever you are ready. Browse what is '
        + 'on right now and use your credit at checkout.',
      ctaLabel: 'Browse live competitions',
    },
    contextSnapshot: {
      schemaVersion: 1,
      opportunityType: 'wtf_credit_waiting',
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'wtf_credit_waiting',
    label: 'WTF credit waiting',
    opportunityType: 'wtf_credit_waiting',
    campaignSpecific: false,
    subject: 'You have WTF credit ready to use',
    previewText: 'There is credit waiting in your WTF Giveaways account.',
    heading: 'You have credit waiting',
    campaignTitle: null,
    ctaLabel: 'Browse live competitions',
    ctaUrl: GIVEAWAYS_URL,
  },
}

export const NEW_ACCOUNT_NO_PURCHASE_PREVIEW: MarketingPreviewSample = {
  key: 'new_account_no_purchase',
  label: 'New account — welcome',
  opportunityType: 'new_account_no_purchase',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'new_account_no_purchase_v1',
      templateVersion: 1,
      subject: 'Welcome to WTF Giveaways',
      previewText: 'Thanks for joining. Here is how to get started.',
      heading: 'Welcome to WTF Giveaways',
      bodyText:
        'Thanks for creating your account. WTF Giveaways runs regular competitions with a wide range '
        + 'of prizes, and entering only takes a moment. Whenever you are ready, take a look at what is '
        + 'live right now and find one you like.',
      ctaLabel: 'See live competitions',
    },
    contextSnapshot: {
      schemaVersion: 1,
      opportunityType: 'new_account_no_purchase',
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'new_account_no_purchase',
    label: 'New account — welcome',
    opportunityType: 'new_account_no_purchase',
    campaignSpecific: false,
    subject: 'Welcome to WTF Giveaways',
    previewText: 'Thanks for joining. Here is how to get started.',
    heading: 'Welcome to WTF Giveaways',
    campaignTitle: null,
    ctaLabel: 'See live competitions',
    ctaUrl: GIVEAWAYS_URL,
  },
}

export const LAPSED_14_DAYS_PREVIEW: MarketingPreviewSample = {
  key: 'lapsed_14_days',
  label: 'Lapsed customer',
  opportunityType: 'lapsed_14_days',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'lapsed_14_days_v1',
      templateVersion: 1,
      subject: 'See what is live at WTF Giveaways',
      previewText: 'New competitions have gone live since your last visit.',
      heading: 'There is plenty on right now',
      bodyText:
        'It has been a little while since we last saw you, and we have added new competitions since '
        + 'then. If you fancy a look, you can see everything that is live right now and pick whichever '
        + 'one appeals to you.',
      ctaLabel: 'Browse competitions',
    },
    contextSnapshot: {
      schemaVersion: 1,
      opportunityType: 'lapsed_14_days',
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'lapsed_14_days',
    label: 'Lapsed customer',
    opportunityType: 'lapsed_14_days',
    campaignSpecific: false,
    subject: 'See what is live at WTF Giveaways',
    previewText: 'New competitions have gone live since your last visit.',
    heading: 'There is plenty on right now',
    campaignTitle: null,
    ctaLabel: 'Browse competitions',
    ctaUrl: GIVEAWAYS_URL,
  },
}

/**
 * All six marketing email samples in operational priority order (campaign-
 * specific first, then lifecycle). Every automation is represented.
 */
export const MARKETING_PREVIEW_SAMPLES: readonly MarketingPreviewSample[] = [
  ABANDONED_CHECKOUT_PREVIEW,
  VIP_EARLY_ACCESS_PREVIEW,
  REGULAR_BUYER_CAMPAIGN_ALERT_PREVIEW,
  WTF_CREDIT_WAITING_PREVIEW,
  NEW_ACCOUNT_NO_PURCHASE_PREVIEW,
  LAPSED_14_DAYS_PREVIEW,
]

// ===========================================================================
// Stage 043 — VERSION-2 COMMERCIAL PREVIEW SAMPLES (representative, non-live)
//
// These feed the SAME production `renderMarketingEmail` with schemaVersion=2
// context so an operator can SEE the commercial enhancements (real artwork,
// ticket price, remaining tickets / instant prizes, top instant value and the
// actual WTF credit) BEFORE anything is sent. They contain NO live customer
// data — the wallet amount and campaign facts are fixed representative numbers.
// ===========================================================================

/** Representative V2 campaign (integer pence throughout). */
const V2_CAMPAIGN_TITLE = 'WIN A £1,480 LV ALMA BB BAG! WORTH £1,500'
const V2_CAMPAIGN_URL = `${WTF_SITE_URL}/giveaways/lv-alma-bb-bag`
/** Existing safe repo asset reused as representative artwork (never live data). */
const V2_CAMPAIGN_IMAGE_URL = `${WTF_SITE_URL}/images/pre-register-product.png`

export const REGULAR_BUYER_CAMPAIGN_ALERT_V2_PREVIEW: MarketingPreviewSample = {
  key: 'regular_buyer_campaign_alert_v2',
  label: 'Regular buyer — campaign alert (V2 commercial)',
  opportunityType: 'regular_buyer_campaign_alert',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'regular_buyer_campaign_alert_v1',
      templateVersion: 1,
      subject: 'Now live: LV Alma BB Bag',
      previewText: 'A new competition has just gone live.',
      heading: 'A new competition just landed',
      bodyText:
        'A brand-new competition has just gone live and we thought you would want to know. Take a '
        + `look at the full details and enter here: ${V2_CAMPAIGN_URL}.`,
      ctaLabel: 'See the competition',
    },
    contextSnapshot: {
      schemaVersion: 2,
      opportunityType: 'regular_buyer_campaign_alert',
      campaign: {
        title: V2_CAMPAIGN_TITLE,
        url: V2_CAMPAIGN_URL,
        imageUrl: V2_CAMPAIGN_IMAGE_URL,
        ticketPricePence: 29,
        ticketsTotal: 40000,
        ticketsSold: 8404,
        ticketsRemaining: 31596,
        endAt: null,
        instantWinsRemaining: 116,
        remainingInstantPrizeValuePence: 100000,
        highestRemainingInstantPrizePence: 25000,
      },
      customerValue: null,
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'regular_buyer_campaign_alert_v2',
    label: 'Regular buyer — campaign alert (V2 commercial)',
    opportunityType: 'regular_buyer_campaign_alert',
    campaignSpecific: true,
    subject: 'Now live: LV Alma BB Bag',
    previewText: 'A new competition has just gone live.',
    heading: 'A new competition just landed',
    campaignTitle: V2_CAMPAIGN_TITLE,
    ctaLabel: 'See the competition',
    ctaUrl: V2_CAMPAIGN_URL,
  },
}

export const WTF_CREDIT_WAITING_V2_PREVIEW: MarketingPreviewSample = {
  key: 'wtf_credit_waiting_v2',
  label: 'WTF credit waiting (V2 — real amount)',
  opportunityType: 'wtf_credit_waiting',
  input: {
    templateSnapshot: {
      schemaVersion: 1,
      templateKey: 'wtf_credit_waiting_v1',
      templateVersion: 1,
      subject: 'You have WTF credit ready to use',
      previewText: 'There is credit waiting in your WTF Giveaways account.',
      heading: 'You have credit waiting',
      bodyText:
        'This is a friendly reminder that you have credit available in your WTF Giveaways account. '
        + 'You can put it towards any of our live competitions whenever you are ready.',
      ctaLabel: 'Browse live competitions',
    },
    contextSnapshot: {
      schemaVersion: 2,
      opportunityType: 'wtf_credit_waiting',
      customerValue: { walletCreditPence: 1850 },
    },
    unsubscribeUrl: SAMPLE_UNSUBSCRIBE_URL,
  },
  meta: {
    key: 'wtf_credit_waiting_v2',
    label: 'WTF credit waiting (V2 — real amount)',
    opportunityType: 'wtf_credit_waiting',
    campaignSpecific: false,
    subject: 'You have WTF credit ready to use',
    previewText: 'There is credit waiting in your WTF Giveaways account.',
    heading: 'You have credit waiting',
    campaignTitle: null,
    ctaLabel: 'Browse live competitions',
    ctaUrl: GIVEAWAYS_URL,
  },
}

/**
 * Stage 043 representative V2 samples (commercial extension). Rendered by the
 * admin preview under a clear "PREVIEW DATA — NOT LIVE CUSTOMER DATA" banner.
 */
export const MARKETING_PREVIEW_SAMPLES_V2: readonly MarketingPreviewSample[] = [
  REGULAR_BUYER_CAMPAIGN_ALERT_V2_PREVIEW,
  WTF_CREDIT_WAITING_V2_PREVIEW,
]
