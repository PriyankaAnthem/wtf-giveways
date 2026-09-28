'use client'

import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import type { OpsDefinition } from './types'
import { opsErrorCopy } from './types'
import { StateChip, ConfirmDialog } from './ops-ui'
import { setDefinitionEnabled } from './ops-client'

export function DefinitionsPanel({
  definitions,
  onChanged,
}: {
  definitions: OpsDefinition[]
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [confirmFor, setConfirmFor] = useState<OpsDefinition | null>(null)

  const enabledCount = definitions.filter((d) => d.enabled).length

  async function apply(d: OpsDefinition, enabled: boolean) {
    setPendingKey(d.opportunityKey)
    const res = await setDefinitionEnabled(d.opportunityKey, enabled)
    setPendingKey(null)
    setConfirmFor(null)
    if (!res.ok) {
      toast({
        title: 'Could not update definition',
        description: opsErrorCopy(res.error),
        variant: 'destructive',
      })
      return
    }
    toast({ title: enabled ? 'Definition enabled' : 'Definition disabled', description: d.displayName })
    onChanged()
  }

  function onToggle(d: OpsDefinition) {
    if (d.enabled) void apply(d, false)
    else setConfirmFor(d)
  }

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">Opportunity Definitions</CardTitle>
            <span className="text-xs text-muted-foreground">
              {enabledCount} of {definitions.length} enabled · discovery detection only
            </span>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              {open ? 'Hide' : 'Show'}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead className="text-center">State</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Expiry</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((d) => {
                  const busy = pendingKey === d.opportunityKey
                  return (
                    <TableRow key={d.opportunityKey}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{d.displayName}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {d.opportunityKey}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.family}</TableCell>
                      <TableCell className="text-center">
                        <StateChip tone={d.enabled ? 'live' : 'safe'}>
                          {d.enabled ? 'On' : 'Off'}
                        </StateChip>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.priority}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.score}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.expiryHours}h</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={d.enabled ? 'outline' : 'default'}
                          disabled={busy}
                          onClick={() => onToggle(d)}
                        >
                          {busy && (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                          )}
                          {d.enabled ? 'Disable' : 'Enable'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      <ConfirmDialog
        open={confirmFor !== null}
        onOpenChange={(o) => !o && setConfirmFor(null)}
        title={`Enable "${confirmFor?.displayName ?? ''}"?`}
        confirmLabel="Enable definition"
        loading={pendingKey !== null}
        description={
          <>
            <p>
              Enabling this definition allows discovery to detect this opportunity type and create
              new opportunities for it.
            </p>
            <p className="font-medium text-foreground">
              It does NOT itself authorize any email delivery — global sending and rollout remain
              authoritative.
            </p>
          </>
        }
        onConfirm={() => confirmFor && apply(confirmFor, true)}
      />
    </Card>
  )
}
