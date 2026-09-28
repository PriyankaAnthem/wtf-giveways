"use client"

import { useState } from "react"
import { Monitor, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MarketingPreviewMeta } from "@/lib/marketing/preview-samples"

export interface EmailPreviewItem {
  /** Fully-rendered, production email HTML (already escaped/safe by the renderer). */
  html: string
  meta: MarketingPreviewMeta
}

interface EmailPreviewClientProps {
  items: EmailPreviewItem[]
}

type Viewport = "desktop" | "mobile"

const VIEWPORT_WIDTH: Record<Viewport, number> = {
  desktop: 640,
  mobile: 390,
}

/**
 * Admin-only responsive preview of EVERY marketing automation email. It renders
 * the EXACT production HTML produced by `renderMarketingEmail` inside a fully
 * sandboxed iframe (no scripts, no same-origin, no forms), so what an operator
 * sees is byte-for-byte what the delivery pipeline would send. An automation
 * selector switches between the six emails and a viewport toggle checks the
 * responsive layout. Nothing here can send an email — it only displays
 * representative, non-personal HTML.
 */
export function EmailPreviewClient({ items }: EmailPreviewClientProps) {
  const [activeKey, setActiveKey] = useState<string>(items[0]?.meta.key ?? "")
  const [viewport, setViewport] = useState<Viewport>("desktop")
  const width = VIEWPORT_WIDTH[viewport]

  const active = items.find((item) => item.meta.key === activeKey) ?? items[0]
  if (!active) {
    return <p className="text-sm text-muted-foreground">No email templates to preview.</p>
  }
  const { meta, html } = active

  return (
    <div className="flex flex-col gap-6">
      {/* Automation selector */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Marketing automation">
        {items.map((item) => {
          const selected = item.meta.key === active.meta.key
          return (
            <button
              key={item.meta.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveKey(item.meta.key)}
              className={
                selected
                  ? "rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  : "rounded-lg border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              }
            >
              {item.meta.label}
              <span
                className={
                  selected
                    ? "ml-2 text-xs text-primary-foreground/70"
                    : "ml-2 text-xs text-muted-foreground"
                }
              >
                {item.meta.campaignSpecific ? "Campaign" : "Lifecycle"}
              </span>
            </button>
          )
        })}
      </div>

      {/* Metadata: what will land in the inbox */}
      <dl className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</dt>
          <dd className="mt-0.5 font-medium text-foreground">{meta.subject}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview text</dt>
          <dd className="mt-0.5 text-foreground">{meta.previewText ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Heading</dt>
          <dd className="mt-0.5 text-foreground">{meta.heading}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign card</dt>
          <dd className="mt-0.5 text-foreground">{meta.campaignTitle ?? "None (lifecycle email)"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Call to action</dt>
          <dd className="mt-0.5 text-foreground">
            {meta.ctaLabel} <span className="text-muted-foreground">&rarr;</span>{" "}
            <span className="break-all text-xs text-muted-foreground">{meta.ctaUrl}</span>
          </dd>
        </div>
      </dl>

      {/* Viewport toggle */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Rendered by the live delivery renderer using representative data. No email is sent.
        </p>
        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Preview viewport">
          <Button
            type="button"
            size="sm"
            variant={viewport === "desktop" ? "default" : "ghost"}
            onClick={() => setViewport("desktop")}
            aria-pressed={viewport === "desktop"}
            className="gap-1.5"
          >
            <Monitor className="h-4 w-4" aria-hidden="true" />
            Desktop
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewport === "mobile" ? "default" : "ghost"}
            onClick={() => setViewport("mobile")}
            aria-pressed={viewport === "mobile"}
            className="gap-1.5"
          >
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            Mobile
          </Button>
        </div>
      </div>

      {/* Sandboxed device frame */}
      <div className="flex justify-center rounded-xl border bg-muted/40 p-4 sm:p-6">
        <div
          className="overflow-hidden rounded-xl border bg-white shadow-lg transition-[width] duration-300 ease-out"
          style={{ width, maxWidth: "100%" }}
        >
          <iframe
            key={`${active.meta.key}-${viewport}`}
            title={`${meta.label} email preview (${viewport})`}
            srcDoc={html}
            sandbox=""
            className="block h-[820px] w-full border-0"
          />
        </div>
      </div>
    </div>
  )
}
