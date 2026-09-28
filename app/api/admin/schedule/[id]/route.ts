import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  isUuid,
  validateScheduleEventInput,
  type ScheduleEvent,
  type ScheduleEventStatus,
  type ScheduleEventType,
} from '@/lib/types/schedule'

/**
 * Admin Schedule item API - edit and delete a single planning row.
 *
 * ISOLATION: every statement is scoped to admin_schedule_events by primary key.
 * Editing or deleting a planning row cannot affect a campaign, host, ticket,
 * payment, instant win, draw or winner (spec s15 / s17 / s26).
 */

function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const SELECT_COLUMNS =
  'id, title, event_type, scheduled_date, scheduled_time, all_day, status, notes, created_at, updated_at'

const ALLOWED_ROLES = ['admin', 'operations_admin'] as const

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } } as const

function authStatus(authError: string | null): number {
  return authError === 'Not authenticated' ? 401 : 403
}

function serialize(row: Record<string, unknown>): ScheduleEvent {
  const time = (row.scheduled_time as string | null) ?? null
  return {
    id: String(row.id),
    title: String(row.title),
    eventType: row.event_type as ScheduleEventType,
    scheduledDate: String(row.scheduled_date),
    scheduledTime: time ? time.slice(0, 5) : null,
    allDay: row.all_day === true,
    status: row.status as ScheduleEventStatus,
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** PATCH /api/admin/schedule/[id] - full replace of the editable fields. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: [...ALLOWED_ROLES] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authStatus(authError), ...NO_STORE },
    )
  }

  const { id } = await ctx.params
  if (!isUuid(id)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_identifier' },
      { status: 400, ...NO_STORE },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400, ...NO_STORE })
  }

  const validated = validateScheduleEventInput(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, ...NO_STORE })
  }

  const svc = getServiceSupabase()
  // created_at / created_by are NEVER overwritten. Scoped to this id only.
  const { data, error } = await svc
    .from('admin_schedule_events')
    .update({
      ...validated.value,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id.trim())
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[admin/schedule] PATCH error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, ...NO_STORE })
  }
  // maybeSingle() returns null rather than erroring when the row is gone, so
  // this is the "someone else deleted it" case, not a failure to save.
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }

  return NextResponse.json({ ok: true, item: serialize(data) }, NO_STORE)
}

/** DELETE /api/admin/schedule/[id] - removes exactly one planning row. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: [...ALLOWED_ROLES] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authStatus(authError), ...NO_STORE },
    )
  }

  const { id } = await ctx.params
  if (!isUuid(id)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_identifier' },
      { status: 400, ...NO_STORE },
    )
  }

  const svc = getServiceSupabase()
  // Returning the deleted row lets us distinguish "deleted" from "already gone"
  // without a second query.
  const { data, error } = await svc
    .from('admin_schedule_events')
    .delete()
    .eq('id', id.trim())
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[admin/schedule] DELETE error:', error.message)
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500, ...NO_STORE })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, ...NO_STORE })
  }

  return NextResponse.json({ ok: true, id: String(data.id) }, NO_STORE)
}
