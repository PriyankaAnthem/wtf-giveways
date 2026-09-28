import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabase, serializeControl, RECIPIENT_STATUSES } from '@/lib/admin/marketing/hub-queries'
import type { ControlDTO } from '@/lib/admin/marketing/hub-queries'
import { maskEmail, canEnableSending } from '@/lib/admin/marketing/ops-validation'

/**
 * Stage 034 — Marketing Operations Console server-only reads + serialisers.
 *
 * Every function assumes admin authorization has ALREADY happened at the route
 * layer; it only constructs the service-role client (which bypasses forced RLS)
 * to READ authoritative configuration and BOUNDED aggregate/operational data.
 *
 * It NEVER sends, enqueues, claims, creates a run, or invokes the worker. All
 * customer identity is either aggregated to counts or masked (emails) before it
 * leaves this module: no claim tokens, unsubscribe tokens, provider payloads or
 * raw snapshots are ever selected or returned.
 */

export { getServiceSupabase, serializeControl }

/** Active-suppression reason buckets (mirror the DB CHECK). */
export const SUPPRESSION_REASONS = [
  'unsubscribe',
  'hard_bounce',
  'complaint',
  'manual',
  'invalid_address',
] as const

/** Hard caps on the "recent" lists so the page can never issue an unbounded read. */
export const RECENT_RECIPIENTS_LIMIT = 25
export const RECENT_RUNS_LIMIT = 20

// ---------------------------------------------------------------------------
// DTOs (config + operational; never a raw identity or secret).
// ---------------------------------------------------------------------------

export interface OpsAutomationDTO {
  automationKey: string
  name: string
  enabled: boolean
  priority: number
  firstDelayMinutes: number | null
  cooldownHours: number | null
  maximumRecipientsPerRun: number
}

export interface OpsDefinitionDTO {
  opportunityKey: string
  displayName: string
  family: string
  enabled: boolean
  priority: number
  score: number
  expiryHours: number
}

export interface QueueSummaryDTO {
  countsByStatus: Record<string, number>
  locked: number
  retryableQueued: number
  scheduledFuture: number
}

export interface RecentRecipientDTO {
  id: string
  createdAt: string
  status: string
  attempts: number
  opportunityType: string | null
  maskedEmail: string
  hasProviderId: boolean
  sentAt: string | null
  deliveredAt: string | null
  clickedAt: string | null
  bouncedAt: string | null
  complainedAt: string | null
}

export interface RecentRunDTO {
  id: string
  automationName: string | null
  status: string
  candidateCount: number
  queuedCount: number
  sentCount: number
  skippedCount: number
  failedCount: number
  startedAt: string
  completedAt: string | null
  createdAt: string
}

export interface SuppressionSummaryDTO {
  byReason: Record<string, number>
  total: number
}

export interface ArmingStateDTO {
  sendingEnabled: boolean
  discoveryEnabled: boolean
  rolloutLimit: number
  maximumBatchSize: number
  enabledAutomationCount: number
  enabledDefinitionCount: number
  queuedRecipientCount: number
}

// ---------------------------------------------------------------------------
// Column lists.
// ---------------------------------------------------------------------------

const CONTROL_COLUMNS =
  'sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact, updated_at'

const OPS_AUTOMATION_COLUMNS =
  'automation_key, name, enabled, priority, first_delay_minutes, cooldown_hours, maximum_recipients_per_run'

const OPS_DEFINITION_COLUMNS =
  'opportunity_key, display_name, family, default_priority, default_score, default_expiry_hours, enabled'

const RECENT_RECIPIENT_COLUMNS =
  'id, created_at, status, attempts, provider_email_id, opportunity_id, email_lc, sent_at, delivered_at, clicked_at, bounced_at, complained_at'

const RECENT_RUN_COLUMNS =
  'id, automation_id, status, candidate_count, queued_count, sent_count, skipped_count, failed_count, started_at, completed_at, created_at'

// ---------------------------------------------------------------------------
// Serialisers.
// ---------------------------------------------------------------------------

export function serializeOpsAutomation(row: Record<string, unknown>): OpsAutomationDTO {
  return {
    automationKey: String(row.automation_key),
    name: String(row.name),
    enabled: row.enabled === true,
    priority: Number(row.priority),
    firstDelayMinutes: (row.first_delay_minutes as number | null) ?? null,
    cooldownHours: (row.cooldown_hours as number | null) ?? null,
    maximumRecipientsPerRun: Number(row.maximum_recipients_per_run),
  }
}

