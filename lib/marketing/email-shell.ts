/**
 * WTF Marketing — Stage 041 FINAL EMAIL ART DIRECTION.
 *
 * ONE WTF brand system, SIX genuinely distinct email compositions. Only the
 * shared chrome is constant across all six:
 *
 *   - the <head>, hidden preheader, logo header, legal footer + unsubscribe,
 *   - the palette, typography family, 600px email width, security architecture.
 *
 * EVERYTHING between header and footer is a bespoke, deterministic composition
 * selected in CODE by {@link WtfEmailLayout} (mapped from opportunityType by the
 * delivery renderer). No layout HTML lives in the DB and template copy never
 * controls structure. The six silhouettes are deliberately different:
 *
 *   - return_to_comp     (abandoned checkout)  — competition TICKET / receipt
 *   - wallet_credit      (WTF credit waiting)  — giant pink £ hero + wallet card
 *   - vip_pass           (VIP early access)    — gold VIP invitation / pass
 *   - new_drop           (regular buyer alert) — pink launch poster + ticker
 *   - welcome_onboarding (new account)         — welcome banner + numbered steps
 *   - comeback_whatsnew  (lapsed 14 days)      — editorial alternating updates
 *
 * EMAIL-SAFE HTML only: nested tables (no flex/grid for essential structure),
 * inline styles, no external CSS/webfont, no JavaScript, hidden preheader,
 * bulletproof CTAs, Outlook-safe fallbacks. The mobile <style> block is
 * progressive enhancement only.
 *
 * Trust posture: HERMETIC and PURE. No imports beyond types, no I/O. EVERY
 * dynamic value is treated as untrusted TEXT and HTML-escaped here (bodyText is
 * escaped BEFORE newlines become <br />). No dangerouslySetInnerHTML, no raw
 * passthrough. Callers validate snapshots first; the shell escapes again anyway
 * (defence in depth). Layout scaffolding strings (badges, step labels, module
 * titles, headlines, tickers) are FIXED brand chrome defined here — never
 * customer data and never DB copy.
 */

// ---------------------------------------------------------------------------
// Brand constants
// ---------------------------------------------------------------------------

/** Canonical public site origin (matches metadataBase / Stage 037). */
export const WTF_SITE_URL = 'https://www.wtf-giveaways.co.uk'
/** Real brand logo asset shipped in /public (never a reinvented mark). */
export const WTF_LOGO_URL = `${WTF_SITE_URL}/images/wtf-logo-main.png`

/**
 * WTF marketing email palette: near-black canvas, hot-pink action colour, and a
 * restrained warm gold (sampled to the WTF logo) used ONLY by the VIP pass — the
 * brand stays dark/pink dominant everywhere else.
 */
export const WTF_EMAIL_PALETTE = {
  bg: '#0b0b0f',
  panel: '#111116',
  card: '#15151b',
  hero: '#17171d',
  text: '#ffffff',
  muted: '#a6a6b0',
  accent: '#ff2d87',
  accentText: '#ffffff',
  onPink: '#0a0a0c',
  gold: '#e6b422',
  goldSoft: '#5a4a1a',
  border: '#292930',
} as const

/** Brand-default chrome, overridable per email type via {@link WtfEmailContent}. */
export const WTF_DEFAULT_EYEBROW = 'STILL LIVE'
export const WTF_DEFAULT_TRUST_ITEMS: readonly string[] = [
  'Secure checkout',
  'Instant confirmation',
  'Live competitions',
]
export const WTF_DEFAULT_LEGAL_LINKS: readonly WtfEmailLink[] = [
  { label: 'Terms', url: `${WTF_SITE_URL}/terms` },
  { label: 'Privacy', url: `${WTF_SITE_URL}/privacy` },
  { label: 'Contact', url: `${WTF_SITE_URL}/contact` },
]

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/**
 * The deterministic body composition for an email. Selected in code from the
 * opportunity type by the delivery renderer; NEVER stored in the DB and NEVER
 * derived from template copy.
 */
export type WtfEmailLayout =
  | 'return_to_comp'
  | 'wallet_credit'
  | 'vip_pass'
  | 'new_drop'
  | 'welcome_onboarding'
  | 'comeback_whatsnew'

export interface WtfEmailLink {
  label: string
  url: string
}

