import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

export async function GET() {
  // Live feed is accessible to Super Admins, Operations Admins, and Hosts (ops).
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'operations_admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: 'Missing Supabase config' }, { status: 500 })
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Fetch latest instant win awards first
  const { data: awards, error: awardsError } = await svc
    .from('instant_win_awards')
    .select('checkout_intent_id, prize_id, awarded_at')
    .order('awarded_at', { ascending: false })
    .limit(20)

  if (awardsError) {
    return NextResponse.json({ ok: false, error: awardsError.message }, { status: 500 })
  }

  if (!awards || awards.length === 0) {
    return NextResponse.json({ ok: true, items: [] })
  }

  // Get related entries by checkout_intent_id
  const checkoutIntentIds = [...new Set(awards.map((a) => a.checkout_intent_id).filter(Boolean))]
  const { data: entries } = await svc
    .from('entries')
    .select('id, checkout_intent_id, campaign_id, qty, created_at, user_id')
    .in('checkout_intent_id', checkoutIntentIds)

  const entryMap = new Map((entries ?? []).map((e) => [e.checkout_intent_id, e]))

  // Resolve campaign titles
  const campaignIds = [...new Set((entries ?? []).map((e) => e.campaign_id))]
  const { data: campaigns } = await svc
    .from('campaigns')
    .select('id, title')
    .in('id', campaignIds)

  const campaignMap = new Map((campaigns ?? []).map((c) => [c.id, c.title]))

  // Resolve display_name from profiles_public_snapshot
  const userIds = [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))]
  const { data: profiles } = await svc
    .from('profiles_public_snapshot')
    .select('user_id, display_name')
    .in('user_id', userIds)

  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]))

  // Resolve mobile and real_name from profiles_private
  const { data: privateProfiles } = await svc
    .from('profiles_private')
    .select('user_id, mobile, real_name')
    .in('user_id', userIds)

  const privateMap = new Map((privateProfiles ?? []).map((p) => [p.user_id, { mobile: p.mobile, real_name: p.real_name }]))

  // Resolve prize titles
  const prizeIds = [...new Set(awards.map((a) => a.prize_id).filter(Boolean))]
  const { data: prizes } = await svc
    .from('instant_win_prizes')
    .select('id, prize_title')
    .in('id', prizeIds)

  const prizeMap = new Map((prizes ?? []).map((p) => [p.id, p.prize_title]))

  // Build response - only instant win events
  const items = awards
    .map((award) => {
      const entry = entryMap.get(award.checkout_intent_id)
      if (!entry) return null

      const nickname = entry.user_id ? profileMap.get(entry.user_id) : null
      const privateProfile = entry.user_id ? privateMap.get(entry.user_id) : null

      return {
        id: entry.id,
        created_at: entry.created_at,
        campaign_title: campaignMap.get(entry.campaign_id) ?? 'Unknown Campaign',
        instant_win_title: prizeMap.get(award.prize_id) ?? null,
        ticket_number: entry.id,
        nickname: nickname ?? null,
        real_name: privateProfile?.real_name ?? null,
        mobile: privateProfile?.mobile ?? null,
      }
    })
    .filter(Boolean)

  return NextResponse.json({ ok: true, items }, {
    headers: {
      'Cache-Control': 'public, max-age=5, s-maxage=5',
    },
  })
}
