import 'server-only'

/* -------------------------------------------------------------------------- *
 * Host Live Feed data layer (Phase 4 — read-only, host-scoped).
 *
 * WHAT
 *   Latest instant-win winner events across the AUTHENTICATED host's assigned
 *   campaigns, for the redesigned Host Live Feed. Hosts open this directly (no
 *   "Open Live Control" / board step) during TikTok lives to see who just won.
 *
 * SECURITY MODEL
 *   Identity is ALWAYS the authenticated session user (getAdminContext) — this
 *   module never accepts a host_user_id from the caller. Winner activity is
 *   restricted server-side to campaigns assigned via campaign_hosts. A host
 *   cannot widen scope by tampering with the optional campaignId filter: an
 *   unassigned id resolves to an EMPTY feed, never another host's wins, and
 *   never all-company activity. Only 'ops', 'admin' and 'operations_admin'
 *   sessions are allowed; everyone else gets `unauthorized`.
 *
 * PERFORMANCE MODEL (no N+1, one bounded request)
 *   A fixed set of set-based queries regardless of how many campaigns the host
 *   has — never one query per campaign:
 *     1. campaign_hosts ......... this host's assigned ids
 *     2. campaigns .............. titles for the assigned ids (filter menu)
 *     3. instant_win_prizes ..... prizes for the (optionally filtered) ids
 *     4. instant_win_awards ..... latest FEED_LIMIT awards for those prizes
 *     5. entries ................ checkout_intent_id -> user_id (bulk)
 *     6. profiles_public_snapshot display names (bulk)
 *     7. profiles_private ....... real name + mobile (bulk; same one query)
 *
 * PRIVACY
 *   Returns a readable winner name (real name preferred, else public display
 *   name), the winner's MOBILE number (hosts call winners during lives), prize,
 *   competition and time. It does NOT return checkout ids, entry/ticket ids,
 *   payment data or earnings. Name and mobile originate from admin/ops-only
 *   sources and must never reach a public/customer surface — this payload is
 *   only served through the secured, host-scoped winner-feed endpoint. Mobile
 *   is read via the EXISTING bulk profiles_private lookup (no extra query).
 * -------------------------------------------------------------------------- */

import { getAdminContext } from '@/lib/admin/auth'
import { getServiceSupabase } from '@/lib/admin/live-board'
import type {
  HostFeedCampaignOption,
  HostFeedItem,
  HostLiveFeedPayload,
} from '@/lib/admin/host-live-feed-types'

export type GetHostLiveFeedResult =
  | { ok: true; data: HostLiveFeedPayload }
  | { ok: false; error: 'unauthorized' | 'service_unavailable' | 'query_failed' }

/** Maximum winner events returned in a single feed response. */
const FEED_LIMIT = 30

