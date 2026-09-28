/**
 * Client-safe shapes + copy for the Marketing Operations Console.
 *
 * These mirror the JSON returned by GET /api/admin/marketing/ops/summary. They
 * are declared here (not imported from the server-only query module) so the
 * client bundle never pulls a `server-only` import.
 */

export interface OpsControl {
  sendingEnabled: boolean
  discoveryEnabled: boolean
  rolloutLimit: number
  maximumBatchSize: number
  maximumDailyPerContact: number
  maximumWeeklyPerContact: number
  updatedAt: string | null
}

export interface OpsAutomation {
  automationKey: string
  name: string
  enabled: boolean
  priority: number
  firstDelayMinutes: number | null
  cooldownHours: number | null
  maximumRecipientsPerRun: number
}

export interface OpsDefinition {
  opportunityKey: string
  displayName: string
  family: string
  enabled: boolean
  priority: number
  score: number
  expiryHours: number
}

export interface OpsQueue {
  countsByStatus: Record<string, number>
  locked: number
  retryableQueued: number
  scheduledFuture: number
}

export interface OpsRecentRecipient {
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

export interface OpsRecentRun {
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

export interface OpsSuppressions {
  byReason: Record<string, number>
  total: number
}

export interface OpsSummaryResponse {
  ok: true
  generatedAt: string
  control: OpsControl
  automations: OpsAutomation[]
  definitions: OpsDefinition[]
  queue: OpsQueue
  recentRecipients: OpsRecentRecipient[]
  recentRuns: OpsRecentRun[]
  suppressions: OpsSuppressions
  derived: {
    enabledAutomationCount: number
    enabledDefinitionCount: number
    sendingBlocker: string | null
  }
}

/** Ordered recipient/queue statuses for the summary grid. */
export const RECIPIENT_STATUS_ORDER = [
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

export const SUPPRESSION_REASON_ORDER = [
  'unsubscribe',
  'hard_bounce',
  'complaint',
  'manual',
  'invalid_address',
] as const

/** Map server error codes to concise operator-facing copy. */
export const OPS_ERROR_COPY: Record<string, string> = {
  sending_requires_rollout: 'Sending is blocked: the rollout limit is 0. Set a rollout limit first.',
  sending_requires_automation: 'Sending is blocked: no automations are enabled.',
  sending_requires_definition: 'Sending is blocked: no opportunity definitions are enabled.',
  rollout_exceeds_batch: 'That rollout limit exceeds the maximum batch size.',
  invalid_rollout_limit: 'Choose one of the allowed rollout values.',
  template_required_to_enable: 'This automation needs a template assigned before it can be enabled.',
  not_found: 'That record no longer exists. Refresh and try again.',
  unauthorized: 'You are not authorized to perform that action.',
  save_failed: 'The change could not be saved. Try again.',
  network_error: 'Network error. Try again.',
}

export function opsErrorCopy(code?: string): string {
  if (!code) return 'Something went wrong. Try again.'
  return OPS_ERROR_COPY[code] ?? 'Something went wrong. Try again.'
}
