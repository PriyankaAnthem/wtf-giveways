"use client"

import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { RotateCcw, Loader2 } from "lucide-react"
import { formatDate } from "./format"

const ERROR_MESSAGES: Record<string, string> = {
  invalid_reason: "A revocation reason is required.",
  invalid_request: "The request was invalid. Please try again.",
  invalid_identifier: "Invalid restriction reference.",
  restriction_not_found: "That restriction could not be found.",
  restriction_mismatch: "That restriction does not belong to this customer.",
  not_admin_originated:
    "This exclusion was not created by an administrator and cannot be removed here.",
  already_revoked: "This restriction has already been removed.",
  forbidden: "You are not allowed to perform this action.",
  unauthorized: "Your session has expired. Please sign in again.",
  revoke_failed: "Could not remove this restriction. Please try again.",
}

/**
 * Super-Admin-only confirmation dialog for removing an ADMIN-originated
 * self-exclusion. It requires an explicit revocation reason and calls the
 * protected revoke API (which passes the acting admin's genuine UUID as
 * p_revoked_by server-side — never from the browser).
 */
export function RevokeRestrictionDialog({
  userId,
  restrictionId,
  customerName,
  appliedAt,
  originalReason,
  onRevoked,
}: {
  userId: string
  restrictionId: string
  customerName: string
  appliedAt: string | null
  originalReason: string | null
  onRevoked: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const reasonInvalid = reason.trim().length === 0

  function resetAll() {
    setReason("")
    setFormError(null)
    submittingRef.current = false
    setSubmitting(false)
  }

  function handleOpenChange(next: boolean) {
    if (submittingRef.current) return
    setOpen(next)
    if (!next) resetAll()
  }

  async function handleConfirm() {
    if (submittingRef.current) return
    if (reasonInvalid) {
      setFormError(ERROR_MESSAGES.invalid_reason)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setFormError(null)

    try {
      const res = await fetch(
        `/api/admin/customers/${userId}/restrictions/${restrictionId}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      )
      const json = await res.json()

      if (!res.ok || !json.ok) {
        setFormError(ERROR_MESSAGES[json.error] ?? ERROR_MESSAGES.revoke_failed)
        submittingRef.current = false
        setSubmitting(false)
        return
      }

      toast({
        title: "Admin restriction removed",
        description: `${customerName} can make purchases again.`,
      })

      onRevoked()
      submittingRef.current = false
      setSubmitting(false)
      setOpen(false)
      resetAll()
    } catch {
      setFormError("Network error. Please try again.")
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Remove admin restriction
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove admin restriction?</DialogTitle>
          <DialogDescription>
            Removing this restriction will allow this customer to purchase again immediately.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Customer</dt>
            <dd className="text-right font-medium">{customerName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Applied</dt>
            <dd className="text-right font-medium">{formatDate(appliedAt)}</dd>
          </div>
          {originalReason && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Original reason</dt>
              <dd className="whitespace-pre-wrap break-words">{originalReason}</dd>
            </div>
          )}
        </dl>

        <div className="space-y-1.5 py-1">
          <Label htmlFor="revoke-reason">Revocation reason (required)</Label>
          <Textarea
            id="revoke-reason"
            placeholder="Why is this restriction being removed?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            autoFocus
          />
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={submitting || reasonInvalid}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove restriction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
