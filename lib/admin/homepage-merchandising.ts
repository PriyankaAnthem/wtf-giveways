import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import { classifyGiveaway, type GiveawayCategory } from '@/lib/giveaway-classification'
import {
  HOMEPAGE_RAILS,
  isManualRail,
  isValidRail,
  resolveRailOrder,
  type HomepageRail,
  type MerchandisingItem,
} from '@/lib/admin/homepage-rails'

/**
 * Server-side data layer for the /admin/homepage merchandising screen.
 *
 * Whole-page load remains exactly TWO Supabase queries, run in parallel:
 *   1. eligible live `list` giveaway snapshots
 *   2. all campaign_homepage_placements rows
 *
 * `is_hidden` is a per-rail exclusion used ONLY by the two derived rails.
 * Manual rails keep their original "placement row = membership" semantics.
 */

export {
  HOMEPAGE_RAILS,
  MANUAL_RAILS,
  DERIVED_RAILS,
  isValidRail,
  isManualRail,
  isUuid,
  resolveRailOrder,
  validateRailOrderInput,
  type HomepageRail,
  type MerchandisingItem,
} from '@/lib/admin/homepage-rails'

/**
 * Admin-only extension of the existing client-safe item shape.
 *
 * Keeping this extension local means the public card/rail types do not need to
 * know about an admin-only visibility control.
 */
export type HiddenAwareMerchandisingItem = MerchandisingItem & {
  is_hidden?: boolean
}

/** Maps each derived rail to the shared classifier category that defines it. */
const DERIVED_RAIL_CATEGORY: Record<'balloon_pop' | 'instant_cash', GiveawayCategory> = {
  balloon_pop: 'live_balloon',
  instant_cash: 'instant_cash',
}

export interface HomepageMerchandisingData {
  /** Visible rail members, already ordered exactly as the homepage renders them. */
  rails: Record<HomepageRail, MerchandisingItem[]>
  /**
   * All eligible competitions for the manual picker.
   * For Balloon/Instant competitions, `is_hidden` reflects that campaign's
   * exclusion state in its derived rail so the admin can render Restore controls.
   */
  eligible: HiddenAwareMerchandisingItem[]
  /** Effective SECTION render order (always the full six rails). */
  railOrder: HomepageRail[]
}

/** One VISIBLE competition inside an ordered public rail. */
export interface RailEntry {
  payload: any
  positioned: boolean
}

/** Shared public/admin visible rail payloads. Hidden derived members are omitted. */
export type RailPayloads = Record<HomepageRail, RailEntry[]>

type PlacementRow = {
  campaign_id: string
  rail: string
  position: number
  is_hidden: boolean
}

type PlacementState = {
  position: number
  isHidden: boolean
}

/** Percentage sold from snapshot fields only (mirrors the public sort). */
function percentSold(payload: any): number {
  const sold = Number(payload?.tickets_sold ?? 0)
  const cap = Number(payload?.hard_cap_total_tickets ?? 0)
  return cap > 0 ? Math.min(100, (sold / cap) * 100) : 0
}