export interface WtfEmailCta {
  label: string
  url: string
}

export interface WtfEmailContent {
  /** Document <title> + accessibility; typically the frozen subject. */
  subject: string
  /** Hidden inbox preview line. Null/empty hides it entirely. */
  preheader: string | null
  /**
   * The body composition to render. Optional; defaults to `return_to_comp`
   * (the campaign-recovery ticket) so existing callers are unchanged.
   */
  layout?: WtfEmailLayout
  /** Small kicker/badge (design-specific). Defaults to the brand eyebrow. */
  eyebrow?: string | null
  /** The frozen heading snapshot — shown as the copy-region lead line. */
  heading: string
  /**
   * The frozen campaign title. Shown by the campaign layouts (ticket, VIP pass,
   * launch poster). Null/omitted for NON-campaign layouts (credit, welcome,
   * comeback): no campaign module is rendered and the footer uses generic copy.
   */
  campaignTitle?: string | null
  /** Supporting copy. Treated as TEXT; newlines become <br /> AFTER escaping. */
  bodyText: string
  /** One dominant CTA. `url` must already be a validated http(s) URL. */
  cta: WtfEmailCta
  /**
   * OPTIONAL hero artwork. Reserved for a future snapshot contract that can
   * safely supply campaign artwork; currently unused (no DB field is invented).
   */
  heroImageUrl?: string | null
  /**
   * OPTIONAL frozen campaign artwork (Stage 043 V2). Rendered PROMINENTLY inside
   * the campaign compositions (ticket / VIP pass / launch poster) at 536px wide.
   * Distinct from {@link heroImageUrl} so the existing top-hero contract is
   * unchanged. Null/omitted => no artwork block. Escaped like any other value.
   */
  campaignImageUrl?: string | null
  /**
   * OPTIONAL compact commercial facts (Stage 043 V2), already formatted by the
   * renderer (e.g. "29P AN ENTRY", "116 INSTANT PRIZES REMAIN"). At most three
   * are shown; more are ignored. Rendered as a compact strip in the campaign
   * compositions only. Treated as untrusted TEXT and escaped here.
   */
  commercialFacts?: readonly string[]
  /**
   * OPTIONAL actual frozen WTF credit amount (Stage 043 V2), pre-formatted by
   * the renderer (e.g. "£18.50"). When present, the wallet-credit hero shows
   * this real amount instead of the generic pound symbol. Escaped here.
   */
  walletCreditText?: string | null
  /** Compact trust strip. Defaults to the brand trust items. */
  trustItems?: readonly string[]
  /** Footer legal links. Defaults to the brand legal links. */
  legalLinks?: readonly WtfEmailLink[]
  /** Required, already-validated http(s) unsubscribe URL. */
  unsubscribeUrl: string
}

// ---------------------------------------------------------------------------
// HTML safety (hermetic; single source of truth for the marketing renderer)
// ---------------------------------------------------------------------------

