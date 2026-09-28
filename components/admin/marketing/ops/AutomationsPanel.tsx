'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { OpsAutomation } from './types'
import { opsErrorCopy } from './types'
import { StateChip } from './ops-ui'
import { ConfirmDialog } from './ops-ui'
import { setAutomationEnabled } from './ops-client'

function delay(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 60) return `${mins}m`
  const h = mins / 60
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export function AutomationsPanel({
  automations,
  onChanged,
}: {
  automations: OpsAutomation[]
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [confirmFor, setConfirmFor] = useState<OpsAutomation | null>(null)

  async function apply(a: OpsAutomation, enabled: boolean) {
    setPendingKey(a.automationKey)
    const res = await setAutomationEnabled(a.automationKey, enabled)
    setPendingKey(null)
    setConfirmFor(null)
    if (!res.ok) {
      toast({
        title: 'Could not update automation',
        description: opsErrorCopy(res.error),
        variant: 'destructive',
      })
      return
    }
    toast({ title: enabled ? 'Automation enabled' : 'Automation disabled', description: a.name })
    onChanged()
  }

  function onToggle(a: OpsAutomation) {
    if (a.enabled) {
      // Disabling is immediate.
      void apply(a, false)
    } else {
      // Enabling requires deliberate confirmation.
      setConfirmFor(a)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Automations</CardTitle>
        <span className="text-xs text-muted-foreground">
          {automations.filter((a) => a.enabled).length} of {automations.length} enabled
        </span>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {automations.map((a) => {
          const busy = pendingKey === a.automationKey
          return (
            <div
              key={a.automationKey}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{a.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{a.automationKey}</span>
                </div>
                <StateChip tone={a.enabled ? 'live' : 'safe'}>{a.enabled ? 'On' : 'Off'}</StateChip>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Metric label="Priority" value={a.priority} />
                <Metric label="First delay" value={delay(a.firstDelayMinutes)} />
                <Metric label="Cooldown" value={a.cooldownHours == null ? '—' : `${a.cooldownHours}h`} />
                <Metric label="Max / run" value={a.maximumRecipientsPerRun} />
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={a.enabled ? 'outline' : 'default'}
                  disabled={busy}
                  onClick={() => onToggle(a)}
                >
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {a.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>

      <ConfirmDialog
        open={confirmFor !== null}
        onOpenChange={(o) => !o && setConfirmFor(null)}
        title={`Enable "${confirmFor?.name ?? ''}"?`}
        confirmLabel="Enable automation"
        loading={pendingKey !== null}
        description={
          <>
            <p>
              Enabling this automation lets discovery-selected opportunities of this type be queued
              when a run executes.
            </p>
            <p className="font-medium text-foreground">
              This does NOT enable its opportunity definition, and does NOT itself authorize any
              email delivery — global sending and rollout remain authoritative.
            </p>
          </>
        }
        onConfirm={() => confirmFor && apply(confirmFor, true)}
      />
    </Card>
  )
}
