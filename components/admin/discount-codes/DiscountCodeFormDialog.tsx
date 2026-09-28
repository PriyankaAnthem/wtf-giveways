"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  type DiscountCode,
  friendlyError,
  isoToLocalInput,
  localInputToIso,
} from "@/lib/discounts/adminDisplay"

export interface CampaignOption {
  id: string
  title: string
  slug: string
}

/** The payload shape POST/PUT expect (camelCase, timestamps as ISO or null). */
export interface DiscountCodePayload {
  id?: string
  code: string
  description: string | null
  discountType: "fixed" | "percentage"
  discountValue: string
  scope: "site_wide" | "campaign"
  campaignId: string | null
  isActive: boolean
  startsAt: string | null
  expiresAt: string | null
}

interface FormState {
  code: string
  description: string
  discountType: "fixed" | "percentage"
  fixedAmount: string
  percentage: string
  scope: "site_wide" | "campaign"
  campaignId: string
  isActive: boolean
  startsAtLocal: string
  expiresAtLocal: string
}

function emptyState(): FormState {
  return {
    code: "",
    description: "",
    discountType: "fixed",
    fixedAmount: "",
    percentage: "",
    scope: "site_wide",
    campaignId: "",
    isActive: true,
    startsAtLocal: "",
    expiresAtLocal: "",
  }
}

function stateFromCode(code: DiscountCode): FormState {
  return {
    code: code.code,
    description: code.description ?? "",
    discountType: code.discountType,
    fixedAmount: code.discountType === "fixed" ? (code.discountValue / 100).toFixed(2) : "",
    percentage: code.discountType === "percentage" ? String(code.discountValue) : "",
    scope: code.scope,
    campaignId: code.campaignId ?? "",
    isActive: code.isActive,
    startsAtLocal: isoToLocalInput(code.startsAt),
    expiresAtLocal: isoToLocalInput(code.expiresAt),
  }
}

interface DiscountCodeFormDialogProps {
  open: boolean
  /** When editing, the existing code; null when creating. */
  editing: DiscountCode | null
  campaigns: CampaignOption[]
  campaignsLoading: boolean
  onClose: () => void
  /**
   * Submit handler. Resolves to a stable error code string on failure (already
   * surfaced to the parent), or null on success. When editing an active code
   * with a material change, the parent may show a confirmation first.
   */
  onSubmit: (payload: DiscountCodePayload) => Promise<string | null>
}

/**
 * Create / edit dialog for a discount code. All validation mirrors the server
 * (which remains authoritative); client checks only give fast feedback.
 */