export async function getHostLiveFeed(opts?: {
  campaignId?: string | null
}): Promise<GetHostLiveFeedResult> {
  // 1) Identity + role strictly from the session.
  const ctx = await getAdminContext()
  if (!ctx || (ctx.role !== 'ops' && ctx.role !== 'admin' && ctx.role !== 'operations_admin')) {
    return { ok: false, error: 'unauthorized' }
  }
  const hostUserId = ctx.user.id

  let svc
  try {
    svc = getServiceSupabase()
  } catch {
    return { ok: false, error: 'service_unavailable' }
  }

  const generatedAt = new Date().toISOString()

  // 2) This host's assignments (bounded to their own rows).
  const { data: assignmentRows, error: assignErr } = await svc
    .from('campaign_hosts')
    .select('campaign_id')
    .eq('host_user_id', hostUserId)

  if (assignErr) {
    console.log('[v0] host-live-feed assignments error:', assignErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const assignedIds = [
    ...new Set((assignmentRows ?? []).map((r) => r.campaign_id as string).filter(Boolean)),
  ]

  // No assignments → safe empty state (never all-company activity).
  if (assignedIds.length === 0) {
    return { ok: true, data: { campaigns: [], items: [], generatedAt } }
  }

  // 3) Filter-menu titles for ALL assigned campaigns (so zero-win comps still
  //    appear in the selector).
  const { data: campaignRows, error: campaignErr } = await svc
    .from('campaigns')
    .select('id, title')
    .in('id', assignedIds)

  if (campaignErr) {
    console.log('[v0] host-live-feed campaigns error:', campaignErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const titleById = new Map<string, string>()
  for (const c of campaignRows ?? []) {
    titleById.set(c.id as string, (c.title ?? 'Untitled') as string)
  }
  const campaigns: HostFeedCampaignOption[] = assignedIds
    .map((id) => ({ id, title: titleById.get(id) ?? 'Untitled' }))
    .sort((a, b) => a.title.localeCompare(b.title))

  // Clamp the optional campaign filter to the AUTHORISED set. An unassigned id
  // (URL/param tampering) yields an empty selection → no data, no leak.
  const requested = opts?.campaignId?.trim() || null
  const effectiveIds = requested
    ? assignedIds.includes(requested)
      ? [requested]
      : []
    : assignedIds

  if (effectiveIds.length === 0) {
    return { ok: true, data: { campaigns, items: [], generatedAt } }
  }

  // 4) Prizes for the effective campaign set → prize_id -> { title, campaignId }.
  const { data: prizes, error: prizesErr } = await svc
    .from('instant_win_prizes')
    .select('id, prize_title, giveaway_id')
    .in('giveaway_id', effectiveIds)

  if (prizesErr) {
    console.log('[v0] host-live-feed prizes error:', prizesErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const prizeInfo = new Map<string, { title: string; campaignId: string }>()
  for (const p of prizes ?? []) {
    prizeInfo.set(p.id as string, {
      title: (p.prize_title ?? 'Instant win') as string,
      campaignId: p.giveaway_id as string,
    })
  }
  const prizeIds = [...prizeInfo.keys()]
  if (prizeIds.length === 0) {
    return { ok: true, data: { campaigns, items: [], generatedAt } }
  }

  // 5) Latest awards for those prizes only (one bounded query for ALL comps).
  const { data: awards, error: awardsErr } = await svc
    .from('instant_win_awards')
    .select('checkout_intent_id, prize_id, awarded_at')
    .in('prize_id', prizeIds)
    .order('awarded_at', { ascending: false })
    .limit(FEED_LIMIT)

  if (awardsErr) {
    console.log('[v0] host-live-feed awards error:', awardsErr.message)
    return { ok: false, error: 'query_failed' }
  }

  const awardRows = awards ?? []
  if (awardRows.length === 0) {
    return { ok: true, data: { campaigns, items: [], generatedAt } }
  }

  // 6) Resolve winner identity in bulk (no per-row calls).
  const checkoutIntentIds = [...new Set(awardRows.map((a) => a.checkout_intent_id).filter(Boolean))]
  const { data: entries } = await svc
    .from('entries')
    .select('checkout_intent_id, user_id')
    .in('checkout_intent_id', checkoutIntentIds)

  const userIdByIntent = new Map((entries ?? []).map((e) => [e.checkout_intent_id, e.user_id]))
  const userIds = [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))]

  const displayNameByUser = new Map<string, string | null>()
  const realNameByUser = new Map<string, string | null>()
  const mobileByUser = new Map<string, string | null>()
  if (userIds.length > 0) {
    const [{ data: publicProfiles }, { data: privateProfiles, error: privateErr }] = await Promise.all([
      svc.from('profiles_public_snapshot').select('user_id, display_name').in('user_id', userIds),
      // Same single bulk lookup — real_name + mobile (host needs to call winners).
      svc.from('profiles_private').select('user_id, real_name, mobile').in('user_id', userIds),
    ])
    for (const p of publicProfiles ?? []) {
      displayNameByUser.set(p.user_id as string, (p.display_name ?? null) as string | null)
    }
    // Fail-soft: a private-profile error must not break the feed; we just fall
    // back to the public display name and omit mobile for those winners.
    if (privateErr) {
      console.log('[v0] host-live-feed profiles_private (non-fatal) error:', privateErr.message)
    } else {
      for (const p of privateProfiles ?? []) {
        realNameByUser.set(p.user_id as string, (p.real_name ?? null) as string | null)
        mobileByUser.set(p.user_id as string, (p.mobile ?? null) as string | null)
      }
    }
  }

  // 7) Assemble scoped items (newest first, already ordered + bounded).
  const items: HostFeedItem[] = awardRows.map((award, i) => {
    const userId = award.checkout_intent_id ? userIdByIntent.get(award.checkout_intent_id) : null
    const realName = userId ? realNameByUser.get(userId) ?? null : null
    const displayName = userId ? displayNameByUser.get(userId) ?? null : null
    const rawMobile = userId ? mobileByUser.get(userId) ?? null : null
    // Normalise empty/whitespace to null so the UI omits the row (never blank/undefined).
    const mobile = typeof rawMobile === 'string' && rawMobile.trim() ? rawMobile.trim() : null
    const info = prizeInfo.get(award.prize_id as string)
    const campaignId = info?.campaignId ?? ''
    return {
      id: `${award.awarded_at}-${award.prize_id}-${i}`,
      createdAt: award.awarded_at as string,
      winnerName: realName || displayName || 'Player',
      mobile,
      prizeTitle: info?.title ?? 'Instant win',
      campaignId,
      campaignTitle: titleById.get(campaignId) ?? 'Competition',
    }
  })

  return { ok: true, data: { campaigns, items, generatedAt } }
}
