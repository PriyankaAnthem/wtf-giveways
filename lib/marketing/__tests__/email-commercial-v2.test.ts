import { describe, it, expect, vi } from 'vitest'

// delivery-email begins with `import 'server-only'`; neutralise under node.
vi.mock('server-only', () => ({}))

import { renderMarketingEmail, MarketingRenderError } from '../delivery-email'
import {
  REGULAR_BUYER_CAMPAIGN_ALERT_V2_PREVIEW,
  WTF_CREDIT_WAITING_V2_PREVIEW,
} from '../preview-samples'

const TEMPLATE_V1 = {
  schemaVersion: 1 as const,
  templateKey: 'k',
  templateVersion: 1,
  subject: 'Subject line',
  previewText: 'Preview',
  heading: 'Heading',
  bodyText: 'Body copy for the email.',
  ctaLabel: 'Do the thing',
}

const UNSUB = 'https://www.wtf-giveaways.co.uk/api/marketing/unsubscribe?token=t'

function render(context: unknown) {
  return renderMarketingEmail({
    templateSnapshot: TEMPLATE_V1,
    contextSnapshot: context,
    unsubscribeUrl: UNSUB,
  })
}

describe('Stage 043 — V2 preview samples render via the production renderer', () => {
  it('renders the V2 campaign-alert sample with commercial facts + artwork', () => {
    const { html, text } = renderMarketingEmail(REGULAR_BUYER_CAMPAIGN_ALERT_V2_PREVIEW.input)
    // Facts are capped at three; the first three by priority appear.
    expect(html).toContain('29P AN ENTRY')
    expect(html).toContain('31,596 TICKETS REMAIN')
    expect(html).toContain('116 INSTANT PRIZES REMAIN')
    // Frozen artwork rendered.
    expect(html).toContain('/images/pre-register-product.png')
    // Plain-text alternative carries the facts too.
    expect(text).toContain('29P AN ENTRY')
  })

  it('renders the V2 wtf-credit sample with the real amount', () => {
    const { html, text } = renderMarketingEmail(WTF_CREDIT_WAITING_V2_PREVIEW.input)
    expect(html).toContain('£18.50')
    expect(html).toContain('WTF Credit')
    expect(text).toContain('WTF Credit: £18.50')
    // Generic wallet layout markers remain.
    expect(html).toContain('<!-- wtf-layout:wallet_credit -->')
  })
})

describe('Stage 043 — V2 commercial-fact prioritisation and capping', () => {
  const base = {
    schemaVersion: 2 as const,
    opportunityType: 'regular_buyer_campaign_alert',
    customerValue: null,
  }

  it('caps facts at three even when all are supplied', () => {
    const { html } = render({
      ...base,
      campaign: {
        title: 'A comp',
        url: 'https://www.wtf-giveaways.co.uk/giveaways/a',
        imageUrl: null,
        ticketPricePence: 29,
        ticketsTotal: 100,
        ticketsSold: 40,
        ticketsRemaining: 60,
        endAt: null,
        instantWinsRemaining: 5,
        remainingInstantPrizeValuePence: 100000,
        highestRemainingInstantPrizePence: 25000,
      },
    })
    expect(html).toContain('29P AN ENTRY')
    expect(html).toContain('60 TICKETS REMAIN')
    expect(html).toContain('5 INSTANT PRIZES REMAIN')
    // The 4th/5th priority facts are dropped by the cap.
    expect(html).not.toContain('TOP INSTANT')
    expect(html).not.toContain('IN INSTANT PRIZES')
  })

  it('omits a fact whose value is null (never renders "0")', () => {
    const { html } = render({
      ...base,
      campaign: {
        title: 'A comp',
        url: 'https://www.wtf-giveaways.co.uk/giveaways/a',
        imageUrl: null,
        ticketPricePence: null,
        ticketsTotal: null,
        ticketsSold: null,
        ticketsRemaining: null,
        endAt: null,
        instantWinsRemaining: null,
        remainingInstantPrizeValuePence: null,
        highestRemainingInstantPrizePence: null,
      },
    })
    expect(html).not.toContain('AN ENTRY')
    expect(html).not.toContain('TICKETS REMAIN')
    expect(html).not.toContain('INSTANT PRIZES REMAIN')
    // No artwork block when imageUrl is null.
    expect(html).not.toContain('<img src="https://www.wtf-giveaways.co.uk/giveaways')
  })
})

