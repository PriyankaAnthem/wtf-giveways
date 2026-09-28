import AuditLogsPanel from "@/components/admin/audit-logs/AuditLogsPanel"
import type { AuditLogEntry } from "@/lib/types/auditLog"
import { requireAdmin } from "@/lib/admin/auth"

// Mock audit logs data
const mockLogs: AuditLogEntry[] = [
  {
    id: 'log1',
    createdAt: '2026-02-10T14:45:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (5 tickets)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***45' },
  },
  {
    id: 'log2',
    createdAt: '2026-02-10T14:40:00Z',
    eventType: 'instant_win_won',
    summary: 'Won "$10 Gift Card"',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***78' },
  },
  {
    id: 'log3',
    createdAt: '2026-02-10T14:35:00Z',
    eventType: 'instant_win_attempt',
    summary: 'Instant win attempt (no prize)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***12' },
  },
  {
    id: 'log4',
    createdAt: '2026-02-10T14:30:00Z',
    eventType: 'entry_created',
    summary: 'Free entry claimed',
    campaignLabel: 'PlayStation 5 Giveaway',
    actor: { type: 'user', label: 'user_***89' },
  },
  {
    id: 'log5',
    createdAt: '2026-02-10T14:20:00Z',
    eventType: 'entry_flagged',
    summary: 'Entry marked as suspicious',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'admin', label: 'admin_ben' },
  },
  {
    id: 'log6',
    createdAt: '2026-02-10T14:15:00Z',
    eventType: 'campaign_status_changed',
    summary: 'Campaign status changed to "paused"',
    campaignLabel: 'iPhone 15 Pro Competition',
    actor: { type: 'admin', label: 'admin_sarah' },
  },
  {
    id: 'log7',
    createdAt: '2026-02-10T14:10:00Z',
    eventType: 'entry_refunded',
    summary: 'Entry refunded (£25.00)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'system' },
  },
  {
    id: 'log8',
    createdAt: '2026-02-10T14:05:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (10 tickets)',
    campaignLabel: 'PlayStation 5 Giveaway',
    actor: { type: 'user', label: 'user_***34' },
  },
  {
    id: 'log9',
    createdAt: '2026-02-10T13:58:00Z',
    eventType: 'instant_win_won',
    summary: 'Won "Free Coffee Voucher"',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***67' },
  },
  {
    id: 'log10',
    createdAt: '2026-02-10T13:50:00Z',
    eventType: 'admin_action',
    summary: 'Instant win prize inventory adjusted',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'admin', label: 'admin_ben' },
  },
  {
    id: 'log11',
    createdAt: '2026-02-10T13:45:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (20 tickets)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***90' },
  },
  {
    id: 'log12',
    createdAt: '2026-02-10T13:40:00Z',
    eventType: 'campaign_status_changed',
    summary: 'Campaign status changed to "live"',
    campaignLabel: 'PlayStation 5 Giveaway',
    actor: { type: 'admin', label: 'admin_sarah' },
  },
  {
    id: 'log13',
    createdAt: '2026-02-10T13:30:00Z',
    eventType: 'instant_win_attempt',
    summary: 'Instant win attempt (no prize)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***23' },
  },
  {
    id: 'log14',
    createdAt: '2026-02-10T13:25:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (8 tickets)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***56' },
  },
  {
    id: 'log15',
    createdAt: '2026-02-10T13:20:00Z',
    eventType: 'instant_win_won',
    summary: 'Won "$50 Store Credit"',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***01' },
  },
  {
    id: 'log16',
    createdAt: '2026-02-10T13:15:00Z',
    eventType: 'entry_flagged',
    summary: 'Multiple entries from same IP',
    campaignLabel: 'PlayStation 5 Giveaway',
    actor: { type: 'system' },
  },
  {
    id: 'log17',
    createdAt: '2026-02-10T13:10:00Z',
    eventType: 'entry_created',
    summary: 'Free entry claimed',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***88' },
  },
  {
    id: 'log18',
    createdAt: '2026-02-10T13:05:00Z',
    eventType: 'admin_action',
    summary: 'Release rule updated',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'admin', label: 'admin_ben' },
  },
  {
    id: 'log19',
    createdAt: '2026-02-10T13:00:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (15 tickets)',
    campaignLabel: 'PlayStation 5 Giveaway',
    actor: { type: 'user', label: 'user_***42' },
  },
  {
    id: 'log20',
    createdAt: '2026-02-10T12:55:00Z',
    eventType: 'instant_win_attempt',
    summary: 'Instant win attempt (no prize)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***75' },
  },
  {
    id: 'log21',
    createdAt: '2026-02-10T12:50:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (4 tickets)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***19' },
  },
  {
    id: 'log22',
    createdAt: '2026-02-10T12:45:00Z',
    eventType: 'instant_win_won',
    summary: 'Won "Wireless Earbuds"',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'user', label: 'user_***63' },
  },
  {
    id: 'log23',
    createdAt: '2026-02-10T12:40:00Z',
    eventType: 'admin_action',
    summary: 'Campaign settings updated',
    campaignLabel: 'iPhone 15 Pro Competition',
    actor: { type: 'admin', label: 'admin_sarah' },
  },
  {
    id: 'log24',
    createdAt: '2026-02-10T12:35:00Z',
    eventType: 'entry_created',
    summary: 'New entry purchased (12 tickets)',
    campaignLabel: 'PlayStation 5 Giveaway',
    actor: { type: 'user', label: 'user_***31' },
  },
  {
    id: 'log25',
    createdAt: '2026-02-10T12:30:00Z',
    eventType: 'entry_refunded',
    summary: 'Entry refunded (£50.00)',
    campaignLabel: 'Win a MacBook Pro',
    actor: { type: 'admin', label: 'admin_ben' },
  },
]

export default async function AuditLogsPage() {
  await requireAdmin({ roles: ['admin'] })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Audit Logs</h2>
        <p className="text-muted-foreground">
          System activity across campaigns
        </p>
      </div>

      <AuditLogsPanel logs={mockLogs} />
    </div>
  )
}