/** Escape the five HTML-significant characters. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape THEN convert newlines to <br /> (never the other way around). */
export function escapeHtmlWithBreaks(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br />')
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const P = WTF_EMAIL_PALETTE
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif"

/** The mobile-only progressive-enhancement stylesheet. */
function styleBlock(): string {
  return `<style>
@media only screen and (max-width:620px){
  .wtf-container{width:100% !important;}
  .wtf-pad{padding-left:20px !important;padding-right:20px !important;}
  .wtf-bannerpad{padding-left:20px !important;padding-right:20px !important;}
  .wtf-heropad{padding-left:18px !important;padding-right:18px !important;}
  .wtf-hook{font-size:30px !important;line-height:1.12 !important;}
  .wtf-campaign{font-size:23px !important;}
  .wtf-poster{font-size:31px !important;}
  .wtf-drop{font-size:34px !important;}
  .wtf-welcome{font-size:38px !important;}
  .wtf-pound{font-size:68px !important;}
  .wtf-stepnum{font-size:34px !important;}
  .wtf-vip{font-size:42px !important;letter-spacing:10px !important;}
  .wtf-cta a{font-size:17px !important;}
}
@media (prefers-color-scheme:light){
  .wtf-body{background-color:${P.bg} !important;}
}
</style>`
}

// --- shared primitives -----------------------------------------------------

/**
 * The bulletproof, near-full-width CTA table. The cell carries the colour so the
 * button still shows if the anchor background is stripped. Rounded corners
 * degrade to square in Outlook. Rendered uppercase with a trailing arrow (chrome
 * only — the words are the frozen `cta.label`, never rewritten here).
 */
function ctaTable(label: string, href: string, opts?: { border?: string; big?: boolean }): string {
  const border = opts?.border ? `border:2px solid ${opts.border};` : ''
  const pad = opts?.big ? '20px 28px' : '18px 28px'
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wtf-cta">
<tr>
<td align="center" bgcolor="${P.accent}" style="background-color:${P.accent};border-radius:12px;${border}">
<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:${pad};font-family:${FONT};font-size:18px;font-weight:800;line-height:1;color:${P.accentText};text-decoration:none;border-radius:12px;letter-spacing:0.6px;text-transform:uppercase;">${escapeHtml(label)} &rarr;</a>
</td>
</tr>
</table>`
}

/** One CTA wrapped in a padded panel row. */
function ctaRow(content: WtfEmailContent, opts?: { border?: string; big?: boolean }): string {
  return `<tr>
<td class="wtf-pad" style="padding:26px 32px 4px 32px;background-color:${P.panel};">
${ctaTable(content.cta.label, content.cta.url, opts)}
</td>
</tr>`
}

/** A small, centred secondary text link (e.g. "See live competitions"). */
function textLinkRow(label: string, url: string): string {
  return `<tr>
<td class="wtf-pad" style="padding:14px 32px 0 32px;background-color:${P.panel};font-family:${FONT};text-align:center;">
<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="font-size:13px;font-weight:700;letter-spacing:0.3px;color:${P.muted};text-decoration:underline;">${escapeHtml(label)}</a>
</td>
</tr>`
}

/**
 * The copy region: the frozen heading as a bold lead line + the supporting body
 * text. Present in EVERY layout so the frozen message always shows. Not a
 * bordered "card" — plain copy on the dark canvas.
 */
function copyRegion(content: WtfEmailContent, align: 'left' | 'center' = 'left'): string {
  const heading = escapeHtml(content.heading)
  const body = escapeHtmlWithBreaks(content.bodyText)
  return `<tr>
<td class="wtf-pad" style="padding:22px 32px 0 32px;background-color:${P.panel};font-family:${FONT};text-align:${align};">
<div style="font-size:20px;line-height:1.3;font-weight:800;color:${P.text};">${heading}</div>
<p style="margin:12px 0 0 0;font-size:16px;line-height:1.6;color:${P.muted};">${body}</p>
</td>
</tr>`
}

function trustRow(content: WtfEmailContent): string {
  const items = content.trustItems ?? WTF_DEFAULT_TRUST_ITEMS
  if (items.length === 0) return ''
  const inner = items
    .map((item) => escapeHtml(item))
    .join(`<span style="color:${P.accent};padding:0 8px;">&bull;</span>`)
  return `<tr>
<td class="wtf-pad" style="padding:24px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="padding-top:18px;border-top:1px solid ${P.border};font-size:12px;font-weight:600;letter-spacing:0.3px;color:${P.muted};text-align:center;">${inner}</div>
</td>
</tr>`
}

/**
 * Frozen campaign artwork (Stage 043 V2). Rendered ONLY when the snapshot
 * supplies `campaignImageUrl`; otherwise omitted so nothing changes for V1.
 * Fixed 536px content width (600px shell minus the 32px side padding). The URL
 * and alt text are escaped; the alt is the (already-escaped) campaign title.
 */
function campaignArtworkRow(content: WtfEmailContent, title: string | null): string {
  const src = content.campaignImageUrl
  if (!src || src.trim().length === 0) return ''
  const safeSrc = escapeHtml(src.trim())
  const safeAlt = title && title.trim().length > 0 ? escapeHtml(title.trim()) : ''
  return `<tr>
<td class="wtf-pad" style="padding:24px 32px 0 32px;background-color:${P.panel};">
<img src="${safeSrc}" alt="${safeAlt}" width="536" style="display:block;width:100%;height:auto;border:0;border-radius:12px;" />
</td>
</tr>`
}

/**
 * The compact commercial-facts strip (Stage 043 V2). Shows AT MOST three
 * already-formatted facts as a single bordered card so it enhances — never
 * overwhelms — the existing hierarchy. Omitted entirely when no facts are
 * supplied (i.e. every V1 email and any V2 email without commercial data).
 */
function commercialFactsRow(content: WtfEmailContent): string {
  const facts = (content.commercialFacts ?? [])
    .filter((f) => typeof f === 'string' && f.trim().length > 0)
    .slice(0, 3)
  if (facts.length === 0) return ''
  const inner = facts
    .map((f) => `<span style="font-weight:800;color:${P.text};">${escapeHtml(f.trim())}</span>`)
    .join(`<span style="color:${P.accent};padding:0 10px;">&bull;</span>`)
  return `<tr>
<td class="wtf-pad" style="padding:22px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.card};border:1px solid ${P.border};border-left:4px solid ${P.accent};border-radius:10px;">
<tr>
<td style="padding:16px 20px;font-family:${FONT};font-size:13px;line-height:1.5;letter-spacing:0.4px;text-transform:uppercase;color:${P.muted};text-align:center;">${inner}</td>
</tr>
</table>
</td>
</tr>`
}

// --- Design 1 — return_to_comp (abandoned): competition TICKET -------------

function layoutReturnToComp(content: WtfEmailContent, title: string | null): string {
  const eyebrow = (content.eyebrow === undefined ? WTF_DEFAULT_EYEBROW : content.eyebrow) ?? 'STILL LIVE'
  const statusStrip = `<tr>
<td class="wtf-pad" style="padding:30px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${P.accent};">${escapeHtml(eyebrow)}</div>
</td>
</tr>`
  const hero = `<tr>
<td class="wtf-pad" style="padding:14px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<h1 class="wtf-hook" style="margin:0;font-size:36px;line-height:1.05;font-weight:900;color:${P.text};letter-spacing:-0.5px;">You left this one behind &#128064;</h1>
</td>
</tr>`
  const ticket = title
    ? `<tr>
<td class="wtf-pad" style="padding:24px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.card};border:1px solid ${P.border};border-top:3px solid ${P.accent};border-radius:10px;">
<tr>
<td style="padding:24px;font-family:${FONT};">
<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.muted};">Your competition</div>
<div class="wtf-campaign" style="margin-top:10px;font-size:26px;line-height:1.2;font-weight:800;color:${P.text};letter-spacing:-0.3px;">${escapeHtml(title)}</div>
<div style="margin-top:18px;border-top:1px dashed ${P.border};font-size:0;line-height:0;">&nbsp;</div>
<div style="margin-top:14px;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${P.muted};">Entry not completed</div>
</td>
</tr>
</table>
</td>
</tr>`
    : ''
  return [
    statusStrip,
    hero,
    ticket,
    campaignArtworkRow(content, title),
    commercialFactsRow(content),
    copyRegion(content),
    ctaRow(content),
    trustRow(content),
  ].join('\n')
}

// --- Design 2 — wallet_credit (credit): giant pink £ hero + wallet card -----

function layoutWalletCredit(content: WtfEmailContent): string {
  // Stage 043 V2: when the real frozen credit amount is supplied (> 0), show it
  // as the hero figure instead of the generic pound symbol. V1 (no amount)
  // keeps the original generic hero exactly.
  const hasAmount = !!(content.walletCreditText && content.walletCreditText.trim().length > 0)
  const amountHtml = hasAmount
    ? escapeHtml(content.walletCreditText!.trim())
    : '&pound;'
  const heroFigure = `<div class="wtf-pound" style="margin-top:14px;font-size:${hasAmount ? 64 : 82}px;line-height:1;font-weight:900;color:${P.onPink};">${amountHtml}</div>`
  const heroCaption = hasAmount
    ? `<div style="margin-top:14px;font-size:22px;line-height:1.1;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:${P.onPink};">WTF Credit</div>`
    : `<div style="margin-top:14px;font-size:28px;line-height:1.1;font-weight:900;color:${P.onPink};">Credit ready to use</div>`
  const pinkHero = `<tr>
<td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.accent}" style="background-color:${P.accent};">
<tr>
<td class="wtf-heropad" align="center" style="padding:44px 24px;font-family:${FONT};text-align:center;">
<div style="font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.onPink};">Your WTF wallet</div>
${heroFigure}
${heroCaption}
<div style="margin-top:10px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${P.onPink};">Sitting in your WTF account</div>
</td>
</tr>
</table>
</td>
</tr>`
  const walletCard = `<tr>
