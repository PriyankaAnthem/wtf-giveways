/**
 * Client-safe homepage merchandising primitives.
 *
 * This module contains ONLY pure constants, types, and validators. It has no
 * server-only import and no Supabase dependency, so it can be safely imported
 * by client components (the rail manager) AND by server code (the loader + API
 * route). The server-only data loader lives in `homepage-merchandising.ts`.
 */
import type { GiveawayCategory } from '@/lib/giveaway-classification'

export const HOMEPAGE_RAILS = [
  'featured',
  'balloon_pop',
  'instant_cash',
  'games',
  'cash',
  'luxury',
] as const

export type HomepageRail = (typeof HOMEPAGE_RAILS)[number]

/** Customer-facing labels for each rail (used by admin + public homepage). */
export const RAIL_LABELS: Record<HomepageRail, string> = {
  featured: 'Featured',
  balloon_pop: 'Balloon Pops',
  instant_cash: 'Instant Wins',
  games: 'Games',
  cash: 'Cash',
  luxury: 'Luxury',
}

/** Icon identity per rail — maps to a bespoke inline SVG in `components/home/rail-icons`. */
export type RailIconKey = 'hot' | 'balloon' | 'instant' | 'games' | 'cash' | 'luxury'

/**
 * Per-room card accent identity. Purely visual — drives the compact homepage
 * card's illuminated frame, CTA gradient, price tile and progress tint. The
 * concrete Tailwind class strings live in `public-giveaway-card` (full literals
 * so Tailwind v4's source scan keeps them). Keys, not classes, cross the
 * server/client boundary.
 */
export type CardAccent = 'gold' | 'magenta' | 'cyan' | 'violet' | 'emerald'

/**
 * Customer-facing presentation for the PUBLIC homepage. Database rail keys are
 * NEVER renamed — this is display copy + presentation only.
 *
 * NO emoji: each rail has a purpose-designed SVG icon (`icon`) and a restrained
 * casino accent expressed as FULL Tailwind class strings (so Tailwind v4's
 * source scan detects them — never build these by concatenation):
 *   - `navActiveClass` — illuminated ACTIVE nav chip (dark glass + accent glow)
 *   - `accentText`      — heading icon + thin divider tint
 *   - `sectionGlow`     — very faint radial atmosphere behind the section header
 * `viewAllHref` points ONLY at real catalogue routes (`/giveaways` +
 * its supported `?category=` filters); never an invented category URL.
 */
export interface RailPresentation {
  navLabel: string
  heading: string
  tagline: string
  icon: RailIconKey
  /** Per-room card accent identity (drives the compact card visual shell). */
  cardAccent: CardAccent
  /** Illuminated ACTIVE room-tab classes (dark surface + strong accent glow). */
  navActiveClass: string
  /** Idle room-tab classes — dark surface with a faint accent outline (still
   *  reads as a lit casino tab, not a flat grey pill). */
  navIdleClass: string
  accentText: string
  sectionGlow: string
  viewAllHref: string
}

export const RAIL_PRESENTATION: Record<HomepageRail, RailPresentation> = {
  featured: {
    navLabel: 'JACKPOTS',
    heading: 'MEGA JACKPOT DROPS',
    tagline: 'Big prizes. Big momentum. Get in now.',
    icon: 'hot',
    cardAccent: 'gold',
    navActiveClass:
      'bg-gradient-to-b from-amber-400/30 to-amber-500/10 text-amber-100 ring-1 ring-amber-300/70 shadow-[0_0_20px_rgba(251,191,36,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]',
    navIdleClass: 'bg-[#15012e] text-amber-100/75 ring-1 ring-amber-400/25 hover:ring-amber-300/50 hover:text-amber-100',
    accentText: 'text-amber-300',
    sectionGlow: 'bg-[radial-gradient(130%_90%_at_0%_0%,rgba(251,191,36,0.18),transparent_62%)]',
    viewAllHref: '/giveaways',
  },
  balloon_pop: {
    navLabel: 'TIKTOK POPS',
    heading: 'TIKTOK POPS',
    tagline: 'Pick your numbers. Pop for the prize.',
    icon: 'balloon',
    cardAccent: 'magenta',
    navActiveClass:
      'bg-gradient-to-b from-fuchsia-500/30 to-fuchsia-600/10 text-fuchsia-50 ring-1 ring-fuchsia-400/70 shadow-[0_0_20px_rgba(217,70,239,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]',
    navIdleClass: 'bg-[#15012e] text-fuchsia-100/75 ring-1 ring-fuchsia-400/25 hover:ring-fuchsia-300/50 hover:text-fuchsia-50',
    accentText: 'text-fuchsia-300',
    sectionGlow: 'bg-[radial-gradient(130%_90%_at_0%_0%,rgba(217,70,239,0.18),transparent_62%)]',
    viewAllHref: '/giveaways?category=live',
  },
  instant_cash: {
    navLabel: 'LUXURY PRIZES',
    heading: 'LUXURY PRIZES',
    tagline: 'Premium wins. Big brands. Serious prizes.',
    icon: 'luxury',
    cardAccent: 'cyan',
    navActiveClass:
      'bg-gradient-to-b from-cyan-400/30 to-sky-500/10 text-cyan-50 ring-1 ring-cyan-300/70 shadow-[0_0_20px_rgba(34,211,238,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]',
    navIdleClass: 'bg-[#15012e] text-cyan-100/75 ring-1 ring-cyan-400/25 hover:ring-cyan-300/50 hover:text-cyan-50',
    accentText: 'text-cyan-300',
    sectionGlow: 'bg-[radial-gradient(130%_90%_at_0%_0%,rgba(34,211,238,0.18),transparent_62%)]',
    viewAllHref: '/giveaways?category=instant',
  },
  games: {
    navLabel: 'GAMES',
    heading: 'THE GAMES FLOOR',
    tagline: "Play. Reveal. See what you've hit.",
    icon: 'games',
    cardAccent: 'violet',
    navActiveClass:
      'bg-gradient-to-b from-violet-500/30 to-violet-600/10 text-violet-50 ring-1 ring-violet-400/70 shadow-[0_0_20px_rgba(139,92,246,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]',
    navIdleClass: 'bg-[#15012e] text-violet-100/75 ring-1 ring-violet-400/25 hover:ring-violet-300/50 hover:text-violet-50',
    accentText: 'text-violet-300',
    sectionGlow: 'bg-[radial-gradient(130%_90%_at_0%_0%,rgba(139,92,246,0.18),transparent_62%)]',
    viewAllHref: '/giveaways',
  },
  cash: {
    navLabel: 'CASH',
    heading: 'CASH VAULT',
    tagline: 'Cash prizes ready to drop.',
    icon: 'cash',
    cardAccent: 'emerald',
    navActiveClass:
      'bg-gradient-to-b from-emerald-500/30 to-emerald-600/10 text-emerald-50 ring-1 ring-emerald-400/70 shadow-[0_0_20px_rgba(16,185,129,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]',
    navIdleClass: 'bg-[#15012e] text-emerald-100/75 ring-1 ring-emerald-400/25 hover:ring-emerald-300/50 hover:text-emerald-50',
    accentText: 'text-emerald-300',
    sectionGlow: 'bg-[radial-gradient(130%_90%_at_0%_0%,rgba(16,185,129,0.18),transparent_62%)]',
    viewAllHref: '/giveaways',
  },
  luxury: {
    navLabel: 'LUXURY',
    heading: 'LUXE JACKPOTS',
    tagline: 'Designer. Premium. Seriously worth winning.',
    icon: 'luxury',
    cardAccent: 'cyan',
    navActiveClass:
      'bg-gradient-to-b from-cyan-400/30 to-sky-500/10 text-cyan-50 ring-1 ring-cyan-300/70 shadow-[0_0_20px_rgba(34,211,238,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]',
    navIdleClass: 'bg-[#15012e] text-cyan-100/75 ring-1 ring-cyan-400/25 hover:ring-cyan-300/50 hover:text-cyan-50',
    accentText: 'text-cyan-100',
    sectionGlow: 'bg-[radial-gradient(130%_90%_at_0%_0%,rgba(34,211,238,0.16),transparent_62%)]',
    viewAllHref: '/giveaways',
  },
}

