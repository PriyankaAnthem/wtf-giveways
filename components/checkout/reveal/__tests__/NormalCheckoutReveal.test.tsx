import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Force the reduced-motion path so the component mounts directly at the final
// `result` stage (no timers needed for a static render); this also exercises
// the prefers-reduced-motion branch. Must be set BEFORE the describe bodies run
// their renders (which happens during collection), so it lives at module scope.
;(globalThis as any).window = {
  matchMedia: () => ({ matches: true }),
}

// next/link -> plain anchor so we can assert hrefs from static markup without a
// Next router runtime. Presentation-only; does not touch app routing.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) =>
    React.createElement('a', { href, ...rest }, children),
}))

import { NormalCheckoutReveal, type NormalRevealAward } from '../NormalCheckoutReveal'

function baseAward(overrides: Partial<NormalRevealAward> = {}): NormalRevealAward {
  return {
    confirmed: true,
    checkout_ref: 'ref_123',
    qty: 1,
    won: false,
    prize: null,
    prizes: [],
    ticket_start: 1107,
    ticket_end: 1107,
    campaign_slug: 'summer-supercar',
    reveal_type: 'normal',
    ...overrides,
  } as NormalRevealAward
}

function render(award: NormalRevealAward): string {
  return renderToStaticMarkup(React.createElement(NormalCheckoutReveal, { award }))
}

describe('NormalCheckoutReveal — no-win, single ticket', () => {
  const html = render(baseAward())

  it('shows the "Not This Time" heading (not "No Instant Win")', () => {
    expect(html).toContain('Not This Time')
    expect(html).not.toContain('No Instant Win')
  })

  it('shows the singular reassurance copy', () => {
    expect(html).toContain('but it is still entered in the main draw')
    expect(html).not.toContain('but they are still entered in the main draw')
  })

  it('shows the "1 ticket still active" chip', () => {
    expect(html).toContain('1 ticket still active')
    expect(html).not.toContain('1 ticket entered')
  })

  it('shows the compact ticket drawer with "Your ticket" and a main-draw status', () => {
    expect(html).toContain('Your ticket')
    expect(html).toContain('Main draw entry')
    expect(html).toContain('#1107')
  })

  it('shows the "Try Again" primary CTA and supporting text (not "Buy More")', () => {
    expect(html).toContain('Try Again')
    expect(html).not.toContain('Buy More')
    expect(html).toContain('Add more tickets for more chances in the main draw.')
  })

  it('keeps Buy More href pointing at the campaign slug', () => {
    expect(html).toContain('href="/giveaways/summer-supercar"')
  })

  it('keeps My Account pointing at /me', () => {
    expect(html).toContain('href="/me"')
    expect(html).toContain('My Account')
  })
})

describe('NormalCheckoutReveal — no-win, multiple tickets', () => {
  const html = render(baseAward({ qty: 3, ticket_start: 200, ticket_end: 202 }))

  it('shows the plural reassurance copy', () => {
    expect(html).toContain('but they are still entered in the main draw')
    expect(html).not.toContain('but it is still entered in the main draw')
  })

  it('shows the correct "3 tickets still active" count', () => {
    expect(html).toContain('3 tickets still active')
  })

  it('preserves all ticket numbers in order', () => {
    expect(html).toContain('#200')
    expect(html).toContain('#201')
    expect(html).toContain('#202')
    expect(html.indexOf('#200')).toBeLessThan(html.indexOf('#201'))
    expect(html.indexOf('#201')).toBeLessThan(html.indexOf('#202'))
  })

  it('uses the plural "Your tickets (3)" heading', () => {
    expect(html).toContain('Your tickets (3)')
  })
})

describe('NormalCheckoutReveal — win result', () => {
  const html = render(
    baseAward({
      won: true,
      prize: { title: 'PlayStation 5 Console', value_text: '£479' },
      prizes: [{ title: 'PlayStation 5 Console', value_text: '£479' }],
      qty: 1,
      ticket_start: 5,
      ticket_end: 5,
    }),
  )

  it('does not show the no-win heading or copy', () => {
    expect(html).not.toContain('Not This Time')
    expect(html).not.toContain('still active')
    expect(html).not.toContain('Try Again')
  })

  it('retains the existing win content', () => {
    expect(html).toContain('Instant Win')
    expect(html).toContain('PlayStation 5 Console')
  })

  it('retains the "Buy More" label and supporting text is absent', () => {
    expect(html).toContain('Buy More')
    expect(html).not.toContain('Add more tickets for more chances in the main draw.')
  })

  it('keeps both destinations unchanged', () => {
    expect(html).toContain('href="/giveaways/summer-supercar"')
    expect(html).toContain('href="/me"')
  })
})

describe('NormalCheckoutReveal — missing campaign slug', () => {
  it('falls back the primary CTA to /giveaways', () => {
    const html = render(baseAward({ campaign_slug: null }))
    expect(html).toContain('href="/giveaways"')
    expect(html).not.toContain('href="/giveaways/')
  })
})

describe('NormalCheckoutReveal — large ticket range', () => {
  // 50 tickets (> TICKET_PREVIEW_COUNT = 10) must keep the collapse/preview UI.
  const html = render(baseAward({ qty: 50, ticket_start: 1, ticket_end: 50 }))

  it('shows only the preview and a "View all tickets" control', () => {
    expect(html).toContain('View all tickets')
    expect(html).toContain('#1')
    expect(html).toContain('#10')
    // #11 and beyond are collapsed until expanded.
    expect(html).not.toContain('#11')
    expect(html).not.toContain('#50')
  })

  it('reports the full count in the chip and heading', () => {
    expect(html).toContain('50 tickets still active')
    expect(html).toContain('Your tickets (50)')
  })
})
