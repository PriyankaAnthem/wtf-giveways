"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { Crown, Plus, Trash2, ArrowLeft } from "lucide-react"

type ItemType = "standard" | "vip"

// Matches lib/admin/live-board.ts LiveBoardItem (the persisted shape).
export interface SetupBoardItem {
  id: string
  label: string
  type: ItemType
  amountPence: number
  starting: number
  remaining: number
  featured: boolean
  sort: number
}

// Draft row keeps numeric fields as strings so inputs stay controlled and the
// admin can clear/retype freely. Values are coerced only at save time.
interface DraftRow {
  id: string
  label: string
  type: ItemType
  amountPounds: string
  starting: string
  remaining: string
  featured: boolean
  sort: string
}

const SETUP_ERROR_MESSAGES: Record<string, string> = {
  campaign_not_found: "Campaign not found.",
  not_balloon_pop: "This campaign is not a Balloon Pop campaign.",
  invalid_items:
    "Please check the prize rows. Each row needs a label, a type, and valid amounts (remaining cannot exceed starting), and at least one prize must have a starting count above zero.",
  live_board_action_failed: "Something went wrong saving the board. Please try again.",
}

function setupErrorText(code?: string): string {
  if (!code) return "Something went wrong. Please try again."
  return SETUP_ERROR_MESSAGES[code] ?? code
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `item-${crypto.randomUUID()}`
    }
  } catch {
    /* ignore */
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyRow(sort: number): DraftRow {
  return {
    id: newId(),
    label: "",
    type: "standard",
    amountPounds: "",
    starting: "",
    remaining: "",
    featured: false,
    sort: String(sort),
  }
}

function toDraftRows(items: SetupBoardItem[] | null): DraftRow[] {
  if (!items || items.length === 0) return [emptyRow(0)]
  return items.map((it) => ({
    id: it.id || newId(),
    label: it.label,
    type: it.type === "vip" ? "vip" : "standard",
    amountPounds: it.amountPence ? String(it.amountPence / 100) : "",
    starting: String(it.starting),
    remaining: String(it.remaining),
    featured: it.featured === true,
    sort: String(it.sort),
  }))
}

// Coerce a single draft row into the persisted item shape. Numbers mirror the
// server's flooring/rounding so what the admin sees is what gets validated.
function rowToItem(row: DraftRow): SetupBoardItem {
  const pounds = Number.parseFloat(row.amountPounds)
  const amountPence = Number.isFinite(pounds) ? Math.round(pounds * 100) : NaN
  const starting = Number.parseInt(row.starting, 10)
  const remaining = Number.parseInt(row.remaining, 10)
  const sort = Number.parseInt(row.sort, 10)
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    type: row.type,
    amountPence,
    starting,
    remaining,
    featured: row.featured === true,
    sort: Number.isFinite(sort) ? sort : 0,
  }
}

