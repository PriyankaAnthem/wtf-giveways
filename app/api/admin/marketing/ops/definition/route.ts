import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { validateDefinitionToggle } from '@/lib/admin/marketing/ops-validation'
import { getServiceSupabase, serializeOpsDefinition } from '@/lib/admin/marketing/ops-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

const OPS_DEFINITION_COLUMNS =
  'opportunity_key, display_name, family, default_priority, default_score, default_expiry_hours, enabled'

/**
 * Stage 034 — narrow enable/disable of a SINGLE opportunity definition
 * (admin-only).
 *
 * Scoped strictly to the one opportunity_key supplied; there is deliberately no
 * bulk / "enable all" path. Enabling a definition only permits DISCOVERY to
 * detect that opportunity type; it does NOT itself authorize any email
 * delivery. This route never sends, discovers, enqueues or invokes the worker —
 * it only flips a single config flag.
 */

function denied(authError: string | null) {
  const status = authError === 'Not authenticated' ? 401 : 403
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status, headers: NO_STORE })
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') return denied(authError)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return bad('invalid_json')
  }

  const validated = validateDefinitionToggle(body)
  if (!validated.ok) return bad(validated.error)
  const { opportunityKey, enabled } = validated.value

  const svc = getServiceSupabase()

  // UPDATE only, scoped to the single opportunity_key. Never insert/delete,
  // never bulk-enable, never touch another row.
  const { data, error } = await svc
    .from('marketing_opportunity_definitions')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('opportunity_key', opportunityKey)
    .select(OPS_DEFINITION_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/ops/definition] update error:', error.message)
    return bad('save_failed', 500)
  }
  if (!data) return bad('not_found', 404)

  return NextResponse.json(
    { ok: true, definition: serializeOpsDefinition(data) },
    { headers: NO_STORE },
  )
}
