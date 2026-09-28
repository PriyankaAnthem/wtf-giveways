import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isUuid } from '@/lib/admin/homepage-rails'
import { isHeroBadge } from '@/lib/homepage-hero-badges'
import { loadHomepageHeroConfig } from '@/lib/homepage-hero'

/**
 * Admin API for the Homepage Main Banner (hero) singleton.
 *
 * GET — current { heroCampaignId, heroBadge }.
 * PUT — save selection + badge onto the pre-existing `homepage_hero` singleton
 *       (key='default'). Configuration only: it never creates/alters schema and
 *       never touches rails/placements.
 *
 * All writes use service_role server-side only; the browser never receives the
 * key. Both handlers are admin-only via authorizeAdminApi.
 */

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin'],
  })

  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  try {
    const config = await loadHomepageHeroConfig()
    return NextResponse.json({ ok: true, ...config })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to load homepage hero' },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin'],
  })

  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { heroCampaignId, heroBadge } = body

  // Campaign id: null (hide slot) OR a canonical UUID.
  if (heroCampaignId !== null && !isUuid(heroCampaignId)) {
    return NextResponse.json(
      { ok: false, error: 'heroCampaignId must be a UUID or null' },
      { status: 400 },
    )
  }

  // Badge: null OR one of the closed allowed set.
  if (heroBadge !== null && !isHeroBadge(heroBadge)) {
    return NextResponse.json(
      { ok: false, error: 'heroBadge must be an allowed badge or null' },
      { status: 400 },
    )
  }

  const svc = getServiceClient()
  if (!svc) {
    return NextResponse.json(
      { ok: false, error: 'Server misconfigured: missing Supabase service credentials' },
      { status: 500 },
    )
  }

  // Upsert the single row. `key='default'` is the singleton discriminator that
  // already exists on the table.
  const { error: upsertError } = await svc
    .from('homepage_hero')
    .upsert(
      { key: 'default', hero_campaign_id: heroCampaignId, hero_badge: heroBadge },
      { onConflict: 'key' },
    )

  if (upsertError) {
    return NextResponse.json(
      { ok: false, error: upsertError.message, details: upsertError },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, heroCampaignId, heroBadge })
}
