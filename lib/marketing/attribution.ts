/**
 * Pure, dependency-free marketing-attribution core.
 *
 * Contains NO database access, NO Next.js request handling, and NO cookie I/O
 * (it only serialises/parses the cookie STRING). This is the single source of
 * truth for:
 *   - the controlled channel / source / medium taxonomy,
 *   - campaign-slug normalisation,
 *   - unambiguous short-code generation,
 *   - internal-path safety (open-redirect prevention),
 *   - the attribution-cookie payload shape + defensive parsing,
 *   - the checkout snapshot column mapping.
 *
 * It is safe to import from BOTH server routes and client components, and is
 * unit-tested in isolation.
 *
 * The taxonomy below is intentionally a strict SUBSET wrapper over the DB CHECK
 * constraints on `public.tracking_links`. Every value it can emit is guaranteed
 * to satisfy those constraints; the DB checks remain as defense-in-depth.
 */

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type Channel =
  | 'email'
  | 'sms'
  | 'tiktok_live'
  | 'organic_social'
  | 'paid_social'
  | 'influencer'
  | 'referral'

export type Source =
  | 'brevo'
  | 'resend'
  | 'tiktok'
  | 'facebook'
  | 'instagram'
  | 'meta'
  | 'tiktok_ads'
  | 'sms'
  | 'influencer'
  | 'referral'

export type Medium = 'email' | 'sms' | 'social_organic' | 'social_paid' | 'live' | 'referral'

export interface SourceOption {
  value: Source
  label: string
}

export interface ChannelConfig {
  /** Human-readable channel label for the admin UI. */
  label: string
  /** The single medium every link in this channel maps to (derived, not chosen). */
  medium: Medium
  /** The sources an admin may pick for this channel. */
  sources: SourceOption[]
}

/**
 * The controlled taxonomy. `channel` drives everything: it fixes the `medium`
 * and constrains the selectable `source`. This guarantees consistent, roll-up-
 * able attribution and keeps every emitted value inside the DB CHECK lists.
 */
export const CHANNELS: Record<Channel, ChannelConfig> = {
  email: {
    label: 'Email',
    medium: 'email',
    sources: [
      { value: 'resend', label: 'Resend' },
      { value: 'brevo', label: 'Brevo' },
    ],
  },
  sms: {
    label: 'SMS',
    medium: 'sms',
    sources: [{ value: 'sms', label: 'SMS' }],
  },
  tiktok_live: {
    label: 'TikTok Live',
    medium: 'live',
    sources: [{ value: 'tiktok', label: 'TikTok' }],
  },
  organic_social: {
    label: 'Organic social',
    medium: 'social_organic',
    sources: [
      { value: 'tiktok', label: 'TikTok' },
      { value: 'instagram', label: 'Instagram' },
      { value: 'facebook', label: 'Facebook' },
      { value: 'meta', label: 'Meta (other)' },
    ],
  },
  paid_social: {
    label: 'Paid social',
    medium: 'social_paid',
    sources: [
      { value: 'tiktok_ads', label: 'TikTok Ads' },
      { value: 'facebook', label: 'Facebook Ads' },
      { value: 'instagram', label: 'Instagram Ads' },
      { value: 'meta', label: 'Meta Ads (other)' },
    ],
  },
  influencer: {
    label: 'Influencer',
    medium: 'referral',
    sources: [{ value: 'influencer', label: 'Influencer' }],
  },
  referral: {
    label: 'Referral',
    medium: 'referral',
    sources: [{ value: 'referral', label: 'Referral' }],
  },
}

export const CHANNEL_VALUES = Object.keys(CHANNELS) as Channel[]

export function isChannel(raw: unknown): raw is Channel {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(CHANNELS, raw)
}

/** The derived medium for a channel, or null when the channel is unknown. */
export function mediumForChannel(channel: unknown): Medium | null {
  return isChannel(channel) ? CHANNELS[channel].medium : null
}

