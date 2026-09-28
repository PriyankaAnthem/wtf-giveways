import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// delivery-email begins with `import 'server-only'`; neutralise under node.
vi.mock('server-only', () => ({}))

import {
  renderWtfEmailShell,
  renderWtfEmailText,
  escapeHtml,
  escapeHtmlWithBreaks,
  WTF_SITE_URL,
  WTF_LOGO_URL,
  WTF_DEFAULT_TRUST_ITEMS,
  type WtfEmailContent,
} from '../email-shell'
import { renderMarketingEmail, resolveEmailLayout } from '../delivery-email'
import {
  ABANDONED_CHECKOUT_PREVIEW,
  MARKETING_PREVIEW_SAMPLES,
} from '../preview-samples'

const REPO_ROOT = process.cwd()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseContent(overrides: Partial<WtfEmailContent> = {}): WtfEmailContent {
  return {
    subject: 'You left this one behind',
    preheader: 'Your entry is still live.',
    heading: 'You left this one behind',
    campaignTitle: '£30,000 Tax-Free Cash',
    bodyText: 'Line one.\nLine two.',
    cta: { label: 'Finish my entry', url: `${WTF_SITE_URL}/giveaways/x` },
    unsubscribeUrl: `${WTF_SITE_URL}/api/marketing/unsubscribe?token=preview`,
    ...overrides,
  }
}

