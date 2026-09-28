"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { Radio } from "lucide-react"

export interface SiteTakeoverValue {
  enabled: boolean
  headline: string | null
  subtext: string | null
  primaryLabel: string | null
  watchUrl: string | null
  updatedAt: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  board_not_found: "Set up the live board before using the site takeover.",
  invalid_takeover: "Add a headline before turning the takeover on.",
  invalid_takeover_url: "Enter a valid http(s) link, or leave the watch URL blank.",
  live_board_action_failed: "Something went wrong. Please try again.",
}

function errorText(code?: string): string {
  if (!code) return "Something went wrong. Please try again."
  return ERROR_MESSAGES[code] ?? code
}

/**
 * "Live site takeover" control. Independent of the balloon board items — saving
 * here only writes the takeover fields, so mark-popped / add-back / undo state
 * is never affected. Enabling one campaign disables any other (enforced
 * server-side).
 */
export function LiveTakeoverControl({
  campaignId,
  initial,
  onSaved,
}: {
  campaignId: string
  initial: SiteTakeoverValue | null | undefined
  onSaved?: () => void
}) {
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [headline, setHeadline] = useState(initial?.headline ?? "")
  const [subtext, setSubtext] = useState(initial?.subtext ?? "")
  const [primaryLabel, setPrimaryLabel] = useState(initial?.primaryLabel ?? "")
  const [watchUrl, setWatchUrl] = useState(initial?.watchUrl ?? "")
  const [busy, setBusy] = useState<null | "save" | "off">(null)

  const patch = async (payload: {
    enabled: boolean
    headline: string
    subtext: string
    primaryLabel: string
    watchUrl: string
  }, key: "save" | "off") => {
    setBusy(key)
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/live-board`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || "live_board_action_failed")
      setEnabled(payload.enabled)
      toast({ title: payload.enabled ? "Site takeover live" : "Site takeover off" })
      onSaved?.()
    } catch (err: any) {
      toast({ variant: "destructive", title: "Takeover not saved", description: errorText(err?.message) })
    } finally {
      setBusy(null)
    }
  }

  const handleSave = () =>
    patch({ enabled, headline, subtext, primaryLabel, watchUrl }, "save")

  const handleTurnOff = () =>
    patch({ enabled: false, headline, subtext, primaryLabel, watchUrl }, "off")

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-pink-500" />
          <h3 className="font-semibold">Live site takeover</h3>
        </div>
        {initial?.enabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/10 px-2.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400">
            <span className="size-2 rounded-full bg-red-600" aria-hidden />
            Currently live
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Off</span>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Shows a &ldquo;Live now&rdquo; banner on the public homepage. Editing the text here does not
        change the balloon board.
      </p>

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="takeover-enabled" className="font-medium">
              Show on the site
            </Label>
            <p className="text-xs text-muted-foreground">Turn the takeover banner on or off.</p>
          </div>
          <Switch id="takeover-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="takeover-headline">Headline</Label>
          <Input
            id="takeover-headline"
            value={headline}
            maxLength={200}
            placeholder="We're live now on TikTok!"
            onChange={(e) => setHeadline(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="takeover-subtext">Subtext</Label>
          <Textarea
            id="takeover-subtext"
            value={subtext}
            maxLength={300}
            rows={2}
            placeholder="Pop balloons and win cash — join the live stream now."
            onChange={(e) => setSubtext(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="takeover-cta">Primary button label</Label>
            <Input
              id="takeover-cta"
              value={primaryLabel}
              maxLength={60}
              placeholder="Enter Now"
              onChange={(e) => setPrimaryLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="takeover-watch">Watch live URL (optional)</Label>
            <Input
              id="takeover-watch"
              type="url"
              inputMode="url"
              value={watchUrl}
              maxLength={500}
              placeholder="https://tiktok.com/@yourhandle/live"
              onChange={(e) => setWatchUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={busy !== null}>
            {busy === "save" ? <Spinner className="mr-2 size-4" /> : null}
            {enabled ? "Save & show" : "Save"}
          </Button>
          {initial?.enabled ? (
            <Button variant="outline" onClick={handleTurnOff} disabled={busy !== null}>
              {busy === "off" ? <Spinner className="mr-2 size-4" /> : null}
              Turn off now
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
