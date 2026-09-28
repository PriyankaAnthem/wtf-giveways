'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { jsonFetcher, sendMutation } from './hub-client'
import type {
  AutomationDTO,
  TemplateOptionDTO,
  DiscountCodeOptionDTO,
} from '@/lib/admin/marketing/hub-queries'

interface AutomationsResponse {
  ok: true
  automations: AutomationDTO[]
  templates: TemplateOptionDTO[]
  discountCodes: DiscountCodeOptionDTO[]
}

const NONE = '__none__'

const AUTOMATION_BLURB: Record<string, string> = {
  vip_early_access: 'VIP buyers get a head start before a competition opens to everyone.',
  abandoned_checkout: 'Nudge customers who started a checkout but did not complete it.',
  wtf_credit_waiting: 'Remind customers they have WTF Credit ready to spend.',
  regular_buyer_campaign_alert: 'Tell frequent buyers when a new competition goes live.',
  new_account_no_purchase: 'Welcome new accounts that have not made their first purchase.',
  lapsed_14_days: 'Win back customers who have not bought in a couple of weeks.',
}

const ERROR_COPY: Record<string, string> = {
  template_required_to_enable: 'Assign a template before enabling this automation.',
  template_not_found: 'The selected template no longer exists.',
  discount_code_not_found: 'The selected discount code no longer exists.',
  discount_code_inactive: 'That discount code is inactive and cannot be assigned.',
  invalid_maximum_recipients: 'Maximum recipients must be between 1 and 100000.',
}

function friendlyError(code?: string): string {
  if (!code) return 'Could not save changes.'
  return ERROR_COPY[code] ?? 'Could not save changes.'
}

function numOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function AutomationCard({
  automation,
  templates,
  discountCodes,
  onSaved,
}: {
  automation: AutomationDTO
  templates: TemplateOptionDTO[]
  discountCodes: DiscountCodeOptionDTO[]
  onSaved: () => void
}) {
  const [enabled, setEnabled] = useState(automation.enabled)
  const [templateId, setTemplateId] = useState(automation.templateId ?? NONE)
  const [discountCodeId, setDiscountCodeId] = useState(automation.discountCodeId ?? NONE)
  const [firstDelay, setFirstDelay] = useState(String(automation.firstDelayMinutes ?? ''))
  const [followUp, setFollowUp] = useState(String(automation.followUpDelayMinutes ?? ''))
  const [cooldown, setCooldown] = useState(String(automation.cooldownHours ?? ''))
  const [minWallet, setMinWallet] = useState(String(automation.minimumWalletPence ?? ''))
  const [maxRecipients, setMaxRecipients] = useState(String(automation.maximumRecipientsPerRun))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasTemplate = templateId !== NONE

  async function save() {
    setSaving(true)
    setError(null)
    const res = await sendMutation('/api/admin/marketing/automations', 'PATCH', {
      automationKey: automation.automationKey,
      enabled: hasTemplate ? enabled : false,
      templateId: templateId === NONE ? null : templateId,
      discountCodeId: discountCodeId === NONE ? null : discountCodeId,
      firstDelayMinutes: numOrNull(firstDelay),
      followUpDelayMinutes: numOrNull(followUp),
      cooldownHours: numOrNull(cooldown),
      minimumWalletPence: numOrNull(minWallet),
      maximumRecipientsPerRun: numOrNull(maxRecipients),
    })
    setSaving(false)
    if (!res.ok) {
      setError(friendlyError(res.error))
      return
    }
    onSaved()
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{automation.name}</h3>
            <Badge variant={automation.enabled ? 'default' : 'secondary'}>
              {automation.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground text-pretty">
            {AUTOMATION_BLURB[automation.automationKey] ?? 'Automation configuration.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Switch checked={enabled && hasTemplate} disabled={!hasTemplate} onCheckedChange={setEnabled} />
          <span className="text-[11px] text-muted-foreground">Enabled</span>
        </div>
      </div>

      {!hasTemplate ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          Assign a template to allow enabling.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} {t.isActive ? '' : '(inactive)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Discount code</Label>
          <Select value={discountCodeId} onValueChange={setDiscountCodeId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="No discount" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No discount</SelectItem>
              {discountCodes.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <NumField label="First delay (minutes)" value={firstDelay} onChange={setFirstDelay} />
        <NumField label="Follow-up delay (minutes)" value={followUp} onChange={setFollowUp} />
        <NumField label="Cooldown (hours)" value={cooldown} onChange={setCooldown} />
        <NumField label="Minimum wallet (pence)" value={minWallet} onChange={setMinWallet} />
        <NumField
          label="Max recipients per run"
          value={maxRecipients}
          onChange={setMaxRecipients}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <span />
        )}
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
    </div>
  )
}

export function AutomationsPanel() {
  const { data, error, isLoading, mutate } = useSWR<AutomationsResponse>(
    '/api/admin/marketing/automations',
    jsonFetcher,
    { revalidateOnFocus: false },
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Automations</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          The six automation definitions. Timing, caps and copy are editable without a deployment.
        </p>
      </div>

      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Discovery and sending are globally paused. Enabling an automation here changes
          configuration only — nothing is discovered, queued or sent.
        </span>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          Could not load automations.
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.automations.map((a) => (
            <AutomationCard
              key={a.automationKey}
              automation={a}
              templates={data.templates}
              discountCodes={data.discountCodes}
              onSaved={() => mutate()}
            />
          ))}
        </div>
      )}
    </div>
  )
}
