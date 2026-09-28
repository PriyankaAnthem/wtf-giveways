'use client'

import { useState } from 'react'
import { Loader2, Power, PowerOff, Radar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { OpsControl, OpsSummaryResponse } from './types'
import { opsErrorCopy } from './types'
import { ConfirmDialog } from './ops-ui'
import { setSending, setDiscovery, setRollout } from './ops-client'

const ROLLOUT_OPTIONS = [0, 1, 5, 10, 25, 50, 100] as const
const ROLLOUT_EXTRA_CONFIRM_ABOVE = 10

type Dialog =
  | { kind: 'enable-sending' }
  | { kind: 'enable-discovery' }
  | { kind: 'rollout'; value: number }
  | null

export function MasterControls({
  control,
  derived,
  queuedRecipientCount,
  onChanged,
}: {
  control: OpsControl
  derived: OpsSummaryResponse['derived']
  queuedRecipientCount: number
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [rolloutChoice, setRolloutChoice] = useState<number>(control.rolloutLimit)

  function fail(error: string) {
    toast({ title: 'Action blocked', description: opsErrorCopy(error), variant: 'destructive' })
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, successMsg: string) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    setDialog(null)
    if (!res.ok) {
      fail(res.error ?? 'save_failed')
      return
    }
    toast({ title: successMsg })
    onChanged()
  }

  // Sending OFF is immediate; ON requires the arming dialog.
  function onSendingClick() {
    if (control.sendingEnabled) {
      void run(() => setSending(false), 'Sending disabled')
    } else {
      setDialog({ kind: 'enable-sending' })
    }
  }

  function onDiscoveryClick() {
    if (control.discoveryEnabled) {
      void run(() => setDiscovery(false), 'Discovery disabled')
    } else {
      setDialog({ kind: 'enable-discovery' })
    }
  }

  function onRolloutApply() {
    if (rolloutChoice === control.rolloutLimit) return
    if (rolloutChoice > control.maximumBatchSize) {
      fail('rollout_exceeds_batch')
      return
    }
    if (rolloutChoice > ROLLOUT_EXTRA_CONFIRM_ABOVE) {
      setDialog({ kind: 'rollout', value: rolloutChoice })
    } else {
      void run(() => setRollout(rolloutChoice), `Rollout limit set to ${rolloutChoice}`)
    }
  }

  const armBlocked = derived.sendingBlocker !== null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Master Controls</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-3">
        {/* Sending */}
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <span className="text-sm font-medium text-foreground">Sending</span>
          <p className="text-xs text-muted-foreground">
            Master switch for marketing email delivery. Turning off is immediate.
          </p>
          <Button
            className="mt-auto"
            variant={control.sendingEnabled ? 'destructive' : 'default'}
            disabled={busy}
            onClick={onSendingClick}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {control.sendingEnabled ? (
              <>
                <PowerOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Disable sending
              </>
            ) : (
              <>
                <Power className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Enable sending
              </>
            )}
          </Button>
          {!control.sendingEnabled && armBlocked && (
            <span className="text-[11px] text-gold">{opsErrorCopy(derived.sendingBlocker!)}</span>
          )}
        </div>

        {/* Discovery */}
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <span className="text-sm font-medium text-foreground">Discovery</span>
          <p className="text-xs text-muted-foreground">
            Detects new opportunities. Separate from delivery — does not authorize sending.
          </p>
          <Button
            className="mt-auto"
            variant={control.discoveryEnabled ? 'outline' : 'default'}
            disabled={busy}
            onClick={onDiscoveryClick}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            <Radar className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {control.discoveryEnabled ? 'Disable discovery' : 'Enable discovery'}
          </Button>
        </div>

        {/* Rollout */}
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <span className="text-sm font-medium text-foreground">Rollout limit</span>
          <p className="text-xs text-muted-foreground">
            Max delivery claims per run. Cannot exceed batch size ({control.maximumBatchSize}).
          </p>
          <div className="mt-auto flex gap-2">
            <Select
              value={String(rolloutChoice)}
              onValueChange={(v) => setRolloutChoice(Number(v))}
              disabled={busy}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLLOUT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)} disabled={n > control.maximumBatchSize}>
                    {n === 0 ? '0 — no claims' : n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={busy || rolloutChoice === control.rolloutLimit}
              onClick={onRolloutApply}
            >
              Apply
            </Button>
          </div>
        </div>
      </CardContent>

      {/* Arming confirmation — enabling sending */}
      <ConfirmDialog
        open={dialog?.kind === 'enable-sending'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Enable marketing sending?"
        confirmLabel="Arm sending"
        destructive
        loading={busy}
        onConfirm={() => run(() => setSending(true), 'Sending enabled')}
        description={
          <>
            <p>You are about to arm live marketing delivery with the current configuration:</p>
            <ul className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-3 text-foreground">
              <li>Queued recipients</li>
              <li className="text-right font-semibold tabular-nums">{queuedRecipientCount}</li>
              <li>Enabled automations</li>
              <li className="text-right font-semibold tabular-nums">
                {derived.enabledAutomationCount}
              </li>
              <li>Enabled definitions</li>
              <li className="text-right font-semibold tabular-nums">
                {derived.enabledDefinitionCount}
              </li>
              <li>Rollout limit</li>
              <li className="text-right font-semibold tabular-nums">{control.rolloutLimit}</li>
            </ul>
            <p className="font-medium text-destructive">
              Once armed, the scheduled cron can send real emails automatically without further
              action. The server re-checks all preconditions before enabling.
            </p>
          </>
        }
      />

      {/* Discovery confirmation */}
      <ConfirmDialog
        open={dialog?.kind === 'enable-discovery'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Enable opportunity discovery?"
        confirmLabel="Enable discovery"
        loading={busy}
        onConfirm={() => run(() => setDiscovery(true), 'Discovery enabled')}
        description={
          <p>
            Discovery can create new marketing opportunities but does not itself authorize email
            delivery. Sending remains governed separately by the master sending switch and rollout
            limit.
          </p>
        }
      />

      {/* Rollout >10 confirmation */}
      <ConfirmDialog
        open={dialog?.kind === 'rollout'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Raise rollout limit to ${dialog?.kind === 'rollout' ? dialog.value : ''}?`}
        confirmLabel="Set rollout limit"
        destructive
        loading={busy}
        onConfirm={() =>
          dialog?.kind === 'rollout' &&
          run(() => setRollout(dialog.value), `Rollout limit set to ${dialog.value}`)
        }
        description={
          <p>
            A higher rollout limit allows more delivery claims per run. If sending is enabled, this
            increases how many real emails can be sent each cycle. Confirm you intend to raise the
            per-run ceiling.
          </p>
        }
      />
    </Card>
  )
}