// ===========================================================================
// SHELL — escaping + safety
// ===========================================================================
describe('Stage 038 — email shell escaping & safety', () => {
  it('escapeHtml escapes all five significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('escapeHtmlWithBreaks escapes BEFORE converting newlines to <br />', () => {
    expect(escapeHtmlWithBreaks('a<b>\nc')).toBe('a&lt;b&gt;<br />c')
  })

  it('escapes a scripted heading (no live tag survives)', () => {
    const html = renderWtfEmailShell(baseContent({ heading: '<script>alert(1)</script>' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes a scripted campaign title', () => {
    const html = renderWtfEmailShell(baseContent({ campaignTitle: '<img src=x onerror=alert(1)>' }))
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img')
  })

  it('escapes an HTML CTA label', () => {
    const html = renderWtfEmailShell(baseContent({ cta: { label: '<i>go</i>', url: `${WTF_SITE_URL}/g` } }))
    expect(html).not.toContain('<i>go</i>')
    expect(html).toContain('&lt;i&gt;go&lt;/i&gt;')
  })

  it('escapes double quotes in a CTA url so no attribute can be broken out of', () => {
    const html = renderWtfEmailShell(
      baseContent({ cta: { label: 'Go', url: `${WTF_SITE_URL}/g?a="x` } }),
    )
    expect(html).toContain('&quot;x')
    expect(html).not.toContain('a="x"')
  })

  it('body newlines become safe <br /> (never raw)', () => {
    const html = renderWtfEmailShell(baseContent({ bodyText: 'one\ntwo' }))
    expect(html).toContain('one<br />two')
  })

  it('renders a valid email document without JavaScript or dangerous handlers', () => {
    const html = renderWtfEmailShell(baseContent())
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son\w+=/i) // no inline event handlers (onclick, onerror, ...)
    expect(html).not.toContain('javascript:')
  })
})

// ===========================================================================
// SHELL — structure / brand / CTA / unsubscribe
// ===========================================================================
describe('Stage 038 — email shell structure', () => {
  it('is table-based and email-safe (no flex/grid on essential layout)', () => {
    const html = renderWtfEmailShell(baseContent())
    expect(html).toContain('role="presentation"')
    expect(html).not.toContain('display:flex')
    expect(html).not.toContain('display:grid')
  })

  it('includes the real WTF logo asset (not a reinvented mark)', () => {
    const html = renderWtfEmailShell(baseContent())
    expect(html).toContain(WTF_LOGO_URL)
    expect(html).toContain('alt="WTF Giveaways"')
    expect(WTF_LOGO_URL).toContain('/images/wtf-logo-main.png')
  })

  it('uses the WTF hot-pink accent on a near-black canvas', () => {
    const html = renderWtfEmailShell(baseContent())
    expect(html.toLowerCase()).toContain('#ff2d87')
    expect(html.toLowerCase()).toContain('#0b0b0f')
  })

  it('renders the CTA as a link to the provided (escaped) campaign url', () => {
    const html = renderWtfEmailShell(baseContent({ cta: { label: 'Finish my entry', url: `${WTF_SITE_URL}/giveaways/abc` } }))
    expect(html).toContain(`href="${WTF_SITE_URL}/giveaways/abc"`)
    expect(html).toContain('Finish my entry')
  })

  it('always includes an unsubscribe link pointing at the supplied url', () => {
    const unsub = `${WTF_SITE_URL}/api/marketing/unsubscribe?token=abc`
    const html = renderWtfEmailShell(baseContent({ unsubscribeUrl: unsub }))
    expect(html).toContain(`href="${unsub}"`)
    expect(html.toLowerCase()).toContain('unsubscribe')
  })

  it('renders the hidden preheader when provided', () => {
    const html = renderWtfEmailShell(baseContent({ preheader: 'Peekaboo preheader' }))
    expect(html).toContain('Peekaboo preheader')
    expect(html).toContain('mso-hide:all')
  })

  it('renders the default trust strip items', () => {
    const html = renderWtfEmailShell(baseContent())
    for (const item of WTF_DEFAULT_TRUST_ITEMS) {
      expect(html).toContain(item)
    }
  })

  it('supports optional hero artwork when a url is supplied (future contract)', () => {
    const img = `${WTF_SITE_URL}/images/campaign-hero.png`
    const html = renderWtfEmailShell(baseContent({ heroImageUrl: img }))
    expect(html).toContain(`src="${img}"`)
  })

  it('uses the branded fallback hero (no hero <img>) when no artwork is supplied', () => {
    const html = renderWtfEmailShell(baseContent({ heroImageUrl: null }))
    // The only <img> present is the logo, never a hero image.
    const imgCount = (html.match(/<img /g) ?? []).length
    expect(imgCount).toBe(1)
  })
})

// ===========================================================================
// SHELL — plain text alternative
// ===========================================================================
describe('Stage 038 — email shell plain text', () => {
  it('includes the CTA/campaign url and the unsubscribe url', () => {
    const content = baseContent()
    const text = renderWtfEmailText(content)
    expect(text).toContain(content.cta.url)
    expect(text).toContain(content.unsubscribeUrl)
  })

  it('contains the heading, campaign title and body copy', () => {
    const content = baseContent()
    const text = renderWtfEmailText(content)
    expect(text).toContain(content.heading)
    expect(text).toContain(content.campaignTitle)
    expect(text).toContain('Line one.')
  })
})

// ===========================================================================
// PREVIEW — same renderer, representative & safe data
// ===========================================================================
describe('Stage 038 — abandoned checkout preview sample', () => {
  it('renders through the SAME production renderMarketingEmail without throwing', () => {
    const out = renderMarketingEmail(ABANDONED_CHECKOUT_PREVIEW.input)
    expect(out.html).toContain('<!DOCTYPE html>')
    expect(out.opportunityType).toBe('abandoned_checkout')
    expect(out.templateKey).toBe('abandoned_checkout_v1')
  })

  it('preview HTML contains the branded shell, campaign, CTA and unsubscribe', () => {
    const out = renderMarketingEmail(ABANDONED_CHECKOUT_PREVIEW.input)
    expect(out.html).toContain('£30,000 Tax-Free Cash')
    expect(out.html).toContain('Finish my entry')
    expect(out.html.toLowerCase()).toContain('unsubscribe')
    expect(out.html).toContain(WTF_LOGO_URL)
  })

  it('sample carries NO customer identity (no email address / personal token)', () => {
    const serialised = JSON.stringify(ABANDONED_CHECKOUT_PREVIEW.input)
    expect(serialised).not.toMatch(/@/) // no email address anywhere
    expect(serialised.toLowerCase()).not.toContain('customer')
    expect(serialised.toLowerCase()).not.toContain('recipient')
    // Representative unsubscribe token only.
    expect(serialised).toContain('preview-sample')
  })

  it('sample content is fully resolved (no leftover {{placeholders}})', () => {
    // Assert on the actual copy fields, not JSON.stringify output (whose nested
    // object boundaries legitimately contain "}}"). A mustache placeholder is an
    // opening "{{" — the renderer fails closed on any such delimiter.
    const { templateSnapshot, contextSnapshot } = ABANDONED_CHECKOUT_PREVIEW.input
    const copy = [
      templateSnapshot.subject,
      templateSnapshot.previewText ?? '',
      templateSnapshot.heading,
      templateSnapshot.bodyText,
      templateSnapshot.ctaLabel,
      contextSnapshot.campaign?.title ?? '',
      contextSnapshot.campaign?.url ?? '',
    ].join('\n')
    expect(copy).not.toContain('{{')
    expect(copy).not.toContain('}}')
  })
})

// ===========================================================================
// PREVIEW — admin-only, render-only (static source guards)
// ===========================================================================
describe('Stage 038 — preview route is admin-only and never sends', () => {
  const previewPage = readFileSync(
    join(REPO_ROOT, 'app/admin/marketing/preview/page.tsx'),
    'utf8',
  )
  const previewClient = readFileSync(
    join(REPO_ROOT, 'components/admin/marketing/EmailPreviewClient.tsx'),
    'utf8',
  )

  it('enforces admin authorization before rendering', () => {
    expect(previewPage).toContain('requireAdmin')
    expect(previewPage).toMatch(/requireAdmin\(\s*\{\s*roles:\s*\[\s*'admin'\s*\]/)
  })

  it('uses the real delivery renderer (not a bespoke mockup)', () => {
    expect(previewPage).toContain("from '@/lib/marketing/delivery-email'")
    expect(previewPage).toContain('renderMarketingEmail(')
  })

  it('never imports the sending provider or a send function', () => {
    expect(previewPage).not.toContain('resend-provider')
    expect(previewPage).not.toContain('sendMarketingEmailViaResend')
    expect(previewClient).not.toContain('resend-provider')
    expect(previewClient).not.toContain('sendMarketingEmailViaResend')
  })

  it('does no database work in the preview page', () => {
    expect(previewPage).not.toMatch(/supabase/i)
    expect(previewPage).not.toContain('.rpc(')
    expect(previewPage).not.toContain('getServiceSupabase')
  })

  it('renders the email HTML in a fully sandboxed iframe', () => {
    expect(previewClient).toContain('srcDoc={html}')
    expect(previewClient).toContain('sandbox=""')
  })

  it('offers both desktop and mobile viewports', () => {
    expect(previewClient).toContain('desktop')
    expect(previewClient).toContain('mobile')
  })
})

// ===========================================================================
// STAGE 039 — all six automations render distinctly & safely
// ===========================================================================

const CAMPAIGN_SPECIFIC = new Set([
  'abandoned_checkout',
  'vip_early_access',
  'regular_buyer_campaign_alert',
])
const NON_CAMPAIGN = new Set([
  'wtf_credit_waiting',
  'new_account_no_purchase',
  'lapsed_14_days',
])
const GIVEAWAYS_URL = `${WTF_SITE_URL}/giveaways`

describe('Stage 039 — six samples, one per automation', () => {
  it('exposes exactly the six automations in a stable order', () => {
    expect(MARKETING_PREVIEW_SAMPLES).toHaveLength(6)
    expect(MARKETING_PREVIEW_SAMPLES.map((s) => s.key)).toEqual([
      'abandoned_checkout',
      'vip_early_access',
      'regular_buyer_campaign_alert',
      'wtf_credit_waiting',
      'new_account_no_purchase',
      'lapsed_14_days',
    ])
  })

  it('every sample renders through the SAME production renderer (fail-closed proof)', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const out = renderMarketingEmail(sample.input)
      expect(out.html).toContain('<!DOCTYPE html>')
      expect(out.opportunityType).toBe(sample.opportunityType)
      // No unresolved placeholder survives into the final HTML or text.
      expect(out.html).not.toContain('{{')
      expect(out.text).not.toContain('{{')
    }
  })

  it('every sample includes the branded shell, logo, unsubscribe and a CTA', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const out = renderMarketingEmail(sample.input)
      expect(out.html).toContain(WTF_LOGO_URL)
      expect(out.html.toLowerCase()).toContain('unsubscribe')
      expect(out.html).toContain(sample.meta.ctaLabel)
      expect(out.html).toContain(`href="${sample.meta.ctaUrl}"`)
    }
  })

  it('each automation reads distinctly (unique subject + heading)', () => {
    const subjects = new Set(MARKETING_PREVIEW_SAMPLES.map((s) => s.meta.subject))
    const headings = new Set(MARKETING_PREVIEW_SAMPLES.map((s) => s.meta.heading))
    expect(subjects.size).toBe(6)
    expect(headings.size).toBe(6)
  })

  it('carries NO customer identity in any sample', () => {
    const serialised = JSON.stringify(MARKETING_PREVIEW_SAMPLES.map((s) => s.input))
    expect(serialised).not.toMatch(/@/)
    expect(serialised.toLowerCase()).not.toContain('recipient')
  })
})

