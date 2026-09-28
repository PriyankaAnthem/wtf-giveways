"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { commissionBpsToPercent } from "@/lib/marketing/attribution"
import { friendlyAffiliateError, type Affiliate } from "@/lib/marketing/affiliateDisplay"

/** The payload POST/PUT expect. `commission` is a PERCENT string (staff type 10). */
export interface AffiliatePayload {
  id?: string
  name: string
  commission: string
  notes: string | null
}

export type SubmitResult = { ok: true; item: Affiliate } | { ok: false; error: string }

interface FormState {
  name: string
  /** Percentage as typed, e.g. "10" or "12.5". Empty = no rate configured. */
  commission: string
  notes: string
}

function emptyState(): FormState {
  return { name: "", commission: "", notes: "" }
}

function stateFromAffiliate(a: Affiliate): FormState {
  const pct = commissionBpsToPercent(a.commissionBps)
  return {
    name: a.name,
    commission: pct == null ? "" : String(pct),
    notes: a.notes ?? "",
  }
}

interface AffiliateFormDialogProps {
  open: boolean
  editing: Affiliate | null
  onClose: () => void
  onSubmit: (payload: AffiliatePayload) => Promise<SubmitResult>
}

/**
 * Create / edit dialog for an affiliate.
 *
 * Commission is entered as a friendly percentage (staff type "10" for 10%); the
 * server converts it to basis points. Leaving it blank means "no rate
 * configured" (distinct from an explicit 0%). The slug is auto-generated from
 * the name server-side, so staff never type it.
 */
export function AffiliateFormDialog({ open, editing, onClose, onSubmit }: AffiliateFormDialogProps) {
  const [state, setState] = useState<FormState>(emptyState)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const isEditing = editing !== null

  useEffect(() => {
    if (open) {
      setState(editing ? stateFromAffiliate(editing) : emptyState())
      setError(null)
    }
  }, [open, editing])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  // Client-side guard mirrors the server validators for instant feedback.
  function clientError(): string | null {
    const name = state.name.trim()
    if (name.length < 1 || name.length > 120) return friendlyAffiliateError("invalid_name")
    const c = state.commission.trim()
    if (c !== "") {
      const n = Number(c)
      if (!Number.isFinite(n) || n < 0 || n > 100) return friendlyAffiliateError("invalid_commission")
    }
    if (state.notes.length > 2000) return friendlyAffiliateError("invalid_notes")
    return null
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return
    if (!next) {
      setError(null)
      onClose()
    }
  }

  async function handleSubmit() {
    if (inFlight.current) return
    const ce = clientError()
    if (ce) {
      setError(ce)
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setError(null)

    const payload: AffiliatePayload = {
      ...(editing ? { id: editing.id } : {}),
      name: state.name.trim(),
      commission: state.commission.trim(),
      notes: state.notes.trim() ? state.notes.trim() : null,
    }

    const result = await onSubmit(payload)
    inFlight.current = false
    setSubmitting(false)
    if (!result.ok) {
      setError(friendlyAffiliateError(result.error))
      return
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit affiliate" : "Add affiliate"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this affiliate's name, commission rate and notes."
              : "Create an affiliate you can attach to tracking links. A short code is generated automatically from the name."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="aff-name">Name</Label>
            <Input
              id="aff-name"
              value={state.name}
              maxLength={120}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Dan"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="aff-commission">Commission rate</Label>
            <div className="relative">
              <Input
                id="aff-commission"
                value={state.commission}
                inputMode="decimal"
                onChange={(e) => set("commission", e.target.value)}
                placeholder="e.g. 10"
                className="pr-8"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Type a percentage, e.g. 10 for 10%. Leave blank if no rate is set yet — that&apos;s
              different from an explicit 0%.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aff-notes">Notes</Label>
            <Textarea
              id="aff-notes"
              value={state.notes}
              maxLength={2000}
              rows={3}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional internal notes"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting} className="bg-transparent">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Add affiliate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