export function DiscountCodeFormDialog({
  open,
  editing,
  campaigns,
  campaignsLoading,
  onClose,
  onSubmit,
}: DiscountCodeFormDialogProps) {
  const [state, setState] = useState<FormState>(emptyState)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  // Reset the form each time the dialog opens (create vs a specific edit row).
  useEffect(() => {
    if (open) {
      setState(editing ? stateFromCode(editing) : emptyState())
      setError(null)
    }
  }, [open, editing])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  const clientError = useMemo(() => validateClient(state), [state])

  function handleOpenChange(next: boolean) {
    if (submitting) return
    if (!next) {
      setError(null)
      onClose()
    }
  }

  async function handleSubmit() {
    if (inFlight.current) return
    if (clientError) {
      setError(clientError)
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setError(null)

    const payload: DiscountCodePayload = {
      ...(editing ? { id: editing.id } : {}),
      code: state.code.trim().toUpperCase(),
      description: state.description.trim() === "" ? null : state.description.trim(),
      discountType: state.discountType,
      discountValue: state.discountType === "fixed" ? state.fixedAmount.trim() : state.percentage.trim(),
      scope: state.scope,
      campaignId: state.scope === "campaign" ? state.campaignId || null : null,
      isActive: state.isActive,
      startsAt: localInputToIso(state.startsAtLocal),
      expiresAt: localInputToIso(state.expiresAtLocal),
    }

    const errCode = await onSubmit(payload)
    inFlight.current = false
    setSubmitting(false)
    if (errCode) {
      setError(friendlyError(errCode))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit discount code" : "Create discount code"}</DialogTitle>
          <DialogDescription>
            New checkouts use these values immediately after saving. Existing checkout snapshots
            are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="dc-code">Code</Label>
            <Input
              id="dc-code"
              value={state.code}
              maxLength={40}
              autoCapitalize="characters"
              className="uppercase"
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="SAVE10"
            />
            <p className="text-xs text-muted-foreground">
              Letters, numbers, hyphen and underscore only. 3–40 characters.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="dc-description">Description</Label>
            <Textarea
              id="dc-description"
              value={state.description}
              maxLength={500}
              rows={2}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Internal note (optional)"
            />
            <p className="text-xs text-muted-foreground">
              Internal only — not shown to customers.
            </p>
          </div>

          {/* Discount type */}
          <div className="space-y-2">
            <Label htmlFor="dc-type">Discount type</Label>
            <Select
              value={state.discountType}
              onValueChange={(v) => set("discountType", v as FormState["discountType"])}
            >
              <SelectTrigger id="dc-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed amount off</SelectItem>
                <SelectItem value="percentage">Percentage off</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Discount value */}
          {state.discountType === "fixed" ? (
            <div className="space-y-2">
              <Label htmlFor="dc-fixed">Amount off (GBP)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">£</span>
                <Input
                  id="dc-fixed"
                  inputMode="decimal"
                  value={state.fixedAmount}
                  onChange={(e) => set("fixedAmount", e.target.value)}
                  placeholder="5.00"
                />
              </div>
              <p className="text-xs text-muted-foreground">Pounds and pence, e.g. 5.00.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="dc-pct">Percentage off</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="dc-pct"
                  inputMode="numeric"
                  value={state.percentage}
                  onChange={(e) => set("percentage", e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="10"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Whole number from 1 to 99.</p>
            </div>
          )}

          {/* Scope */}
          <div className="space-y-2">
            <Label htmlFor="dc-scope">Scope</Label>
            <Select
              value={state.scope}
              onValueChange={(v) => set("scope", v as FormState["scope"])}
            >
              <SelectTrigger id="dc-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="site_wide">Site-wide</SelectItem>
                <SelectItem value="campaign">One competition</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Campaign selector (campaign scope only) */}
          {state.scope === "campaign" && (
            <div className="space-y-2">
              <Label htmlFor="dc-campaign">Competition</Label>
              <Select
                value={state.campaignId}
                onValueChange={(v) => set("campaignId", v)}
                disabled={campaignsLoading}
              >
                <SelectTrigger id="dc-campaign">
                  <SelectValue placeholder={campaignsLoading ? "Loading…" : "Select a competition"} />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                      {c.slug ? ` (${c.slug})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The code only applies to the selected competition.
              </p>
            </div>
          )}

          {/* Status */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="dc-active">Active</Label>
              <p className="text-xs text-muted-foreground">
                Disabled codes cannot be applied to new checkouts.
              </p>
            </div>
            <Switch
              id="dc-active"
              checked={state.isActive}
              onCheckedChange={(v) => set("isActive", v)}
            />
          </div>

          {/* Schedule */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dc-start">Starts (UK time)</Label>
              <Input
                id="dc-start"
                type="datetime-local"
                value={state.startsAtLocal}
                onChange={(e) => set("startsAtLocal", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dc-expiry">Expires (UK time)</Label>
              <Input
                id="dc-expiry"
                type="datetime-local"
                value={state.expiresAtLocal}
                onChange={(e) => set("expiresAtLocal", e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Times are optional and interpreted in UK local time.
          </p>

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
            {editing ? "Save changes" : "Create code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Fast client-side feedback; the server remains the source of truth. */
function validateClient(state: FormState): string | null {
  const code = state.code.trim().toUpperCase()
  if (code.length < 3 || code.length > 40) return "Code must be 3–40 characters."
  if (!/^[A-Z0-9_-]+$/.test(code)) return "Code may only contain A–Z, 0–9, hyphen and underscore."

  if (state.discountType === "fixed") {
    const s = state.fixedAmount.trim()
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return "Enter a valid amount, e.g. 5.00."
    const pence = Math.round(Number(s) * 100)
    if (!Number.isFinite(pence) || pence <= 0) return "Amount must be greater than £0.00."
  } else {
    const s = state.percentage.trim()
    if (!/^\d{1,3}$/.test(s)) return "Enter a whole percentage."
    const n = Number(s)
    if (n < 1 || n > 99) return "Percentage must be between 1 and 99."
  }

  if (state.scope === "campaign" && !state.campaignId) return "Select a competition."

  if (state.startsAtLocal && state.expiresAtLocal) {
    if (new Date(state.expiresAtLocal).getTime() <= new Date(state.startsAtLocal).getTime()) {
      return "Expiry must be later than the start time."
    }
  }
  return null
}
