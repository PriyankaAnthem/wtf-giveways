import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-cache' } }

/**
 * GET /api/admin/instant-winners/campaigns
 *
 * Read-only campaign list that backs the Instant Winners campaign filter
 * dropdown. Unlike the live-feed endpoint (LIVE only), this returns ALL
 * campaigns — including historical/ended ones — because staff routinely look
 * up winners from past campaigns.
 *
 * Admin + Operations Admin only. Authorises BEFORE creating the service-role
 * client. Returns only id/title/slug — no campaign configuration, no writes.
 * Does not grant Operations Admin access to campaign-management surfaces.
 */
export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/instant-winners/campaigns] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }

  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const { data: campaigns, error } = await svc
      .from('campaigns')
      .select('id, title, slug')
      .order('title', { ascending: true })

    if (error) {
      console.error('[admin/instant-winners/campaigns] query error:', error.message)
      return NextResponse.json({ ok: false, error: 'Failed to load campaigns' }, { status: 500, ...NO_STORE })
    }

    const result = (campaigns ?? []).map((c) => ({
      id: c.id as string,
      title: (c.title ?? 'Untitled') as string,
      slug: (c.slug ?? '') as string,
    }))

    return NextResponse.json({ ok: true, campaigns: result }, NO_STORE)
  } catch (err: any) {
    console.error('[admin/instant-winners/campaigns] unexpected error:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500, ...NO_STORE })
  }
}
