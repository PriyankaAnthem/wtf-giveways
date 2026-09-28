import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isUuid } from '@/lib/discounts/adminValidation'
import { validateTemplateInput, templateContentChanged } from '@/lib/admin/marketing/hub-validation'
import {
  getServiceSupabase,
  serializeTemplate,
  fetchActiveDiscountCodeOptions,
  discountCodeActive,
  TEMPLATE_COLUMNS,
} from '@/lib/admin/marketing/hub-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }
const UNIQUE_VIOLATION = '23505'

/**
 * Admin-only Marketing Hub template configuration (Stage 3B).
 *
 * Structured content slots ONLY: raw HTML/JS is rejected and only the six
 * controlled placeholders are permitted (validation lives in hub-validation).
 * Editing rendered content increments the template version. This route can
 * never send an email or create a recipient/run — it writes template config
 * rows to the forced-RLS marketing_templates table via the service-role client,
 * strictly AFTER admin authorization.
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
    .from('marketing_templates')
    .select(TEMPLATE_COLUMNS)
    .order('template_key', { ascending: true })

  if (error) {
    console.error('[marketing/templates] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500, headers: NO_STORE })
  }

  const discountCodes = await fetchActiveDiscountCodeOptions(svc)

  return NextResponse.json(
    { ok: true, templates: (data ?? []).map(serializeTemplate), discountCodes },
    { headers: NO_STORE },
  )
}

/** Shared discount-code active guard for create/update. */
async function guardDiscountCode(
  svc: ReturnType<typeof getServiceSupabase>,
  id: string | null,
): Promise<NextResponse | null> {
  if (!id) return null
  const state = await discountCodeActive(svc, id)
  if (state === null) {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!state.exists) {
    return NextResponse.json({ ok: false, error: 'discount_code_not_found' }, { status: 400, headers: NO_STORE })
  }
  if (!state.active) {
    return NextResponse.json({ ok: false, error: 'discount_code_inactive' }, { status: 400, headers: NO_STORE })
  }
  return null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') return denied(authError)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE })
  }

  const validated = validateTemplateInput(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE })
  }

  const svc = getServiceSupabase()
  const guard = await guardDiscountCode(svc, validated.value.discount_code_id)
  if (guard) return guard

  // New templates always start at version 1.
  const { data, error } = await svc
    .from('marketing_templates')
    .insert({ ...validated.value, version: 1, created_by: user.id, updated_by: user.id })
    .select(TEMPLATE_COLUMNS)
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: false, error: 'template_key_already_exists' }, { status: 409, headers: NO_STORE })
    }
    console.error('[marketing/templates] POST error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, template: serializeTemplate(data) }, { headers: NO_STORE })
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

  if (!isUuid(body.id)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, headers: NO_STORE })
  }
  const id = (body.id as string).trim()

  const validated = validateTemplateInput(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE })
  }

  const svc = getServiceSupabase()
  const guard = await guardDiscountCode(svc, validated.value.discount_code_id)
  if (guard) return guard

  // Read the current row to compare content and derive the next version.
  const { data: existing, error: readErr } = await svc
    .from('marketing_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readErr) {
    console.error('[marketing/templates] PUT read error:', readErr.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  // Version bumps ONLY when rendered content changed; metadata-only edits keep
  // the version. created_at / created_by are never overwritten.
  const contentChanged = templateContentChanged(existing, validated.value)
  const nextVersion = Number(existing.version) + (contentChanged ? 1 : 0)

  const { data, error } = await svc
    .from('marketing_templates')
    .update({
      ...validated.value,
      version: nextVersion,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(TEMPLATE_COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: false, error: 'template_key_already_exists' }, { status: 409, headers: NO_STORE })
    }
    console.error('[marketing/templates] PUT error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json(
    { ok: true, template: serializeTemplate(data), versionBumped: contentChanged },
    { headers: NO_STORE },
  )
}
