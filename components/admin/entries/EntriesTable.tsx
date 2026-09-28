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
import { Button } from "@/components/ui/button"
import type { AdminEntry } from "@/lib/types/entry"

type EntriesTableProps = {
  entries: AdminEntry[]
  onView?: (entry: AdminEntry) => void
}

function shortenId(id: string | null): string {
  if (!id) return '—'
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}...${id.slice(-4)}`
}

function formatTickets(start: number | null, end: number | null): string {
  if (start === null || end === null) return '—'
  if (start === end) return String(start)
  return `${start}-${end}`
}

function formatPence(pence: number | null, currency: string | null): string {
  if (pence === null) return '—'
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'
  return `${symbol}${(pence / 100).toFixed(2)}`
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

export default function EntriesTable({ entries, onView }: EntriesTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entries</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No entries found</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Checkout Ref</TableHead>
                <TableHead>Tickets</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString('en-GB', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate" title={entry.customer_name}>
                    {entry.customer_name}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs" title={entry.customer_email}>
                    {entry.customer_email}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {entry.customer_mobile}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.checkout_ref ?? '—'}
                  </TableCell>
                  <TableCell>
                    {formatTickets(entry.start_ticket, entry.end_ticket)}
                  </TableCell>
                  <TableCell>{entry.qty}</TableCell>
                  <TableCell>
                    {formatPence(entry.total_pence, entry.currency)}
                  </TableCell>
                  <TableCell>
                    {entry.checkout_state ? (
                      <Badge variant={getStateBadgeVariant(entry.checkout_state)}>
                        {entry.checkout_state}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.provider ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onView?.(entry)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
