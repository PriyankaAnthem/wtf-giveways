import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabase } from '@/lib/admin/live-board'

/**
 * WTF Marketing Hub — Stage 3B server-only reads + serialisers.
 *
 * Every function here assumes admin authorization has ALREADY happened at the
 * route layer; it only ever constructs the service-role client (which bypasses
 * the forced-RLS Stage 3A tables) to READ configuration or aggregate counts, or
 * to verify referential existence before a write. It NEVER selects recipient or
 * external-contact identity rows — recipients/external contacts are exposed as
 * aggregate counts only — and it can never send, enqueue or create a run.
 */

export { getServiceSupabase }

/** Recipient statuses (mirror the DB CHECK) — used for identity-free counts. */
export const RECIPIENT_STATUSES = [
  'queued',
  'processing',
  'sent',
  'delivered',
  'clicked',
  'skipped',
  'failed',
  'bounced',
  'complained',
  'cancelled',
] as const

// ---------------------------------------------------------------------------
// DTOs (camelCase, config-only, never any customer identity).
// ---------------------------------------------------------------------------

export interface AutomationDTO {
  automationKey: string
  name: string
  enabled: boolean
  priority: number
  templateId: string | null
  firstDelayMinutes: number | null
  followUpDelayMinutes: number | null
  cooldownHours: number | null
  minimumWalletPence: number | null
  discountCodeId: string | null
  maximumRecipientsPerRun: number
  updatedAt: string
}

export interface TemplateDTO {
  id: string
  templateKey: string
  name: string
  subject: string
  previewText: string | null
  heading: string
  bodyText: string
  ctaLabel: string
  defaultUrl: string | null
  discountCodeId: string | null
  version: number
  isActive: boolean
  updatedAt: string
}

export interface TemplateOptionDTO {
  id: string
  templateKey: string
  name: string
  isActive: boolean
  version: number
}

export interface DiscountCodeOptionDTO {
  id: string
  code: string
}

export interface CampaignOptionDTO {
  id: string
  title: string | null
  slug: string | null
}

export interface PromotionDTO {
  id: string
  campaignId: string
  campaignTitle: string | null
  promotionType: string
  templateId: string | null
  status: string
  scheduledAt: string | null
  rolloutLimit: number
  createdAt: string
  updatedAt: string
}

export interface ControlDTO {
  sendingEnabled: boolean
  discoveryEnabled: boolean
  rolloutLimit: number
  maximumBatchSize: number
  maximumDailyPerContact: number
  maximumWeeklyPerContact: number
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// Column lists.
// ---------------------------------------------------------------------------

export const AUTOMATION_COLUMNS =
  'automation_key, name, enabled, priority, template_id, first_delay_minutes, follow_up_delay_minutes, cooldown_hours, minimum_wallet_pence, discount_code_id, maximum_recipients_per_run, updated_at'

export const TEMPLATE_COLUMNS =
  'id, template_key, name, subject, preview_text, heading, body_text, cta_label, default_url, discount_code_id, version, is_active, updated_at'

export const PROMOTION_COLUMNS =
  'id, campaign_id, promotion_type, template_id, status, scheduled_at, rollout_limit, created_at, updated_at'

// ---------------------------------------------------------------------------
// Serialisers.
// ---------------------------------------------------------------------------

export function serializeAutomation(row: Record<string, unknown>): AutomationDTO {
  return {
    automationKey: String(row.automation_key),
    name: String(row.name),
    enabled: row.enabled === true,
    priority: Number(row.priority),
    templateId: (row.template_id as string | null) ?? null,
    firstDelayMinutes: (row.first_delay_minutes as number | null) ?? null,
    followUpDelayMinutes: (row.follow_up_delay_minutes as number | null) ?? null,
    cooldownHours: (row.cooldown_hours as number | null) ?? null,
    minimumWalletPence: (row.minimum_wallet_pence as number | null) ?? null,
    discountCodeId: (row.discount_code_id as string | null) ?? null,
    maximumRecipientsPerRun: Number(row.maximum_recipients_per_run),
    updatedAt: String(row.updated_at),
  }
}

export function serializeTemplate(row: Record<string, unknown>): TemplateDTO {
  return {
    id: String(row.id),
    templateKey: String(row.template_key),
    name: String(row.name),
    subject: String(row.subject),
    previewText: (row.preview_text as string | null) ?? null,
    heading: String(row.heading),
    bodyText: String(row.body_text),
    ctaLabel: String(row.cta_label),
    defaultUrl: (row.default_url as string | null) ?? null,
    discountCodeId: (row.discount_code_id as string | null) ?? null,
    version: Number(row.version),
    isActive: row.is_active === true,
    updatedAt: String(row.updated_at),
  }
}

export function serializePromotion(
  row: Record<string, unknown>,
  campaigns: Map<string, CampaignOptionDTO>,
): PromotionDTO {
  const campaignId = String(row.campaign_id)
  return {
    id: String(row.id),
    campaignId,
    campaignTitle: campaigns.get(campaignId)?.title ?? null,
    promotionType: String(row.promotion_type),
    templateId: (row.template_id as string | null) ?? null,
    status: String(row.status),
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    rolloutLimit: Number(row.rollout_limit),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function serializeControl(row: Record<string, unknown> | null): ControlDTO {
  return {
    sendingEnabled: row?.sending_enabled === true,
    discoveryEnabled: row?.discovery_enabled === true,
    rolloutLimit: Number(row?.rollout_limit ?? 0),
    maximumBatchSize: Number(row?.maximum_batch_size ?? 100),
    maximumDailyPerContact: Number(row?.maximum_daily_per_contact ?? 1),
    maximumWeeklyPerContact: Number(row?.maximum_weekly_per_contact ?? 3),
    updatedAt: (row?.updated_at as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Option / lookup reads.
// ---------------------------------------------------------------------------

/** Active discount codes only, as compact {id, code} options for pickers. */
export async function fetchActiveDiscountCodeOptions(
  svc: SupabaseClient,
): Promise<DiscountCodeOptionDTO[]> {
  const { data } = await svc
    .from('discount_codes')
    .select('id, code, is_active')
    .eq('is_active', true)
    .order('code', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), code: String(r.code) }))
}

export async function fetchTemplateOptions(svc: SupabaseClient): Promise<TemplateOptionDTO[]> {
  const { data } = await svc
    .from('marketing_templates')
    .select('id, template_key, name, is_active, version')
    .order('template_key', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    templateKey: String(r.template_key),
    name: String(r.name),
    isActive: r.is_active === true,
    version: Number(r.version),
  }))
}

export async function fetchCampaignOptions(svc: SupabaseClient): Promise<CampaignOptionDTO[]> {
  const { data } = await svc
    .from('campaigns')
    .select('id, title, slug')
    .order('created_at', { ascending: false })
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    title: (r.title as string | null) ?? null,
    slug: (r.slug as string | null) ?? null,
  }))
}