<td class="wtf-pad" style="padding:28px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.card};border:1px solid #34343d;border-left:4px solid ${P.accent};border-radius:16px;">
<tr>
<td style="padding:26px 24px;font-family:${FONT};">
<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.muted};">WTF Giveaways</div>
<div style="margin-top:28px;font-size:22px;font-weight:900;letter-spacing:1px;color:${P.text};">WTF CREDIT</div>
<div style="margin-top:6px;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.accent};">Ready to use</div>
<div style="margin-top:22px;font-size:15px;font-weight:700;letter-spacing:4px;color:${P.muted};">&bull;&bull;&bull;&bull; WTF</div>
</td>
</tr>
</table>
</td>
</tr>`
  return [
    pinkHero,
    walletCard,
    copyRegion(content),
    ctaRow(content),
    textLinkRow('See live competitions', content.cta.url),
    trustRow(content),
  ].join('\n')
}

// --- Design 3 — vip_pass (VIP): gold invitation / pass ----------------------

function layoutVipPass(content: WtfEmailContent, title: string | null): string {
  const intro = `<tr>
<td class="wtf-pad" align="center" style="padding:34px 32px 0 32px;background-color:${P.panel};font-family:${FONT};text-align:center;">
<div style="font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${P.gold};">Private access</div>
<h1 class="wtf-hook" style="margin:14px 0 0 0;font-size:32px;line-height:1.1;font-weight:800;color:${P.text};letter-spacing:-0.3px;">You&#39;re on the list</h1>
</td>
</tr>`
  const titleHtml = title
    ? `<div class="wtf-campaign" style="margin-top:4px;font-size:24px;line-height:1.25;font-weight:800;color:${P.text};">${escapeHtml(title)}</div>`
    : ''
  const pass = `<tr>
