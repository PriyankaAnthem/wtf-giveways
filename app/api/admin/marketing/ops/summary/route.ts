import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import { getServiceSupabase, assembleOpsSummary } from '@/lib/admin/marketing/ops-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Stage 034 — Marketing Operations Console read-only snapshot (admin-only).
 *
 * Auth FIRST (user-scoped RLS client, admin role ONLY). Only after an admin is
 * confirmed is the service-role client built to READ authoritative config and
 * BOUNDED operational data in one deliberate request (the console never polls).
 * This route can only read: it cannot send, discover, enqueue, claim, create a
 * run or invoke the worker. Every value is aggregate or masked — no tokens,
 * payloads, snapshots or raw identities.
 */
export async function GET() {
  const supabase = await createClient()
  const { user, role, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user || role !== 'admin') {
    const status = authError === 'Not authenticated' ? 401 : 403
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status, headers: NO_STORE })
  }

  const svc = getServiceSupabase()
  const summary = await assembleOpsSummary(svc)

  return NextResponse.json({ ok: true, ...summary }, { headers: NO_STORE })
}