/** True only when `source` is an allowed source for `channel`. */
export function isSourceAllowedForChannel(channel: unknown, source: unknown): source is Source {
  if (!isChannel(channel) || typeof source !== 'string') return false
  return CHANNELS[channel].sources.some((s) => s.value === source)
}

// ---------------------------------------------------------------------------
// Campaign slug
// ---------------------------------------------------------------------------

const CAMPAIGN_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const CAMPAIGN_SLUG_MAX = 80

/**
 * Normalise a free-text campaign name into the canonical slug the DB stores:
 * lowercase, alphanumerics separated by single hyphens, no leading/trailing or
 * repeated hyphens, max 80 chars. Returns null when nothing valid remains.
 */
export function normalizeCampaignSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, CAMPAIGN_SLUG_MAX)
    .replace(/-+$/g, '') // re-trim in case the slice landed on a hyphen
  if (slug.length === 0 || !CAMPAIGN_SLUG_RE.test(slug)) return null
  return slug
}

// ---------------------------------------------------------------------------
// Short codes
// ---------------------------------------------------------------------------

// Unambiguous alphabet: no 0/O, 1/I/l. Matches the DB regex [A-Za-z0-9]{5,16}.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const CODE_RE = /^[A-Za-z0-9]{5,16}$/
export const DEFAULT_CODE_LENGTH = 8

/** True when a code satisfies the DB `code` CHECK. */
export function isValidShortCode(raw: unknown): raw is string {
  return typeof raw === 'string' && CODE_RE.test(raw)
}

/**
 * Generate a random short code from the unambiguous alphabet. Uses the Web
 * Crypto API when available (server + modern browsers) and falls back to
 * Math.random only if it is not. Length is clamped to the DB-legal 5–16.
 */
export function generateShortCode(length: number = DEFAULT_CODE_LENGTH): string {
  const len = Math.min(16, Math.max(5, Math.floor(length) || DEFAULT_CODE_LENGTH))
  const alphabetLen = CODE_ALPHABET.length
  let out = ''

  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(len)
    cryptoObj.getRandomValues(bytes)
    for (let i = 0; i < len; i++) {
      out += CODE_ALPHABET[bytes[i] % alphabetLen]
    }
    return out
  }

  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * alphabetLen)]
  }
  return out
}

// ---------------------------------------------------------------------------
// Internal-path safety (open-redirect prevention)
// ---------------------------------------------------------------------------

export const DESTINATION_PATH_MAX = 512

/**
 * True ONLY for a safe, same-origin internal path:
 *   - starts with a single '/',
 *   - is NOT protocol-relative ('//host'),
 *   - contains no scheme ('://'),
 *   - contains no backslash (browsers may treat '\' as '/'),
 *   - contains no whitespace / control chars,
 *   - is within the length cap.
 * This blocks every open-redirect vector (external URLs, '//evil.com',
 * 'javascript:', CRLF, etc.).
 */
export function isSafeInternalPath(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const p = raw
  if (p.length === 0 || p.length > DESTINATION_PATH_MAX) return false
  if (p[0] !== '/') return false
  if (p[1] === '/') return false // protocol-relative
  if (p.includes('://')) return false
  if (p.includes('\\')) return false
  if (/[\s\u0000-\u001f\u007f]/.test(p)) return false
  return true
}

/**
 * Coerce a free-text destination into a safe internal path, or null. Trims,
 * ensures a single leading slash, then applies `isSafeInternalPath`.
 */
export function sanitizeDestinationPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let p = raw.trim()
  if (p.length === 0) return null
  if (p[0] !== '/') p = `/${p}`
  return isSafeInternalPath(p) ? p : null
}

// ---------------------------------------------------------------------------
// Attribution cookie
// ---------------------------------------------------------------------------

/**
 * Legacy, host-only attribution cookie. Kept ONLY for read-time backward
 * compatibility with clicks made before the v2 (domain-scoped) rollout. Never
 * written anymore.
 */
export const ATTRIBUTION_COOKIE_NAME = 'wtf_attribution'