describe('Stage 039 — campaign-specific vs non-campaign presentation', () => {
  it('campaign-specific emails show the campaign card and point the CTA at the campaign url', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES.filter((s) => CAMPAIGN_SPECIFIC.has(s.opportunityType))) {
      const out = renderMarketingEmail(sample.input)
      expect(sample.meta.campaignSpecific).toBe(true)
      expect(sample.meta.campaignTitle).toBeTruthy()
      expect(out.html).toContain(sample.meta.campaignTitle as string)
      expect(sample.input.contextSnapshot.campaign).not.toBeNull()
      expect(sample.meta.ctaUrl).toBe(sample.input.contextSnapshot.campaign?.url)
    }
  })

  it('non-campaign emails omit the campaign card and use the fixed /giveaways CTA', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES.filter((s) => NON_CAMPAIGN.has(s.opportunityType))) {
      const out = renderMarketingEmail(sample.input)
      expect(sample.meta.campaignSpecific).toBe(false)
      expect(sample.meta.campaignTitle).toBeNull()
      // context has no campaign block at all
      expect(sample.input.contextSnapshot.campaign).toBeUndefined()
      // CTA resolves to the fixed public listing
      expect(sample.meta.ctaUrl).toBe(GIVEAWAYS_URL)
      expect(out.html).toContain(`href="${GIVEAWAYS_URL}"`)
      // no "This email relates to ..." campaign footer line
      expect(out.html).not.toContain('This email relates to')
    }
  })
})

