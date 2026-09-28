'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  PromotionDTO,
  CampaignOptionDTO,
  TemplateOptionDTO,
} from '@/lib/admin/marketing/hub-queries'
import { PROMOTION_TYPES, ADMIN_PROMOTION_STATUSES } from '@/lib/admin/marketing/hub-validation'

interface PromotionsResponse {
  ok: true
  promotions: PromotionDTO[]
  campaigns: CampaignOptionDTO[]
  templates: TemplateOptionDTO[]
}

const NONE = '__none__'

const TYPE_LABELS: Record<string, string> = {
  regular_buyer_campaign_alert: 'Regular buyer alert',
  vip_early_access: 'VIP early access',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'secondary',
  scheduled: 'default',
  cancelled: 'outline',
}

const ERROR_COPY: Record<string, string> = {
  template_not_found: 'The selected template no longer exists.',
  schedule_time_required: 'Choose a schedule time before setting the status to scheduled.',
  invalid_campaign_id: 'Choose a competition for this promotion.',
  invalid_rollout_limit: 'Rollout limit must be zero or a positive whole number.',
}

function friendlyError(code?: string): string {
  if (!code) return 'Could not save the promotion.'
  return ERROR_COPY[code] ?? 'Could not save the promotion.'
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  // yyyy-MM-ddThh:mm for datetime-local
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface DraftState {
  id: string | null
  campaignId: string
  promotionType: string
  templateId: string
  status: string
  scheduledAt: string
  rolloutLimit: string
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  campaignId: '',
  promotionType: PROMOTION_TYPES[0],
  templateId: NONE,
  status: 'draft',
  scheduledAt: '',
  rolloutLimit: '0',
}

export function PromotionsPanel() {
  const { data, isLoading, mutate } = useSWR<PromotionsResponse>(
    '/api/admin/marketing/promotions',
    jsonFetcher,
  )
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const campaigns = data?.campaigns ?? []
  const templates = data?.templates ?? []

  function startNew() {
    setError(null)
    setDraft({ ...EMPTY_DRAFT })
  }

  function editExisting(p: PromotionDTO) {
    setError(null)
    setDraft({
      id: p.id,
      campaignId: p.campaignId,
      promotionType: p.promotionType,
      templateId: p.templateId ?? NONE,
      status: ADMIN_PROMOTION_STATUSES.includes(p.status as never) ? p.status : 'draft',
      scheduledAt: toLocalInput(p.scheduledAt),
      rolloutLimit: String(p.rolloutLimit),
    })
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    const scheduledIso = draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null
    const common = {
      templateId: draft.templateId === NONE ? null : draft.templateId,
      status: draft.status,
      scheduledAt: scheduledIso,
      rolloutLimit: Number(draft.rolloutLimit) || 0,
    }
    const res = draft.id
      ? await sendMutation('/api/admin/marketing/promotions', 'PATCH', { id: draft.id, ...common })
      : await sendMutation('/api/admin/marketing/promotions', 'POST', {
          campaignId: draft.campaignId,
          promotionType: draft.promotionType,
          ...common,
        })
    setSaving(false)
    if (!res.ok) {
      setError(friendlyError(res.error))
      return
    }
    setDraft(null)
    void mutate()
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading promotions…</span>
      </div>
    )
  }

  const promotions = data?.promotions ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Campaign promotions</h2>
          <p className="text-sm text-muted-foreground">
            Attach a promotion to a competition. Saving a promotion only stores configuration — no
            email is queued or sent.
          </p>
        </div>
        <Button type="button" size="sm" onClick={startNew}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          New promotion
        </Button>
      </div>

      {draft && (
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="promo-campaign">Competition</Label>
            <Select
              value={draft.campaignId}
              onValueChange={(v) => setDraft({ ...draft, campaignId: v })}
              disabled={draft.id !== null}
            >
              <SelectTrigger id="promo-campaign">
                <SelectValue placeholder="Choose a competition" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title ?? c.slug ?? c.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="promo-type">Promotion type</Label>
            <Select
              value={draft.promotionType}
              onValueChange={(v) => setDraft({ ...draft, promotionType: v })}
              disabled={draft.id !== null}
            >
              <SelectTrigger id="promo-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMOTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="promo-template">Template (optional)</Label>
            <Select
              value={draft.templateId}
              onValueChange={(v) => setDraft({ ...draft, templateId: v })}
            >
              <SelectTrigger id="promo-template">
                <SelectValue placeholder="No template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No template</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="promo-status">Status</Label>
            <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
              <SelectTrigger id="promo-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_PROMOTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="promo-when">Schedule time (optional)</Label>
            <Input
              id="promo-when"
              type="datetime-local"
              value={draft.scheduledAt}
              onChange={(e) => setDraft({ ...draft, scheduledAt: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="promo-rollout">Rollout limit (0 = no cap)</Label>
            <Input
              id="promo-rollout"
              type="number"
              min={0}
              value={draft.rolloutLimit}
              onChange={(e) => setDraft({ ...draft, rolloutLimit: e.target.value })}
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" onClick={save} disabled={saving || (!draft.id && !draft.campaignId)}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              {draft.id ? 'Save changes' : 'Create promotion'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {promotions.length === 0 && (
          <li className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No promotions yet.
          </li>
        )}
        {promotions.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => editExisting(p)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary"
            >
              <span className="flex flex-col">
                <span className="font-medium text-foreground">
                  {p.campaignTitle ?? p.campaignId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {TYPE_LABELS[p.promotionType] ?? p.promotionType}
                  {p.scheduledAt ? ` · ${new Date(p.scheduledAt).toLocaleString()}` : ''}
                </span>
              </span>
              <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>{p.status}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
