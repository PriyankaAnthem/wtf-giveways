import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  validateCreateInput,
  validateEditInput,
  isUuid,
} from '@/lib/marketing/linkValidation'
import { generateShortCode } from '@/lib/marketing/attribution'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Admin Tracking Links CRUD.
 *
 * Authorization: 'admin' AND 'operations_admin'. Links is the ONE marketing
 * surface Operations Admin may manage (view / create / edit label+destination /
 * enable-disable). Every other marketing API (analytics, ops/*, automations,
 * control, audiences, templates, promotions) remains strictly admin-only.
 *
 * `public.tracking_links` has RLS enabled with NO browser policies, so every
 * read/write here uses the service-role client AFTER admin authorization. This
 * exactly mirrors the discount-codes admin route. Public short-link resolution
 * never touches this route — it goes through the SECURITY DEFINER
 * `resolve_tracking_link` RPC in the /t route.
 *
 * Immutability: channel / source / medium / campaign_slug AND affiliate_id are
 * attribution-defining and are ONLY ever set on create. Edits accept label +
 * destination + optional content/ref/provider_id. affiliate_id is additionally
 * protected by the DB immutability trigger — the UI shows it read-only on edit,
 * the edit validator never accepts it, and the trigger is the final guarantee.
 */
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

// Includes the link's own affiliate_id plus an embedded affiliate (name +
// active) resolved via the tracking_links.affiliate_id -> affiliates FK, so the
// Links list can show a friendly affiliate name (and flag deactivated ones).
const SELECT_COLUMNS =
  'id, code, label, channel, source, medium, campaign_slug, destination_path, content, ref, provider_id, is_active, affiliate_id, created_at, created_by, updated_at, updated_by, affiliate:affiliates(id, name, is_active)'

/** Postgres unique-violation SQLSTATE (short-code collision). */
const UNIQUE_VIOLATION = '23505'

interface TrackingLinkDTO {
  id: string
  code: string
  label: string
  channel: string
  source: string
  medium: string
  campaign: string
  destinationPath: string
  content: string | null
  ref: string | null
  providerId: string | null
  isActive: boolean
  affiliateId: string | null
  affiliateName: string | null
  /** Whether the attached affiliate is currently active (null = no affiliate). */
  affiliateActive: boolean | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

function serialize(row: Record<string, unknown>): TrackingLinkDTO {
  // Embedded affiliate relation: PostgREST returns an object or null.
  const affiliate = (row.affiliate ?? null) as
    | { id?: unknown; name?: unknown; is_active?: unknown }
    | null
  return {
    id: String(row.id),
    code: String(row.code),
    label: String(row.label),
    channel: String(row.channel),
    source: String(row.source),
    medium: String(row.medium),
    campaign: String(row.campaign_slug),
    destinationPath: String(row.destination_path),
    content: (row.content as string | null) ?? null,
    ref: (row.ref as string | null) ?? null,
    providerId: (row.provider_id as string | null) ?? null,
    isActive: row.is_active === true,
    affiliateId: (row.affiliate_id as string | null) ?? null,
    affiliateName: affiliate && typeof affiliate.name === 'string' ? affiliate.name : null,
    affiliateActive: affiliate ? affiliate.is_active === true : null,
    createdAt: String(row.created_at),
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: String(row.updated_at),
    updatedBy: (row.updated_by as string | null) ?? null,
  }
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
    .from('tracking_links')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[marketing/links] GET error:', error.message)
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

  const validated = validateCreateInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()

  // When an affiliate is attached, it MUST exist and be ACTIVE at creation time.
  // A missing affiliate -> invalid_affiliate (400); an inactive one ->
  // affiliate_inactive (409). This mirrors the UI, which only offers active
  // affiliates in the picker; the check here is the authoritative server guard.
  // (Existing links pointing at a since-deactivated affiliate are unaffected —
  // this rule applies only to NEW links.)
  if (validated.value.affiliate_id) {
    const { data: aff, error: affErr } = await svc
      .from('affiliates')
      .select('id, is_active')
      .eq('id', validated.value.affiliate_id)
      .maybeSingle()

    if (affErr) {
      console.error('[marketing/links] affiliate lookup error:', affErr.message)
      return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
    }
    if (!aff) {
      return NextResponse.json({ ok: false, error: 'invalid_affiliate' }, { status: 400 })
    }
    if (aff.is_active !== true) {
      return NextResponse.json({ ok: false, error: 'affiliate_inactive' }, { status: 409 })
    }
  }

  // Generate a unique short code with collision-retry. The DB has a
  // case-insensitive unique index, so a collision surfaces as 23505; we retry a
  // handful of times before surfacing a stable error.
  const MAX_ATTEMPTS = 6
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateShortCode()
    const { data, error } = await svc
      .from('tracking_links')
      .insert({
        ...validated.value,
        code,
        created_by: user.id,
        updated_by: user.id,
      })
      .select(SELECT_COLUMNS)
      .single()

    if (!error && data) {
      return NextResponse.json({ ok: true, item: serialize(data) })
    }

    if (error && error.code === UNIQUE_VIOLATION) {
      // Code collision — try a fresh code.
      continue
    }

    console.error('[marketing/links] POST error:', error?.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }

  console.error('[marketing/links] POST failed: exhausted short-code attempts')
  return NextResponse.json({ ok: false, error: 'code_generation_failed' }, { status: 500 })
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

  // Only safely-editable fields. channel/source/medium/campaign_slug/code are
  // never updated here (immutable; the DB trigger rejects attribution changes).
  const validated = validateEditInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from('tracking_links')
    .update({
      ...validated.value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/links] PUT error:', error.message)
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
  // Enable/disable only. A disabled link stops resolving at /t (the RPC filters
  // is_active) but existing checkout attribution snapshots are never changed.
  const { data, error } = await svc
    .from('tracking_links')
    .update({
      is_active: body.isActive,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[marketing/links] PATCH error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, item: serialize(data) })
}