export function LiveBoardSetup({
  campaignId,
  initialItems,
  initialEnabled,
  boardExists,
  onCancel,
  onSaved,
}: {
  campaignId: string
  initialItems: SetupBoardItem[] | null
  initialEnabled: boolean
  boardExists: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<DraftRow[]>(() => toDraftRows(initialItems))
  const [saving, setSaving] = useState(false)

  const updateRow = (id: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow(prev.length)])
  }

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)))
  }

  // Lightweight client validation for immediate feedback. The server-side
  // validateItemsForSetup() remains the source of truth on save.
  const clientError = useMemo(() => {
    if (rows.length === 0) return "Add at least one prize row."
    let totalStarting = 0
    for (const row of rows) {
      const item = rowToItem(row)
      if (!item.label) return "Every prize needs a label."
      if (!Number.isFinite(item.amountPence) || item.amountPence < 0)
        return `Enter a valid amount for "${item.label || "prize"}".`
      if (!Number.isFinite(item.starting) || item.starting < 0)
        return `Enter a valid starting count for "${item.label || "prize"}".`
      if (!Number.isFinite(item.remaining) || item.remaining < 0)
        return `Enter a valid remaining count for "${item.label || "prize"}".`
      if (item.remaining > item.starting)
        return `Remaining cannot exceed starting for "${item.label || "prize"}".`
      totalStarting += item.starting
    }
    if (totalStarting <= 0) return "At least one prize must have a starting count above zero."
    return null
  }, [rows])

  const handleSave = async () => {
    if (clientError) {
      toast({ variant: "destructive", title: "Check the board", description: clientError })
      return
    }
    setSaving(true)
    try {
      const items = rows.map(rowToItem)
      const res = await fetch(`/api/admin/campaigns/${campaignId}/live-board`, {
        method: boardExists ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        // Preserve the current enabled state; the public on/off toggle stays in
        // the main panel and is not changed by a setup save.
        body: JSON.stringify({ items, enabled: initialEnabled }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || "live_board_action_failed")
      toast({ title: boardExists ? "Board updated" : "Live board created" })
      onSaved()
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: setupErrorText(err?.message),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {boardExists ? "Edit board setup" : "Set up live board"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add each prize the host will pop on the TikTok Live Balloon Pop board. You control
              every value manually — nothing is generated from prize records.
            </p>
          </div>
          <Button variant="ghost" onClick={onCancel} disabled={saving} className="gap-2">
            <ArrowLeft className="size-4" />
            Cancel
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        {rows.map((row, index) => (
          <Card key={row.id} className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Prize {index + 1}</span>
                {row.type === "vip" ? (
                  <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                    <Crown className="mr-1 size-3" />
                    VIP
                  </Badge>
                ) : null}
                {row.featured ? <Badge variant="secondary">Featured</Badge> : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(row.id)}
                disabled={rows.length <= 1 || saving}
                aria-label={`Remove prize ${index + 1}`}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                <Label htmlFor={`label-${row.id}`}>Label</Label>
                <Input
                  id={`label-${row.id}`}
                  value={row.label}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                  placeholder="e.g. £100 Cash"
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`type-${row.id}`}>Type</Label>
                <Select
                  value={row.type}
                  onValueChange={(v) => updateRow(row.id, { type: v as ItemType })}
                  disabled={saving}
                >
                  <SelectTrigger id={`type-${row.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="vip">VIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`amount-${row.id}`}>Amount (£)</Label>
                <Input
                  id={`amount-${row.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={row.amountPounds}
                  onChange={(e) => updateRow(row.id, { amountPounds: e.target.value })}
                  placeholder="0.00"
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`starting-${row.id}`}>Starting</Label>
                <Input
                  id={`starting-${row.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={row.starting}
                  onChange={(e) => updateRow(row.id, { starting: e.target.value })}
                  placeholder="0"
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`remaining-${row.id}`}>Remaining</Label>
                <Input
                  id={`remaining-${row.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={row.remaining}
                  onChange={(e) => updateRow(row.id, { remaining: e.target.value })}
                  placeholder="0"
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`sort-${row.id}`}>Sort</Label>
                <Input
                  id={`sort-${row.id}`}
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={row.sort}
                  onChange={(e) => updateRow(row.id, { sort: e.target.value })}
                  placeholder="0"
                  disabled={saving}
                />
              </div>

              <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                <Checkbox
                  id={`featured-${row.id}`}
                  checked={row.featured}
                  onCheckedChange={(checked) => updateRow(row.id, { featured: checked === true })}
                  disabled={saving}
                />
                <Label htmlFor={`featured-${row.id}`} className="cursor-pointer">
                  Featured
                </Label>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addRow} disabled={saving} className="gap-2">
        <Plus className="size-4" />
        Add prize
      </Button>

      {clientError ? <p className="text-sm text-destructive">{clientError}</p> : null}

      <Separator />

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || !!clientError} className="gap-2">
          {saving ? <Spinner className="size-4" /> : null}
          {boardExists ? "Save changes" : "Create board"}
        </Button>
      </div>
    </div>
  )
}