/**
 * Current attribution cookie. Written by the /t resolver and, on production WTF
 * hosts, scoped to the registrable domain so it is shared across the apex and
 * `www` (and any `*.wtf-giveaways.co.uk`) — fixing the www↔apex attribution
 * loss. A NEW name (not the legacy one) so users holding a stale host-only
 * `wtf_attribution` are unaffected and simply migrate on their next click.
 */
export const ATTRIBUTION_COOKIE_NAME_V2 = 'wtf_attribution_v2'

/** The registrable production domain attribution is scoped to. */
export const ATTRIBUTION_PRODUCTION_DOMAIN = 'wtf-giveaways.co.uk'

export const ATTRIBUTION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // 7 days
export const ATTRIBUTION_SCHEMA_VERSION = 1

/**
 * Decide the `Domain` attribute for the v2 attribution cookie from the request
 * host. Pure + dependency-free so it is unit-testable.
 *
 *   - Production apex `wtf-giveaways.co.uk`      -> 'wtf-giveaways.co.uk'
 *   - Production `www.` / any subdomain of it    -> 'wtf-giveaways.co.uk'
 *   - localhost / 127.0.0.1                       -> undefined (host-only)
 *   - Vercel previews (`*.vercel.app`) / anything -> undefined (host-only)
 *
 * Returning `undefined` means "set no Domain", leaving the cookie host-only —
 * the correct, safe behaviour off-production (a production Domain on a
 * `*.vercel.app` host would be rejected by the browser). Any port is ignored.
 */
export function attributionCookieDomain(
  hostname: string | null | undefined,
): string | undefined {
  if (typeof hostname !== 'string') return undefined
  const host = hostname.split(':')[0].trim().toLowerCase()
  if (host.length === 0) return undefined
  if (
    host === ATTRIBUTION_PRODUCTION_DOMAIN ||
    host.endsWith(`.${ATTRIBUTION_PRODUCTION_DOMAIN}`)
  ) {
    return ATTRIBUTION_PRODUCTION_DOMAIN
  }
  return undefined
}

/** The resolved, non-sensitive fields of a tracking link used for attribution. */
export interface ResolvedTrackingLink {
  id: string
  source: string
  medium: string
  channel: string
  campaign: string
  content: string | null
  ref: string | null
  provider_id: string | null
  /**
   * Optional affiliate/partner attached to the link, returned by
   * `resolve_tracking_link`. Non-affiliate links return all three as null.
   * `affiliate_commission_bps` is the affiliate's rate in basis points AT CLICK
   * TIME (10% => 1000); it is frozen into the snapshot so a later rate change
   * never rewrites historical orders. Affiliate is completely independent of
   * channel/source/medium/campaign.
   */
  affiliate_id?: string | null
  affiliate_name?: string | null
  affiliate_commission_bps?: number | null
}

/** The decoded cookie payload (also the in-memory attribution snapshot). */
export interface AttributionSnapshot {
  v: number
  linkId: string
  source: string
  medium: string
  channel: string
  campaign: string
  content: string | null
  ref: string | null
  providerId: string | null
  /** epoch ms of the click that set this attribution. */
  clickedAt: number
  /** the internal path the click landed on. */
  landingPath: string | null
  /**
   * Optional affiliate snapshot (additive; absent on pre-affiliate cookies,
   * which simply mean "no affiliate"). Frozen at click time and carried through
   * to checkout unchanged — never re-looked-up.
   */
  affiliateId?: string | null
  affiliateName?: string | null
  affiliateCommissionBps?: number | null
}

const CLAMP = 200 // generous per-field length cap for defensive parsing

/** Basis-point bounds: 0% .. 100% inclusive (0 .. 10000 bps). */
export const COMMISSION_BPS_MIN = 0
export const COMMISSION_BPS_MAX = 10000

function clampStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length === 0) return null
  return t.slice(0, CLAMP)
}

/**
 * Defensive parse of a commission basis-point value. Returns a finite integer
 * in [0, 10000], or null for anything missing/invalid. Critically, `0` is a
 * VALID, distinct value (0% commission) and is preserved — only genuinely
 * absent/invalid values become null ("no rate configured"). Non-integers are
 * rounded to the nearest bp.
 */
