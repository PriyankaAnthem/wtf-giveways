import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'

export const runtime = 'nodejs'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * GET /api/admin/inbox/assignees
 *
 * Returns the enabled staff who may be assigned Inbox tickets, via the live
 * `admin_list_inbox_assignees()` RPC. We NEVER query auth.users directly and
 * never include Host/ops users manually — the RPC is the single source of
 * truth. This same list is used server-side to validate assignment requests.
 */
export async function GET() {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, {
    roles: ['admin', 'operations_admin'],
  })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin/inbox/assignees] Missing Supabase config')
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500, ...NO_STORE })
  }
  const svc = createServiceClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const { data, error } = await svc.rpc('admin_list_inbox_assignees')
    if (error) {
      console.error('[admin/inbox/assignees] RPC error:', (error.message || '').slice(0, 300))
      return NextResponse.json({ ok: false, error: 'assignees_failed' }, { status: 500, ...NO_STORE })
    }
    if (!Array.isArray(data)) {
      return NextResponse.json({ ok: false, error: 'assignees_failed' }, { status: 500, ...NO_STORE })
    }

    const assignees = data
      .map((row) => {
        const r = row as Record<string, unknown>
        const userId = asStringOrNull(r.user_id)
        if (!userId || !UUID_RE.test(userId)) return null
        return {
          user_id: userId,
          role: asStringOrNull(r.role),
          email: asStringOrNull(r.email),
          first_name: asStringOrNull(r.first_name),
          last_name: asStringOrNull(r.last_name),
          display_name: asStringOrNull(r.display_name),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    return NextResponse.json({ ok: true, assignees }, NO_STORE)
  } catch (err) {
    console.error('[admin/inbox/assignees] Unexpected error:', (err as Error)?.message)
    return NextResponse.json({ ok: false, error: 'assignees_failed' }, { status: 500, ...NO_STORE })
  }
}