<td class="wtf-pad" style="padding:26px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d0d11;border:2px solid ${P.gold};border-radius:12px;">
<tr>
<td align="center" style="padding:30px 22px;font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${P.goldSoft};border-radius:8px;">
<tr>
<td align="center" style="padding:30px 20px;font-family:${FONT};text-align:center;">
<div style="font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${P.muted};">WTF Giveaways</div>
<div class="wtf-vip" style="margin-top:18px;font-size:48px;line-height:1;font-weight:900;letter-spacing:16px;color:${P.gold};">VIP</div>
<div style="margin-top:14px;font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.text};">Early access</div>
<div style="width:70px;height:1px;font-size:0;line-height:1px;background-color:${P.gold};margin:22px auto;">&nbsp;</div>
${titleHtml}
<div style="margin-top:22px;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.muted};">Access status</div>
<div style="margin-top:10px;"><span style="display:inline-block;padding:6px 18px;border-radius:999px;background-color:${P.accent};color:${P.accentText};font-size:12px;font-weight:800;letter-spacing:2px;">OPEN</span></div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>`
  return [
    intro,
    pass,
    campaignArtworkRow(content, title),
    commercialFactsRow(content),
    copyRegion(content, 'center'),
    ctaRow(content, { border: P.gold }),
    trustRow(content),
  ].join('\n')
}

// --- Design 4 — new_drop (regular buyer): launch poster + ticker ------------

function layoutNewDrop(content: WtfEmailContent, title: string | null): string {
  const banner = `<tr>
<td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.accent}" style="background-color:${P.accent};">
<tr>
<td class="wtf-bannerpad" style="padding:28px 32px;font-family:${FONT};">
<div class="wtf-drop" style="font-size:42px;line-height:1;font-weight:900;letter-spacing:-0.5px;text-transform:uppercase;color:${P.onPink};">Just landed</div>
</td>
</tr>
</table>
</td>
</tr>`
  const poster = title
    ? `<tr>
<td class="wtf-pad" style="padding:32px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${P.accent};">New at WTF</div>
<div class="wtf-poster" style="margin-top:12px;font-size:42px;line-height:1.05;font-weight:900;letter-spacing:-0.8px;color:${P.text};">${escapeHtml(title)}</div>
</td>
</tr>`
    : ''
  const divider = `<tr>
