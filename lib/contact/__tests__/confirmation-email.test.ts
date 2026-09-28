import { describe, it, expect } from 'vitest'

import {
  buildContactConfirmationEmail,
  CONTACT_CONFIRMATION_SUBJECTS,
  CONTACT_CTA_LABEL,
  PAYOUT_48_HOUR_STATEMENT,
  WTF_LIVE_COMPETITIONS_URL,
} from '../confirmation-email'

const ID = '3f8a1c22-9b4e-4a71-8d0e-77c1a5e9b210'

const general = () =>
  buildContactConfirmationEmail({ kind: 'general', firstName: 'Ben', enquiryId: ID })
const payout = () =>
  buildContactConfirmationEmail({ kind: 'winner_payout', firstName: 'Ben', enquiryId: ID })

describe('contact confirmation email — subjects', () => {
  it('uses the exact approved general subject', () => {
    expect(general().subject).toBe("We've got your message 👋 | WTF Giveaways")
    expect(CONTACT_CONFIRMATION_SUBJECTS.general).toBe("We've got your message 👋 | WTF Giveaways")
  })

  it('uses the exact approved payout subject', () => {
    expect(payout().subject).toBe('Your payout details are in ✅ | WTF Giveaways')
    expect(CONTACT_CONFIRMATION_SUBJECTS.winner_payout).toBe(
      'Your payout details are in ✅ | WTF Giveaways'
    )
  })

  it('gives the two enquiry kinds different subjects', () => {
    expect(general().subject).not.toBe(payout().subject)
  })
})

describe('contact confirmation email — general copy', () => {
  it('renders the hero, greeting and body copy', () => {
    const { html, text } = general()
    expect(html).toContain('Message received!')
    expect(html).toContain('Hi Ben,')
    expect(html).toContain('Thanks for getting in touch.')
    expect(html).toContain('Your message is safely with the WTF team')
    expect(text).toContain('Hi Ben,')
    expect(text).toContain('Thanks for getting in touch.')
  })

  it('shows the enquiry reference using the inserted row id', () => {
    const { html, text } = general()
    expect(html).toContain('Your enquiry reference')
    expect(html).toContain(ID)
    expect(text).toContain(`Your enquiry reference: ${ID}`)
  })

  it('renders the general sales section', () => {
    const { html, text } = general()
    expect(html).toContain('Your next win could already be waiting')
    expect(html).toContain('New instant wins, cash prizes and giveaways are live right now.')
    expect(text).toContain('Your next win could already be waiting')
  })
})

describe('contact confirmation email — payout copy', () => {
  it('renders the hero and secure-receipt confirmation', () => {
    const { html, text } = payout()
    expect(html).toContain('Payout details received')
    expect(html).toContain('Hi Ben,')
    expect(html).toContain(
      'We&#39;ve securely received your payout details and your claim is now with the WTF team.'
    )
    expect(text).toContain(
      "We've securely received your payout details and your claim is now with the WTF team."
    )
  })

  it('states the 48-hour promise verbatim, with no hedging', () => {
    const { html, text } = payout()
    expect(PAYOUT_48_HOUR_STATEMENT).toBe('Payouts are processed within 48 hours of submission.')
    expect(html).toContain('Payouts are processed within 48 hours of submission.')
    expect(text).toContain('Payouts are processed within 48 hours of submission.')

    for (const hedge of ['aim to', 'usually', 'often sooner', 'up to approximately', 'try to']) {
      expect(html.toLowerCase()).not.toContain(hedge)
      expect(text.toLowerCase()).not.toContain(hedge)
    }
  })

  it('tells the winner not to resubmit bank details', () => {
    const { html, text } = payout()
    expect(html).toContain('You do not need to submit your bank details again.')
    expect(text).toContain('You do not need to submit your bank details again.')
  })

  it('shows the claim reference and the closing line', () => {
    const { html, text } = payout()
    expect(html).toContain('Claim reference')
    expect(html).toContain(ID)
    expect(text).toContain(`Claim reference: ${ID}`)
    expect(html).toContain('maybe we&#39;ll be paying you again soon')
  })

  it('renders the payout sales section', () => {
    const { html, text } = payout()
    expect(html).toContain('Fancy making it two wins?')
    // The apostrophe is HTML-escaped by the renderer, as it should be.
    expect(html).toContain('There&#39;s plenty more up for grabs right now.')
    expect(text).toContain("There's plenty more up for grabs right now.")
    expect(text).toContain('Fancy making it two wins?')
  })
})

