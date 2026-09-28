import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { isUuid } from '@/lib/discounts/adminValidation'
import { validatePromotionCreate, validatePromotionUpdate } from '@/lib/admin/marketing/hub-validation'
import {
  getServiceSupabase,
  serializePromotion,
  resolveCampaignTitles,
  fetchCampaignOptions,
  fetchTemplateOptions,
  campaignExists,
  templateExists,
  PROMOTION_COLUMNS,
} from '@/lib/admin/marketing/hub-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Admin-only Marketing Hub campaign-promotion configuration (Stage 3B).
 *
 * Creating or scheduling a promotion is CONFIG ONLY: it writes a row to the
 * forced-RLS marketing_campaign_promotions table (service-role, after admin
 * auth) and never enqueues a recipient, creates a run, or sends an email. An
 * admin may only move a promotion between draft, scheduled and cancelled;
 * processing/completed/failed are reserved for future automated transitions.
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
    .from('marketing_campaign_promotions')
    .select(PROMOTION_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[marketing/promotions] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500, headers: NO_STORE })
  }

  const rows = data ?? []
  const [campaignsMap, campaignOptions, templates] = await Promise.all([
    resolveCampaignTitles(svc, rows.map((r: Record<string, unknown>) => String(r.campaign_id))),
    fetchCampaignOptions(svc),
    fetchTemplateOptions(svc),
  ])

  return NextResponse.json(
    {
      ok: true,
      promotions: rows.map((r: Record<string, unknown>) => serializePromotion(r, campaignsMap)),
      campaigns: campaignOptions,
      templates,
    },
    { headers: NO_STORE },
  )
}

/** Verify an optional template reference exists. Returns an error response or null. */
async function guardTemplate(
  svc: ReturnType<typeof getServiceSupabase>,
  id: string | null,
): Promise<NextResponse | null> {
  if (!id) return null
  const exists = await templateExists(svc, id)
  if (exists === null) {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!exists) {
    return NextResponse.json({ ok: false, error: 'template_not_found' }, { status: 400, headers: NO_STORE })
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

  const validated = validatePromotionCreate(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE })
  }
  const v = validated.value

  const svc = getServiceSupabase()

  const campaignOk = await campaignExists(svc, v.campaign_id)
  if (campaignOk === null) {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!campaignOk) {
    return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400, headers: NO_STORE })
  }

  const templateGuard = await guardTemplate(svc, v.template_id)
  if (templateGuard) return templateGuard

  // INSERT a config row only. No recipient row, no run row, no email.
  const { data, error } = await svc
    .from('marketing_campaign_promotions')
    .insert({
      campaign_id: v.campaign_id,
      promotion_type: v.promotion_type,
      template_id: v.template_id,
      status: v.status,
      scheduled_at: v.scheduled_at,
      rollout_limit: v.rollout_limit,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(PROMOTION_COLUMNS)
    .single()

  if (error) {
    console.error('[marketing/promotions] POST error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }

  const campaignsMap = await resolveCampaignTitles(svc, [String(data.campaign_id)])
  return NextResponse.json({ ok: true, promotion: serializePromotion(data, campaignsMap) }, { headers: NO_STORE })
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

  if (!isUuid(body.id)) {
    return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400, headers: NO_STORE })
  }
  const id = (body.id as string).trim()

  const validated = validatePromotionUpdate(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE })
  }
  const v = validated.value

  const svc = getServiceSupabase()
  const templateGuard = await guardTemplate(svc, v.template_id)
  if (templateGuard) return templateGuard

  // UPDATE config only. Never touches recipients or runs, never sends.
  const { data, error } = await svc
    .from('marketing_campaign_promotions')
    .update({
      status: v.status,
      template_id: v.template_id,
      scheduled_at: v.scheduled_at,
      rollout_limit: v.rollout_limit,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(PROMOTION_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/promotions] PATCH error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, headers: NO_STORE })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  const campaignsMap = await resolveCampaignTitles(svc, [String(data.campaign_id)])
  return NextResponse.json({ ok: true, promotion: serializePromotion(data, campaignsMap) }, { headers: NO_STORE })
}
