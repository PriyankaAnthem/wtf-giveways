'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { EmailPreview } from './EmailPreview'
import type { TemplateDTO, DiscountCodeOptionDTO } from '@/lib/admin/marketing/hub-queries'
import {
  TEMPLATE_LIMITS,
  findUnknownPlaceholdersForForm,
} from '@/lib/admin/marketing/hub-validation'

interface TemplatesResponse {
  ok: true
  templates: TemplateDTO[]
  discountCodes: DiscountCodeOptionDTO[]
}

const NONE = '__none__'

const ERROR_COPY: Record<string, string> = {
  template_key_taken: 'That template key is already in use.',
  discount_code_not_found: 'The selected discount code no longer exists.',
  discount_code_inactive: 'That discount code is inactive and cannot be assigned.',
  unknown_placeholder: 'The content uses a placeholder that is not on the allowed list.',
  invalid_subject: 'Subject is required (max 300 characters, no angle brackets).',
  invalid_heading: 'Heading is required (max 300 characters, no angle brackets).',
  invalid_body_text: 'Body is required (max 5000 characters, no angle brackets).',
  invalid_cta_label: 'Call-to-action label is required (max 100 characters).',
  invalid_template_key: 'Key must be lowercase letters, numbers and underscores.',
  invalid_name: 'Name is required (max 200 characters).',
}

function friendlyError(code?: string): string {
  if (!code) return 'Could not save the template.'
  return ERROR_COPY[code] ?? 'Could not save the template.'
}

interface DraftState {
  id: string | null
  templateKey: string
  name: string
  subject: string
  previewText: string
  heading: string
  bodyText: string
  ctaLabel: string
  defaultUrl: string
  discountCodeId: string
  isActive: boolean
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  templateKey: '',
  name: '',
  subject: '',
  previewText: '',
  heading: '',
  bodyText: '',
  ctaLabel: '',
  defaultUrl: '',
  discountCodeId: NONE,
  isActive: true,
}

function toDraft(t: TemplateDTO): DraftState {
  return {
    id: t.id,
    templateKey: t.templateKey,
    name: t.name,
    subject: t.subject,
    previewText: t.previewText ?? '',
    heading: t.heading,
    bodyText: t.bodyText,
    ctaLabel: t.ctaLabel,
    defaultUrl: t.defaultUrl ?? '',
    discountCodeId: t.discountCodeId ?? NONE,
    isActive: t.isActive,
  }
}

export function TemplatesPanel() {
  const { data, isLoading, mutate } = useSWR<TemplatesResponse>(
    '/api/admin/marketing/templates',
    jsonFetcher,
  )
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const discountCodes = data?.discountCodes ?? []

  const unknownPlaceholders = useMemo(() => {
    if (!draft) return []
    return findUnknownPlaceholdersForForm({
      subject: draft.subject,
      previewText: draft.previewText,
      heading: draft.heading,
      bodyText: draft.bodyText,
      ctaLabel: draft.ctaLabel,
      defaultUrl: draft.defaultUrl,
    })
  }, [draft])

  function startNew() {
    setError(null)
    setDraft({ ...EMPTY_DRAFT })
  }

  function edit(t: TemplateDTO) {
    setError(null)
    setDraft(toDraft(t))
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    const payload = {
      id: draft.id,
      templateKey: draft.templateKey,
      name: draft.name,
      subject: draft.subject,
      previewText: draft.previewText,
      heading: draft.heading,
      bodyText: draft.bodyText,
      ctaLabel: draft.ctaLabel,
      defaultUrl: draft.defaultUrl,
      discountCodeId: draft.discountCodeId === NONE ? null : draft.discountCodeId,
      isActive: draft.isActive,
    }
    const method = draft.id ? 'PATCH' : 'POST'
    const res = await sendMutation('/api/admin/marketing/templates', method, payload)
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
        <span>Loading templates…</span>
      </div>
    )
  }

  const templates = data?.templates ?? []

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label="Email templates" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Email templates</h2>
            <p className="text-sm text-muted-foreground">
              Content only. Every email is wrapped in the fixed WTF layout with an unsubscribe
              footer.
            </p>
          </div>
          <Button type="button" size="sm" onClick={startNew}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New template
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {templates.length === 0 && (
            <li className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              No templates yet. Create one to assign it to an automation or promotion.
            </li>
          )}
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => edit(t)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.templateKey}</span>
                </span>
                <Badge variant={t.isActive ? 'default' : 'secondary'}>
                  {t.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Template editor" className="flex flex-col gap-4">
        {!draft ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            Select a template to edit, or create a new one.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={draft.name}
                  maxLength={TEMPLATE_LIMITS.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-key">Key</Label>
                <Input
                  id="tpl-key"
                  value={draft.templateKey}
                  disabled={draft.id !== null}
                  placeholder="e.g. abandoned_checkout_v1"
                  onChange={(e) => setDraft({ ...draft, templateKey: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-subject">Subject</Label>
                <Input
                  id="tpl-subject"
                  value={draft.subject}
                  maxLength={TEMPLATE_LIMITS.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-preview">Preview text</Label>
                <Input
                  id="tpl-preview"
                  value={draft.previewText}
                  maxLength={TEMPLATE_LIMITS.previewText}
                  onChange={(e) => setDraft({ ...draft, previewText: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-heading">Heading</Label>
                <Input
                  id="tpl-heading"
                  value={draft.heading}
                  maxLength={TEMPLATE_LIMITS.heading}
                  onChange={(e) => setDraft({ ...draft, heading: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-body">Body</Label>
                <Textarea
                  id="tpl-body"
                  rows={5}
                  value={draft.bodyText}
                  maxLength={TEMPLATE_LIMITS.bodyText}
                  onChange={(e) => setDraft({ ...draft, bodyText: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-cta">Call-to-action label</Label>
                <Input
                  id="tpl-cta"
                  value={draft.ctaLabel}
                  maxLength={TEMPLATE_LIMITS.ctaLabel}
                  onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-url">Default call-to-action URL</Label>
                <Input
                  id="tpl-url"
                  value={draft.defaultUrl}
                  placeholder="https://…"
                  onChange={(e) => setDraft({ ...draft, defaultUrl: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-discount">Discount code (optional)</Label>
                <Select
                  value={draft.discountCodeId}
                  onValueChange={(v) => setDraft({ ...draft, discountCodeId: v })}
                >
                  <SelectTrigger id="tpl-discount">
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
            </div>

            {unknownPlaceholders.length > 0 && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Unknown placeholder(s): {unknownPlaceholders.join(', ')}. Remove them before saving.
              </p>
            )}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Preview</h3>
              <EmailPreview
                subject={draft.subject}
                previewText={draft.previewText || null}
                heading={draft.heading}
                bodyText={draft.bodyText}
                ctaLabel={draft.ctaLabel}
                defaultUrl={draft.defaultUrl || null}
                discountCode={
                  discountCodes.find((d) => d.id === draft.discountCodeId)?.code ?? null
                }
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={save}
                disabled={saving || unknownPlaceholders.length > 0}
              >
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
                {draft.id ? 'Save changes' : 'Create template'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