/** Manual rails: placement row = membership + order. */
export const MANUAL_RAILS: readonly HomepageRail[] = ['featured', 'games', 'cash', 'luxury']

/** Derived rails: membership from the classifier; placement row = order only. */
export const DERIVED_RAILS: readonly HomepageRail[] = ['balloon_pop', 'instant_cash']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate a value is one of the six allowed rails. */
export function isValidRail(value: unknown): value is HomepageRail {
  return typeof value === 'string' && (HOMEPAGE_RAILS as readonly string[]).includes(value)
}

/** True when a rail's membership is manual (placement-driven). */
export function isManualRail(rail: HomepageRail): boolean {
  return (MANUAL_RAILS as readonly string[]).includes(rail)
}

/**
 * Resolve the effective SECTION render order from persisted rows.
 *
 * Backwards-safe by construction:
 *   - stored rows are sorted by `position` (ascending);
 *   - unknown/invalid rail keys are ignored;
 *   - ANY rail missing from the stored order is appended in the canonical
 *     HOMEPAGE_RAILS order.
 *
 * The result therefore ALWAYS contains exactly the six known rails, so a
 * missing/empty/partial table can never make a rail disappear. An empty or
 * null input yields the canonical HOMEPAGE_RAILS order unchanged.
 */
export function resolveRailOrder(
  rows: ReadonlyArray<{ rail: string; position: number }> | null | undefined,
): HomepageRail[] {
  const sorted = (rows ?? [])
    .filter((row) => isValidRail(row.rail))
    .slice()
    .sort((a, b) => Number(a.position) - Number(b.position))

  const seen = new Set<HomepageRail>()
  const order: HomepageRail[] = []

  for (const row of sorted) {
    const rail = row.rail as HomepageRail
    if (!seen.has(rail)) {
      seen.add(rail)
      order.push(rail)
    }
  }

  for (const rail of HOMEPAGE_RAILS) {
    if (!seen.has(rail)) {
      seen.add(rail)
      order.push(rail)
    }
  }

  return order
}

/**
 * Validate a client-supplied section order for the atomic save.
 *
 * Requires the COMPLETE set: exactly six entries, all valid rails, no
 * duplicates. Returns the typed array on success, or null on any violation.
 * (Six distinct valid rails can only be the full known set, so this also
 * guarantees every expected rail is present.)
 */
export function validateRailOrderInput(value: unknown): HomepageRail[] | null {
  if (!Array.isArray(value) || value.length !== HOMEPAGE_RAILS.length) {
    return null
  }

  const seen = new Set<string>()
  for (const entry of value) {
    if (!isValidRail(entry) || seen.has(entry)) return null
    seen.add(entry)
  }

  return value as HomepageRail[]
}

/** Validate a value is a canonical UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** A single competition as shown in the admin merchandising UI. */
export interface MerchandisingItem {
  id: string
  title: string
  slug: string | null
  presentation_type: string | null
  ends_at: string | null
  hero_image_url: string | null
  category: GiveawayCategory
  /** True when this item currently has a placement row in the rail it appears in. */
  positioned: boolean
}
