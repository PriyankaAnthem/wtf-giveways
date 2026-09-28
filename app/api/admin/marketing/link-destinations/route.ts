import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Read-only helper for the Tracking Links create/edit UI: the list of live
 * competitions staff can pick as a destination, so they never have to know or
 * type an internal path like `/giveaways/15kinstant`.
 *
 * Authorization mirrors the links CRUD route ('admin' AND 'operations_admin').
 * It reads the SAME published `giveaway_snapshots` (kind='list') the public
 * /giveaways page reads, filtered to currently-live competitions. It performs
 * NO writes and touches NO attribution / schema / RLS.
 */
export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await svc
    .from('giveaway_snapshots')
    .select('payload')
    .eq('kind', 'list')
    .order('generated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[marketing/link-destinations] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }

  const now = Date.now()
  const seen = new Set<string>()
  const items: { slug: string; title: string }[] = []

  for (const row of data ?? []) {
    const g = (row as { payload?: Record<string, unknown> }).payload
    if (!g || typeof g.slug !== 'string' || typeof g.title !== 'string') continue
    if (g.status !== 'live') continue
    if (typeof g.ends_at === 'string' && g.ends_at) {
      const t = new Date(g.ends_at).getTime()
      if (Number.isFinite(t) && t <= now) continue
    }
    if (seen.has(g.slug)) continue
    seen.add(g.slug)
    items.push({ slug: g.slug, title: g.title })
  }

  items.sort((a, b) => a.title.localeCompare(b.title))
  return NextResponse.json({ ok: true, items })
}
