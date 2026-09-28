'use client'

import { Lock, RefreshCcw, Clock, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { OpsQueue, OpsRecentRecipient, OpsRecentRun, OpsSuppressions } from './types'
import { RECIPIENT_STATUS_ORDER, SUPPRESSION_REASON_ORDER } from './types'
import { StatusBadge, StateChip, fmtTime } from './ops-ui'

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  sent: 'Sent',
  delivered: 'Delivered',
  clicked: 'Clicked',
  skipped: 'Skipped',
  failed: 'Failed',
  bounced: 'Bounced',
  complained: 'Complained',
  cancelled: 'Cancelled',
}

const REASON_LABEL: Record<string, string> = {
  unsubscribe: 'Unsubscribe',
  hard_bounce: 'Hard bounce',
  complaint: 'Complaint',
  manual: 'Manual',
  invalid_address: 'Invalid address',
}

function TimeCell({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>
  return <span className="whitespace-nowrap tabular-nums text-foreground">{fmtTime(iso)}</span>
}

function BoolMark({ on }: { on: boolean }) {
  return on ? (
    <Check className="mx-auto h-4 w-4 text-trust" aria-label="yes" />
  ) : (
    <X className="mx-auto h-4 w-4 text-muted-foreground" aria-label="no" />
  )
}

export function QueuePanel({ queue }: { queue: OpsQueue }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Delivery Queue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {RECIPIENT_STATUS_ORDER.map((status) => (
            <div
              key={status}
              className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3"
            >
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {STATUS_LABEL[status]}
              </span>
              <span className="text-xl font-semibold tabular-nums text-foreground">
                {queue.countsByStatus[status] ?? 0}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <Lock className="h-4 w-4 text-gold" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Locked</span>
            <span className="ml-auto text-lg font-semibold tabular-nums text-foreground">
              {queue.locked}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <RefreshCcw className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Retryable</span>
            <span className="ml-auto text-lg font-semibold tabular-nums text-foreground">
              {queue.retryableQueued}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Scheduled</span>
            <span className="ml-auto text-lg font-semibold tabular-nums text-foreground">
              {queue.scheduledFuture}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SuppressionsCard({ suppressions }: { suppressions: OpsSuppressions }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Active Suppressions</CardTitle>
        <StateChip tone={suppressions.total > 0 ? 'warn' : 'safe'}>
          {suppressions.total} active
        </StateChip>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {SUPPRESSION_REASON_ORDER.map((reason) => (
          <div key={reason} className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {REASON_LABEL[reason]}
            </span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {suppressions.byReason[reason] ?? 0}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function RecentRecipientsPanel({ recipients }: { recipients: OpsRecentRecipient[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Recent Delivery Activity</CardTitle>
        <span className="text-xs text-muted-foreground">Latest {recipients.length}</span>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {recipients.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No recipients yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Opportunity</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="text-center">Provider ID</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Clicked</TableHead>
                <TableHead>Bounced</TableHead>
                <TableHead>Complained</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <TimeCell iso={r.createdAt} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground">{r.maskedEmail}</TableCell>
                  <TableCell className="text-muted-foreground">{r.opportunityType ?? '—'}</TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.attempts}</TableCell>
                  <TableCell className="text-center">
                    <BoolMark on={r.hasProviderId} />
                  </TableCell>
                  <TableCell>
                    <TimeCell iso={r.sentAt} />
                  </TableCell>
                  <TableCell>
                    <TimeCell iso={r.deliveredAt} />
                  </TableCell>
                  <TableCell>
                    <TimeCell iso={r.clickedAt} />
                  </TableCell>
                  <TableCell>
                    <TimeCell iso={r.bouncedAt} />
                  </TableCell>
                  <TableCell>
                    <TimeCell iso={r.complainedAt} />
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

export function RunsPanel({ runs }: { runs: OpsRecentRun[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Recent Runs</CardTitle>
        <span className="text-xs text-muted-foreground">Latest {runs.length}</span>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Automation</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Candidates</TableHead>
                <TableHead className="text-right">Queued</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <TimeCell iso={run.createdAt} />
                  </TableCell>
                  <TableCell className="text-foreground">{run.automationName ?? '—'}</TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{run.candidateCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.queuedCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.sentCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.skippedCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.failedCount}</TableCell>
                  <TableCell>
                    <TimeCell iso={run.completedAt} />
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