export async function resolveCampaignTitles(
  svc: SupabaseClient,
  ids: string[],
): Promise<Map<string, CampaignOptionDTO>> {
  const map = new Map<string, CampaignOptionDTO>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return map
  const { data } = await svc.from('campaigns').select('id, title, slug').in('id', unique)
  for (const r of data ?? []) {
    map.set(String(r.id), {
      id: String(r.id),
      title: (r.title as string | null) ?? null,
      slug: (r.slug as string | null) ?? null,
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Referential guards (never trust the client selection).
// ---------------------------------------------------------------------------

/** null = lookup failed; true/false = exists. */
export async function campaignExists(svc: SupabaseClient, id: string): Promise<boolean | null> {
  const { data, error } = await svc.from('campaigns').select('id').eq('id', id).maybeSingle()
  if (error) return null
  return !!data
}

export async function templateExists(svc: SupabaseClient, id: string): Promise<boolean | null> {
  const { data, error } = await svc
    .from('marketing_templates')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  return !!data
}

/**
 * Resolve a discount code by id and report whether it exists AND is active.
 * Returns null on a lookup failure.
 */
export async function discountCodeActive(
  svc: SupabaseClient,
  id: string,
): Promise<{ exists: boolean; active: boolean } | null> {
  const { data, error } = await svc
    .from('discount_codes')
    .select('id, is_active')
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  if (!data) return { exists: false, active: false }
  return { exists: true, active: data.is_active === true }
}

// ---------------------------------------------------------------------------
// Aggregate counts (identity-free).
// ---------------------------------------------------------------------------

/**
 * Recipient counts by status using HEAD counts only (no rows, no identities).
 * In Stage 3A there are zero recipients, so every count is 0; this stays
 * scale-safe if that ever changes.
 */
export async function fetchRecipientCountsByStatus(
  svc: SupabaseClient,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  await Promise.all(
    RECIPIENT_STATUSES.map(async (status) => {
      const { count } = await svc
        .from('marketing_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      counts[status] = count ?? 0
    }),
  )
  return counts
}

/** The Stage 3A read-only aggregate snapshot RPC (config + aggregate counts). */
export async function fetchConfigurationSnapshot(
  svc: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await svc.rpc('get_admin_marketing_configuration')
  if (error || !data) return null
  return data as Record<string, unknown>
}