describe('Stage 043 — wallet credit is only shown for wtf_credit_waiting and only when > 0', () => {
  it('shows the amount for a positive wtf_credit_waiting balance', () => {
    const { html } = render({
      schemaVersion: 2,
      opportunityType: 'wtf_credit_waiting',
      customerValue: { walletCreditPence: 500 },
    })
    expect(html).toContain('£5')
    expect(html).toContain('WTF Credit')
  })

  it('does NOT show a wallet figure when the balance is zero (fail closed)', () => {
    const { html, text } = render({
      schemaVersion: 2,
      opportunityType: 'wtf_credit_waiting',
      customerValue: { walletCreditPence: 0 },
    })
    // Falls back to the generic pound-symbol hero, no explicit amount line.
    expect(text).not.toContain('WTF Credit: £')
    expect(html).toContain('<!-- wtf-layout:wallet_credit -->')
  })

  it('ignores wallet credit supplied for a non-credit opportunity type', () => {
    const { text } = render({
      schemaVersion: 2,
      opportunityType: 'lapsed_14_days',
      customerValue: { walletCreditPence: 999 },
    })
    expect(text).not.toContain('WTF Credit: £9.99')
  })
})

describe('Stage 043 — V2 validation fails closed', () => {
  it('rejects an unknown schema version', () => {
    expect(() => render({ schemaVersion: 3, opportunityType: 'lapsed_14_days' }))
      .toThrow(MarketingRenderError)
  })

  it('rejects a non-integer commercial value', () => {
    expect(() =>
      render({
        schemaVersion: 2,
        opportunityType: 'regular_buyer_campaign_alert',
        customerValue: null,
        campaign: {
          title: 'A comp',
          url: 'https://www.wtf-giveaways.co.uk/giveaways/a',
          ticketPricePence: 29.5,
        },
      }),
    ).toThrow(/invalid_ticket_price_pence/)
  })

  it('rejects a negative commercial value', () => {
    expect(() =>
      render({
        schemaVersion: 2,
        opportunityType: 'regular_buyer_campaign_alert',
        customerValue: null,
        campaign: {
          title: 'A comp',
          url: 'https://www.wtf-giveaways.co.uk/giveaways/a',
          instantWinsRemaining: -1,
        },
      }),
    ).toThrow(/invalid_instant_wins_remaining/)
  })

  it('rejects a non-https campaign image url', () => {
    expect(() =>
      render({
        schemaVersion: 2,
        opportunityType: 'regular_buyer_campaign_alert',
        customerValue: null,
        campaign: {
          title: 'A comp',
          url: 'https://www.wtf-giveaways.co.uk/giveaways/a',
          imageUrl: 'javascript:alert(1)',
        },
      }),
    ).toThrow(MarketingRenderError)
  })

  it('rejects a campaign block on a non-campaign V2 type', () => {
    expect(() =>
      render({
        schemaVersion: 2,
        opportunityType: 'wtf_credit_waiting',
        customerValue: null,
        campaign: { title: 'x', url: 'https://www.wtf-giveaways.co.uk/giveaways/a' },
      }),
    ).toThrow(/unexpected_campaign_for_non_campaign_type/)
  })

  it('rejects an unsupported opportunity type', () => {
    expect(() => render({ schemaVersion: 2, opportunityType: 'totally_made_up' }))
      .toThrow(/unsupported_opportunity_type/)
  })
})

describe('Stage 043 — V1 snapshots are completely unchanged (no commercial leakage)', () => {
  it('renders a V1 campaign snapshot with no commercial facts or extra artwork', () => {
    const { html } = render({
      schemaVersion: 1,
      opportunityType: 'regular_buyer_campaign_alert',
      campaign: { title: 'A comp', url: 'https://www.wtf-giveaways.co.uk/giveaways/a' },
    })
    expect(html).not.toContain('AN ENTRY')
    expect(html).not.toContain('TICKETS REMAIN')
    expect(html).not.toContain('INSTANT PRIZES')
    expect(html).not.toContain('/images/pre-register-product.png')
  })
})
