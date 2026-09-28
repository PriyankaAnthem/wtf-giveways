import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AdminEntry } from "@/lib/types/entry"
import { X } from 'lucide-react'

type EntryDetailsDrawerProps = {
  entry: AdminEntry | null
  isOpen: boolean
  onClose: () => void
}

function formatPence(pence: number | null, currency: string | null): string {
  if (pence === null) return '—'
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'
  return `${symbol}${(pence / 100).toFixed(2)}`
}

function formatTickets(start: number | null, end: number | null): string {
  if (start === null || end === null) return '—'
  if (start === end) return String(start)
  return `${start} - ${end}`
}

function getStateBadgeVariant(state: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'confirmed':
    case 'paid':
      return 'default'
    case 'pending':
    case 'awaiting_payment':
      return 'secondary'
    case 'failed':
    case 'expired':
      return 'destructive'
    default:
      return 'outline'
  }
}

export default function EntryDetailsDrawer({
  entry,
  isOpen,
  onClose,
}: EntryDetailsDrawerProps) {
  if (!entry) return null

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
            <h2 className="text-lg font-semibold">Entry Details</h2>
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
            {/* Customer Contact Details */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Customer</h3>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Name</div>
                <div className="text-sm font-medium">{entry.customer_name}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Email</div>
                <div className="text-sm font-medium break-all">{entry.customer_email}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Mobile</div>
                <div className="text-sm font-medium">{entry.customer_mobile}</div>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Entry ID</div>
              <div className="font-mono text-sm break-all">{entry.id}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Time</div>
              <div className="text-sm">
                {new Date(entry.created_at).toLocaleString('en-GB', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">User ID</div>
              <div className="font-mono text-sm break-all">{entry.user_id}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Campaign ID</div>
              <div className="font-mono text-sm break-all">{entry.campaign_id}</div>
            </div>

            {entry.giveaway_id && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Giveaway ID</div>
                <div className="font-mono text-sm break-all">{entry.giveaway_id}</div>
              </div>
            )}

            <div className="flex gap-6">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Quantity</div>
                <div className="text-sm font-medium">{entry.qty}</div>
              </div>

              <div>
                <div className="text-sm text-muted-foreground mb-1">Tickets</div>
                <div className="text-sm font-medium">
                  {formatTickets(entry.start_ticket, entry.end_ticket)}
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Checkout Ref</div>
              <div className="font-mono text-sm">{entry.checkout_ref ?? '—'}</div>
            </div>

            <div className="flex gap-6">
              <div>
                <div className="text-sm text-muted-foreground mb-1">State</div>
                {entry.checkout_state ? (
                  <Badge variant={getStateBadgeVariant(entry.checkout_state)}>
                    {entry.checkout_state}
                  </Badge>
                ) : (
                  <span className="text-sm">—</span>
                )}
              </div>

              <div>
                <div className="text-sm text-muted-foreground mb-1">Provider</div>
                <div className="text-sm">{entry.provider ?? '—'}</div>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Amount Paid</div>
              <div className="text-sm font-medium">
                {formatPence(entry.total_pence, entry.currency)}
              </div>
            </div>

            {entry.confirmed_at && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Confirmed At</div>
                <div className="text-sm">
                  {new Date(entry.confirmed_at).toLocaleString('en-GB', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            )}
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
