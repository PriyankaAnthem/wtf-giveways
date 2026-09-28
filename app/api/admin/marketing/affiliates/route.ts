import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  validateAffiliateCreateInput,
  validateAffiliateEditInput,
  isUuid,
} from '@/lib/marketing/affiliateValidation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Admin Affiliates CRUD.
 *
 * Authorization: 'admin' AND 'operations_admin' (same surface set as Tracking
 * Links). Every write uses the service-role client AFTER admin authorization
 * because `public.affiliates` has RLS enabled with NO browser policies, exactly
 * mirroring the tracking-links / discount-codes admin routes.
 *
 * There is intentionally NO DELETE endpoint: affiliates are soft-disabled via
 * PATCH is_active. A disabled affiliate cannot be attached to NEW tracking
 * links, but existing links + historical order snapshots are never affected
 * (and `tracking_links.affiliate_id` is ON DELETE RESTRICT at the DB anyway).
 */
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const SELECT_COLUMNS =
  'id, name, slug, commission_bps, notes, is_active, created_at, created_by, updated_at, updated_by'

/** Postgres unique-violation SQLSTATE (slug collision => duplicate name). */
const UNIQUE_VIOLATION = '23505'

interface AffiliateDTO {
  id: string
  name: string
  slug: string
  commissionBps: number | null
  notes: string | null
  isActive: boolean
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

function serialize(row: Record<string, unknown>): AffiliateDTO {
  const bps = row.commission_bps
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    commissionBps: typeof bps === 'number' && Number.isFinite(bps) ? bps : null,
    notes: (row.notes as string | null) ?? null,
    isActive: row.is_active === true,
    createdAt: String(row.created_at),
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: String(row.updated_at),
    updatedBy: (row.updated_by as string | null) ?? null,
  }
}

function authStatus(authError: string | null): number {
  return authError === 'Not authenticated' ? 401 : 403
}

/**
 * GET /api/admin/marketing/affiliates
 * Optional `?active=1` returns only active affiliates (used by the Create
 * Tracking Link picker, which must never offer a disabled affiliate).
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  const activeOnly = new URL(request.url).searchParams.get('active') === '1'

  const svc = getServiceSupabase()
  let query = svc.from('affiliates').select(SELECT_COLUMNS).order('name', { ascending: true })
  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) {
    console.error('[marketing/affiliates] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }

  const items = (data ?? []).map((r: Record<string, unknown>) => serialize(r))
  return NextResponse.json({ ok: true, items })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const validated = validateAffiliateCreateInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from('affiliates')
    .insert({
      ...validated.value,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Slug is derived from the name, so a collision means the name is taken.
      return NextResponse.json({ ok: false, error: 'duplicate_affiliate' }, { status: 409 })
    }
    console.error('[marketing/affiliates] POST error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, item: serialize(data) })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (!isUuid(body.id)) return NextResponse.json({ ok: false, error: 'invalid_identifier' }, { status: 400 })
  const id = (body.id as string).trim()

  // Name / commission / notes are editable. The slug is NOT regenerated on edit
  // so the affiliate's stable identity never shifts under existing references.
  const validated = validateAffiliateEditInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from('affiliates')
    .update({
      ...validated.value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/affiliates] PUT error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, item: serialize(data) })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
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
  // Activate / deactivate only. Deactivating removes the affiliate from the
  // NEW-link picker; it never breaks existing links or rewrites order history.
  const { data, error } = await svc
    .from('affiliates')
    .update({
      is_active: body.isActive,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/affiliates] PATCH error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, item: serialize(data) })
}