export function clampCommissionBps(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  if (n < COMMISSION_BPS_MIN || n > COMMISSION_BPS_MAX) return null
  return n
}

/**
 * Convert a staff-entered percentage (e.g. `10` or `12.5`) into basis points
 * (1000 / 1250). Accepts a number or numeric string. Empty/blank -> null ("no
 * rate"). Out-of-range or non-numeric -> null. `0` -> 0 (valid, distinct from
 * null). Supports up to 2 decimal places of percent precision (1 bp).
 */
export function percentToCommissionBps(input: unknown): number | null {
  if (input == null) return null
  const raw = typeof input === 'number' ? input : typeof input === 'string' ? input.trim() : null
  if (raw === null || raw === '') return null
  const pct = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(pct)) return null
  return clampCommissionBps(pct * 100)
}

/**
 * Convert basis points to a percentage number (1000 -> 10, 1250 -> 12.5), or
 * null when bps is null. For display/prefill only.
 */
export function commissionBpsToPercent(bps: number | null | undefined): number | null {
  const n = clampCommissionBps(bps)
  return n == null ? null : n / 100
}

/**
 * Human display for a commission rate. NULL renders as an em dash ("no rate
 * configured"), which is VISIBLY different from `0` which renders "0%". This
 * distinction is required by the spec.
 */
export function formatCommission(bps: number | null | undefined): string {
  const pct = commissionBpsToPercent(bps ?? null)
  if (pct == null) return '—'
  // Trim trailing zeros: 10 -> "10%", 12.5 -> "12.5%".
  return `${Number(pct.toFixed(2))}%`
}

/**
 * Build the attribution snapshot to persist in the cookie from a freshly
 * resolved tracking link + the landing path. `now` is epoch ms.
 */
export function buildSnapshot(
  link: ResolvedTrackingLink,
  landingPath: string | null,
  now: number,
): AttributionSnapshot {
  return {
    v: ATTRIBUTION_SCHEMA_VERSION,
    linkId: link.id,
    source: link.source,
    medium: link.medium,
    channel: link.channel,
    campaign: link.campaign,
    content: link.content ?? null,
    ref: link.ref ?? null,
    providerId: link.provider_id ?? null,
    clickedAt: now,
    landingPath: landingPath && isSafeInternalPath(landingPath) ? landingPath.slice(0, CLAMP) : null,
    // Affiliate frozen at click time (independent of channel/source/campaign).
    affiliateId: clampStr(link.affiliate_id),
    affiliateName: clampStr(link.affiliate_name),
    affiliateCommissionBps: clampCommissionBps(link.affiliate_commission_bps),
  }
}

/** Serialise a snapshot to the raw cookie string. Never throws. */
export function serializeAttribution(snapshot: AttributionSnapshot): string {
  try {
    return JSON.stringify(snapshot)
  } catch {
    return ''
  }
}

/**
 * Defensive parse of a raw attribution-cookie value. Returns null for anything
 * malformed, wrong-versioned, structurally invalid, or older than the 7-day
 * window (relative to `now`). NEVER throws — a bad cookie must never break a
 * page or checkout; it is simply treated as "no attribution".
 */
