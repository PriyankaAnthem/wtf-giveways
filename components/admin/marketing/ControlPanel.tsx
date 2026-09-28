'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Loader2, PauseCircle, PlayCircle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { jsonFetcher, sendMutation } from './hub-client'
import type { ControlDTO } from '@/lib/admin/marketing/hub-queries'

interface ControlResponse {
  ok: true
  control: ControlDTO
  counts: {
    activeRunCount: number
    externalContactCount: number
    externalContactEnabledCount: number
    promotionCountsByStatus: Record<string, number>
    recipientCountsByStatus: Record<string, number>
  }
}

const ERROR_COPY: Record<string, string> = {
  weekly_below_daily: 'The weekly cap cannot be lower than the daily cap.',
  invalid_batch_size: 'Batch size must be between 1 and 100.',
  invalid_rollout_limit: 'Rollout limit must be zero or a positive whole number.',
}

function friendlyError(code?: string): string {
  if (!code) return 'Could not update the controls.'
  return ERROR_COPY[code] ?? 'Could not update the controls.'
}

function numOr(v: string, fallback: number): number {
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : fallback
}

export function ControlPanel() {
  const { data, isLoading, mutate } = useSWR<ControlResponse>(
    '/api/admin/marketing/control',
    jsonFetcher,
  )
  const [form, setForm] = useState<ControlDTO | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (data?.control) setForm(data.control)
  }, [data?.control])

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading controls…</span>
      </div>
    )
  }

  const counts = data?.counts
  const sendingLive = form.sendingEnabled && form.discoveryEnabled

  async function save() {
    if (!form) return
    setSaving(true)
    setError(null)
    const res = await sendMutation('/api/admin/marketing/control', 'PUT', {
      sendingEnabled: form.sendingEnabled,
      discoveryEnabled: form.discoveryEnabled,
      rolloutLimit: form.rolloutLimit,
      maximumBatchSize: form.maximumBatchSize,
      maximumDailyPerContact: form.maximumDailyPerContact,
      maximumWeeklyPerContact: form.maximumWeeklyPerContact,
    })
    setSaving(false)
    if (!res.ok) {
      setError(friendlyError(res.error))
      return
    }
    void mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 ${
          sendingLive
            ? 'border-destructive/40 bg-destructive/10'
            : 'border-border bg-muted/40'
        }`}
      >
        {sendingLive ? (
          <PlayCircle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
        ) : (
          <PauseCircle className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="text-sm">
          <p className="font-medium text-foreground">
            {sendingLive ? 'Sending is LIVE' : 'Sending is paused'}
          </p>
          <p className="text-muted-foreground">
            {sendingLive
              ? 'Discovery and sending are both enabled. A future worker may queue and deliver marketing email.'
              : 'No marketing email can be discovered or sent while either master switch is off. Stage 3B ships with both off.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="pr-4">
            <Label htmlFor="ctl-discovery" className="text-sm font-medium">
              Discovery enabled
            </Label>
            <p className="text-xs text-muted-foreground">
              Allow a future worker to find candidates. No effect on its own.
            </p>
          </div>
          <Switch
            id="ctl-discovery"
            checked={form.discoveryEnabled}
            onCheckedChange={(v) => setForm({ ...form, discoveryEnabled: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="pr-4">
            <Label htmlFor="ctl-sending" className="text-sm font-medium">
              Sending enabled
            </Label>
            <p className="text-xs text-muted-foreground">
              Master send switch. Both this and discovery must be on to ever send.
            </p>
          </div>
          <Switch
            id="ctl-sending"
            checked={form.sendingEnabled}
            onCheckedChange={(v) => setForm({ ...form, sendingEnabled: v })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ctl-rollout">Rollout limit</Label>
          <Input
            id="ctl-rollout"
            type="number"
            min={0}
            value={form.rolloutLimit}
            onChange={(e) => setForm({ ...form, rolloutLimit: numOr(e.target.value, 0) })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ctl-batch">Batch size (1–100)</Label>
          <Input
            id="ctl-batch"
            type="number"
            min={1}
            max={100}
            value={form.maximumBatchSize}
            onChange={(e) => setForm({ ...form, maximumBatchSize: numOr(e.target.value, 1) })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ctl-daily">Max per contact / day</Label>
          <Input
            id="ctl-daily"
            type="number"
            min={0}
            value={form.maximumDailyPerContact}
            onChange={(e) => setForm({ ...form, maximumDailyPerContact: numOr(e.target.value, 0) })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ctl-weekly">Max per contact / week</Label>
          <Input
            id="ctl-weekly"
            type="number"
            min={0}
            value={form.maximumWeeklyPerContact}
            onChange={(e) => setForm({ ...form, maximumWeeklyPerContact: numOr(e.target.value, 0) })}
          />
        </div>
      </div>

      {form.maximumWeeklyPerContact < form.maximumDailyPerContact && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          The weekly cap cannot be lower than the daily cap.
        </p>
      )}
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div>
        <Button
          type="button"
          onClick={save}
          disabled={saving || form.maximumWeeklyPerContact < form.maximumDailyPerContact}
        >
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          Save controls
        </Button>
      </div>

      {counts && (
        <section aria-label="Marketing hub status" className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Active runs" value={counts.activeRunCount} />
          <StatCard label="External contacts" value={counts.externalContactCount} />
          <StatCard label="Opted-in contacts" value={counts.externalContactEnabledCount} />
        </section>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
