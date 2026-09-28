'use server'

/* -------------------------------------------------------------------------- *
 * Campaign host assignments (Phase 2 — attribution only).
 *
 * Reads/writes the pre-existing `public.campaign_hosts` relationship table
 * (id, campaign_id, host_user_id, commission_pct, created_at, updated_at;
 * UNIQUE(campaign_id, host_user_id)). No schema/RLS is defined or altered here.
 *
 * Every action is Super-Admin-only (authorizeAdminApi(['admin'])) — the same
 * gate the campaign create/edit API already uses — so `ops`/Host users cannot
 * write host assignments. Host identity labels are resolved by REUSING the
 * existing listHosts() mechanism (email via the Supabase Auth admin API); no
 * second identity resolver is introduced.
 * -------------------------------------------------------------------------- */

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { authorizeAdminApi, HOST_ROLE } from '@/lib/admin/auth'
import { listHosts } from '@/app/admin/hosts/actions'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A Host that can be assigned to a campaign, with a display label. */
export interface AssignableHost {
  user_id: string
  label: string
}

/** One persisted host assignment (numeric percentage, e.g. 7.5 → 7.50%). */
export interface HostAssignment {
  host_user_id: string
  commission_pct: number
}

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Super-Admin-only guard. Authorises the caller with the user-scoped client
 * (RLS-respecting) BEFORE handing back a service client for the reads/writes
 * that need to see all `admin_users` rows — mirrors app/admin/hosts/actions.ts.
 */
async function requireAdminService(): Promise<
  | { ok: true; svc: NonNullable<ReturnType<typeof getServiceClient>> }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { user, error } = await authorizeAdminApi(supabase, { roles: ['admin'] })
  if (!user) {
    return {
      ok: false,
      error: error === 'Not authenticated' ? 'Not authenticated' : 'Not authorized',
    }
  }
  const svc = getServiceClient()
  if (!svc) return { ok: false, error: 'Server configuration error' }
  return { ok: true, svc }
}

/**
 * Enabled Host (ops) users for the campaign host selector.
 * Reuses listHosts() (which already resolves the email label and is
 * Super-Admin-guarded) and keeps only enabled hosts. One lightweight call.
 */
export async function listAssignableHosts(): Promise<{
  ok: boolean
  hosts?: AssignableHost[]
  error?: string
}> {
  const res = await listHosts()
  if (!res.ok) return { ok: false, error: res.error ?? 'Failed to load hosts' }

  const hosts: AssignableHost[] = (res.hosts ?? [])
    .filter((h) => h.is_enabled)
    .map((h) => ({ user_id: h.user_id, label: h.email ?? 'Host (no email)' }))

  return { ok: true, hosts }
}

/** Load a campaign's saved host assignments (stable created_at order). */
export async function getCampaignHostAssignments(campaignId: string): Promise<{
  ok: boolean
  assignments?: HostAssignment[]
  error?: string
}> {
  const guard = await requireAdminService()
  if (!guard.ok) return { ok: false, error: guard.error }

  if (!campaignId || !UUID_RE.test(campaignId)) {
    return { ok: false, error: 'Invalid campaign id' }
  }

  const { data, error } = await guard.svc
    .from('campaign_hosts')
    .select('host_user_id, commission_pct')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[campaign-hosts] load error:', error.message)
    return { ok: false, error: 'Failed to load host assignments' }
  }

  const assignments: HostAssignment[] = (data ?? []).map((r) => ({
    host_user_id: r.host_user_id as string,
    commission_pct: Number(r.commission_pct),
  }))

  return { ok: true, assignments }
}

/**
 * Synchronise a campaign's host assignments to exactly `assignments`.
 *
 * Batch strategy (max two writes, no per-host round trips):
 *   1. DELETE rows for this campaign whose host_user_id is NOT in the new set
 *      (deletes everything when the new set is empty).
 *   2. UPSERT the new set on the UNIQUE(campaign_id, host_user_id) key.
 * Saving with no changes re-upserts the same keys (idempotent — no duplicates).
 * An empty list is valid and simply clears all assignments.
 */