/** ms of `ends_at`, or +Infinity when missing/invalid (sorted last). */
function endMs(payload: any): number {
  if (!payload?.ends_at) return Number.POSITIVE_INFINITY
  const t = new Date(payload.ends_at).getTime()
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/** Stable ascending compare on campaign id (final deterministic tie-break). */
function byIdAsc(a: any, b: any): number {
  const ida = String(a?.id ?? '')
  const idb = String(b?.id ?? '')
  return ida < idb ? -1 : ida > idb ? 1 : 0
}

/**
 * Fallback ordering for UNPOSITIONED derived-rail members:
 * ends_at ASC (missing last) -> percent sold DESC -> campaign_id ASC.
 */
function fallbackCompare(a: any, b: any): number {
  const ea = endMs(a)
  const eb = endMs(b)
  if (ea !== eb) return ea - eb
  const pa = percentSold(a)
  const pb = percentSold(b)
  if (pa !== pb) return pb - pa
  return byIdAsc(a, b)
}

function toItem(
  payload: any,
  positioned: boolean,
  isHidden = false,
): HiddenAwareMerchandisingItem {
  return {
    id: String(payload.id),
    title: payload.title ?? '',
    slug: payload.slug ?? null,
    presentation_type: payload.presentation_type ?? null,
    ends_at: payload.ends_at ?? null,
    hero_image_url: payload.hero_image_url ?? null,
    category: classifyGiveaway(payload),
    positioned,
    is_hidden: isHidden,
  }
}

/**
 * Eligibility filter — identical rules to the public homepage:
 * live raffles only, excluding ended/sold_out/closed and past `ends_at`.
 */
export function filterEligiblePayloads(
  rawRows: any[] | null | undefined,
  now: number,
): any[] {
  return (rawRows ?? [])
    .map((x: any) => x.payload)
    .filter((g: any) => {
      if (!g || g.status === 'ended' || g.status === 'sold_out' || g.status === 'closed') {
        return false
      }
      if (g.status !== 'live') return false

      if (g.ends_at) {
        const t = new Date(g.ends_at).getTime()
        if (Number.isFinite(t) && t <= now) return false
      }

      return true
    })
}

/**
 * THE SINGLE public source of rail membership + ordering.
 *
 * Manual rails:
 *   placement row = membership + order.
 *
 * Derived rails:
 *   classifier = membership.
 *   no placement row = visible, fallback order.
 *   placement + is_hidden=false = visible, positioned order.
 *   placement + is_hidden=true = excluded from THIS rail only.
 *
 * A derived hide never changes classification and never affects another rail.
 */
export function buildHomepageRailPayloads(
  eligiblePayloads: any[],
  placementRows: PlacementRow[],
): RailPayloads {
  const eligibleById = new Map<string, any>()
  for (const payload of eligiblePayloads) {
    if (payload?.id != null) {
      eligibleById.set(String(payload.id), payload)
    }
  }

  const placementsByRail = new Map<
    HomepageRail,
    Map<string, PlacementState>
  >()

  for (const rail of HOMEPAGE_RAILS) {
    placementsByRail.set(rail, new Map())
  }

  for (const row of placementRows) {
    if (!isValidRail(row.rail)) continue

    placementsByRail.get(row.rail)!.set(String(row.campaign_id), {
      position: Number(row.position ?? 0),
      isHidden: row.is_hidden === true,
    })
  }

  const rails = {} as RailPayloads

  for (const rail of HOMEPAGE_RAILS) {
    const placementMap = placementsByRail.get(rail)!

    if (isManualRail(rail)) {
      // Manual semantics are deliberately unchanged. `is_hidden` is ignored.
      const placed = [...placementMap.entries()]
        .map(([campaignId, placement]) => ({
          campaignId,
          position: placement.position,
        }))
        .filter((entry) => eligibleById.has(entry.campaignId))
        .sort(
          (a, b) =>
            a.position - b.position ||
            (a.campaignId < b.campaignId
              ? -1
              : a.campaignId > b.campaignId
                ? 1
                : 0),
        )

      rails[rail] = placed.map((entry) => ({
        payload: eligibleById.get(entry.campaignId),
        positioned: true,
      }))

      continue
    }

    const derivedRail = rail as 'balloon_pop' | 'instant_cash'
    const category = DERIVED_RAIL_CATEGORY[derivedRail]

    const members = eligiblePayloads.filter(
      (payload: any) => classifyGiveaway(payload) === category,
    )

    // Explicit hides are removed before either positioned or fallback ordering.
    const visibleMembers = members.filter((payload: any) => {
      const placement = placementMap.get(String(payload.id))
      return placement?.isHidden !== true
    })

    const positioned = visibleMembers
      .filter((payload: any) => placementMap.has(String(payload.id)))
      .sort((a: any, b: any) => {
        const pa = placementMap.get(String(a.id))!.position
        const pb = placementMap.get(String(b.id))!.position
        return pa - pb || byIdAsc(a, b)
      })

    const unpositioned = visibleMembers
      .filter((payload: any) => !placementMap.has(String(payload.id)))
      .sort(fallbackCompare)

    rails[rail] = [
      ...positioned.map((payload: any) => ({
        payload,
        positioned: true,
      })),
      ...unpositioned.map((payload: any) => ({
        payload,
        positioned: false,
      })),
    ]
  }

  return rails
}

/**
 * Run the two shared queries and return eligible payloads + placement rows.
 *
 * `anon` selects the cookie-FREE client, used by the PUBLIC homepage path only.
 * Both queries read public, unfiltered merchandising data, so no session is
 * involved; the cookie-bound client merely caused supabase-js to attempt (and,
 * from a Server Component, fail to persist) a Supabase Auth token refresh on
 * every homepage render. The ADMIN path keeps the cookie-bound client so its
 * behaviour and RLS role are entirely unchanged.
 */
async function fetchRailInputs(anon = false): Promise<{
  eligiblePayloads: any[]
  placementRows: PlacementRow[]
  railOrder: HomepageRail[]
}> {
  const supabase = anon ? createPublicClient() : await createClient()

  const [snapshotRes, placementRes, orderRes] = await Promise.all([
    supabase
      .from('giveaway_snapshots')
      .select('payload')
      .eq('kind', 'list')
      .eq('payload->>status', 'live'),

    // Still ONE tiny placement query. `is_hidden` is simply one extra column.
    supabase
      .from('campaign_homepage_placements')
      .select('campaign_id, rail, position, is_hidden'),

    // One tiny (six-row) SECTION-order query, run in the SAME parallel batch —
    // no extra round trip, no N+1. supabase-js resolves (never rejects) query
    // errors, so a missing/unreadable table leaves `orderRes.data` null and we
    // fall back to the canonical HOMEPAGE_RAILS order below.
    supabase
      .from('homepage_rail_order')
      .select('rail, position'),
  ])

  const eligiblePayloads = filterEligiblePayloads(snapshotRes.data, Date.now())
  const placementRows = (placementRes.data ?? []) as PlacementRow[]
  // resolveRailOrder always returns the full six rails, appending any missing
  // ones in canonical order — a missing DB row can never drop a rail.
  const railOrder = resolveRailOrder(
    orderRes.data as { rail: string; position: number }[] | null,
  )

  return { eligiblePayloads, placementRows, railOrder }
}

/**
 * PUBLIC homepage data path:
 * exactly TWO Supabase reads, then in-memory merge.
 */
export async function loadHomepageRails(): Promise<{
  rails: RailPayloads
  eligiblePayloads: any[]
  /** Effective SECTION render order (always the full six rails). */
  railOrder: HomepageRail[]
}> {
  // `true` = cookie-free anon client. Public data only; keeps the homepage from
  // triggering a Supabase Auth token refresh on every logged-in pageview.
  const { eligiblePayloads, placementRows, railOrder } = await fetchRailInputs(true)

  return {
    rails: buildHomepageRailPayloads(eligiblePayloads, placementRows),
    eligiblePayloads,
    railOrder,
  }
}

/**
 * ADMIN merchandising data path.
 *
 * `rails` contains only visible members.
 * `eligible` additionally carries derived-rail `is_hidden` state so the existing
 * HomepageManager props can remain unchanged — no admin page wrapper change.
 */
export async function loadHomepageMerchandising(): Promise<HomepageMerchandisingData> {
  const { eligiblePayloads, placementRows, railOrder } = await fetchRailInputs()
  const railPayloads = buildHomepageRailPayloads(
    eligiblePayloads,
    placementRows,
  )

  const placementLookup = new Map<string, PlacementRow>()
  for (const row of placementRows) {
    if (!isValidRail(row.rail)) continue
    placementLookup.set(`${row.rail}:${String(row.campaign_id)}`, row)
  }

  const rails = {} as Record<HomepageRail, MerchandisingItem[]>

  for (const rail of HOMEPAGE_RAILS) {
    rails[rail] = railPayloads[rail].map((entry) =>
      toItem(entry.payload, entry.positioned, false),
    )
  }

  // Add-picker source remains every eligible competition, alphabetically.
  // The only addition is the derived rail's current hidden flag.
  const eligible = eligiblePayloads
    .map((payload: any) => {
      const category = classifyGiveaway(payload)

      const derivedRail:
        | 'balloon_pop'
        | 'instant_cash'
        | null =
        category === 'live_balloon'
          ? 'balloon_pop'
          : category === 'instant_cash'
            ? 'instant_cash'
            : null

      const placement = derivedRail
        ? placementLookup.get(`${derivedRail}:${String(payload.id)}`)
        : undefined

      return toItem(
        payload,
        Boolean(placement),
        placement?.is_hidden === true,
      )
    })
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

  return { rails, eligible, railOrder }
}
