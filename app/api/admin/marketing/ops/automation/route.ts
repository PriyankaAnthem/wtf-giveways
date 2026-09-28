import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { validateAutomationToggle } from '@/lib/admin/marketing/ops-validation'
import { getServiceSupabase, serializeOpsAutomation } from '@/lib/admin/marketing/ops-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

const OPS_AUTOMATION_COLUMNS =
  'automation_key, name, enabled, priority, first_delay_minutes, cooldown_hours, maximum_recipients_per_run'

/**
 * Stage 034 — narrow enable/disable of a SINGLE automation (admin-only).
 *
 * Scoped strictly to the one automation_key supplied; it can never bulk-enable
 * or touch another row, and it never enables a matching opportunity definition
 * as a side effect. Enabling requires the automation to already have a template
 * assigned (re-read authoritatively). Enabling an automation does NOT authorize
 * any delivery — the global control state stays authoritative. This route never
 * sends, discovers, enqueues or invokes the worker.
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

  const validated = validateAutomationToggle(body)
  if (!validated.ok) return bad(validated.error)
  const { automationKey, enabled } = validated.value

  const svc = getServiceSupabase()

  // Enabling requires an already-assigned template (re-read authoritatively).
  if (enabled) {
    const { data: existing, error: readErr } = await svc
      .from('marketing_automations')
      .select('automation_key, template_id')
      .eq('automation_key', automationKey)
      .maybeSingle()
    if (readErr) {
      console.error('[marketing/ops/automation] read error:', readErr.message)
      return bad('save_failed', 500)
    }
    if (!existing) return bad('not_found', 404)
    if (!existing.template_id) return bad('template_required_to_enable', 409)
  }

  // UPDATE only, scoped to the single automation_key. Never insert/delete,
  // never touch another row, never change any other column.
  const { data, error } = await svc
    .from('marketing_automations')
    .update({ enabled, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('automation_key', automationKey)
    .select(OPS_AUTOMATION_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/ops/automation] update error:', error.message)
    return bad('save_failed', 500)
  }
  if (!data) return bad('not_found', 404)

  return NextResponse.json(
    { ok: true, automation: serializeOpsAutomation(data) },
    { headers: NO_STORE },
  )
}