<td class="wtf-pad" style="padding:24px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="height:5px;font-size:0;line-height:5px;background-color:${P.accent};border-radius:3px;">&nbsp;</div>
<div style="margin-top:12px;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.accent};">Live now at WTF</div>
</td>
</tr>`
  const ticker = `<tr>
<td style="padding:26px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.accent}" style="background-color:${P.accent};">
<tr>
<td align="center" style="padding:12px 16px;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.onPink};text-align:center;">Live now &bull; WTF Giveaways &bull; Live now</td>
</tr>
</table>
</td>
</tr>`
  return [
    banner,
    poster,
    campaignArtworkRow(content, title),
    commercialFactsRow(content),
    divider,
    copyRegion(content),
    ctaRow(content, { big: true }),
    ticker,
  ].join('\n')
}

// --- Design 5 — welcome_onboarding (new account): banner + numbered steps ---

function layoutWelcomeOnboarding(content: WtfEmailContent): string {
  const banner = `<tr>
<td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.accent}" style="background-color:${P.accent};">
<tr>
<td class="wtf-bannerpad" style="padding:32px;font-family:${FONT};">
<div class="wtf-welcome" style="font-size:48px;line-height:1;font-weight:900;letter-spacing:-1px;text-transform:uppercase;color:${P.onPink};">Welcome<br />to WTF.</div>
<div style="margin-top:14px;font-size:15px;font-weight:700;color:${P.onPink};">Your account&#39;s ready. Here&#39;s how it works.</div>
</td>
</tr>
</table>
</td>
</tr>`
  const steps: Array<[string, string, string]> = [
    ['01', "See what's live", 'Browse the competitions currently open.'],
    ['02', 'Pick your comp', 'Choose the one that catches your eye.'],
    ['03', 'Enter', 'Checkout and get your entry confirmation.'],
  ]
  const stepRow = (num: string, label: string, desc: string, i: number): string => {
    const first = i === 0
    const topBorder = first ? '' : `border-top:1px solid ${P.border};`
    const padTop = first ? '26px' : '22px'
    return `<tr>
<td class="wtf-pad" style="padding:0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="72" valign="top" style="padding:${padTop} 0 22px 0;${topBorder}font-family:${FONT};">
<div class="wtf-stepnum" style="font-size:42px;line-height:1;font-weight:900;color:${P.accent};">${escapeHtml(num)}</div>
</td>
<td valign="top" style="padding:${padTop} 0 22px 14px;${topBorder}font-family:${FONT};">
<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.muted};">Step ${escapeHtml(String(i + 1))}</div>
<div style="margin-top:6px;font-size:20px;font-weight:800;letter-spacing:0.3px;color:${P.text};">${escapeHtml(label)}</div>
<div style="margin-top:6px;font-size:14px;line-height:1.5;color:${P.muted};">${escapeHtml(desc)}</div>
</td>
</tr>
</table>
</td>
</tr>`
  }
  const stepRows = steps.map(([n, l, d], i) => stepRow(n, l, d, i)).join('\n')
  const completion = `<tr>
<td class="wtf-pad" style="padding:28px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="font-size:30px;line-height:1.1;font-weight:900;letter-spacing:-0.5px;color:${P.text};">You&#39;re ready.</div>
<p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:${P.muted};">${escapeHtmlWithBreaks(content.bodyText)}</p>
</td>
</tr>`
  return [banner, stepRows, completion, ctaRow(content)].join('\n')
}

// --- Design 6 — comeback_whatsnew (lapsed): editorial alternating updates ---

function layoutComebackWhatsnew(content: WtfEmailContent): string {
  const hero = `<tr>
<td class="wtf-pad" style="padding:34px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${P.accent};">The WTF update</div>
<h1 class="wtf-hook" style="margin:14px 0 0 0;font-size:38px;line-height:1.05;font-weight:900;color:${P.text};letter-spacing:-0.5px;">Been a minute... &#128064;</h1>
<div style="margin-top:12px;font-size:16px;line-height:1.5;color:${P.muted};">Here&#39;s what&#39;s been happening.</div>
</td>
</tr>`
  const update1 = `<tr>
