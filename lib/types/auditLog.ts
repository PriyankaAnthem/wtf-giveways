export type AuditEventType =
  | 'entry_created'
  | 'entry_flagged'
  | 'entry_refunded'
  | 'instant_win_attempt'
  | 'instant_win_won'
  | 'campaign_status_changed'
  | 'admin_action'

export type AuditActor =
  | { type: 'user'; label: string }
  | { type: 'admin'; label: string }
  | { type: 'system' }

export type AuditLogEntry = {
  id: string
  createdAt: string
  eventType: AuditEventType
  summary: string
  campaignLabel?: string
  actor: AuditActor
  metadata?: Record<string, string | number>
}