export function parseAttributionCookie(
  raw: string | null | undefined,
  now: number = Date.now(),
): AttributionSnapshot | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null

  let obj: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    obj = parsed as Record<string, unknown>
  } catch {
    return null
  }

  if (obj.v !== ATTRIBUTION_SCHEMA_VERSION) return null

  const linkId = clampStr(obj.linkId)
  const source = clampStr(obj.source)
  const medium = clampStr(obj.medium)
  const channel = clampStr(obj.channel)
  const campaign = clampStr(obj.campaign)
  if (!linkId || !source || !medium || !channel || !campaign) return null

  const clickedAtRaw = obj.clickedAt
  const clickedAt =
    typeof clickedAtRaw === 'number' && Number.isFinite(clickedAtRaw) ? clickedAtRaw : null
  if (clickedAt == null) return null

  // Expiry: ignore clicks older than the 7-day window. A future timestamp
  // (clock skew / tampering) is also rejected as implausible.
  const ageMs = now - clickedAt
  if (ageMs < -60_000 || ageMs > ATTRIBUTION_MAX_AGE_SECONDS * 1000) return null

  const landingPath = clampStr(obj.landingPath)

  return {
    v: ATTRIBUTION_SCHEMA_VERSION,
    linkId,
    source,
    medium,
    channel,
    campaign,
    content: clampStr(obj.content),
    ref: clampStr(obj.ref),
    providerId: clampStr(obj.providerId),
    clickedAt,
    landingPath: landingPath && isSafeInternalPath(landingPath) ? landingPath : null,
    // Affiliate fields are ADDITIVE + OPTIONAL: cookies written before the
    // affiliate rollout simply omit them and parse to null ("no affiliate").
    affiliateId: clampStr(obj.affiliateId),
    affiliateName: clampStr(obj.affiliateName),
    affiliateCommissionBps: clampCommissionBps(obj.affiliateCommissionBps),
  }
}

/**
 * Choose which raw attribution-cookie value the checkout reader should parse:
 * the domain-scoped v2 value when present (non-empty), otherwise the legacy
 * host-only value, otherwise null. An empty string counts as absent. Pure so
 * the "prefer v2 / fall back to legacy" contract is unit-testable. Note: a
 * present-but-malformed v2 value is still preferred (and will simply parse to
 * null downstream) — we only fall back when v2 is genuinely absent.
 */
export function pickAttributionCookieValue(
  v2: string | null | undefined,
  legacy: string | null | undefined,
): string | null {
  if (typeof v2 === 'string' && v2.length > 0) return v2
  if (typeof legacy === 'string' && legacy.length > 0) return legacy
  return null
}

/** The `checkout_intents` attribution columns, all snake_case + nullable. */
export interface CheckoutAttributionColumns {
  attribution_tracking_link_id: string | null
  attribution_source: string | null
  attribution_medium: string | null
  attribution_channel: string | null
  attribution_campaign: string | null
  attribution_content: string | null
  attribution_ref: string | null
  attribution_provider_id: string | null
  attribution_clicked_at: string | null
  attribution_captured_at: string | null
  attribution_landing_path: string | null
  /** Frozen affiliate snapshot (null on non-affiliate / pre-affiliate orders). */
  attribution_affiliate_id: string | null
  attribution_affiliate_name: string | null
  attribution_affiliate_commission_bps: number | null
}

/**
 * Map a decoded snapshot to the checkout_intents attribution columns. `now` is
 * the capture time. Returns null when there is no snapshot (so the caller can
 * simply omit the columns). NEVER throws.
 */
export function toCheckoutAttributionColumns(
  snapshot: AttributionSnapshot | null,
  now: number = Date.now(),
): CheckoutAttributionColumns | null {
  if (!snapshot) return null
  try {
    return {
      attribution_tracking_link_id: snapshot.linkId,
      attribution_source: snapshot.source,
      attribution_medium: snapshot.medium,
      attribution_channel: snapshot.channel,
      attribution_campaign: snapshot.campaign,
      attribution_content: snapshot.content,
      attribution_ref: snapshot.ref,
      attribution_provider_id: snapshot.providerId,
      attribution_clicked_at: new Date(snapshot.clickedAt).toISOString(),
      attribution_captured_at: new Date(now).toISOString(),
      attribution_landing_path: snapshot.landingPath,
      // Frozen affiliate snapshot; `?? null` normalises absent optional fields.
      attribution_affiliate_id: snapshot.affiliateId ?? null,
      attribution_affiliate_name: snapshot.affiliateName ?? null,
      attribution_affiliate_commission_bps: clampCommissionBps(snapshot.affiliateCommissionBps),
    }
  } catch {
    return null
  }
}