<td style="padding:24px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.accent}" style="background-color:${P.accent};">
<tr>
<td class="wtf-bannerpad" style="padding:28px 32px;font-family:${FONT};">
<div style="font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:-0.3px;color:${P.onPink};">Fresh comps</div>
<div style="margin-top:8px;font-size:15px;font-weight:700;color:${P.onPink};">New competitions regularly landing.</div>
</td>
</tr>
</table>
</td>
</tr>`
  const update2 = `<tr>
<td class="wtf-pad" style="padding:22px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.card};border-left:6px solid ${P.accent};border-radius:6px;">
<tr>
<td style="padding:24px 22px;font-family:${FONT};">
<div style="font-size:24px;font-weight:900;text-transform:uppercase;color:${P.text};">Instant wins</div>
<div style="margin-top:8px;font-size:15px;line-height:1.5;color:${P.muted};">Plenty of competitions include instant prizes.</div>
</td>
</tr>
</table>
</td>
</tr>`
  const update3 = `<tr>
<td class="wtf-pad" style="padding:16px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0c0c10;border-top:4px solid ${P.accent};border-radius:6px;">
<tr>
<td style="padding:24px 22px;font-family:${FONT};">
<div style="font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:${P.muted};">Live action</div>
<div style="margin-top:8px;font-size:15px;line-height:1.5;color:${P.text};">Keep an eye on WTF for live draws and updates.</div>
</td>
</tr>
</table>
</td>
</tr>`
  const ret = `<tr>
<td class="wtf-pad" style="padding:28px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="font-size:30px;line-height:1.1;font-weight:900;letter-spacing:-0.5px;color:${P.text};">Come have a look</div>
<p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:${P.muted};">${escapeHtmlWithBreaks(content.bodyText)}</p>
</td>
</tr>`
  return [hero, update1, update2, update3, ret, ctaRow(content)].join('\n')
}

// --- body composition dispatch ---------------------------------------------

/**
 * Optional campaign artwork. Rendered ONLY when the snapshot supplies a hero
 * image URL (forward contract); otherwise omitted so the logo stays the single
 * <img> in the document. Escaped like any other untrusted value.
 */
function optionalHeroImage(content: WtfEmailContent): string {
  const src = content.heroImageUrl
  if (!src || src.trim().length === 0) return ''
  const safe = escapeHtml(src.trim())
  return `<tr>
<td style="padding:0;background-color:${P.panel};">
<img src="${safe}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
</td>
</tr>`
}

/**
 * Compose the deterministic body for the selected layout. Header, footer and
 * chrome are added by {@link renderWtfEmailShell}. A hidden HTML comment marks
 * the chosen layout for diagnostics/tests (ignored by every email client).
 */
function bodyComposition(content: WtfEmailContent): string {
  const layout: WtfEmailLayout = content.layout ?? 'return_to_comp'
  const title = content.campaignTitle && content.campaignTitle.trim().length > 0
    ? content.campaignTitle.trim()
    : null
  const marker = `<!-- wtf-layout:${layout} -->`
  const hero = optionalHeroImage(content)

  switch (layout) {
    case 'wallet_credit':
      return [marker, hero, layoutWalletCredit(content)].join('\n')
    case 'vip_pass':
      return [marker, hero, layoutVipPass(content, title)].join('\n')
    case 'new_drop':
      return [marker, hero, layoutNewDrop(content, title)].join('\n')
    case 'welcome_onboarding':
      return [marker, hero, layoutWelcomeOnboarding(content)].join('\n')
    case 'comeback_whatsnew':
      return [marker, hero, layoutComebackWhatsnew(content)].join('\n')
    case 'return_to_comp':
    default:
      return [marker, hero, layoutReturnToComp(content, title)].join('\n')
  }
}

function footerBlock(content: WtfEmailContent): string {
  const unsubHref = escapeHtml(content.unsubscribeUrl)
  const legalLinks = content.legalLinks ?? WTF_DEFAULT_LEGAL_LINKS
  const legalHtml = legalLinks.length > 0
    ? `<p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:${P.muted};">${legalLinks
        .map((l) => `<a href="${escapeHtml(l.url)}" style="color:${P.muted};text-decoration:underline;">${escapeHtml(l.label)}</a>`)
        .join(`<span style="padding:0 8px;">&bull;</span>`)}</p>`
    : ''
  // Campaign emails name the competition; non-campaign emails use generic copy.
  const relatesHtml =
    content.campaignTitle && content.campaignTitle.trim().length > 0
      ? `<p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:${P.muted};">This email relates to ${escapeHtml(content.campaignTitle)}.</p>`
      : ''
  return `<tr>
<td class="wtf-pad" style="padding:28px 32px 34px 32px;background-color:${P.bg};border-top:1px solid ${P.border};font-family:${FONT};">
<div style="margin:0 0 12px 0;font-size:15px;font-weight:800;letter-spacing:0.5px;color:${P.text};">WTF<span style="color:${P.accent};">GIVEAWAYS</span></div>
${relatesHtml}
<p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:${P.muted};">You&#39;re receiving this because you opted in to WTF Giveaways marketing emails. You can stop them at any time &mdash; <a href="${unsubHref}" style="color:${P.text};text-decoration:underline;">unsubscribe here</a>.</p>
${legalHtml}
<p style="margin:0;font-size:12px;line-height:1.6;color:${P.muted};">&copy; WTF Giveaways. All rights reserved.</p>
</td>
</tr>`
}

