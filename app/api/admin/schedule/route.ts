import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  isCalendarDate,
  validateScheduleEventInput,
  type ScheduleEvent,
  type ScheduleEventStatus,
  type ScheduleEventType,
} from '@/lib/types/schedule'

/**
 * Admin Schedule API - manual planning calendar (spec s18 / s28 / s29).
 *
 * ISOLATION: touches ONLY admin_schedule_events. No campaign, host, ticket,
 * payment, instant-win, draw or marketing table is read or written, and no RPC
 * is invoked. Creating or editing a planning row has zero side effects
 * elsewhere in WTF (spec s26).
 */

// admin_schedule_events has RLS enabled with NO browser policies, so every
// read/write here uses the service-role client AFTER admin authorization.
// This mirrors the established discount_codes convention.
function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const SELECT_COLUMNS =
  'id, title, event_type, scheduled_date, scheduled_time, all_day, status, notes, created_at, updated_at'

/** Both roles may plan; the Schedule is a shared operations tool. */
const ALLOWED_ROLES = ['admin', 'operations_admin'] as const

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } } as const

/**
 * A single month grid spans at most 42 days, but allow a little slack so a
 * caller can request a padded range. This is the guard that keeps the endpoint
 * from being used to dump the entire planning history (spec s28).
 */
const MAX_RANGE_DAYS = 70

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
    // Postgres returns HH:MM:SS; the UI only ever wants HH:MM.
    scheduledTime: time ? time.slice(0, 5) : null,
    allDay: row.all_day === true,
    status: row.status as ScheduleEventStatus,
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  )
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

/**
 * GET /api/admin/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns only the planning rows inside the requested (bounded) range. There is
 * deliberately no "fetch everything" mode.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: [...ALLOWED_ROLES] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authStatus(authError), ...NO_STORE },
    )
  }

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  // The range is mandatory: without it a caller could pull the whole table.
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return NextResponse.json({ ok: false, error: 'invalid_range' }, { status: 400, ...NO_STORE })
  }

  const span = daysBetween(from, to)
  if (span < 0) {
    return NextResponse.json({ ok: false, error: 'invalid_range' }, { status: 400, ...NO_STORE })
  }
  if (span > MAX_RANGE_DAYS) {
    return NextResponse.json({ ok: false, error: 'range_too_large' }, { status: 400, ...NO_STORE })
  }

  const svc = getServiceSupabase()
  const { data, error } = await svc
    .from('admin_schedule_events')
    .select(SELECT_COLUMNS)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date', { ascending: true })
    .order('all_day', { ascending: false })
    .order('scheduled_time', { ascending: true, nullsFirst: true })

  if (error) {
    console.error('[admin/schedule] GET error:', error.message)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500, ...NO_STORE })
  }

  const items = (data ?? []).map((row) => serialize(row as Record<string, unknown>))
  return NextResponse.json({ ok: true, items }, NO_STORE)
}

/**
 * POST /api/admin/schedule
 *
 * Creates one planning row. Also serves Duplicate: the client sends the copied
 * field values as a normal create, so the new row is fully independent and
 * holds no reference to the original (spec s16).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: [...ALLOWED_ROLES] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authStatus(authError), ...NO_STORE },
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
  const { data, error } = await svc
    .from('admin_schedule_events')
    .insert({
      ...validated.value,
      // Audit field is ALWAYS derived server-side; any client value is ignored.
      created_by: user.id,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    console.error('[admin/schedule] POST error:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500, ...NO_STORE })
  }

  return NextResponse.json({ ok: true, item: serialize(data) }, NO_STORE)
}
