import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache' } }

export async function GET(request: NextRequest) {
  // Super Admins and Operations Admins. Hosts (ops) and read_only are rejected.
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
    console.error('[admin/entries] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Parse query params
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)))
  const campaignId = searchParams.get('campaignId') || null
  const state = searchParams.get('state') || null
  const search = searchParams.get('search') || null

  const offset = (page - 1) * limit
  const hasFilter = Boolean(state || search)

  try {
    let entries: any[] = []
    let hasNext = false

    if (!hasFilter) {
      // === PATH A: No state/search filter - entries-first query ===
      let entriesQuery = svc
        .from('entries')
        .select('id, user_id, campaign_id, giveaway_id, qty, created_at, checkout_intent_id')
        .order('created_at', { ascending: false })

      if (campaignId) {
        entriesQuery = entriesQuery.eq('campaign_id', campaignId)
      }

      // Fetch limit + 1 to detect hasNext
      entriesQuery = entriesQuery.range(offset, offset + limit)

      const { data: entriesData, error: entriesError } = await entriesQuery

      if (entriesError) {
        console.error('[admin/entries] Entries query error:', entriesError.message)
        return NextResponse.json({ ok: false, error: 'Failed to fetch entries' }, { status: 500, ...NO_STORE })
      }

      if (!entriesData || entriesData.length === 0) {
        return NextResponse.json({ ok: true, entries: [], hasNext: false, page, limit }, NO_STORE)
      }

      // Check if there's a next page
      if (entriesData.length > limit) {
        hasNext = true
        entries = entriesData.slice(0, limit)
      } else {
        entries = entriesData
      }
    } else {
      // === PATH B: state/search filter - checkout_intents-first query ===
      let checkoutQuery = svc
        .from('checkout_intents')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(500) // Safe maximum

      if (state) {
        checkoutQuery = checkoutQuery.eq('state', state)
      }

      if (search) {
        checkoutQuery = checkoutQuery.ilike('ref', `%${search}%`)
      }

      const { data: matchingCheckouts, error: checkoutError } = await checkoutQuery

      if (checkoutError) {
        console.error('[admin/entries] Checkout filter query error:', checkoutError.message)
        return NextResponse.json({ ok: false, error: 'Failed to search checkouts' }, { status: 500, ...NO_STORE })
      }

      if (!matchingCheckouts || matchingCheckouts.length === 0) {
        return NextResponse.json({ ok: true, entries: [], hasNext: false, page, limit }, NO_STORE)
      }

      const matchingCheckoutIds = matchingCheckouts.map((c) => c.id)

      // Now query entries with those checkout_intent_ids
      let entriesQuery = svc
        .from('entries')
        .select('id, user_id, campaign_id, giveaway_id, qty, created_at, checkout_intent_id')
        .in('checkout_intent_id', matchingCheckoutIds)
        .order('created_at', { ascending: false })

      if (campaignId) {
        entriesQuery = entriesQuery.eq('campaign_id', campaignId)
      }

      // Fetch limit + 1 to detect hasNext
      entriesQuery = entriesQuery.range(offset, offset + limit)

      const { data: entriesData, error: entriesError } = await entriesQuery

      if (entriesError) {
        console.error('[admin/entries] Filtered entries query error:', entriesError.message)
        return NextResponse.json({ ok: false, error: 'Failed to fetch entries' }, { status: 500, ...NO_STORE })
      }

      if (!entriesData || entriesData.length === 0) {
        return NextResponse.json({ ok: true, entries: [], hasNext: false, page, limit }, NO_STORE)
      }

      // Check if there's a next page
      if (entriesData.length > limit) {
        hasNext = true
        entries = entriesData.slice(0, limit)
      } else {
        entries = entriesData
      }
    }

    // === Common: batch fetch checkout_intents and ticket_allocations ===
    const checkoutIntentIds = entries.map((e) => e.checkout_intent_id).filter(Boolean)
    const entryIds = entries.map((e) => e.id)

    // Collect unique user_ids from current page entries (capped at 25 - same as max page size)
    const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))].slice(0, 25)

    // Fetch checkout_intents
    let checkoutIntentsData: Record<string, any> = {}
    if (checkoutIntentIds.length > 0) {
      const { data: checkoutIntents, error: ciError } = await svc
        .from('checkout_intents')
        .select('id, ref, state, total_pence, currency, provider, confirmed_at')
        .in('id', checkoutIntentIds)

      if (ciError) {
        console.error('[admin/entries] Checkout intents batch fetch error:', ciError.message)
      } else {
        checkoutIntentsData = Object.fromEntries(
          (checkoutIntents ?? []).map((ci) => [ci.id, ci])
        )
      }
    }

    // Fetch ticket_allocations
    let allocationsData: Record<string, { start_ticket: number; end_ticket: number }> = {}
    if (entryIds.length > 0) {
      const { data: allocations, error: allocError } = await svc
        .from('ticket_allocations')
        .select('entry_id, start_ticket, end_ticket')
        .in('entry_id', entryIds)

      if (allocError) {
        console.error('[admin/entries] Ticket allocations batch fetch error:', allocError.message)
      } else {
        allocationsData = Object.fromEntries(
          (allocations ?? []).map((a) => [a.entry_id, { start_ticket: a.start_ticket, end_ticket: a.end_ticket }])
        )
      }
    }

    // === Fetch customer contact details for current-page user_ids only (FAIL-SOFT) ===
    // These lookups are non-blocking: if they fail, entries still return with fallback values.
    let profilesData: Record<string, { real_name: string | null; mobile: string | null }> = {}
    let emailsData: Record<string, string | null> = {}

    if (userIds.length > 0) {
      // Fetch profiles_private (name, mobile) for current-page user_ids only
      // FAIL-SOFT: if this fails, entries still return with customer_name = "Unknown"
      try {
        const { data: profiles, error: profilesError } = await svc
          .from('profiles_private')
          .select('user_id, real_name, mobile')
          .in('user_id', userIds)

        if (profilesError) {
          console.error('[admin/entries] Profiles batch fetch error (non-fatal):', profilesError.message)
        } else {
          profilesData = Object.fromEntries(
            (profiles ?? []).map((p) => [p.user_id, { real_name: p.real_name, mobile: p.mobile }])
          )
        }
      } catch (profileErr: any) {
        console.error('[admin/entries] Profiles fetch exception (non-fatal):', profileErr?.message)
      }

      // ========================================================================
      // AUTH EMAIL LOOKUP - ADMIN ONLY - PRODUCTION SAFETY NOTES
      // ========================================================================
      // - This is ADMIN-ONLY (protected by authorize() check above)
      // - It is CAPPED to the current page only (max 25 users from userIds array)
      // - It uses auth.admin.getUserById per user, NOT auth.admin.listUsers
      // - DO NOT change this to list all users or remove the userIds cap
      // - FAIL-SOFT: if any lookup fails, entries still return with email = "-"
      // ========================================================================
      try {
        const emailResults = await Promise.allSettled(
          userIds.map(async (userId) => {
            try {
              const { data, error } = await svc.auth.admin.getUserById(userId)
              if (error) {
                console.error(`[admin/entries] Auth user lookup failed for ${userId} (non-fatal):`, error.message)
                return { userId, email: null }
              }
              return { userId, email: data?.user?.email ?? null }
            } catch (innerErr: any) {
              console.error(`[admin/entries] Auth user lookup exception for ${userId} (non-fatal):`, innerErr?.message)
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
        console.error('[admin/entries] Auth email lookup exception (non-fatal):', emailErr?.message)
      }
    }

    // Build response entries
    const responseEntries = entries.map((entry) => {
      const checkout = checkoutIntentsData[entry.checkout_intent_id]
      const allocation = allocationsData[entry.id]
      const profile = profilesData[entry.user_id]
      const email = emailsData[entry.user_id]

      return {
        id: entry.id,
        created_at: entry.created_at,
        user_id: entry.user_id,
        campaign_id: entry.campaign_id,
        giveaway_id: entry.giveaway_id,
        qty: entry.qty,
        checkout_ref: checkout?.ref ?? null,
        checkout_state: checkout?.state ?? null,
        total_pence: checkout?.total_pence ?? null,
        currency: checkout?.currency ?? null,
        provider: checkout?.provider ?? null,
        confirmed_at: checkout?.confirmed_at ?? null,
        start_ticket: allocation?.start_ticket ?? null,
        end_ticket: allocation?.end_ticket ?? null,
        // Customer contact details with fallbacks
        customer_name: profile?.real_name || 'Unknown',
        customer_email: email || '-',
        customer_mobile: profile?.mobile || '-',
      }
    })

    return NextResponse.json(
      {
        ok: true,
        entries: responseEntries,
        hasNext,
        page,
        limit,
      },
      NO_STORE
    )
  } catch (err: any) {
    console.error('[admin/entries] Unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500, ...NO_STORE })
  }
}
