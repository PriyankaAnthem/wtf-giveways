/**
 * WTF Giveaways — customer confirmation emails for the /contact form.
 *
 * TRANSACTIONAL, not marketing. These are triggered by a single contact-form
 * submission, are sent once, and never subscribe anyone to anything. That is
 * exactly why this does NOT use `renderWtfEmailShell` from
 * lib/marketing/email-shell.ts: that shell REQUIRES an `unsubscribeUrl` and its
 * footer asserts "You're receiving this because you opted in to WTF Giveaways
 * marketing emails" — a false statement here, and minting an unsubscribe token
 * would drag marketing consent machinery into a transactional path.
 *
 * What IS reused from the established WTF email system: the brand palette, the
 * canonical site origin, the real logo asset, and the hardened `escapeHtml`
 * helper. Same visual language, same email-safety rules, no duplicated brand
 * constants and no second mail architecture.
 *
 * Email-safe HTML only: nested tables (no flex/grid), inline styles, no
 * external CSS or webfonts, no JavaScript, hidden preheader, bulletproof CTA.
 * The <style> block is mobile progressive enhancement only.
 *
 * Trust posture: HERMETIC and PURE — no imports beyond the brand primitives, no
 * I/O, no environment reads. Every dynamic value (first name, enquiry id) is
 * treated as untrusted TEXT and HTML-escaped. Bank details are never accepted
 * as input here, so they can never be rendered.
 */

import {
  WTF_SITE_URL,
  WTF_LOGO_URL,
  WTF_EMAIL_PALETTE,
  escapeHtml,
} from '@/lib/marketing/email-shell'

const P = WTF_EMAIL_PALETTE
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif"

/** The canonical live-competitions destination (matches the site header nav). */
export const WTF_LIVE_COMPETITIONS_URL = `${WTF_SITE_URL}/giveaways`

/** Which of the two customer confirmations to render. */
export type ContactConfirmationKind = 'general' | 'winner_payout'

export interface ContactConfirmationInput {
  kind: ContactConfirmationKind
  /** Submitted first name. Blank/absent falls back to a neutral greeting. */
  firstName: string | null | undefined
  /** The id of the successfully inserted contact_enquiries row. */
  enquiryId: string
}

export interface ContactConfirmationEmail {
  subject: string
  html: string
  text: string
}

// ---------------------------------------------------------------------------
// Frozen copy — exported so tests assert the exact approved wording
// ---------------------------------------------------------------------------

export const CONTACT_CONFIRMATION_SUBJECTS = {
  general: "We've got your message 👋 | WTF Giveaways",
  winner_payout: 'Your payout details are in ✅ | WTF Giveaways',
} as const

/** The payout promise. Stated once, verbatim, with no hedging language. */
export const PAYOUT_48_HOUR_STATEMENT = 'Payouts are processed within 48 hours of submission.'

export const CONTACT_CTA_LABEL = "SEE WHAT'S LIVE"

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function styleBlock(): string {
  return `<style>
@media only screen and (max-width:620px){
  .wtf-container{width:100% !important;}
  .wtf-pad{padding-left:20px !important;padding-right:20px !important;}
  .wtf-hero{font-size:30px !important;line-height:1.14 !important;}
  .wtf-promo-title{font-size:22px !important;}
  .wtf-highlight{font-size:17px !important;}
  .wtf-cta a{font-size:17px !important;}
}
@media (prefers-color-scheme:light){
  .wtf-body{background-color:${P.bg} !important;}
}
</style>`
}

/** Hidden inbox preview line. */
function preheader(text: string): string {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(text)}</div>`
}

function logoHeader(): string {
  return `<tr>
<td class="wtf-pad" align="center" style="padding:30px 32px 26px 32px;background-color:${P.panel};">
<img src="${WTF_LOGO_URL}" alt="WTF Giveaways" width="132" style="display:block;width:132px;max-width:132px;height:auto;border:0;" />
</td>
</tr>`
}

/** Bulletproof, near-full-width CTA. The cell carries the colour as fallback. */
function ctaTable(label: string, href: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wtf-cta">
<tr>
<td align="center" bgcolor="${P.accent}" style="background-color:${P.accent};border-radius:12px;">
<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:19px 28px;font-family:${FONT};font-size:18px;font-weight:800;line-height:1;color:${P.accentText};text-decoration:none;border-radius:12px;letter-spacing:0.6px;text-transform:uppercase;">${escapeHtml(label)} &rarr;</a>
</td>
</tr>
</table>`
}

/** Eyebrow + hero heading. */
function heroRow(eyebrow: string, heading: string): string {
  return `<tr>
<td class="wtf-pad" style="padding:0 32px;background-color:${P.panel};font-family:${FONT};">
<div style="font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.accent};">${escapeHtml(eyebrow)}</div>
<h1 class="wtf-hero" style="margin:12px 0 0 0;font-size:34px;line-height:1.08;font-weight:900;color:${P.text};letter-spacing:-0.5px;">${heading}</h1>
</td>
</tr>`
}

