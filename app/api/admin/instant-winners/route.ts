import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isValidUuid, normalizeSearchQuery } from '@/lib/admin/instant-win-search'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache' } }

export async function GET(request: NextRequest) {
  // Admin-only. Hosts (ops) and read_only are rejected.
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/instant-winners] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Parse query params
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)))
  const campaignId = searchParams.get('campaignId') || null
  const paidStatus = searchParams.get('paidStatus') || 'all' // all | unpaid | paid
  // `q` is the primary search param; the legacy `search` param is accepted only
  // as a temporary fallback when `q` is absent.
  const rawQuery = searchParams.get('q') ?? searchParams.get('search')

  // Validate campaignId as a UUID up front so a malformed value returns 400
  // rather than producing a Postgres error and a 500.
  if (campaignId && !isValidUuid(campaignId)) {
    return NextResponse.json({ ok: false, error: 'invalid_campaign' }, { status: 400, ...NO_STORE })
  }

  // Normalise/validate the search term (server is the authoritative layer).
  const normalized = normalizeSearchQuery(rawQuery)
  if (normalized.kind === 'error') {
    return NextResponse.json({ ok: false, error: normalized.error }, { status: 400, ...NO_STORE })
  }

  const offset = (page - 1) * limit

  try {
    // === Calculate outstanding amount via DB aggregate RPC ===
    // Uses public.get_instant_win_outstanding_pence() which sums unpaid awards server-side
    let outstandingAmountPence = 0
    try {
      const { data: rpcResult, error: rpcError } = await svc.rpc('get_instant_win_outstanding_pence')

      if (rpcError) {
        console.error('[admin/instant-winners] Outstanding RPC error (non-fatal):', rpcError.message)
        // outstandingAmountPence remains 0
      } else {
        // RPC returns a single bigint value
        outstandingAmountPence = typeof rpcResult === 'number' ? rpcResult : parseInt(rpcResult ?? '0', 10) || 0
      }
    } catch (outstandingErr: any) {
      console.error('[admin/instant-winners] Outstanding RPC exception (non-fatal):', outstandingErr?.message)
      // outstandingAmountPence remains 0
    }

    // === Resolve candidate award IDs from the search term ===
    // A supplied term builds a UNION of matching checkout-intent ids and
    // instant-win slot ids, then filters awards by that union. A blank term
    // skips resolution and returns the most recent awards.
    let candidateCheckoutIds: string[] = []
    let candidateSlotIds: string[] = []

    if (normalized.kind === 'search') {
      const checkoutIdSet = new Set<string>()
      const slotIdSet = new Set<string>()
      const userIdSet = new Set<string>()

      if (normalized.runIdentitySearch) {
        // (1) Name / email / mobile via the shared wallet identity RPC.
        //     Reuses the exact RPC name, args, result shape and error mapping.
        const { data: rpcData, error: rpcError } = await svc.rpc('admin_search_wallet_users', {
          p_query: normalized.raw,
          p_limit: 25,
        })
        if (rpcError) {
          const rawMessage = typeof rpcError.message === 'string' ? rpcError.message : ''
          console.error('[admin/instant-winners] identity RPC error:', rawMessage.slice(0, 300))
          if (rawMessage.includes('admin_wallet_search_invalid_query')) {
            return NextResponse.json({ ok: false, error: 'invalid_query' }, { status: 400, ...NO_STORE })
          }
          if (rawMessage.includes('admin_wallet_search_email_must_be_complete')) {
            return NextResponse.json(
              { ok: false, error: 'complete_email_required' },
              { status: 400, ...NO_STORE },
            )
          }
          // Any other RPC failure is non-fatal: fall back to the other sources.
        } else if (Array.isArray(rpcData)) {
          for (const row of rpcData as unknown[]) {
            const uid = (row as Record<string, unknown>)?.user_id
            if (typeof uid === 'string' && isValidUuid(uid)) userIdSet.add(uid)
          }
        }

        // (2) Display name / TikTok username (case-insensitive, escaped).
        const { data: snaps, error: snapErr } = await svc
          .from('profiles_public_snapshot')
          .select('user_id')
          .ilike('display_name', normalized.likePattern)
          .limit(500)
        if (snapErr) {
          console.error('[admin/instant-winners] display_name search error (non-fatal):', snapErr.message)
        } else {
          for (const s of snaps ?? []) if (s.user_id) userIdSet.add(s.user_id)
        }

        // (3) Checkout reference (partial, case-insensitive, escaped).
        const { data: refs, error: refErr } = await svc
          .from('checkout_intents')
          .select('id')
          .ilike('ref', normalized.likePattern)
          .limit(500)
        if (refErr) {
          console.error('[admin/instant-winners] ref search error (non-fatal):', refErr.message)
        } else {
          for (const c of refs ?? []) if (c.id) checkoutIdSet.add(c.id)
        }
      }

      // (4) Winning ticket (exact numeric match; a ticket can span campaigns).
      if (normalized.ticketNumber !== null) {
        const { data: slots, error: slotErr } = await svc
          .from('instant_win_slots')
          .select('id')
          .eq('winning_ticket', normalized.ticketNumber)
          .limit(500)
        if (slotErr) {
          console.error('[admin/instant-winners] ticket search error (non-fatal):', slotErr.message)
        } else {
          for (const s of slots ?? []) if (s.id) slotIdSet.add(s.id)
        }
      }

      // Resolve matched users -> their checkout intents in one bounded query.
      if (userIdSet.size > 0) {
        const { data: userIntents, error: uiErr } = await svc
          .from('checkout_intents')
          .select('id')
          .in('user_id', [...userIdSet])
          .limit(1000)
        if (uiErr) {
          console.error('[admin/instant-winners] user-intent resolve error (non-fatal):', uiErr.message)
        } else {
          for (const c of userIntents ?? []) if (c.id) checkoutIdSet.add(c.id)
        }
      }

      candidateCheckoutIds = [...checkoutIdSet]
      candidateSlotIds = [...slotIdSet]

      // A supplied term with zero matches returns an empty list (never all).
      if (candidateCheckoutIds.length === 0 && candidateSlotIds.length === 0) {
        return NextResponse.json(
          { ok: true, awards: [], hasNext: false, outstandingAmountPence, page, limit },
          NO_STORE,
        )
      }
    }

    // === Fetch instant_win_awards (newest first, paginated, capped) ===
    let awardsQuery = svc
      .from('instant_win_awards')
      .select('id, awarded_at, campaign_id, giveaway_id, prize_id, instant_win_slot_id, checkout_intent_id, payout_amount_pence, is_paid, paid_at, payout_notes')
      .order('awarded_at', { ascending: false })

    if (normalized.kind === 'search') {
      const orParts: string[] = []
      if (candidateCheckoutIds.length > 0) {
        orParts.push(`checkout_intent_id.in.(${candidateCheckoutIds.join(',')})`)
      }
      if (candidateSlotIds.length > 0) {
        orParts.push(`instant_win_slot_id.in.(${candidateSlotIds.join(',')})`)
      }
      awardsQuery = awardsQuery.or(orParts.join(','))
    }

    if (campaignId) {
      awardsQuery = awardsQuery.eq('campaign_id', campaignId)
    }
    if (paidStatus === 'unpaid') {
      awardsQuery = awardsQuery.eq('is_paid', false)
    } else if (paidStatus === 'paid') {
      awardsQuery = awardsQuery.eq('is_paid', true)
    }

    awardsQuery = awardsQuery.range(offset, offset + limit)

    const { data: awardsData, error: awardsError } = await awardsQuery
    if (awardsError) {
      console.error('[admin/instant-winners] Awards query error:', awardsError.message)
      return NextResponse.json({ ok: false, error: 'Failed to fetch awards' }, { status: 500, ...NO_STORE })
    }

    let awards: any[] = []
    let hasNext = false
    if (awardsData && awardsData.length > limit) {
      hasNext = true
      awards = awardsData.slice(0, limit)
    } else {
      awards = awardsData ?? []
    }

    if (awards.length === 0) {
      return NextResponse.json(
        { ok: true, awards: [], hasNext: false, outstandingAmountPence, page, limit },
        NO_STORE,
      )
    }

    // === Batch fetch related data ===
    const prizeIds = [...new Set(awards.map((a) => a.prize_id).filter(Boolean))]
    const checkoutIntentIds = [...new Set(awards.map((a) => a.checkout_intent_id).filter(Boolean))]
    const slotIds = [...new Set(awards.map((a) => a.instant_win_slot_id).filter(Boolean))]
    const campaignIds = [...new Set(awards.map((a) => a.campaign_id).filter(Boolean))]

    // Fetch campaign title/slug for the current page (single batched query).
    let campaignsData: Record<string, { title: string | null; slug: string | null }> = {}
    if (campaignIds.length > 0) {
      const { data: campaigns, error: campaignsError } = await svc
        .from('campaigns')
        .select('id, title, slug')
        .in('id', campaignIds)

      if (campaignsError) {
        console.error('[admin/instant-winners] Campaigns fetch error (non-fatal):', campaignsError.message)
      } else {
        campaignsData = Object.fromEntries(
          (campaigns ?? []).map((c) => [c.id, { title: c.title ?? null, slug: c.slug ?? null }]),
        )
      }
    }

    // Fetch instant_win_slots for the exact winning ticket per award.
    // Single batched query keyed by slot id (no per-award query -> avoids N+1).
    let slotsData: Record<string, { winning_ticket: number | null }> = {}
    if (slotIds.length > 0) {
      const { data: slots, error: slotsError } = await svc
        .from('instant_win_slots')
        .select('id, winning_ticket')
        .in('id', slotIds)

      if (slotsError) {
        console.error('[admin/instant-winners] Slots fetch error (non-fatal):', slotsError.message)
      } else {
        slotsData = Object.fromEntries(
          (slots ?? []).map((s) => [s.id, { winning_ticket: s.winning_ticket ?? null }])
        )
      }
    }

    // Fetch prizes
    let prizesData: Record<string, { prize_title: string }> = {}
    if (prizeIds.length > 0) {
      const { data: prizes, error: prizesError } = await svc
        .from('instant_win_prizes')
        .select('id, prize_title')
        .in('id', prizeIds)

      if (prizesError) {
        console.error('[admin/instant-winners] Prizes fetch error (non-fatal):', prizesError.message)
      } else {
        prizesData = Object.fromEntries(
          (prizes ?? []).map((p) => [p.id, { prize_title: p.prize_title }])
        )
      }
    }

    // Fetch checkout_intents for refs and user_ids
    let checkoutsData: Record<string, { ref: string; user_id: string }> = {}
    if (checkoutIntentIds.length > 0) {
      const { data: checkouts, error: checkoutsError } = await svc
        .from('checkout_intents')
        .select('id, ref, user_id')
        .in('id', checkoutIntentIds)

      if (checkoutsError) {
        console.error('[admin/instant-winners] Checkouts fetch error (non-fatal):', checkoutsError.message)
      } else {
        checkoutsData = Object.fromEntries(
          (checkouts ?? []).map((c) => [c.id, { ref: c.ref, user_id: c.user_id }])
        )
      }
    }

    // Fetch entries for ticket allocations - need entry_id from entries table
    let entriesData: Record<string, string> = {} // checkout_intent_id -> entry_id
    if (checkoutIntentIds.length > 0) {
      const { data: entries, error: entriesError } = await svc
        .from('entries')
        .select('id, checkout_intent_id')
        .in('checkout_intent_id', checkoutIntentIds)

      if (entriesError) {
        console.error('[admin/instant-winners] Entries fetch error (non-fatal):', entriesError.message)
      } else {
        entriesData = Object.fromEntries(
          (entries ?? []).map((e) => [e.checkout_intent_id, e.id])
        )
      }
    }

    // Fetch ticket_allocations
    const entryIds = Object.values(entriesData).filter(Boolean)
    let allocationsData: Record<string, { start_ticket: number; end_ticket: number }> = {}
    if (entryIds.length > 0) {
      const { data: allocations, error: allocError } = await svc
        .from('ticket_allocations')
        .select('entry_id, start_ticket, end_ticket')
        .in('entry_id', entryIds)

      if (allocError) {
        console.error('[admin/instant-winners] Allocations fetch error (non-fatal):', allocError.message)
      } else {
        allocationsData = Object.fromEntries(
          (allocations ?? []).map((a) => [a.entry_id, { start_ticket: a.start_ticket, end_ticket: a.end_ticket }])
        )
      }
    }

    // === Fetch customer contact details (FAIL-SOFT, max 25 users) ===
    const userIds = [...new Set(
      Object.values(checkoutsData).map((c) => c.user_id).filter(Boolean)
    )].slice(0, 25)

    let profilesData: Record<string, { real_name: string | null; mobile: string | null }> = {}
    let displayNamesData: Record<string, string | null> = {}
    let emailsData: Record<string, string | null> = {}

    if (userIds.length > 0) {
      // Fetch profiles_private
      try {
        const { data: profiles, error: profilesError } = await svc
          .from('profiles_private')
          .select('user_id, real_name, mobile')
          .in('user_id', userIds)

        if (profilesError) {
          console.error('[admin/instant-winners] Profiles fetch error (non-fatal):', profilesError.message)
        } else {
          profilesData = Object.fromEntries(
            (profiles ?? []).map((p) => [p.user_id, { real_name: p.real_name, mobile: p.mobile }])
          )
        }
      } catch (profileErr: any) {
        console.error('[admin/instant-winners] Profiles exception (non-fatal):', profileErr?.message)
      }

      // Fetch public display names (display name / TikTok username).
      try {
        const { data: snapshots, error: snapshotError } = await svc
          .from('profiles_public_snapshot')
          .select('user_id, display_name')
          .in('user_id', userIds)

        if (snapshotError) {
          console.error('[admin/instant-winners] Display name fetch error (non-fatal):', snapshotError.message)
        } else {
          displayNamesData = Object.fromEntries(
            (snapshots ?? []).map((p) => [p.user_id, p.display_name ?? null])
          )
        }
      } catch (snapErr: any) {
        console.error('[admin/instant-winners] Display name exception (non-fatal):', snapErr?.message)
      }

      // Fetch auth emails
      try {
        const emailResults = await Promise.allSettled(
          userIds.map(async (userId) => {
            try {
              const { data, error } = await svc.auth.admin.getUserById(userId)
              if (error) {
                console.error(`[admin/instant-winners] Auth lookup failed for ${userId} (non-fatal):`, error.message)
                return { userId, email: null }
              }
              return { userId, email: data?.user?.email ?? null }
            } catch (innerErr: any) {
              console.error(`[admin/instant-winners] Auth exception for ${userId} (non-fatal):`, innerErr?.message)
              return { userId, email: null }
            }
          })
        )

        for (const result of emailResults) {
          if (result.status === 'fulfilled') {
            emailsData[result.value.userId] = result.value.email
          }
        }
      } catch (emailErr: any) {
        console.error('[admin/instant-winners] Email lookup exception (non-fatal):', emailErr?.message)
      }
    }

    // === Build response ===
    const responseAwards = awards.map((award) => {
      const prize = prizesData[award.prize_id]
      const checkout = checkoutsData[award.checkout_intent_id]
      const entryId = entriesData[award.checkout_intent_id]
      const allocation = entryId ? allocationsData[entryId] : null
      const userId = checkout?.user_id
      const profile = userId ? profilesData[userId] : null
      const displayName = userId ? displayNamesData[userId] : null
      const email = userId ? emailsData[userId] : null
      const slot = award.instant_win_slot_id ? slotsData[award.instant_win_slot_id] : null
      const campaign = award.campaign_id ? campaignsData[award.campaign_id] : null

      return {
        award_id: award.id,
        awarded_at: award.awarded_at,
        campaign_id: award.campaign_id,
        campaign_title: campaign?.title ?? null,
        campaign_slug: campaign?.slug ?? null,
        giveaway_id: award.giveaway_id,
        prize_id: award.prize_id,
        prize_title: prize?.prize_title ?? 'Unknown Prize',
        checkout_intent_id: award.checkout_intent_id,
        checkout_ref: checkout?.ref ?? '-',
        user_id: userId ?? null,
        customer_name: profile?.real_name || 'Unknown',
        display_name: displayName ?? null,
        customer_email: email || '-',
        customer_mobile: profile?.mobile || '-',
        start_ticket: allocation?.start_ticket ?? null,
        end_ticket: allocation?.end_ticket ?? null,
        winning_ticket: slot?.winning_ticket ?? null,
        payout_amount_pence: award.payout_amount_pence,
        is_paid: award.is_paid ?? false,
        paid_at: award.paid_at,
        payout_notes: award.payout_notes,
      }
    })

    return NextResponse.json({
      ok: true,
      awards: responseAwards,
      hasNext,
      outstandingAmountPence,
      page,
      limit,
    }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/instant-winners] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500, ...NO_STORE })
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/instant-winners] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const body = await request.json()
    const { award_id, payout_amount_pence, is_paid, payout_notes } = body

    if (!award_id || typeof award_id !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing or invalid award_id' }, { status: 400, ...NO_STORE })
    }

    // Build update object - only payout tracking fields
    const updateData: Record<string, any> = {}

    if (payout_amount_pence !== undefined) {
      // Allow null to clear, or number to set
      if (payout_amount_pence === null || typeof payout_amount_pence === 'number') {
        updateData.payout_amount_pence = payout_amount_pence
      }
    }

    if (payout_notes !== undefined) {
      // Allow null to clear, or string to set
      if (payout_notes === null || typeof payout_notes === 'string') {
        updateData.payout_notes = payout_notes
      }
    }

    if (is_paid !== undefined && typeof is_paid === 'boolean') {
      updateData.is_paid = is_paid
      if (is_paid) {
        updateData.paid_at = new Date().toISOString()
        updateData.paid_by_user_id = user.id
      } else {
        updateData.paid_at = null
        updateData.paid_by_user_id = null
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400, ...NO_STORE })
    }

    const { data: updatedRows, error: updateError } = await svc
      .from('instant_win_awards')
      .update(updateData)
      .eq('id', award_id)
      .select('id, payout_amount_pence, is_paid, paid_at, paid_by_user_id, payout_notes')

    if (updateError) {
      console.error('[admin/instant-winners] Update error:', updateError.message)
      return NextResponse.json({ ok: false, error: 'Failed to update award' }, { status: 500, ...NO_STORE })
    }

    const updatedRow = updatedRows?.[0]
    if (!updatedRow) {
      return NextResponse.json({ ok: false, error: 'Award not found' }, { status: 404, ...NO_STORE })
    }

    // Fetch updated outstanding total via RPC
    let outstandingAmountPence = 0
    try {
      const { data: rpcResult, error: rpcError } = await svc.rpc('get_instant_win_outstanding_pence')
      if (rpcError) {
        console.error('[admin/instant-winners] Outstanding RPC error after PATCH (non-fatal):', rpcError.message)
      } else {
        outstandingAmountPence = typeof rpcResult === 'number' ? rpcResult : parseInt(rpcResult ?? '0', 10) || 0
      }
    } catch (rpcErr: any) {
      console.error('[admin/instant-winners] Outstanding RPC exception after PATCH (non-fatal):', rpcErr?.message)
    }

    return NextResponse.json({
      ok: true,
      updated: {
        award_id: updatedRow.id,
        payout_amount_pence: updatedRow.payout_amount_pence,
        is_paid: updatedRow.is_paid ?? false,
        paid_at: updatedRow.paid_at,
        paid_by_user_id: updatedRow.paid_by_user_id,
        payout_notes: updatedRow.payout_notes,
      },
      outstandingAmountPence,
    }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/instant-winners] PATCH error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500, ...NO_STORE })
  }
}
