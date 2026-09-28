import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AuditLogEntry, AuditEventType } from "@/lib/types/auditLog"
import { X } from 'lucide-react'

type AuditLogDetailsDrawerProps = {
  log: AuditLogEntry | null
  isOpen: boolean
  onClose: () => void
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

function getActorLabel(actor: AuditLogEntry['actor']): string {
  if (actor.type === 'system') return 'System'
  return actor.label
}

function getActorType(actor: AuditLogEntry['actor']): string {
  return actor.type.charAt(0).toUpperCase() + actor.type.slice(1)
}

export default function AuditLogDetailsDrawer({
  log,
  isOpen,
  onClose,
}: AuditLogDetailsDrawerProps) {
  if (!log) return null

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-background border-l shadow-lg z-50 transition-transform ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-lg font-semibold">Log Details</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Event ID</div>
              <div className="font-mono text-sm">{log.id}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Time</div>
              <div className="text-sm">
                {new Date(log.createdAt).toLocaleString('en-GB', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Event Type</div>
              <Badge variant={getEventBadgeVariant(log.eventType)}>
                {formatEventType(log.eventType)}
              </Badge>
            </div>

            {log.campaignLabel && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Campaign</div>
                <div className="text-sm">{log.campaignLabel}</div>
              </div>
            )}

            <div>
              <div className="text-sm text-muted-foreground mb-1">Actor</div>
              <div className="space-y-1">
                <div className="text-sm font-medium">{getActorLabel(log.actor)}</div>
                <div className="text-xs text-muted-foreground">
                  Type: {getActorType(log.actor)}
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Summary</div>
              <div className="text-sm font-medium p-3 bg-muted rounded-md">
                {log.summary}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-2">Metadata</div>
              {log.metadata && Object.keys(log.metadata).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(log.metadata).map(([key, value]) => (
                    <div key={key} className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{key}:</span>
                      <span className="font-mono">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No metadata</div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t p-6">
            <Button variant="secondary" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