/** Body paragraphs. `lines` are pre-escaped HTML fragments. */
function copyRow(lines: string[], topPad = 20): string {
  const body = lines
    .map(
      (line, i) =>
        `<p style="margin:${i === 0 ? '0' : '14px 0 0 0'};font-size:16px;line-height:1.62;color:${P.muted};">${line}</p>`
    )
    .join('\n')
  return `<tr>
<td class="wtf-pad" style="padding:${topPad}px 32px 0 32px;background-color:${P.panel};font-family:${FONT};">
${body}
</td>
</tr>`
}

/**
 * The prominent gold statement block. Used for the 48-hour payout promise —
 * the single most important line in the payout email.
 */
function highlightRow(text: string): string {
  return `<tr>
<td class="wtf-pad" style="padding:22px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#1b1608" style="background-color:#1b1608;border:2px solid ${P.gold};border-radius:12px;">
<tr>
<td align="center" style="padding:20px 22px;font-family:${FONT};">
<div class="wtf-highlight" style="font-size:19px;line-height:1.4;font-weight:900;color:${P.gold};text-align:center;">${escapeHtml(text)}</div>
</td>
</tr>
</table>
</td>
</tr>`
}

/** The reference card — enquiry / claim id, monospaced for legibility. */
function referenceRow(label: string, value: string): string {
  return `<tr>
<td class="wtf-pad" style="padding:22px 32px 0 32px;background-color:${P.panel};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.card};border:1px solid ${P.border};border-left:4px solid ${P.accent};border-radius:10px;">
<tr>
<td style="padding:18px 20px;font-family:${FONT};">
<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.muted};">${escapeHtml(label)}</div>
<div style="margin-top:8px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:15px;font-weight:700;line-height:1.4;color:${P.text};word-break:break-all;">${escapeHtml(value)}</div>
</td>
</tr>
</table>
</td>
</tr>`
}

/**
 * The sales opportunity — deliberately a visually separate dark card so the
 * confirmation above it still reads as the point of the email.
 */
function promoRow(title: string, body: string): string {
  return `<tr>
<td class="wtf-pad" style="padding:30px 32px 0 32px;background-color:${P.panel};">
<div style="border-top:1px solid ${P.border};font-size:0;line-height:0;">&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;background-color:${P.hero};border:1px solid ${P.border};border-radius:14px;">
<tr>
<td class="wtf-pad" style="padding:26px 24px 24px 24px;font-family:${FONT};">
<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${P.accent};">Live now</div>
<div class="wtf-promo-title" style="margin-top:10px;font-size:25px;line-height:1.18;font-weight:900;color:${P.text};letter-spacing:-0.3px;">${title}</div>
<p style="margin:12px 0 22px 0;font-size:16px;line-height:1.6;color:${P.muted};">${escapeHtml(body)}</p>
${ctaTable(CONTACT_CTA_LABEL, WTF_LIVE_COMPETITIONS_URL)}
</td>
</tr>
</table>
</td>
</tr>`
}

/** Small closing line beneath the promo (payout email only). */
function closingRow(text: string): string {
  return `<tr>
<td class="wtf-pad" align="center" style="padding:20px 32px 0 32px;background-color:${P.panel};font-family:${FONT};text-align:center;">
<div style="font-size:14px;font-weight:700;line-height:1.5;color:${P.text};">${text}</div>
</td>
</tr>`
}

/**
 * Footer. States plainly that this is a transactional confirmation — there is
 * no unsubscribe link because the recipient was never added to a mailing list.
 */
function footerRow(): string {
  const links = [
    { label: 'Terms', url: `${WTF_SITE_URL}/terms` },
    { label: 'Privacy', url: `${WTF_SITE_URL}/privacy` },
    { label: 'Contact', url: `${WTF_SITE_URL}/contact` },
  ]
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" style="color:${P.muted};text-decoration:underline;">${escapeHtml(l.label)}</a>`
    )
    .join(`<span style="color:${P.border};padding:0 8px;">|</span>`)

  return `<tr>
<td class="wtf-pad" style="padding:34px 32px 36px 32px;background-color:${P.panel};font-family:${FONT};">
<div style="padding-top:22px;border-top:1px solid ${P.border};">
<p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:${P.muted};">You&#39;re receiving this one-off email to confirm the enquiry you just submitted at wtf-giveaways.co.uk. It isn&#39;t a marketing email and you haven&#39;t been added to any mailing list.</p>
<p style="margin:0 0 12px 0;font-size:12px;line-height:1.6;color:${P.muted};">Please play responsibly. 18+ only.</p>
<div style="font-size:12px;line-height:1.6;">${links}</div>
<p style="margin:12px 0 0 0;font-size:12px;line-height:1.6;color:${P.muted};">&copy; WTF Giveaways</p>
</div>
</td>
</tr>`
}