/**
 * Render the branded WTF marketing email HTML from structured content. The
 * shared chrome (head/logo/footer) is constant; the body composition is chosen
 * deterministically by `content.layout`. Every dynamic value is escaped here
 * regardless of upstream validation.
 */
export function renderWtfEmailShell(content: WtfEmailContent): string {
  const subject = escapeHtml(content.subject)
  const preheader = content.preheader && content.preheader.trim().length > 0
    ? escapeHtml(content.preheader.trim())
    : ''
  const logo = escapeHtml(WTF_LOGO_URL)

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark light" />
<meta name="x-apple-disable-message-reformatting" />
<title>${subject}</title>
${styleBlock()}
</head>
<body class="wtf-body" style="margin:0;padding:0;background-color:${P.bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;line-height:0;overflow:hidden;mso-hide:all;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.bg};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" class="wtf-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:${P.panel};border:1px solid ${P.border};border-radius:18px;overflow:hidden;">
<tr>
<td align="center" style="padding:30px 40px 26px 40px;background-color:${P.bg};border-bottom:1px solid ${P.border};">
<img src="${logo}" alt="WTF Giveaways" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0;" />
</td>
</tr>
${bodyComposition(content)}
${footerBlock(content)}
</table>
</td>
</tr>
</table>
</body>
</html>`
}

/**
 * Render the plain-text alternative. Mirrors the HTML content and ALWAYS
 * includes the CTA/campaign URL and the unsubscribe URL.
 */
export function renderWtfEmailText(content: WtfEmailContent): string {
  const lines: string[] = []
  const hasCampaign = !!(content.campaignTitle && content.campaignTitle.trim().length > 0)
  const campaignTitle = hasCampaign ? content.campaignTitle!.trim() : ''
  const eyebrow = content.eyebrow === undefined ? WTF_DEFAULT_EYEBROW : content.eyebrow
  if (eyebrow && eyebrow.trim().length > 0) lines.push(eyebrow.trim().toUpperCase())
  lines.push(content.heading)
  lines.push('')
  if (hasCampaign) {
    lines.push(campaignTitle)
    lines.push('')
  }
  // Stage 043 V2: the actual wallet credit amount (wallet_credit layout).
  if (content.walletCreditText && content.walletCreditText.trim().length > 0) {
    lines.push(`WTF Credit: ${content.walletCreditText.trim()}`)
    lines.push('')
  }
  // Stage 043 V2: up to three commercial facts (campaign layouts).
  const facts = (content.commercialFacts ?? [])
    .filter((f) => typeof f === 'string' && f.trim().length > 0)
    .slice(0, 3)
  if (facts.length > 0) {
    lines.push(facts.join(' | '))
    lines.push('')
  }
  lines.push(content.bodyText)
  lines.push('')
  lines.push(`${content.cta.label}: ${content.cta.url}`)
  lines.push('')
  const items = content.trustItems ?? WTF_DEFAULT_TRUST_ITEMS
  if (items.length > 0) lines.push(items.join(' | '))
  lines.push('')
  lines.push('---')
  if (hasCampaign) lines.push(`This email relates to ${campaignTitle}.`)
  lines.push('You are receiving this because you opted in to WTF Giveaways marketing emails.')
  lines.push(`Unsubscribe: ${content.unsubscribeUrl}`)
  return lines.join('\n')
}
