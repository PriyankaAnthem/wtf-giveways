import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  validateControlAction,
  canEnableSending,
  validateRolloutAgainstBatch,
} from '@/lib/admin/marketing/ops-validation'
import { getServiceSupabase, serializeControl, fetchArmingState } from '@/lib/admin/marketing/ops-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

const CONTROL_COLUMNS =
  'sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact, updated_at'

/**
 * Stage 034 — narrow, purpose-built marketing control transitions (admin-only).
 *
 * This is NOT a generic control editor: it accepts exactly one of three
 * transitions — sending on/off, discovery on/off, or a constrained rollout
 * value — and can only ever write those specific columns on the singleton
 * marketing_control_state row. It never sends, discovers, enqueues or invokes
 * the worker; it only flips authoritative flags.
 *
 * Dangerous ON transitions FAIL CLOSED and re-read authoritative state
 * immediately before mutating (never trusting stale UI):
 *   - sending ON is blocked with rollout 0, zero enabled automations, or zero
 *     enabled definitions.
 *   - rollout may never exceed maximum_batch_size.
 * Turning sending OFF is always allowed and immediate.
 */

function denied(authError: string | null) {
  const status = authError === 'Not authenticated' ? 401 : 403
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status, headers: NO_STORE })
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') return denied(authError)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return bad('invalid_json')
  }

  const action = validateControlAction(body)
  if (!action.ok) return bad(action.error)

  const svc = getServiceSupabase()

  // Build the single-field patch, applying dangerous-transition guards with a
  // FRESH authoritative re-read for every ON/limit change.
  let patch: Record<string, unknown>

  if (action.value.target === 'sending') {
    if (action.value.enabled) {
      const state = await fetchArmingState(svc)
      const check = canEnableSending({
        rolloutLimit: state.rolloutLimit,
        enabledAutomationCount: state.enabledAutomationCount,
        enabledDefinitionCount: state.enabledDefinitionCount,
      })
      if (!check.ok) return bad(check.error, 409)
      patch = { sending_enabled: true }
    } else {
      patch = { sending_enabled: false }
    }
  } else if (action.value.target === 'discovery') {
    patch = { discovery_enabled: action.value.enabled }
  } else {
    // rollout
    const state = await fetchArmingState(svc)
    const guard = validateRolloutAgainstBatch(action.value.rolloutLimit, state.maximumBatchSize)
    if (!guard.ok) return bad(guard.error, 409)
    patch = { rollout_limit: guard.value }
  }

  const { data, error } = await svc
    .from('marketing_control_state')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('key', 'default')
    .select(CONTROL_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/ops/control] update error:', error.message)
    return bad('save_failed', 500)
  }
  if (!data) return bad('not_found', 404)

  return NextResponse.json({ ok: true, control: serializeControl(data) }, { headers: NO_STORE })
}
