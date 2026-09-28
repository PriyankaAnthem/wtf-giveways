import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  loadHomepageMerchandising,
  isManualRail,
  isValidRail,
  isUuid,
  validateRailOrderInput,
} from '@/lib/admin/homepage-merchandising'

/**
 * Admin merchandising API.
 *
 * GET   — current six visible rails + eligible picker/hidden metadata + the
 *          configured SECTION order.
 * POST  — atomically save the full homepage SECTION (rail container) order via
 *          set_homepage_rail_section_order. Separate from campaign placement.
 * PUT   — save one rail's visible order via set_homepage_rail_order.
 * PATCH — atomically Hide/Restore one campaign in a DERIVED rail only.
 *
 * All writes use service_role server-side only. Browser never receives the key.
 * All handlers remain admin-only through authorizeAdminApi.
 */

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) return null

  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin'],
  })

  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  try {
    const data = await loadHomepageMerchandising()
    return NextResponse.json({ ok: true, ...data })
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? 'Failed to load homepage merchandising',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin'],
  })

  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  // Full ordered list of the six rail keys. The validator enforces exactly six
  // entries, all valid rails, no duplicates — so the RPC never receives a
  // partial or unknown order. The DB RPC re-validates identically.
  const railOrder = validateRailOrderInput(body?.railOrder)

  if (!railOrder) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'railOrder must list all six rail keys exactly once, with no unknown rails',
      },
      { status: 400 },
    )
  }

  const svc = getServiceClient()

  if (!svc) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Server misconfigured: missing Supabase service credentials',
      },
      { status: 500 },
    )
  }

  // One atomic write of positions 0..5. This touches ONLY homepage_rail_order —
  // never campaign_homepage_placements, so campaign membership/order and hidden
  // state are entirely unaffected.
  const { error: rpcError } = await svc.rpc('set_homepage_rail_section_order', {
    p_rails: railOrder,
  })

  if (rpcError) {
    return NextResponse.json(
      { ok: false, error: rpcError.message, details: rpcError },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, railOrder })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin'],
  })

  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const { rail, campaignIds } = body

  if (!isValidRail(rail)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid rail' },
      { status: 400 },
    )
  }

  if (!Array.isArray(campaignIds) || !campaignIds.every(isUuid)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'campaignIds must be an array of UUIDs',
      },
      { status: 400 },
    )
  }

  if (new Set(campaignIds).size !== campaignIds.length) {
    return NextResponse.json(
      {
        ok: false,
        error: 'campaignIds contains duplicates',
      },
      { status: 400 },
    )
  }

  const svc = getServiceClient()

  if (!svc) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Server misconfigured: missing Supabase service credentials',
      },
      { status: 500 },
    )
  }

  // One atomic order save. The production RPC now preserves is_hidden=true rows
  // on derived rails and keeps the original replace semantics on manual rails.
  const { error: rpcError } = await svc.rpc('set_homepage_rail_order', {
    p_rail: rail,
    p_campaign_ids: campaignIds,
  })

  if (rpcError) {
    return NextResponse.json(
      { ok: false, error: rpcError.message, details: rpcError },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    rail,
    campaignIds,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin'],
  })

  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403 },
    )
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const { rail, campaignId, hidden } = body

  if (!isValidRail(rail)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid rail' },
      { status: 400 },
    )
  }

  // Hide/Restore is deliberately unavailable for manual rails.
  // Manual membership remains Add/Remove exactly as before.
  if (isManualRail(rail)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Hide/Restore is only available for automatic rails',
      },
      { status: 400 },
    )
  }

  if (!isUuid(campaignId)) {
    return NextResponse.json(
      { ok: false, error: 'campaignId must be a UUID' },
      { status: 400 },
    )
  }

  if (typeof hidden !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'hidden must be a boolean' },
      { status: 400 },
    )
  }

  const svc = getServiceClient()

  if (!svc) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Server misconfigured: missing Supabase service credentials',
      },
      { status: 500 },
    )
  }

  // One atomic per-campaign visibility write using the same rail advisory lock
  // as reorder. It cannot affect another rail.
  const { error: rpcError } = await svc.rpc('set_homepage_rail_hidden', {
    p_rail: rail,
    p_campaign_id: campaignId,
    p_hidden: hidden,
  })

  if (rpcError) {
    return NextResponse.json(
      { ok: false, error: rpcError.message, details: rpcError },
      { status: 500 },
    )
  }

  // Return the authoritative admin state after the write. This costs two small
  // admin-only reads, but removes any client guesswork around Restore position.
  try {
    const data = await loadHomepageMerchandising()

    return NextResponse.json({
      ok: true,
      rail,
      campaignId,
      hidden,
      ...data,
    })
  } catch (e: any) {
    // The visibility write has already succeeded. Report that clearly rather
    // than pretending the mutation failed merely because the refresh failed.
    return NextResponse.json({
      ok: true,
      rail,
      campaignId,
      hidden,
      refreshWarning:
        e?.message ?? 'Visibility saved but failed to refresh merchandising data',
    })
  }
}
