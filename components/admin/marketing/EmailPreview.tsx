'use client'

import {
  substitutePlaceholders,
  PLACEHOLDER_PREVIEW_SAMPLE,
  type AllowedPlaceholder,
} from '@/lib/admin/marketing/placeholders'

/**
 * Safe, fixed WTF Giveaways email layout preview.
 *
 * The template owns ONLY structured content slots; this component owns the HTML
 * structure. Placeholder substitution runs WITHOUT HTML-escaping and the result
 * is rendered as React text nodes, so React escapes every value — a template can
 * never inject markup or script into the preview. Unknown placeholders are
 * rejected at save time and left untouched here.
 */

interface EmailPreviewProps {
  subject: string
  previewText: string | null
  heading: string
  bodyText: string
  ctaLabel: string
  defaultUrl: string | null
  /** The selected discount code string, if any (drives {{discount_code}}). */
  discountCode?: string | null
}

export function EmailPreview({
  subject,
  previewText,
  heading,
  bodyText,
  ctaLabel,
  defaultUrl,
  discountCode,
}: EmailPreviewProps) {
  const context: Partial<Record<AllowedPlaceholder, string>> = {
    ...PLACEHOLDER_PREVIEW_SAMPLE,
    discount_code: discountCode || PLACEHOLDER_PREVIEW_SAMPLE.discount_code,
    campaign_url: defaultUrl || PLACEHOLDER_PREVIEW_SAMPLE.campaign_url,
  }

  // escape=false: React renders these as text nodes and escapes them itself.
  const sub = (text: string | null) => substitutePlaceholders(text, context, false)

  const bodyParagraphs = sub(bodyText)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="border-b border-border bg-card px-4 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Subject
        </p>
        <p className="truncate text-sm font-semibold text-foreground">{sub(subject) || '—'}</p>
        {previewText ? (
          <p className="truncate text-xs text-muted-foreground">{sub(previewText)}</p>
        ) : null}
      </div>

      <div className="flex justify-center px-4 py-6">
        <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="bg-primary px-6 py-4 text-center">
            <span className="text-sm font-bold uppercase tracking-widest text-primary-foreground">
              WTF Giveaways
            </span>
          </div>

          <div className="flex flex-col gap-4 px-6 py-6">
            <h3 className="text-xl font-bold leading-tight text-foreground text-balance">
              {sub(heading) || 'Heading'}
            </h3>

            <div className="flex flex-col gap-3">
              {bodyParagraphs.length > 0 ? (
                bodyParagraphs.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground text-pretty">
                    {p}
                  </p>
                ))
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">Body copy…</p>
              )}
            </div>

            {discountCode ? (
              <div className="rounded-md border border-dashed border-border bg-muted px-4 py-3 text-center">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Your code
                </p>
                <p className="font-mono text-base font-bold tracking-widest text-foreground">
                  {discountCode}
                </p>
              </div>
            ) : null}

            <div className="pt-1">
              <span className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
                {sub(ctaLabel) || 'Call to action'}
              </span>
            </div>
          </div>

          <div className="border-t border-border px-6 py-4 text-center">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              You are receiving this because you opted in to WTF Giveaways marketing.
              <br />
              <span className="underline">Unsubscribe</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
