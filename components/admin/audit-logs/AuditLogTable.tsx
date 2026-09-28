import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import type { AuditLogEntry, AuditEventType } from "@/lib/types/auditLog"

type AuditLogTableProps = {
  logs: AuditLogEntry[]
  onSelect?: (log: AuditLogEntry) => void
}

function getEventBadgeVariant(eventType: AuditEventType): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (eventType) {
    case 'entry_created':
      return 'default'
    case 'entry_flagged':
      return 'destructive'
    case 'entry_refunded':
      return 'outline'
    case 'instant_win_attempt':
      return 'secondary'
    case 'instant_win_won':
      return 'default'
    case 'campaign_status_changed':
      return 'outline'
    case 'admin_action':
      return 'secondary'
    default:
      return 'outline'
  }
}

function formatEventType(eventType: AuditEventType): string {
  return eventType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getActorLabel(actor: AuditLogEntry['actor']): string {
  if (actor.type === 'system') return 'System'
  return actor.label
}

export default function AuditLogTable({ logs, onSelect }: AuditLogTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Actor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow 
                key={log.id}
                onClick={() => onSelect?.(log)}
                className="cursor-pointer"
              >
                <TableCell className="text-muted-foreground">
                  {formatTime(log.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={getEventBadgeVariant(log.eventType)}>
                      {formatEventType(log.eventType)}
                    </Badge>
                    <span className="text-sm">{log.summary}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {log.campaignLabel ? (
                    <span className="text-sm">{log.campaignLabel}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm">{getActorLabel(log.actor)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
