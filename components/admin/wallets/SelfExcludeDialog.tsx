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
import { Ban, Loader2 } from "lucide-react"

const ERROR_MESSAGES: Record<string, string> = {
  invalid_reason: "A reason is required.",
  customer_not_found: "That customer could not be found.",
  forbidden: "You are not allowed to perform this action.",
  unauthorized: "Your session has expired. Please sign in again.",
  invalid_identifier: "Invalid customer reference.",
  invalid_request: "The request was invalid. Please try again.",
  self_exclude_failed: "Could not self-exclude this customer. Please try again.",
}

export function SelfExcludeDialog({
  userId,
  customerName,
  onExcluded,
}: {
  userId: string
  customerName: string
  onExcluded: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Synchronous latch to defeat duplicate submissions from rapid clicks.
  const submittingRef = useRef(false)

  const reasonInvalid = reason.trim().length === 0

  function resetAll() {
    setReason("")
    setFormError(null)
    submittingRef.current = false
    setSubmitting(false)
  }

  function handleOpenChange(next: boolean) {
    if (submittingRef.current) return // never close mid-submit
    setOpen(next)
    if (!next) resetAll()
  }

  async function handleConfirm() {
    if (submittingRef.current) return
    // Block submission on a blank / whitespace-only reason.
    if (reasonInvalid) {
      setFormError(ERROR_MESSAGES.invalid_reason)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setFormError(null)

    try {
      const res = await fetch(`/api/admin/wallets/${userId}/self-exclude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const json = await res.json()

      if (!res.ok || !json.ok) {
        setFormError(ERROR_MESSAGES[json.error] ?? ERROR_MESSAGES.self_exclude_failed)
        submittingRef.current = false
        setSubmitting(false)
        return
      }

      toast({
        title: `${customerName} has been self-excluded`,
        description: json.alreadyExcluded
          ? "This customer was already self-excluded, so no duplicate restriction was created."
          : "Purchasing is now disabled for this account. Existing entries, winnings and wallet balance are unaffected.",
      })

      onExcluded()
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
        <Button variant="destructive">
          <Ban className="mr-2 h-4 w-4" />
          Self-exclude customer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Self-exclude customer?</DialogTitle>
          <DialogDescription>
            This will prevent this customer from making any new purchases. Existing competition entries, winnings,
            transaction history and wallet balance will not be removed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="self-exclude-reason">Internal reason (required)</Label>
            <Textarea
              id="self-exclude-reason"
              placeholder="Customer requested account closure / self-exclusion"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
            />
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={submitting || reasonInvalid}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm self-exclusion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