describe('Stage 039 — renderer fail-closed branching', () => {
  it('throws campaign_missing when a campaign-specific type lacks a campaign', () => {
    expect(() =>
      renderMarketingEmail({
        templateSnapshot: {
          schemaVersion: 1,
          templateKey: 'abandoned_checkout_v1',
          templateVersion: 1,
          subject: 'S',
          previewText: null,
          heading: 'H',
          bodyText: 'B',
          ctaLabel: 'C',
        },
        contextSnapshot: { schemaVersion: 1, opportunityType: 'abandoned_checkout' } as never,
        unsubscribeUrl: `${WTF_SITE_URL}/api/marketing/unsubscribe?token=x`,
      }),
    ).toThrow(/campaign_missing/)
  })

  it('throws when a non-campaign type is given a stray campaign block', () => {
    expect(() =>
      renderMarketingEmail({
        templateSnapshot: {
          schemaVersion: 1,
          templateKey: 'wtf_credit_waiting_v1',
          templateVersion: 1,
          subject: 'S',
          previewText: null,
          heading: 'H',
          bodyText: 'B',
          ctaLabel: 'C',
        },
        contextSnapshot: {
          schemaVersion: 1,
          opportunityType: 'wtf_credit_waiting',
          campaign: { title: 'X', url: `${WTF_SITE_URL}/giveaways/x` },
        } as never,
        unsubscribeUrl: `${WTF_SITE_URL}/api/marketing/unsubscribe?token=x`,
      }),
    ).toThrow(/unexpected_campaign_for_non_campaign_type/)
  })

  it('FAILS CLOSED on an unknown opportunity type (no homepage fallback)', () => {
    const attempt = () =>
      renderMarketingEmail({
        templateSnapshot: {
          schemaVersion: 1,
          templateKey: 'some_future_v1',
          templateVersion: 1,
          subject: 'S',
          previewText: null,
          heading: 'H',
          bodyText: 'B',
          ctaLabel: 'Go',
        },
        contextSnapshot: { schemaVersion: 1, opportunityType: 'some_future_type' } as never,
        unsubscribeUrl: `${WTF_SITE_URL}/api/marketing/unsubscribe?token=x`,
      })
    expect(attempt).toThrow(/unsupported_opportunity_type/)
    // And it definitely does NOT render a homepage-CTA email instead.
    expect(attempt).not.toThrow(/relates/)
  })

  it('there is NO homepage ("/") CTA fallback anywhere for any supported type', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const out = renderMarketingEmail(sample.input)
      expect(out.html).not.toContain(`href="${WTF_SITE_URL}/"`)
    }
  })

  it('every supported opportunity type resolves a concrete, non-homepage CTA', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const out = renderMarketingEmail(sample.input)
      if (NON_CAMPAIGN.has(sample.opportunityType)) {
        expect(out.html).toContain(`href="${GIVEAWAYS_URL}"`)
      } else {
        expect(out.html).toContain(`href="${sample.input.contextSnapshot.campaign?.url}"`)
      }
    }
  })
})