export function serializeOpsDefinition(row: Record<string, unknown>): OpsDefinitionDTO {
  return {
    opportunityKey: String(row.opportunity_key),
    displayName: String(row.display_name),
    family: String(row.family),
    enabled: row.enabled === true,
    priority: Number(row.default_priority),
    score: Number(row.default_score),
    expiryHours: Number(row.default_expiry_hours),
  }
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

export async function fetchOpsControl(svc: SupabaseClient): Promise<ControlDTO> {
  const { data } = await svc
    .from('marketing_control_state')
    .select(CONTROL_COLUMNS)
    .eq('key', 'default')
    .maybeSingle()
  return serializeControl((data as Record<string, unknown> | null) ?? null)
}

export async function fetchOpsAutomations(svc: SupabaseClient): Promise<OpsAutomationDTO[]> {
  const { data } = await svc
    .from('marketing_automations')
    .select(OPS_AUTOMATION_COLUMNS)
    .order('priority', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => serializeOpsAutomation(r))
}

export async function fetchOpsDefinitions(svc: SupabaseClient): Promise<OpsDefinitionDTO[]> {
  const { data } = await svc
    .from('marketing_opportunity_definitions')
    .select(OPS_DEFINITION_COLUMNS)
    .order('family', { ascending: true })
    .order('default_priority', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => serializeOpsDefinition(r))
}

async function headCount(
  svc: SupabaseClient,
  build: (q: ReturnType<SupabaseClient['from']>) => unknown,
): Promise<number> {
  const q = svc.from('marketing_recipients').select('id', { count: 'exact', head: true })
  const { count } = (await build(q)) as { count: number | null }
  return count ?? 0
}

/**
 * Bounded operational queue summary. Uses HEAD counts only (no rows, no
 * identities) for every status plus the three operational signals.
 */
export async function fetchQueueSummary(
  svc: SupabaseClient,
  now: string = new Date().toISOString(),
): Promise<QueueSummaryDTO> {
  const countsByStatus: Record<string, number> = {}

  await Promise.all(
    RECIPIENT_STATUSES.map(async (status) => {
      const { count } = await svc
        .from('marketing_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      countsByStatus[status] = count ?? 0
    }),
  )

  const [locked, retryableQueued, scheduledFuture] = await Promise.all([
    headCount(svc, (q) => (q as any).not('locked_until', 'is', null).gt('locked_until', now)),
    headCount(svc, (q) => (q as any).eq('status', 'queued').gt('attempts', 0)),
    headCount(svc, (q) => (q as any).eq('status', 'queued').gt('run_after', now)),
  ])

  return { countsByStatus, locked, retryableQueued, scheduledFuture }
}

/**
 * The most recent recipients (bounded to RECENT_RECIPIENTS_LIMIT). Emails are
 * masked; opportunity type is resolved via a single batched lookup on
 * marketing_opportunities (never the recipient's raw snapshots).
 */
export async function fetchRecentRecipients(svc: SupabaseClient): Promise<RecentRecipientDTO[]> {
  const { data } = await svc
    .from('marketing_recipients')
    .select(RECENT_RECIPIENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(RECENT_RECIPIENTS_LIMIT)

  const rows = (data ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return []

  const opportunityIds = [
    ...new Set(rows.map((r) => r.opportunity_id).filter((v): v is string => typeof v === 'string')),
  ]

  const typeById = new Map<string, string>()
  if (opportunityIds.length > 0) {
    const { data: opps } = await svc
      .from('marketing_opportunities')
      .select('id, opportunity_type')
      .in('id', opportunityIds)
    for (const o of (opps ?? []) as Record<string, unknown>[]) {
      typeById.set(String(o.id), String(o.opportunity_type))
    }
  }

  return rows.map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    status: String(r.status),
    attempts: Number(r.attempts),
    opportunityType:
      typeof r.opportunity_id === 'string' ? (typeById.get(r.opportunity_id) ?? null) : null,
    maskedEmail: maskEmail(r.email_lc),
    hasProviderId: typeof r.provider_email_id === 'string' && r.provider_email_id.length > 0,
    sentAt: (r.sent_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    clickedAt: (r.clicked_at as string | null) ?? null,
    bouncedAt: (r.bounced_at as string | null) ?? null,
    complainedAt: (r.complained_at as string | null) ?? null,
  }))
}

/** The most recent automation runs (bounded to RECENT_RUNS_LIMIT). */
export async function fetchRecentRuns(svc: SupabaseClient): Promise<RecentRunDTO[]> {
  const { data } = await svc
    .from('marketing_automation_runs')
    .select(RECENT_RUN_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(RECENT_RUNS_LIMIT)

  const rows = (data ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return []

  const automationIds = [
    ...new Set(rows.map((r) => r.automation_id).filter((v): v is string => typeof v === 'string')),
  ]

  const nameById = new Map<string, string>()
  if (automationIds.length > 0) {
    const { data: autos } = await svc
      .from('marketing_automations')
      .select('id, name')
      .in('id', automationIds)
    for (const a of (autos ?? []) as Record<string, unknown>[]) {
      nameById.set(String(a.id), String(a.name))
    }
  }

  return rows.map((r) => ({
    id: String(r.id),
    automationName:
      typeof r.automation_id === 'string' ? (nameById.get(r.automation_id) ?? null) : null,
    status: String(r.status),
    candidateCount: Number(r.candidate_count),
    queuedCount: Number(r.queued_count),
    sentCount: Number(r.sent_count),
    skippedCount: Number(r.skipped_count),
    failedCount: Number(r.failed_count),
    startedAt: String(r.started_at),
    completedAt: (r.completed_at as string | null) ?? null,
    createdAt: String(r.created_at),
  }))
}

/** Active suppression counts grouped by reason (revoked_at IS NULL only). */
export async function fetchSuppressionSummary(svc: SupabaseClient): Promise<SuppressionSummaryDTO> {
  const byReason: Record<string, number> = {}
  await Promise.all(
    SUPPRESSION_REASONS.map(async (reason) => {
      const { count } = await svc
        .from('marketing_suppressions')
        .select('id', { count: 'exact', head: true })
        .eq('reason', reason)
        .is('revoked_at', null)
      byReason[reason] = count ?? 0
    }),
  )
  const total = Object.values(byReason).reduce((a, b) => a + b, 0)
  return { byReason, total }
}

/**
 * Freshly-read authoritative arming state, used by the sending mutation right
 * before a dangerous ON transition. Never trusts stale UI values.
 */
export async function fetchArmingState(svc: SupabaseClient): Promise<ArmingStateDTO> {
  const [control, enabledAutomations, enabledDefinitions, queued] = await Promise.all([
    svc
      .from('marketing_control_state')
      .select('sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size')
      .eq('key', 'default')
      .maybeSingle(),
    svc
      .from('marketing_automations')
      .select('automation_key', { count: 'exact', head: true })
      .eq('enabled', true),
    svc
      .from('marketing_opportunity_definitions')
      .select('opportunity_key', { count: 'exact', head: true })
      .eq('enabled', true),
    svc
      .from('marketing_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued'),
  ])

  const row = (control.data as Record<string, unknown> | null) ?? null
  return {
    sendingEnabled: row?.sending_enabled === true,
    discoveryEnabled: row?.discovery_enabled === true,
    rolloutLimit: Number(row?.rollout_limit ?? 0),
    maximumBatchSize: Number(row?.maximum_batch_size ?? 100),
    enabledAutomationCount: enabledAutomations.count ?? 0,
    enabledDefinitionCount: enabledDefinitions.count ?? 0,
    queuedRecipientCount: queued.count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Full snapshot assembly — the SINGLE source of truth shared by the read route
// and the server-rendered admin page, so both always agree. Read-only: it never
// sends, enqueues, claims, creates a run, or invokes the worker.
// ---------------------------------------------------------------------------

export interface OpsSummary {
  generatedAt: string
  control: ControlDTO
  automations: OpsAutomationDTO[]
  definitions: OpsDefinitionDTO[]
  queue: QueueSummaryDTO
  recentRecipients: RecentRecipientDTO[]
  recentRuns: RecentRunDTO[]
  suppressions: SuppressionSummaryDTO
  derived: {
    enabledAutomationCount: number
    enabledDefinitionCount: number
    sendingBlocker: string | null
  }
}

export async function assembleOpsSummary(svc: SupabaseClient): Promise<OpsSummary> {
  const [control, automations, definitions, queue, recentRecipients, recentRuns, suppressions] =
    await Promise.all([
      fetchOpsControl(svc),
      fetchOpsAutomations(svc),
      fetchOpsDefinitions(svc),
      fetchQueueSummary(svc),
      fetchRecentRecipients(svc),
      fetchRecentRuns(svc),
      fetchSuppressionSummary(svc),
    ])

  const enabledAutomationCount = automations.filter((a) => a.enabled).length
  const enabledDefinitionCount = definitions.filter((d) => d.enabled).length

  // Advisory only — the authoritative re-read + block happens in the mutation.
  const armingCheck = canEnableSending({
    rolloutLimit: control.rolloutLimit,
    enabledAutomationCount,
    enabledDefinitionCount,
  })

  return {
    generatedAt: new Date().toISOString(),
    control,
    automations,
    definitions,
    queue,
    recentRecipients,
    recentRuns,
    suppressions,
    derived: {
      enabledAutomationCount,
      enabledDefinitionCount,
      sendingBlocker: armingCheck.ok ? null : armingCheck.error,
    },
  }
}
