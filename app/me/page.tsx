import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AccountTabs } from "./account-tabs"

export default async function AccountPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/auth/login?redirect=/me')
  }

  // Step 1: Fetch entries
  let entries: { id: string; campaign_id: string; qty: number; created_at: string; checkout_intent_id: string | null }[] = []
  let entriesError: string | null = null

  const { data: entriesData, error: entriesErr } = await supabase
    .from('entries')
    .select('id, campaign_id, qty, created_at, checkout_intent_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (entriesErr) {
    entriesError = entriesErr.message
  } else {
    entries = entriesData ?? []
  }

  // Step 2: Fetch ticket allocations
  const allocationMap: Record<string, { start_ticket: number; end_ticket: number }> = {}

  if (entries.length > 0) {
    const entryIds = entries.map((e) => e.id)
    const { data: allocations } = await supabase
      .from('ticket_allocations')
      .select('entry_id, start_ticket, end_ticket')
      .in('entry_id', entryIds)

    if (allocations) {
      for (const a of allocations) {
        allocationMap[a.entry_id] = {
          start_ticket: a.start_ticket,
          end_ticket: a.end_ticket,
        }
      }
    }
  }

  // Step 3: Fetch campaign metadata from the PUBLIC giveaway_snapshots table.
  // The `campaigns` table is RLS-locked for the authenticated role, so reading it
  // here returns no rows (causing the "Competition" fallback). The public list
  // snapshots (one per campaign, keyed by giveaway_id, any status) are the same
  // source the public giveaway pages use and expose title + status + slug.
  // Only lightweight fields are read — no hero_image_url / remote images.
  const campaignMap: Record<string, { title: string; status: string; slug: string | null }> = {}

  if (entries.length > 0) {
    const campaignIds = [...new Set(entries.map((e) => e.campaign_id))]
    const { data: snapshots, error: snapshotsErr } = await supabase
      .from('giveaway_snapshots')
      .select('giveaway_id, payload')
      .eq('kind', 'list')
      .in('giveaway_id', campaignIds)

    if (snapshotsErr) {
      // Fail safe: leave campaignMap empty so cards degrade gracefully rather
      // than crashing /me. Cards will show their neutral fallback wording.
      console.error('[me] giveaway_snapshots lookup failed:', snapshotsErr.message)
    } else if (snapshots) {
      for (const s of snapshots) {
        const payload = (s as any).payload || {}
        campaignMap[(s as any).giveaway_id] = {
          title: payload.title || 'Giveaway',
          status: payload.status || 'unknown',
          slug: payload.slug || null,
        }
      }
    }
  }

  // Step 4: Fetch user's instant wins, keyed by checkout_intent_id.
  // An instant win belongs to the exact checkout that won, so we key by
  // checkout_intent_id (NOT campaign_id) to avoid showing a win on every entry
  // in a campaign. One checkout can now win MULTIPLE prizes, so each checkout
  // maps to an array of zero-or-more awards. Awards are NOT deduplicated by
  // title — two identical prizes (e.g. two "Yellow Card" wins) are two distinct
  // awards and must both be shown, each keyed by its own award id.
  const winsMap: Record<string, { awardId: string; prizeTitle: string; awardedAt: string }[]> = {}

  if (entries.length > 0) {
    // Only look up awards for checkouts that actually belong to this user's entries.
    const checkoutIds = [
      ...new Set(
        entries
          .map((e) => e.checkout_intent_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]

    if (checkoutIds.length > 0) {
      // Join instant_win_prizes only to get the prize title for display.
      const { data: awards } = await supabase
        .from('instant_win_awards')
        .select('id, checkout_intent_id, prize_id, awarded_at, instant_win_prizes(prize_title)')
        .in('checkout_intent_id', checkoutIds)

      if (awards) {
        for (const a of awards) {
          const checkoutIntentId = (a as any).checkout_intent_id as string | null
          // Skip awards with no checkout linkage — cannot be safely attributed.
          if (!checkoutIntentId) continue

          const prizeTitle = (a.instant_win_prizes as any)?.prize_title || 'Prize'

          if (!winsMap[checkoutIntentId]) {
            winsMap[checkoutIntentId] = []
          }

          // Every distinct award row is retained (no title-based dedup) so
          // multiple wins on one checkout each display separately.
          winsMap[checkoutIntentId].push({
            awardId: (a as any).id as string,
            prizeTitle,
            awardedAt: a.awarded_at,
          })
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a002b] via-[#2d0050] to-[#0a0014]">
      <div className="container px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">My Account</h1>
          <p className="mt-1 text-white/70">Manage your entries and profile</p>
        </div>

        <AccountTabs
          email={user.email || ''}
          entries={entries}
          entriesError={entriesError}
          allocationMap={allocationMap}
          campaignMap={campaignMap}
          winsMap={winsMap}
        />
      </div>
    </div>
  )
}
