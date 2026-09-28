/**
 * Pure, client-safe helpers that power the SIMPLIFIED Tracking Links UX.
 *
 * This module contains NO database / network / cookie access. It only imports
 * the client-safe taxonomy + path helpers from `attribution.ts`. It is the
 * single source of truth for translating the plain-language choices staff make
 * ("where will this link be used?" + "where should customers land?") into the
 * controlled attribution values and safe internal paths the rest of the system
 * already expects. It changes NOTHING about the attribution architecture — it
 * just derives the exact same channel / source / destination_path values a
 * power user used to type by hand.
 */
import {
  CHANNELS,
  sanitizeDestinationPath,
  type Channel,
  type Source,
} from '@/lib/marketing/attribution'

// ---------------------------------------------------------------------------
// Placement — the friendly "Where will this link be used?" choice.
// ---------------------------------------------------------------------------

export interface PlacementPlatform {
  value: Source
  label: string
}

/**
 * A placement maps a plain-language choice to a controlled {channel, source}.
 * Most placements fix the source outright; two of them (Email, Paid social)
 * ask one extra plain-language question — the platform — which resolves the
 * source. The derived `medium` still comes from the channel via CHANNELS, so
 * staff never see or configure channel / source / medium terminology.
 */
export interface Placement {
  value: string
  label: string
  /** Short helper shown under the option, optional. */
  hint?: string
  channel: Channel
  /** Fixed source when the placement needs no platform sub-choice. */
  source?: Source
  /** Label for the secondary platform question, when present. */
  platformLabel?: string
  /** The platform choices that resolve the source, when present. */
  platforms?: PlacementPlatform[]
}

export const PLACEMENTS: Placement[] = [
  {
    value: 'email',
    label: 'Email',
    channel: 'email',
    platformLabel: 'Email platform',
    platforms: [
      { value: 'brevo', label: 'Brevo' },
      { value: 'resend', label: 'Resend' },
    ],
  },
  { value: 'sms', label: 'SMS', channel: 'sms', source: 'sms' },
  { value: 'tiktok_live', label: 'TikTok Live', channel: 'tiktok_live', source: 'tiktok' },
  {
    value: 'organic_social',
    label: 'Organic social',
    hint: 'A normal (unpaid) post on a social platform.',
    channel: 'organic_social',
    platformLabel: 'Platform',
    platforms: [
      { value: 'facebook', label: 'Facebook' },
      { value: 'instagram', label: 'Instagram' },
      { value: 'tiktok', label: 'TikTok' },
    ],
  },
  {
    value: 'paid_social',
    label: 'Paid social',
    hint: 'A paid ad on a social platform.',
    channel: 'paid_social',
    platformLabel: 'Platform',
    platforms: [
      { value: 'facebook', label: 'Facebook' },
      { value: 'instagram', label: 'Instagram' },
      { value: 'tiktok_ads', label: 'TikTok' },
      { value: 'meta', label: 'Meta Ads (other)' },
    ],
  },
  { value: 'influencer', label: 'Influencer / Creator', channel: 'influencer', source: 'influencer' },
  { value: 'referral', label: 'Other referral', channel: 'referral', source: 'referral' },
]

export function getPlacement(value: unknown): Placement | null {
  if (typeof value !== 'string') return null
  return PLACEMENTS.find((p) => p.value === value) ?? null
}

/** True when the placement asks the extra platform question. */
export function placementNeedsPlatform(p: Placement | null): boolean {
  return !!p && Array.isArray(p.platforms) && p.platforms.length > 0
}

/**
 * Resolve the controlled attribution values from a placement + optional
 * platform choice. Returns null when the placement is unknown or a required
 * platform has not been chosen / is not valid for that placement.
 */
export function resolvePlacement(
  placementValue: unknown,
  platformValue: unknown,
): { channel: Channel; source: Source; medium: string } | null {
  const p = getPlacement(placementValue)
  if (!p) return null

  let source: Source | undefined
  if (placementNeedsPlatform(p)) {
    if (typeof platformValue !== 'string') return null
    const match = p.platforms!.find((pl) => pl.value === platformValue)
    if (!match) return null
    source = match.value
  } else {
    source = p.source
  }
  if (!source) return null

  return { channel: p.channel, source, medium: CHANNELS[p.channel].medium }
}

// ---------------------------------------------------------------------------
// Destination — the friendly "Where should customers land?" choice.
// ---------------------------------------------------------------------------

export type DestinationKind = 'home' | 'competition' | 'custom'

export const HOMEPAGE_PATH = '/'
export const GIVEAWAYS_PATH = '/giveaways'

/** The public landing path for a live competition slug. */
export function competitionPath(slug: string): string {
  return `/giveaways/${slug}`
}

/** The WTF apex domain. Any subdomain of it is also accepted. */
export const WTF_ROOT_DOMAIN = 'wtf-giveaways.co.uk'

/**
 * Convert a pasted "Custom WTF page" value into a SAFE internal path, or null.
 *
 * Accepts either an already-internal path ("/giveaways/x") or a full WTF URL
 * ("https://www.wtf-giveaways.co.uk/giveaways/x"). Any non-WTF host is
 * rejected so staff can never point a tracking link at an external site.
 * `extraHosts` lets the caller allow the current preview/staging origin too.
 */
export function wtfUrlToInternalPath(raw: unknown, extraHosts: string[] = []): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // Already an internal path — sanitise and return.
  if (trimmed.startsWith('/')) return sanitizeDestinationPath(trimmed)

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  const allowed =
    host === WTF_ROOT_DOMAIN ||
    host.endsWith(`.${WTF_ROOT_DOMAIN}`) ||
    extraHosts.map((h) => h.toLowerCase()).includes(host)
  if (!allowed) return null

  return sanitizeDestinationPath(`${url.pathname}${url.search}`)
}

/** A small, human display of a stored destination path. */
export interface DestinationDescription {
  kind: DestinationKind | 'giveaways'
  /** Human title, e.g. a competition name or "Homepage". */
  title: string
  path: string
}

/** Title-case a slug as a readable fallback when no competition title is known. */
function prettifySlug(slug: string): string {
  const words = slug.split(/[-_]+/).filter(Boolean)
  if (words.length === 0) return slug
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * Describe a stored `destination_path` for display in the list / success panel.
 * `titlesBySlug` maps live-competition slugs to their titles so a giveaway path
 * shows its real name (e.g. "£15,000 INSTANT CASH") rather than the raw path.
 */
export function describeDestination(
  path: string,
  titlesBySlug: Record<string, string> = {},
): DestinationDescription {
  if (path === HOMEPAGE_PATH) return { kind: 'home', title: 'Homepage', path }
  if (path === GIVEAWAYS_PATH) return { kind: 'giveaways', title: 'All live competitions', path }

  const match = /^\/giveaways\/([^/?#]+)/.exec(path)
  if (match) {
    const slug = match[1]
    return { kind: 'competition', title: titlesBySlug[slug] ?? prettifySlug(slug), path }
  }
  return { kind: 'custom', title: path, path }
}
