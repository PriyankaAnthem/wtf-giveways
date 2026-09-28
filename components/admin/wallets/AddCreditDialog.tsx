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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Plus, Loader2 } from "lucide-react"

export type CreditSuccess = {
  transactionId: string
  creditedPence: number
  balancePence: number
  reservedPence: number
  availablePence: number
  alreadyCredited: boolean
}

// Client-side GBP shape check (server is authoritative). Mirrors the API regex.
const GBP_RE = /^\d{1,7}(\.\d{1,2})?$/

const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: "Enter a valid amount greater than £0 (up to two decimal places).",
  amount_too_large: "That amount exceeds the maximum allowed per credit (£10,000).",
  invalid_reason: "Reason must be between 3 and 500 characters.",
  invalid_reference: "Internal reference must be 200 characters or fewer.",
  customer_not_found: "That customer could not be found.",
  forbidden: "You are not allowed to perform this action.",
  request_conflict: "This adjustment conflicts with a previous request. Start a new adjustment.",
  invalid_identifier: "Invalid customer reference.",
  invalid_request: "The request was invalid. Please try again.",
  credit_failed: "Could not add credit. Please try again.",
}

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`
}

export function AddCreditDialog({
  userId,
  customerName,
  customerEmail,
  onCredited,
}: {
  userId: string
  customerName: string
  customerEmail: string
  onCredited: (result: CreditSuccess) => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<1 | 2>(1)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [reference, setReference] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Idempotency request id: generated once when a confirmation attempt begins,
  // reused across ambiguous-failure retries, regenerated only for a new attempt.
  const requestIdRef = useRef<string | null>(null)
  // Synchronous latch to prevent duplicate submissions from rapid clicks.
  const submittingRef = useRef(false)

  function resetAll() {
    setStage(1)
    setAmount("")
    setReason("")
    setReference("")
    setFormError(null)
    requestIdRef.current = null
    submittingRef.current = false
    setSubmitting(false)
  }

  function handleOpenChange(next: boolean) {
    if (submittingRef.current) return // never close mid-submit
    setOpen(next)
    if (!next) resetAll()
  }

  function goToConfirm() {
    setFormError(null)
    const trimmedAmount = amount.trim()
    if (!GBP_RE.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
      setFormError(ERROR_MESSAGES.invalid_amount)
      return
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setFormError(ERROR_MESSAGES.invalid_reason)
      return
    }
    if (reference.trim().length > 200) {
      setFormError(ERROR_MESSAGES.invalid_reference)
      return
    }
    // A fresh confirmation attempt gets a new idempotency id.
    requestIdRef.current = crypto.randomUUID()
    setStage(2)
  }

  function goBackToEdit() {
    // The admin is deliberately starting a new attempt: drop the request id so
    // the next confirmation generates a fresh one.
    requestIdRef.current = null
    setFormError(null)
    setStage(1)
  }

  async function handleConfirm() {
    // Synchronous latch BEFORE any await to defeat duplicate clicks.
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setFormError(null)

    const requestId = requestIdRef.current
    if (!requestId) {
      submittingRef.current = false
      setSubmitting(false)
      setFormError(ERROR_MESSAGES.credit_failed)
      return
    }

    try {
      const res = await fetch(`/api/admin/wallets/${userId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountGbp: amount.trim(),
          reason: reason.trim(),
          internalReference: reference.trim() || undefined,
          requestId,
        }),
      })
      const json = await res.json()

      if (!res.ok || !json.ok) {
        // Known validation/permission errors: allow the admin to correct input.
        // The same requestId is retained so a genuine retry stays idempotent.
        setFormError(ERROR_MESSAGES[json.error] ?? ERROR_MESSAGES.credit_failed)
        submittingRef.current = false
        setSubmitting(false)
        return
      }

      const result: CreditSuccess = {
        transactionId: json.transactionId,
        creditedPence: json.creditedPence,
        balancePence: json.balancePence,
        reservedPence: json.reservedPence,
        availablePence: json.availablePence,
        alreadyCredited: json.alreadyCredited,
      }

      onCredited(result)
      toast({
        title: `${formatPence(result.creditedPence)} WTF Credit added successfully`,
        description: result.alreadyCredited
          ? "This matched an earlier identical request, so no duplicate credit was applied."
          : `New balance: ${formatPence(result.balancePence)}`,
      })

      // Confirmed success -> fully reset (next adjustment gets a new request id).
      submittingRef.current = false
      setSubmitting(false)
      setOpen(false)
      resetAll()
    } catch {
      // Ambiguous network failure: keep the SAME requestId so a retry is
      // protected by the database idempotency check.
      setFormError("Network error. You can safely retry — duplicate credit is prevented.")
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add WTF Credit
        </Button>
      </DialogTrigger>
      <DialogContent>
        {stage === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Add WTF Credit</DialogTitle>
              <DialogDescription>
                Manually credit {customerName}&apos;s wallet. You will confirm the details on the next step.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="credit-amount">Amount (£)</Label>
                <Input
                  id="credit-amount"
                  inputMode="decimal"
                  placeholder="e.g. 20 or 20.50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="credit-reason">Reason (required)</Label>
                <Textarea
                  id="credit-reason"
                  placeholder="Why is this credit being added?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="credit-reference">Internal reference (optional)</Label>
                <Input
                  id="credit-reference"
                  placeholder="e.g. ticket #1234"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={200}
                  autoComplete="off"
                />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={goToConfirm}>Review</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm WTF Credit</DialogTitle>
              <DialogDescription>Review the details before adding credit.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
                <dl className="space-y-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Customer</dt>
                    <dd className="text-right font-medium">{customerName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="text-right">{customerEmail}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="text-right text-lg font-semibold">£{amount.trim()}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd className="max-w-[60%] text-right">{reason.trim()}</dd>
                  </div>
                  {reference.trim() && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Reference</dt>
                      <dd className="max-w-[60%] text-right">{reference.trim()}</dd>
                    </div>
                  )}
                </dl>
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={goBackToEdit} disabled={submitting}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add WTF Credit
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