/** Wrap the composed rows in the branded shell. */
function shell(subject: string, preheaderText: string, rows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>${escapeHtml(subject)}</title>
${styleBlock()}
</head>
<body class="wtf-body" style="margin:0;padding:0;background-color:${P.bg};">
${preheader(preheaderText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.bg}" style="background-color:${P.bg};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" class="wtf-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:${P.panel};border-radius:16px;overflow:hidden;">
${rows}
</table>
</td>
</tr>
</table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

/**
 * Build the customer confirmation email for a stored contact enquiry.
 *
 * Pure: same input always yields the same output. Never receives, and so can
 * never render, sort code / account number / any banking field.
 */
export function buildContactConfirmationEmail(
  input: ContactConfirmationInput
): ContactConfirmationEmail {
  const { kind, enquiryId } = input
  const trimmedName = (input.firstName ?? '').trim()
  const greetingName = trimmedName.length > 0 ? trimmedName : 'there'
  const greetingHtml = `<strong style="color:${P.text};">Hi ${escapeHtml(greetingName)},</strong>`
  const greetingText = `Hi ${greetingName},`
  const subject = CONTACT_CONFIRMATION_SUBJECTS[kind]

  if (kind === 'winner_payout') {
    const rows = [
      logoHeader(),
      heroRow('Claim received', 'Payout details received &#9989;'),
      copyRow([
        greetingHtml,
        "We&#39;ve securely received your payout details and your claim is now with the WTF team.",
      ]),
      highlightRow(PAYOUT_48_HOUR_STATEMENT),
      copyRow([
        "We&#39;ll verify your win and process your payout using the details you submitted.",
        `<strong style="color:${P.text};">You do not need to submit your bank details again.</strong>`,
      ]),
      referenceRow('Claim reference', enquiryId),
      promoRow('Fancy making it two wins? &#128064;', "There's plenty more up for grabs right now."),
      closingRow("Good luck &mdash; maybe we&#39;ll be paying you again soon. &#129310;"),
      footerRow(),
    ].join('\n')

    const text = [
      'PAYOUT DETAILS RECEIVED',
      '',
      greetingText,
      '',
      "We've securely received your payout details and your claim is now with the WTF team.",
      '',
      `*** ${PAYOUT_48_HOUR_STATEMENT} ***`,
      '',
      "We'll verify your win and process your payout using the details you submitted.",
      'You do not need to submit your bank details again.',
      '',
      `Claim reference: ${enquiryId}`,
      '',
      '---',
      '',
      'Fancy making it two wins?',
      "There's plenty more up for grabs right now.",
      '',
      `${CONTACT_CTA_LABEL}: ${WTF_LIVE_COMPETITIONS_URL}`,
      '',
      "Good luck - maybe we'll be paying you again soon.",
      '',
      '---',
      "You're receiving this one-off email to confirm the enquiry you just submitted at wtf-giveaways.co.uk.",
      "It isn't a marketing email and you haven't been added to any mailing list.",
      'Please play responsibly. 18+ only.',
      '(c) WTF Giveaways',
    ].join('\n')

    return {
      subject,
      html: shell(subject, 'Your payout claim is with the WTF team.', rows),
      text,
    }
  }

  const rows = [
    logoHeader(),
    heroRow('Enquiry received', 'Message received! &#127881;'),
    copyRow([
      greetingHtml,
      'Thanks for getting in touch.',
      "Your message is safely with the WTF team and we&#39;ll get back to you as soon as we can.",
    ]),
    referenceRow('Your enquiry reference', enquiryId),
    promoRow(
      'Your next win could already be waiting &#128064;',
      'New instant wins, cash prizes and giveaways are live right now.'
    ),
    footerRow(),
  ].join('\n')

  const text = [
    'MESSAGE RECEIVED',
    '',
    greetingText,
    '',
    'Thanks for getting in touch.',
    '',
    "Your message is safely with the WTF team and we'll get back to you as soon as we can.",
    '',
    `Your enquiry reference: ${enquiryId}`,
    '',
    '---',
    '',
    'Your next win could already be waiting',
    'New instant wins, cash prizes and giveaways are live right now.',
    '',
    `${CONTACT_CTA_LABEL}: ${WTF_LIVE_COMPETITIONS_URL}`,
    '',
    '---',
    "You're receiving this one-off email to confirm the enquiry you just submitted at wtf-giveaways.co.uk.",
    "It isn't a marketing email and you haven't been added to any mailing list.",
    'Please play responsibly. 18+ only.',
    '(c) WTF Giveaways',
  ].join('\n')

  return {
    subject,
    html: shell(subject, "Thanks for getting in touch — we've got your message.", rows),
    text,
  }
}
