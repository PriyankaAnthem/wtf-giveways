'use client'

import { ShieldCheck, ShieldAlert, Radar, AlertTriangle } from 'lucide-react'
import type { OpsControl, OpsSummaryResponse } from './types'
import { opsErrorCopy } from './types'

function StatBox({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function MasterStatusCard({
  control,
  derived,
}: {
  control: OpsControl
  derived: OpsSummaryResponse['derived']
}) {
  const live = control.sendingEnabled
  const discovering = control.discoveryEnabled

  return (
    <section
      className={`rounded-xl border p-5 ${
        live ? 'border-destructive/50 bg-destructive/5' : 'border-trust/40 bg-trust/5'
      }`}
      aria-label="Marketing delivery status"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {live ? (
              <ShieldAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-7 w-7 text-trust" aria-hidden="true" />
            )}
            <div className="flex flex-col">
              <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Marketing Delivery Status
              </h2>
              <p
                className={`text-2xl font-bold tracking-tight ${
                  live ? 'text-destructive' : 'text-trust'
                }`}
              >
                {live ? 'LIVE — SENDING ENABLED' : 'SAFE — SENDING OFF'}
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
              discovering
                ? 'border-gold/50 bg-gold-soft text-gold'
                : 'border-border bg-muted/50 text-muted-foreground'
            }`}
          >
            <Radar className="h-4 w-4" aria-hidden="true" />
            Discovery {discovering ? 'On' : 'Off'}
          </div>
        </div>

        {live && derived.sendingBlocker && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{opsErrorCopy(derived.sendingBlocker)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatBox label="Rollout limit" value={control.rolloutLimit} hint="claims per run" />
          <StatBox label="Max batch size" value={control.maximumBatchSize} />
          <StatBox label="Daily / contact" value={control.maximumDailyPerContact} />
          <StatBox label="Weekly / contact" value={control.maximumWeeklyPerContact} />
          <StatBox label="Enabled automations" value={derived.enabledAutomationCount} />
          <StatBox label="Enabled definitions" value={derived.enabledDefinitionCount} />
        </div>
      </div>
    </section>
  )
}
