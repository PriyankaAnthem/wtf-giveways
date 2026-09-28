/**
 * Client-safe primitives for the Homepage Main Banner badge.
 *
 * ONLY pure constants/types/validators — no server-only import, no Supabase
 * dependency — so this can be imported by the client admin control, the server
 * hero loader, AND the admin API route (mirrors the homepage-rails split).
 *
 * The badge is the admin-selected merchandising label rendered on the hero.
 * The set is closed and matches the approved design exactly.
 */

export const HERO_BADGES = [
  'FEATURED',
  'POPULAR',
  'TRENDING',
  'ENDING SOON',
  'NEW',
  'MUST PLAY',
] as const

export type HeroBadge = (typeof HERO_BADGES)[number]

/** True when the value is one of the closed set of allowed hero badges. */
export function isHeroBadge(value: unknown): value is HeroBadge {
  return typeof value === 'string' && (HERO_BADGES as readonly string[]).includes(value)
}
