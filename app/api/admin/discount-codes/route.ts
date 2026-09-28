import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { validateDiscountInput, isUuid } from '@/lib/discounts/adminValidation'

// discount_codes has RLS enabled with NO browser policies, so every read/write
// here uses the service-role client AFTER admin authorization.
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const SELECT_COLUMNS =
  'id, code, description, discount_type, discount_value, scope, campaign_id, is_active, starts_at, expires_at, created_at, created_by, updated_at, updated_by'

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505'

interface DiscountCodeDTO {
  id: string
  code: string
  description: string | null
  discountType: string
  discountValue: number
  scope: string
  campaignId: string | null
  campaignTitle: string | null
  campaignSlug: string | null
  isActive: boolean
  startsAt: string | null
  expiresAt: string | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
  uses: number
  netRevenuePence: number
}

/** Lifetime performance metric for a single discount code. */
interface DiscountMetric {
  uses: number
  netRevenuePence: number
}

/**
 * Resolve campaign title/slug for a set of campaign ids in ONE query. Returns a
 * map keyed by id. A missing campaign simply resolves to null title/slug.
 */
async function resolveCampaigns(
  svc: SupabaseClient,
  ids: string[],
): Promise<Map<string, { title: string | null; slug: string | null }>> {
  const map = new Map<string, { title: string | null; slug: string | null }>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return map
  const { data } = await svc.from('campaigns').select('id, title, slug').in('id', unique)
  for (const row of data ?? []) {
    map.set(String(row.id), { title: row.title ?? null, slug: row.slug ?? null })
  }
  return map
}

function serialize(
  row: Record<string, unknown>,
  campaigns: Map<string, { title: string | null; slug: string | null }>,
  metrics?: Map<string, DiscountMetric>,
): DiscountCodeDTO {
  const campaignId = (row.campaign_id as string | null) ?? null
  const campaign = campaignId ? campaigns.get(campaignId) : undefined
  // Codes with no confirmed usage are absent from the RPC result -> default 0.
  const metric = metrics?.get(String(row.id))
  return {
    id: String(row.id),
    code: String(row.code),
    description: (row.description as string | null) ?? null,
    discountType: String(row.discount_type),
    discountValue: Number(row.discount_value),
    scope: String(row.scope),
    campaignId,
    campaignTitle: campaign?.title ?? null,
    campaignSlug: campaign?.slug ?? null,
    isActive: row.is_active === true,
    startsAt: (row.starts_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    createdAt: String(row.created_at),
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: String(row.updated_at),
    updatedBy: (row.updated_by as string | null) ?? null,
    uses: metric?.uses ?? 0,
    netRevenuePence: metric?.netRevenuePence ?? 0,
  }
}

/**
 * Load lifetime performance metrics for every discount code in ONE call to the
 * authoritative `get_discount_code_performance()` RPC. The RPC is the single
 * source of truth — we never query checkout_intents or recompute financials
 * here. Returns a map keyed by discount_code_id, or null when the RPC itself
 * failed (callers MUST surface this as an error, never as silent zeroes).
 */
async function loadPerformanceMetrics(
  svc: SupabaseClient,
): Promise<Map<string, DiscountMetric> | null> {
  const { data, error } = await svc.rpc('get_discount_code_performance')
  if (error) {
    console.error('[discount-codes] performance RPC error:', error.message)
    return null
  }
  const map = new Map<string, DiscountMetric>()
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    const id = row.discount_code_id != null ? String(row.discount_code_id) : null
    if (!id) continue
    map.set(id, {
      uses: Number(row.uses ?? 0),
      netRevenuePence: Number(row.net_revenue_pence ?? 0),
    })
  }
  return map
}

/**
 * Verify a campaign exists (service-role). Returns true/false, or null when the
 * lookup itself failed (treated as a server error by callers).
 */
async function campaignExists(svc: SupabaseClient, id: string): Promise<boolean | null> {
  const { data, error } = await svc.from('campaigns').select('id').eq('id', id).maybeSingle()
  if (error) return null
  return !!data
}

function authStatus(authError: string | null): number {
  return authError === 'Not authenticated' ? 401 : 403
}

export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from('discount_codes')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[discount-codes] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }

  const rows = data ?? []

  // Authoritative lifetime metrics (single RPC call). A failure here must be
  // surfaced — showing every code as 0 uses / £0.00 would be misleading.
  const metrics = await loadPerformanceMetrics(svc)
  if (metrics === null) {
    return NextResponse.json({ ok: false, error: 'metrics_failed' }, { status: 500 })
  }

  const campaigns = await resolveCampaigns(
    svc,
    rows.map((r: Record<string, unknown>) => r.campaign_id as string).filter(Boolean),
  )
  const items = rows.map((r: Record<string, unknown>) => serialize(r, campaigns, metrics))
  return NextResponse.json({ ok: true, items })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const validated = validateDiscountInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()

  // Server-side campaign existence check (never trust the client selection).
  if (validated.value.scope === 'campaign' && validated.value.campaign_id) {
    const exists = await campaignExists(svc, validated.value.campaign_id)
    if (exists === null) return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
    if (!exists) return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400 })
  }

  const { data, error } = await svc
    .from('discount_codes')
    .insert({
      ...validated.value,
      // Audit fields are ALWAYS derived server-side; client values are ignored.
      created_by: user.id,
      updated_by: user.id,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: false, error: 'discount_code_already_exists' }, { status: 409 })
    }
    console.error('[discount-codes] POST error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }

  const campaigns = await resolveCampaigns(svc, [data.campaign_id].filter(Boolean))
  return NextResponse.json({ ok: true, item: serialize(data, campaigns) })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (!isUuid(body.id)) return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400 })
  const id = (body.id as string).trim()

  const validated = validateDiscountInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()

  if (validated.value.scope === 'campaign' && validated.value.campaign_id) {
    const exists = await campaignExists(svc, validated.value.campaign_id)
    if (exists === null) return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
    if (!exists) return NextResponse.json({ ok: false, error: 'campaign_not_found' }, { status: 400 })
  }

  // created_at / created_by are NEVER overwritten. Only mutable fields + audit
  // fields are updated. Editing does NOT touch any checkout_intents snapshot.
  const { data, error } = await svc
    .from('discount_codes')
    .update({
      ...validated.value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: false, error: 'discount_code_already_exists' }, { status: 409 })
    }
    console.error('[discount-codes] PUT error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const campaigns = await resolveCampaigns(svc, [data.campaign_id].filter(Boolean))
  return NextResponse.json({ ok: true, item: serialize(data, campaigns) })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (!isUuid(body.id)) return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400 })
  if (typeof body.isActive !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'invalid_is_active' }, { status: 400 })
  }
  const id = (body.id as string).trim()

  const svc = getServiceSupabase()
  // Soft-disable only. This flips is_active and never deletes or mutates any
  // existing checkout_intents snapshot or payment session.
  const { data, error } = await svc
    .from('discount_codes')
    .update({
      is_active: body.isActive,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[discount-codes] PATCH error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const campaigns = await resolveCampaigns(svc, [data.campaign_id].filter(Boolean))
  return NextResponse.json({ ok: true, item: serialize(data, campaigns) })
}