describe('contact confirmation email — payout security', () => {
  it('never renders banking fields, because it never receives them', () => {
    const { html, text } = payout()
    const forbidden = [
      'sort code',
      'sort_code',
      'account number',
      'account_number',
      'payout_sort_code',
      'payout_account_number',
      'iban',
    ]
    for (const term of forbidden) {
      expect(html.toLowerCase()).not.toContain(term)
      expect(text.toLowerCase()).not.toContain(term)
    }
  })

  it('accepts no banking input at all (type-level guarantee)', () => {
    // The renderer's only dynamic inputs are kind, firstName and enquiryId, so
    // no banking value can reach the template even by mistake.
    const out = buildContactConfirmationEmail({
      kind: 'winner_payout',
      firstName: 'Ben',
      enquiryId: ID,
    })
    expect(out.html).not.toMatch(/\b\d{2}-\d{2}-\d{2}\b/) // sort-code shape
    expect(out.html).not.toMatch(/\b\d{8}\b/) // account-number shape
  })
})

describe('contact confirmation email — CTA', () => {
  it('links both emails to the canonical live competitions route', () => {
    expect(WTF_LIVE_COMPETITIONS_URL).toBe('https://www.wtf-giveaways.co.uk/giveaways')
    for (const { html, text } of [general(), payout()]) {
      expect(html).toContain(`href="${WTF_LIVE_COMPETITIONS_URL}"`)
      expect(text).toContain(WTF_LIVE_COMPETITIONS_URL)
    }
  })

  it('uses the approved CTA label', () => {
    expect(CONTACT_CTA_LABEL).toBe("SEE WHAT'S LIVE")
    expect(general().html).toContain('SEE WHAT&#39;S LIVE')
  })
})

describe('contact confirmation email — transactional, not marketing', () => {
  it('contains no unsubscribe link or opt-in claim', () => {
    for (const { html, text } of [general(), payout()]) {
      expect(html.toLowerCase()).not.toContain('unsubscribe')
      expect(text.toLowerCase()).not.toContain('unsubscribe')
      expect(html.toLowerCase()).not.toContain('opted in')
    }
  })

  it('states plainly that no mailing list was joined', () => {
    for (const { html, text } of [general(), payout()]) {
      expect(html).toContain('haven&#39;t been added to any mailing list')
      expect(text).toContain("haven't been added to any mailing list")
    }
  })
})

describe('contact confirmation email — structure and safety', () => {
  it('orders branding, confirmation, reference, sales, then footer', () => {
    const { html } = general()
    const logo = html.indexOf('wtf-logo-main.png')
    const confirm = html.indexOf('Message received!')
    const reference = html.indexOf('Your enquiry reference')
    const sales = html.indexOf('Your next win could already be waiting')
    const cta = html.indexOf('SEE WHAT&#39;S LIVE')
    const footer = html.indexOf('Please play responsibly')

    expect(logo).toBeGreaterThan(-1)
    expect(logo).toBeLessThan(confirm)
    expect(confirm).toBeLessThan(reference)
    expect(reference).toBeLessThan(sales)
    expect(sales).toBeLessThan(cta)
    expect(cta).toBeLessThan(footer)
  })

  it('puts the payout 48-hour promise before the sales section', () => {
    const { html } = payout()
    expect(html.indexOf(PAYOUT_48_HOUR_STATEMENT)).toBeLessThan(
      html.indexOf('Fancy making it two wins?')
    )
  })

  it('escapes untrusted first names', () => {
    const { html } = buildContactConfirmationEmail({
      kind: 'general',
      firstName: '<script>alert(1)</script>',
      enquiryId: ID,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes untrusted enquiry ids', () => {
    const { html } = buildContactConfirmationEmail({
      kind: 'general',
      firstName: 'Ben',
      enquiryId: '"><img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('falls back to a neutral greeting when no first name is supplied', () => {
    for (const name of ['', '   ', null, undefined]) {
      const { html, text } = buildContactConfirmationEmail({
        kind: 'general',
        firstName: name,
        enquiryId: ID,
      })
      expect(html).toContain('Hi there,')
      expect(text).toContain('Hi there,')
      expect(html).not.toContain('Hi ,')
    }
  })

  it('is email-client safe: tables, inline styles, no script or external assets', () => {
    for (const { html } of [general(), payout()]) {
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('role="presentation"')
      expect(html).toContain('charset="utf-8"')
      expect(html).not.toContain('<script')
      expect(html).not.toContain('display:flex')
      expect(html).not.toContain('display:grid')
      expect(html).not.toContain('fonts.googleapis.com')
      expect(html).not.toContain('<link')
    }
  })

  it('always provides a non-trivial plain-text fallback', () => {
    for (const { text } of [general(), payout()]) {
      expect(text.length).toBeGreaterThan(200)
      expect(text).not.toContain('<')
    }
  })

  it('is deterministic', () => {
    expect(general().html).toBe(general().html)
    expect(payout().text).toBe(payout().text)
  })
})
