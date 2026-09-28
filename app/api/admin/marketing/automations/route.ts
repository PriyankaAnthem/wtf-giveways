import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { validateAutomationUpdate } from '@/lib/admin/marketing/hub-validation'
import {
  getServiceSupabase,
  serializeAutomation,
  fetchTemplateOptions,
  fetchActiveDiscountCodeOptions,
  fetchConfigurationSnapshot,
  templateExists,
  discountCodeActive,
  AUTOMATION_COLUMNS,
} from '@/lib/admin/marketing/hub-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Admin-only Marketing Hub automation configuration (Stage 3B).
 *
 * Auth FIRST (user-scoped RLS client, admin role ONLY). Only after an admin is
 * confirmed is the service-role client built to read/write the forced-RLS
 * marketing_automations table. This route configures the six automation
 * definitions; it can NEVER send, discover, enqueue a recipient or create a
 * run. Enabling an automation only flips a config flag — the global control
 * state stays authoritative and defaults fully paused.
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

  const { data, error } = await svc
    .from('marketing_automations')
    .select(AUTOMATION_COLUMNS)
    .order('priority', { ascending: true })

  if (error) {
    console.error('[marketing/automations] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500, headers: NO_STORE })
  }

  const [templates, discountCodes, snapshot] = await Promise.all([
    fetchTemplateOptions(svc),
    fetchActiveDiscountCodeOptions(svc),
    fetchConfigurationSnapshot(svc),
  ])

  const control = {
    // Surfaced ONLY so the UI can warn that sending/discovery are paused.
    sendingEnabled: false,
    discoveryEnabled: false,
  }

  return NextResponse.json(
    {
      ok: true,
      automations: (data ?? []).map(serializeAutomation),
      templates,
      discountCodes,
      control,
      // Aggregate-only context (never identities).
      activeRunCount: Number((snapshot?.activeRunCount as number | undefined) ?? 0),
    },
    { headers: NO_STORE },
  )
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') return denied(authError)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE })
  }

  const validated = validateAutomationUpdate(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE })
  }
  const v = validated.value

  const svc = getServiceSupabase()

  // Template must exist when assigned. Enabling additionally requires a template
  // (the validator already blocks enabled-without-template).
  if (v.template_id) {
    const exists = await templateExists(svc, v.template_id)
    if (exists === null) {
      return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
    }
    if (!exists) {
      return NextResponse.json({ ok: false, error: 'template_not_found' }, { status: 400, headers: NO_STORE })
    }
  }

  // Discount codes must reference an EXISTING, ACTIVE code.
  if (v.discount_code_id) {
    const state = await discountCodeActive(svc, v.discount_code_id)
    if (state === null) {
      return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
    }
    if (!state.exists) {
      return NextResponse.json({ ok: false, error: 'discount_code_not_found' }, { status: 400, headers: NO_STORE })
    }
    if (!state.active) {
      return NextResponse.json({ ok: false, error: 'discount_code_inactive' }, { status: 400, headers: NO_STORE })
    }
  }

  // UPDATE only (never INSERT/DELETE). automation_key + priority are immutable.
  const { data, error } = await svc
    .from('marketing_automations')
    .update({
      enabled: v.enabled,
      template_id: v.template_id,
      first_delay_minutes: v.first_delay_minutes,
      follow_up_delay_minutes: v.follow_up_delay_minutes,
      cooldown_hours: v.cooldown_hours,
      minimum_wallet_pence: v.minimum_wallet_pence,
      discount_code_id: v.discount_code_id,
      maximum_recipients_per_run: v.maximum_recipients_per_run,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('automation_key', v.automation_key)
    .select(AUTOMATION_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/automations] PATCH error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, automation: serializeAutomation(data) }, { headers: NO_STORE })
}
