import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { validateControlUpdate } from '@/lib/admin/marketing/hub-validation'
import {
  getServiceSupabase,
  serializeControl,
  fetchRecipientCountsByStatus,
  fetchConfigurationSnapshot,
} from '@/lib/admin/marketing/hub-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Admin-only Marketing Hub global control state (Stage 3B).
 *
 * The singleton kill-switch + rollout ceilings row. An admin can update these
 * values, but NO sending system exists yet: flipping sending_enabled or
 * discovery_enabled changes a flag only. This route reads/updates the
 * forced-RLS marketing_control_state table via the service-role client after
 * admin auth, and exposes recipient/contact numbers as AGGREGATE COUNTS ONLY —
 * never rows, never identities. It cannot send, discover or create a run.
 */

function denied(authError: string | null) {
  const status = authError === 'Not authenticated' ? 401 : 403
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status, headers: NO_STORE })
}

export async function GET() {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') return denied(authError)

  const svc = getServiceSupabase()

  const { data: controlRow, error } = await svc
    .from('marketing_control_state')
    .select(
      'sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact, updated_at',
    )
    .eq('key', 'default')
    .maybeSingle()

  if (error) {
    console.error('[marketing/control] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500, headers: NO_STORE })
  }

  const [recipientCountsByStatus, snapshot] = await Promise.all([
    fetchRecipientCountsByStatus(svc),
    fetchConfigurationSnapshot(svc),
  ])

  return NextResponse.json(
    {
      ok: true,
      control: serializeControl(controlRow),
      counts: {
        activeRunCount: Number((snapshot?.activeRunCount as number | undefined) ?? 0),
        externalContactCount: Number((snapshot?.externalContactCount as number | undefined) ?? 0),
        externalContactEnabledCount: Number(
          (snapshot?.externalContactEnabledCount as number | undefined) ?? 0,
        ),
        promotionCountsByStatus:
          (snapshot?.promotionCountsByStatus as Record<string, number> | undefined) ?? {},
        recipientCountsByStatus,
      },
    },
    { headers: NO_STORE },
  )
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') return denied(authError)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE })
  }

  const validated = validateControlUpdate(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE })
  }

  const svc = getServiceSupabase()

  // UPDATE the singleton only (never INSERT a second row, never DELETE).
  const { data, error } = await svc
    .from('marketing_control_state')
    .update({
      ...validated.value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('key', 'default')
    .select(
      'sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact, updated_at',
    )
    .maybeSingle()

  if (error) {
    console.error('[marketing/control] PUT error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, control: serializeControl(data) }, { headers: NO_STORE })
}