// ===========================================================================
// STAGE 039 — template copy migration: deterministic upsert + mapping safety.
//
// The migration is intentionally NOT executed here (SQL execution is out of
// scope for this stage). Instead each required behaviour is proven by a precise
// structural assertion on the executable SQL, which is deterministic.
// ===========================================================================
describe('Stage 039 — template copy migration (deterministic upsert)', () => {
  const MIG = readFileSync(
    join(REPO_ROOT, 'scripts/marketing/024-marketing-template-copy-all-automations.sql'),
    'utf8',
  )
  // Executable SQL with line comments stripped. Safe because no string literal
  // in this migration contains a "--" sequence (URLs use "//", dashes use "—").
  const EXEC = MIG.replace(/--[^\n]*/g, '')
  const EXEC_LC = EXEC.toLowerCase()
  // Whitespace-collapsed variant so aligned SQL (multiple spaces) still matches
  // single-space structural substrings.
  const EXEC_LC_WS = EXEC_LC.replace(/\s+/g, ' ')

  const ALL_SIX_KEYS = [
    'abandoned_checkout_v1',
    'vip_early_access_v1',
    'regular_buyer_campaign_alert_v1',
    'wtf_credit_waiting_v1',
    'new_account_no_purchase_v1',
    'lapsed_14_days_v1',
  ]

  it('declares the approved copy for all six template keys in executable SQL', () => {
    for (const key of ALL_SIX_KEYS) expect(EXEC).toContain(key)
  })

  it('updates the existing abandoned_checkout_v1 to the approved Stage 039 copy', () => {
    // New approved copy present...
    expect(EXEC).toContain('You left this one behind 👀')
    expect(EXEC).toContain("Your entry isn''t finished")
    expect(EXEC).toContain("didn''t finish your entry")
    expect(EXEC).toContain('Finish my entry')
    // ...and the earlier Stage 022 copy is gone.
    expect(EXEC).not.toContain('You left something behind')
    expect(EXEC).not.toContain('Still thinking about')
  })

  it('increments version EXACTLY ONCE, and only when content differs', () => {
    // Exactly one version bump expression, in the UPDATE's SET clause.
    const bumps = EXEC.match(/version\s*=\s*t\.version\s*\+\s*1/gi) ?? []
    expect(bumps).toHaveLength(1)
    // The UPDATE is guarded by a difference test, so identical rows are skipped
    // (a second immediate run performs no update and no further increment).
    expect(EXEC_LC).toContain('is distinct from')
    // version is NOT part of the difference predicate (it is a result, not a
    // compared field), so re-running never re-triggers on version alone.
    const whereBlock = EXEC.slice(EXEC.search(/UPDATE\s+public\.marketing_templates/i))
    const diffPredicate = whereBlock.slice(whereBlock.toLowerCase().indexOf('where'))
    expect(diffPredicate.toLowerCase()).not.toContain('version is distinct from')
  })

  it('inserts missing templates at version 1, guarded by WHERE NOT EXISTS', () => {
    expect(EXEC_LC).toContain('insert into public.marketing_templates')
    expect(EXEC_LC).toContain('where not exists')
    // Insert sources the desired-state temp table and seeds version 1.
    expect(EXEC).toContain('_stage039_desired')
  })

  it('compares/writes exactly the nine approved content fields', () => {
    for (const field of [
      'name',
      'subject',
      'preview_text',
      'heading',
      'body_text',
      'cta_label',
      'default_url',
      'discount_code_id',
      'is_active',
    ]) {
      expect(EXEC_LC_WS).toContain(`${field} is distinct from`)
    }
  })

  it('FAILS CLOSED if all six automations are not present', () => {
    expect(EXEC_LC).toContain('raise exception')
    expect(EXEC).toMatch(/found\s+6\s+marketing automations|expected 6 marketing automations/i)
  })

  it('FAILS CLOSED (before any write) if an automation is mapped to the WRONG template', () => {
    // Guard 2: a non-NULL template_id whose key differs from expected aborts.
    expect(EXEC_LC).toContain('unexpected template')
    expect(EXEC).toMatch(/a\.template_id\s+IS NOT NULL/i)
    expect(EXEC).toMatch(/cur\.template_key\s+IS DISTINCT FROM\s+m\.expected_key/i)
  })

  it('maps NULL automations only, leaving correct existing mappings unchanged', () => {
    // Mapping UPDATE is guarded by template_id IS NULL: unmapped rows get mapped,
    // already-correct mappings are never overwritten.
    expect(EXEC).toMatch(/UPDATE\s+public\.marketing_automations/i)
    expect(EXEC_LC).toContain('a.template_id is null')
  })

  it('never enables sending, flips a control flag, or touches definitions', () => {
    expect(EXEC_LC).not.toContain('sending_enabled')
    expect(EXEC_LC).not.toContain('discovery_enabled')
    expect(EXEC).not.toMatch(/UPDATE\s+public\.marketing_control_state/i)
    expect(EXEC).not.toMatch(/marketing_opportunity_definitions/i)
    expect(EXEC).not.toMatch(/SET\s+enabled\s*=/i)
  })

  it('keeps ONLY the six known automations (no new automation rows)', () => {
    expect(EXEC).not.toMatch(/INSERT\s+INTO\s+public\.marketing_automations/i)
  })

  it('campaign default_url stays NULL; non-campaign uses the fixed /giveaways URL', () => {
    // Fixed public listing URL for the three static templates.
    const giveawaysMatches = EXEC.match(/https:\/\/www\.wtf-giveaways\.co\.uk\/giveaways/g) ?? []
    expect(giveawaysMatches.length).toBeGreaterThanOrEqual(3)
    // No homepage-root default_url is ever written.
    expect(EXEC).not.toMatch(/'https:\/\/www\.wtf-giveaways\.co\.uk\/'/)
  })
})

