"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  BIG_WINS_BUCKET,
  type BigWinDTO,
  type BigWinInput,
  clampPercent,
  validateBigWinInput,
} from "@/lib/big-wins"
import { validateImageFile, IMAGE_ACCEPT_ATTR } from "@/lib/media/image-upload"
import { deleteManagedObjectByUrl } from "@/lib/media/storage-cleanup"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: BigWinDTO | null
  onSaved: (item: BigWinDTO) => void
}

const EMPTY: BigWinInput = {
  winnerName: "",
  prizeText: "",
  competition: "",
  wonOn: "",
  ticketNumber: "",
  imageUrl: "",
  imagePosX: 50,
  imagePosY: 50,
  isActive: true,
}

export function BigWinFormDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<BigWinInput>(EMPTY)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Reset the form whenever the dialog opens for a new target.
  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        winnerName: editing.winnerName,
        prizeText: editing.prizeText,
        competition: editing.competition,
        wonOn: editing.wonOn ?? "",
        ticketNumber: editing.ticketNumber != null ? String(editing.ticketNumber) : "",
        imageUrl: editing.imageUrl,
        imagePosX: editing.imagePosX,
        imagePosY: editing.imagePosY,
        isActive: editing.isActive,
      })
    } else {
      setForm(EMPTY)
    }
    setErrors([])
  }, [open, editing])

  const set = useCallback(<K extends keyof BigWinInput>(key: K, value: BigWinInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleUpload = async (file: File) => {
    const validation = validateImageFile(file)
    if (!validation.ok) {
      toast({ title: validation.error, variant: "destructive" })
      return
    }
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
      const path = `${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(BIG_WINS_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from(BIG_WINS_BUCKET).getPublicUrl(path)
      set("imageUrl", data.publicUrl)
      // Reset framing to centre for a freshly uploaded photo.
      set("imagePosX", 50)
      set("imagePosY", 50)
    } catch (err) {
      console.error("[v0] big-win upload error:", err)
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    const validation = validateBigWinInput(form as unknown as Record<string, unknown>)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }
    setErrors([])
    setSaving(true)
    try {
      const isEdit = Boolean(editing)
      const previousImageUrl = editing?.imageUrl ?? null
      const res = await fetch("/api/admin/big-wins", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: editing!.id, ...validation.value } : validation.value),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed")
      const saved = json.item as BigWinDTO
      // Read-your-writes orphan cleanup: the new photo URL is now persisted, so
      // the superseded object can be safely removed. Big Wins render live from
      // the `big_wins` table on the dynamic /winners page (no snapshot
      // propagation), so no cached page still references the old object. This
      // is best-effort and only ever touches our own `big-wins` bucket.
      if (previousImageUrl && previousImageUrl !== saved.imageUrl) {
        await deleteManagedObjectByUrl(createClient(), previousImageUrl, {
          allowedBuckets: [BIG_WINS_BUCKET],
        })
      }
      toast({ title: isEdit ? "Big Win updated" : "Big Win added" })
      onSaved(saved)
    } catch (err) {
      console.error("[v0] big-win save error:", err)
      toast({ title: "Could not save", description: "Please try again.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Big Win" : "Add Big Win"}</DialogTitle>
          <DialogDescription>
            Curated hero winners shown in the Big Wins carousel at the top of the Winners page.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          {/* Fields */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bw-prize">Prize *</Label>
              <Input
                id="bw-prize"
                value={form.prizeText}
                onChange={(e) => set("prizeText", e.target.value)}
                placeholder="e.g. £30,000 Cash or a Range Rover"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bw-name">Winner name *</Label>
              <Input
                id="bw-name"
                value={form.winnerName}
                onChange={(e) => set("winnerName", e.target.value)}
                placeholder="e.g. Sarah T."
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bw-comp">Competition *</Label>
              <Input
                id="bw-comp"
                value={form.competition}
                onChange={(e) => set("competition", e.target.value)}
                placeholder="e.g. December Mega Draw"
                maxLength={120}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bw-date">Won on</Label>
                <Input
                  id="bw-date"
                  type="date"
                  value={form.wonOn ?? ""}
                  onChange={(e) => set("wonOn", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bw-ticket">Ticket number</Label>
                <Input
                  id="bw-ticket"
                  value={form.ticketNumber ?? ""}
                  onChange={(e) => set("ticketNumber", e.target.value)}
                  placeholder="e.g. 4821"
                  maxLength={40}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Switch
                id="bw-active"
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v)}
              />
              <Label htmlFor="bw-active" className="cursor-pointer">
                Show on Winners page
              </Label>
            </div>
          </div>

          {/* Image + framing */}
          <div className="space-y-3">
            <Label>Winner photo *</Label>
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[16rem] overflow-hidden rounded-lg border bg-muted">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.imageUrl || "/placeholder.svg"}
                  alt="Winner preview"
                  className="h-full w-full object-cover"
                  style={{ objectPosition: `${form.imagePosX}% ${form.imagePosY}%` }}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  Portrait preview (3:4)
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleUpload(file)
                e.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 size-4" />
              )}
              {form.imageUrl ? "Replace photo" : "Upload photo"}
            </Button>

            {form.imageUrl && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Reposition</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Horizontal</Label>
                  <Slider
                    value={[form.imagePosX]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => set("imagePosX", clampPercent(v[0]))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Vertical</Label>
                  <Slider
                    value={[form.imagePosY]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => set("imagePosY", clampPercent(v[0]))}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || uploading}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {editing ? "Save changes" : "Add Big Win"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
