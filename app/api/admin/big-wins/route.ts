import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"
import { authorizeAdminApi } from "@/lib/admin/auth"
import {
  BIG_WIN_PUBLIC_COLUMNS,
  isUuid,
  mapBigWinRow,
  validateBigWinInput,
} from "@/lib/big-wins"

export const dynamic = "force-dynamic"

// big_wins has RLS enabled; anon can read only ACTIVE rows. Admin management
// (including reading hidden rows) uses the service-role client AFTER admin
// authorization, mirroring the discount_codes convention.
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

function authStatus(authError: string | null): number {
  return authError === "Not authenticated" ? 401 : 403
}

/** GET — every card (active + hidden), ordered as the public carousel would be. */
export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ["admin"] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from("big_wins")
    .select(BIG_WIN_PUBLIC_COLUMNS)
    .order("display_order", { ascending: true })
    .order("won_on", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[big-wins] GET error:", error.message)
    return NextResponse.json({ ok: false, error: "load_failed" }, { status: 500 })
  }
  return NextResponse.json({ ok: true, items: (data ?? []).map(mapBigWinRow) })
}

/** POST — create a new card. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ["admin"] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const validated = validateBigWinInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from("big_wins")
    .insert({ ...validated.value, created_by: user.id })
    .select(BIG_WIN_PUBLIC_COLUMNS)
    .single()

  if (error) {
    console.error("[big-wins] POST error:", error.message)
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 })
  }
  return NextResponse.json({ ok: true, item: mapBigWinRow(data) })
}

/** PUT — edit an existing card (all editable fields). */
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ["admin"] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  if (!isUuid(body.id)) return NextResponse.json({ ok: false, error: "invalid_identifier" }, { status: 400 })
  const id = (body.id as string).trim()

  const validated = validateBigWinInput(body)
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 })

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from("big_wins")
    .update({ ...validated.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(BIG_WIN_PUBLIC_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error("[big-wins] PUT error:", error.message)
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true, item: mapBigWinRow(data) })
}

/**
 * PATCH — two shapes:
 *   { id, isActive }            -> toggle active/hidden
 *   { order: [id1, id2, ...] }  -> persist a new display order (index = order)
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ["admin"] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const svc = getServiceSupabase()

  // Reorder: array of ids in the desired order. display_order = array index.
  if (Array.isArray(body.order)) {
    const ids = body.order
    if (!ids.every((v) => isUuid(v))) {
      return NextResponse.json({ ok: false, error: "invalid_order" }, { status: 400 })
    }
    // Apply sequentially; each row's new display_order is its position.
    for (let i = 0; i < ids.length; i++) {
      const { error } = await svc
        .from("big_wins")
        .update({ display_order: i, updated_at: new Date().toISOString() })
        .eq("id", ids[i] as string)
      if (error) {
        console.error("[big-wins] reorder error:", error.message)
        return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true })
  }

  // Toggle active/hidden.
  if (!isUuid(body.id)) return NextResponse.json({ ok: false, error: "invalid_identifier" }, { status: 400 })
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid_is_active" }, { status: 400 })
  }
  const { data, error } = await svc
    .from("big_wins")
    .update({ is_active: body.isActive, updated_at: new Date().toISOString() })
    .eq("id", (body.id as string).trim())
    .select(BIG_WIN_PUBLIC_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error("[big-wins] PATCH error:", error.message)
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true, item: mapBigWinRow(data) })
}

/** DELETE — permanently remove a card (?id=<uuid>). */
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ["admin"] })
  if (!user) return NextResponse.json({ ok: false, error: authError }, { status: authStatus(authError) })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: "invalid_identifier" }, { status: 400 })

  const svc = getServiceSupabase()
  const { error } = await svc.from("big_wins").delete().eq("id", id!.trim())
  if (error) {
    console.error("[big-wins] DELETE error:", error.message)
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