// ===========================================================================
// STAGE 040 — DISTINCT EMAIL LAYOUTS
//
// One WTF brand shell, six deterministic body compositions selected in code by
// opportunity type. The acceptance test: each of the six renders a VISIBLY
// different body (unique layout marker + unique structural module) while the
// shared chrome (logo, footer, unsubscribe, width, palette, escaping) is
// identical. Layout is NEVER stored in the DB and template copy never controls
// structure.
// ===========================================================================

/** opportunity type -> (expected layout, a body module unique to that layout). */
const LAYOUT_EXPECTATIONS: Record<
  string,
  { layout: string; sentinel: string }
> = {
  abandoned_checkout: { layout: 'return_to_comp', sentinel: 'Entry not completed' },
  vip_early_access: { layout: 'vip_pass', sentinel: 'Private access' },
  regular_buyer_campaign_alert: { layout: 'new_drop', sentinel: 'Just landed' },
  wtf_credit_waiting: { layout: 'wallet_credit', sentinel: 'WTF CREDIT' },
  new_account_no_purchase: { layout: 'welcome_onboarding', sentinel: 'Pick your comp' },
  lapsed_14_days: { layout: 'comeback_whatsnew', sentinel: 'Live action' },
}

describe('Stage 040 — deterministic layout selection (code, not DB/copy)', () => {
  it('maps each of the six opportunity types to its exact layout variant', () => {
    expect(resolveEmailLayout('abandoned_checkout')).toBe('return_to_comp')
    expect(resolveEmailLayout('vip_early_access')).toBe('vip_pass')
    expect(resolveEmailLayout('regular_buyer_campaign_alert')).toBe('new_drop')
    expect(resolveEmailLayout('wtf_credit_waiting')).toBe('wallet_credit')
    expect(resolveEmailLayout('new_account_no_purchase')).toBe('welcome_onboarding')
    expect(resolveEmailLayout('lapsed_14_days')).toBe('comeback_whatsnew')
  })

  it('FAILS CLOSED on an unknown opportunity type (no default layout)', () => {
    expect(() => resolveEmailLayout('some_future_type')).toThrow(/unsupported_opportunity_type/)
  })

  it('every preview sample renders its expected layout marker + unique module', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const expected = LAYOUT_EXPECTATIONS[sample.opportunityType]
      expect(expected).toBeTruthy()
      const out = renderMarketingEmail(sample.input)
      expect(out.html).toContain(`<!-- wtf-layout:${expected.layout} -->`)
      expect(out.html).toContain(expected.sentinel)
    }
  })
})