export async function saveCampaignHostAssignments(
  campaignId: string,
  assignments: HostAssignment[],
): Promise<{ ok: boolean; error?: string }> {
  const guard = await requireAdminService()
  if (!guard.ok) return { ok: false, error: guard.error }
  const svc = guard.svc

  if (!campaignId || !UUID_RE.test(campaignId)) {
    return { ok: false, error: 'Invalid campaign id' }
  }
  if (!Array.isArray(assignments)) {
    return { ok: false, error: 'Invalid host assignments' }
  }

  // Validate shape, range and duplicates server-side (never trust the client).
  const seen = new Set<string>()
  const clean: HostAssignment[] = []
  for (const a of assignments) {
    const id = typeof a?.host_user_id === 'string' ? a.host_user_id : ''
    if (!UUID_RE.test(id)) {
      return { ok: false, error: 'Every host row must have a host selected.' }
    }
    if (seen.has(id)) {
      return { ok: false, error: 'The same host cannot be assigned twice.' }
    }
    seen.add(id)

    const pct = Number(a?.commission_pct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'Commission must be a number between 0 and 100.' }
    }
    // Match numeric(5,2) precision.
    clean.push({ host_user_id: id, commission_pct: Math.round(pct * 100) / 100 })
  }

  // Confirm the campaign exists — a clear error beats an opaque FK violation.
  const { data: campaignRow, error: campaignErr } = await svc
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .maybeSingle()
  if (campaignErr) {
    console.error('[campaign-hosts] campaign lookup error:', campaignErr.message)
    return { ok: false, error: 'Failed to verify campaign' }
  }
  if (!campaignRow) return { ok: false, error: 'Campaign not found' }

  // Safety: only enabled Host (ops) users may be assigned. One batched query.
  if (clean.length > 0) {
    const ids = clean.map((c) => c.host_user_id)
    const { data: validHosts, error: hostErr } = await svc
      .from('admin_users')
      .select('user_id')
      .eq('role', HOST_ROLE)
      .eq('is_enabled', true)
      .in('user_id', ids)
    if (hostErr) {
      console.error('[campaign-hosts] host verify error:', hostErr.message)
      return { ok: false, error: 'Failed to verify hosts' }
    }
    const validSet = new Set((validHosts ?? []).map((r) => r.user_id as string))
    if (ids.some((id) => !validSet.has(id))) {
      return { ok: false, error: 'One or more selected hosts are not valid, enabled hosts.' }
    }
  }

  // 1. Delete assignments that are no longer selected. ALWAYS scoped by
  //    campaign_id, so it can never touch another campaign's rows; the
  //    host_user_id exclusion only narrows the delete WITHIN this campaign.
  //    UUIDs are quoted in the in-list per PostgREST parsing rules.
  const keepIds = clean.map((c) => c.host_user_id)
  let del = svc.from('campaign_hosts').delete().eq('campaign_id', campaignId)
  if (keepIds.length > 0) {
    del = del.not('host_user_id', 'in', `(${keepIds.map((id) => `"${id}"`).join(',')})`)
  }
  const { error: deleteErr } = await del
  if (deleteErr) {
    console.error('[campaign-hosts] delete error:', deleteErr.message)
    return { ok: false, error: 'Failed to update host assignments' }
  }

  // 2. Batch upsert the current set (created_at relies on the column default;
  //    updated_at is always bumped).
  if (clean.length > 0) {
    const nowIso = new Date().toISOString()
    const rows = clean.map((c) => ({
      campaign_id: campaignId,
      host_user_id: c.host_user_id,
      commission_pct: c.commission_pct,
      updated_at: nowIso,
    }))
    const { error: upsertErr } = await svc
      .from('campaign_hosts')
      .upsert(rows, { onConflict: 'campaign_id,host_user_id' })
    if (upsertErr) {
      console.error('[campaign-hosts] upsert error:', upsertErr.message)
      return { ok: false, error: 'Failed to save host assignments' }
    }
  }

  return { ok: true }
}
