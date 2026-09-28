import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { InstantWinAttemptLog } from "@/lib/types/instantWins"

interface InstantWinAuditLogTableProps {
  logs: InstantWinAttemptLog[]
}

export default function InstantWinAuditLogTable({ logs }: InstantWinAuditLogTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Outcome:</label>
            <Select defaultValue="all">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Tier:</label>
            <Select defaultValue="all">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="big">Big</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Attempt</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Eligible set</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Prize</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell className="font-mono text-xs">{log.id}</TableCell>
                <TableCell>{log.userLabel}</TableCell>
                <TableCell className="font-mono text-xs">
                  {log.eligibleSetHashShort}
                </TableCell>
                <TableCell>
                  <Badge variant={log.outcome === 'won' ? 'default' : 'outline'}>
                    {log.outcome}
                  </Badge>
                </TableCell>
                <TableCell>
                  {log.prizeName ? (
                    <div className="flex items-center gap-2">
                      <span>{log.prizeName}</span>
                      {log.tier && (
                        <Badge variant="secondary" className="text-xs">
                          {log.tier}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