describe('Stage 040 — six emails are visibly distinct (acceptance test)', () => {
  it('the six render six DISTINCT layout markers', () => {
    const markers = MARKETING_PREVIEW_SAMPLES.map((s) => {
      const html = renderMarketingEmail(s.input).html
      const m = html.match(/<!-- wtf-layout:([a-z_]+) -->/)
      return m?.[1]
    })
    expect(markers).toHaveLength(6)
    expect(new Set(markers).size).toBe(6)
    expect(markers).toEqual([
      'return_to_comp',
      'vip_pass',
      'new_drop',
      'wallet_credit',
      'welcome_onboarding',
      'comeback_whatsnew',
    ])
  })

  it('each email carries a module the OTHER five do not', () => {
    const rendered = MARKETING_PREVIEW_SAMPLES.map((s) => ({
      type: s.opportunityType,
      html: renderMarketingEmail(s.input).html,
    }))
    for (const { type, html } of rendered) {
      const sentinel = LAYOUT_EXPECTATIONS[type].sentinel
      expect(html).toContain(sentinel)
      // No OTHER email contains this layout's unique module.
      for (const other of rendered) {
        if (other.type === type) continue
        expect(other.html).not.toContain(sentinel)
      }
    }
  })

  it('the restrained GOLD accent appears ONLY in the VIP pass layout', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const html = renderMarketingEmail(sample.input).html.toLowerCase()
      if (sample.opportunityType === 'vip_early_access') {
        expect(html).toContain('#e6b422')
      } else {
        expect(html).not.toContain('#e6b422')
      }
    }
  })
})

describe('Stage 040 — campaign vs lifecycle module rules', () => {
  it('lifecycle layouts never render the campaign card or any campaign module', () => {
    for (const key of ['wtf_credit_waiting', 'new_account_no_purchase', 'lapsed_14_days']) {
      const sample = MARKETING_PREVIEW_SAMPLES.find((s) => s.opportunityType === key)!
      const html = renderMarketingEmail(sample.input).html
      expect(html).not.toContain('Entry not completed') // return_to_comp ticket
      expect(html).not.toContain('Just landed') // new_drop launch banner
      expect(html).not.toContain('New at WTF') // new_drop poster label
      expect(html).not.toContain('Private access') // vip pass intro
      expect(html).not.toContain('This email relates to') // campaign footer line
    }
  })

  it('campaign layouts retain the frozen campaign title inside their module', () => {
    for (const key of ['abandoned_checkout', 'vip_early_access', 'regular_buyer_campaign_alert']) {
      const sample = MARKETING_PREVIEW_SAMPLES.find((s) => s.opportunityType === key)!
      const html = renderMarketingEmail(sample.input).html
      expect(html).toContain(sample.meta.campaignTitle as string)
    }
  })
})

describe('Stage 040 — shared chrome & safety are unchanged across all layouts', () => {
  it('every layout keeps the identical logo, unsubscribe, width and single <img>', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const html = renderMarketingEmail(sample.input).html
      expect(html).toContain(WTF_LOGO_URL)
      expect(html).toContain(`href="${sample.input.unsubscribeUrl}"`)
      expect(html).toContain('width="600"')
      // No layout introduces an external icon/image dependency: logo is the only <img>.
      const imgCount = (html.match(/<img /g) ?? []).length
      expect(imgCount).toBe(1)
    }
  })

  it('every layout is table-based & email-safe (no flex/grid/script/handlers)', () => {
    for (const sample of MARKETING_PREVIEW_SAMPLES) {
      const html = renderMarketingEmail(sample.input).html
      expect(html).not.toContain('display:flex')
      expect(html).not.toContain('display:grid')
      expect(html).not.toMatch(/<script/i)
      expect(html).not.toMatch(/\son\w+=/i)
      expect(html).not.toContain('javascript:')
    }
  })

  it('escaping is unchanged in a NON-default layout (wallet_credit)', () => {
    const html = renderWtfEmailShell(
      baseContent({ layout: 'wallet_credit', heading: '<script>alert(1)</script>' }),
    )
    expect(html).toContain('<!-- wtf-layout:wallet_credit -->')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('Stage 041 — each layout renders a materially different signature composition', () => {
  const htmlFor = (type: string): string => {
    const sample = MARKETING_PREVIEW_SAMPLES.find((s) => s.opportunityType === type)!
    return renderMarketingEmail(sample.input).html
  }

  it('ABANDONED is a competition TICKET (status strip + entry-not-completed receipt)', () => {
    const html = htmlFor('abandoned_checkout')
    expect(html).toContain('You left this one behind')
    expect(html).toContain('Your competition')
    expect(html).toContain('Entry not completed')
    expect(html).toContain('border-top:3px solid #ff2d87') // ticket top edge
    expect(html).toContain('dashed') // receipt tear line
  })

  it('CREDIT is a giant pink £ hero + wallet card', () => {
    const html = htmlFor('wtf_credit_waiting')
    expect(html).toContain('Your WTF wallet')
    expect(html).toContain('Credit ready to use')
    expect(html).toContain('font-size:82px') // dominant £ glyph
    expect(html).toContain('WTF CREDIT')
    expect(html).toContain('&bull;&bull;&bull;&bull; WTF') // wallet card number row
  })

  it('VIP is a gold invitation / pass', () => {
    const html = htmlFor('vip_early_access')
    expect(html).toContain('Private access')
    expect(html).toContain("You&#39;re on the list")
    expect(html.toLowerCase()).toContain('#e6b422') // gold, VIP only
    expect(html).toContain('letter-spacing:16px') // "V I P" spacing
    expect(html).toContain('Access status')
  })

  it('CAMPAIGN ALERT is a pink launch poster + ticker', () => {
    const html = htmlFor('regular_buyer_campaign_alert')
    expect(html).toContain('Just landed') // pink banner
    expect(html).toContain('New at WTF') // poster label
    expect(html).toContain('wtf-poster') // oversized campaign typography
    expect(html).toContain('Live now &bull; WTF Giveaways &bull; Live now') // ticker
  })

  it('WELCOME is a welcome banner + numbered onboarding rows', () => {
    const html = htmlFor('new_account_no_purchase')
    expect(html).toContain('Welcome<br />to WTF.')
    expect(html).toContain('wtf-stepnum') // large step numbers
    expect(html).toContain('Pick your comp')
    expect(html).toContain("You&#39;re ready.")
    // Onboarding does NOT use a campaign card or trust strip.
    expect(html).not.toContain('Secure checkout')
  })

  it('LAPSED is an editorial update with alternating full-width sections', () => {
    const html = htmlFor('lapsed_14_days')
    expect(html).toContain('The WTF update')
    expect(html).toContain('Been a minute')
    expect(html).toContain('Fresh comps') // full-width pink block
    expect(html).toContain('border-left:6px solid #ff2d87') // side-bar update
    expect(html).toContain('border-top:4px solid #ff2d87') // top-border update
    expect(html).toContain('Live action')
  })

  it('the six silhouettes are distinguished by structurally different signature markup', () => {
    // A signature substring that must appear in exactly ONE of the six emails.
    // Each signature is a piece of INLINE composition markup unique to one
    // layout (avoids the shared <style> block, whose class names appear in all).
    const signatures: Record<string, string> = {
      abandoned_checkout: 'border-top:3px solid #ff2d87',
      wtf_credit_waiting: 'font-size:82px',
      vip_early_access: 'letter-spacing:16px',
      regular_buyer_campaign_alert: 'Live now &bull; WTF Giveaways',
      new_account_no_purchase: 'Welcome<br />to WTF.',
      lapsed_14_days: 'border-left:6px solid #ff2d87',
    }
    const rendered = MARKETING_PREVIEW_SAMPLES.map((s) => ({
      type: s.opportunityType,
      html: renderMarketingEmail(s.input).html,
    }))
    for (const [type, sig] of Object.entries(signatures)) {
      const owners = rendered.filter((r) => r.html.includes(sig)).map((r) => r.type)
      expect(owners).toEqual([type])
    }
  })
})
