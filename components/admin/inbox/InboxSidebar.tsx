"use client"

import Link from "next/link"
import { useState } from "react"
import { ExternalLink, Loader2, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { InboxStatusBadge } from "./InboxStatusBadge"
import { enquiryTypeLabel, isWinnerPayout } from "@/lib/admin/inbox/format"
import { INBOX_STATUSES, type InboxStatus } from "@/lib/admin/inbox/types"

/** A customer resolved from the enquiry email (or null when guest/unmatched). */
export interface ConversationCustomer {
  userId: string
  name: string
  email: string | null
  mobile: string | null
}

/** An allowed Inbox assignee (already resolved to a display name). */
export interface ConversationAssignee {
  userId: string
  name: string
  role: string | null
}

const UNASSIGNED = "__unassigned__"

const STATUS_HINT: Record<InboxStatus, string> = {
  open: "Needs a response.",
  waiting: "Replied — awaiting the customer.",
  resolved: "Closed out. Reopen by setting Open.",
}

type PayoutInfo = {
  method: string | null
  amountClaimedPence: number | null
  verifiedAmountPence: number | null
  accountHolderName: string | null
  sortCodeMasked: string | null
  accountNumberMasked: string | null
  paypalEmail: string | null
  contactDetail: string | null
  adminNotes: string | null
  paidAt: string | null
  processedAt: string | null
  legacyStatus: string | null
}

/**
 * Right-hand context rail for a conversation. Self-contained: it performs its
 * own PATCH calls to `/api/admin/inbox/[id]` for status + assignment, then calls
 * `onChanged()` so the server component re-renders with fresh data.
 *
 * All PII shown here is already masked/resolved server-side. The "View Customer"
 * link only appears when the server matched the enquiry email to a real account.
 */
export function InboxSidebar({
  enquiryId,
  enquiryType,
  status,
  assignedTo,
  assignees,
  customer,
  contact,
  references,
  payout,
  busy,
  onChanged,
}: {
  enquiryId: string
  enquiryType: string
  status: InboxStatus
  assignedTo: string | null
  assignees: ConversationAssignee[]
  customer: ConversationCustomer | null
  contact: { email: string; phone: string | null; tiktok: string | null }
  references: { giveaway: string | null; order: string | null }
  payout: PayoutInfo | null
  busy: boolean
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [statusBusy, setStatusBusy] = useState(false)
  const [assigneeBusy, setAssigneeBusy] = useState(false)

  async function patch(payloadBody: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/admin/inbox/${enquiryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody),
    })
    const json = await res.json().catch(() => null)
    return res.ok && json?.ok === true
  }

  async function handleStatus(next: string) {
    if (next === status || !INBOX_STATUSES.includes(next as InboxStatus)) return
    setStatusBusy(true)
    try {
      const ok = await patch({ inbox_status: next })
      if (!ok) {
        toast({ title: "Couldn't update status", variant: "destructive" })
        return
      }
      toast({ title: "Status updated" })
      onChanged()
    } catch {
      toast({ title: "Couldn't update status", variant: "destructive" })
    } finally {
      setStatusBusy(false)
    }
  }

  async function handleAssignee(next: string) {
    const value = next === UNASSIGNED ? null : next
    if ((value ?? "") === (assignedTo ?? "")) return
    setAssigneeBusy(true)
    try {
      const ok = await patch({ assignee: value })
      if (!ok) {
        toast({ title: "Couldn't update assignment", variant: "destructive" })
        return
      }
      toast({ title: value ? "Ticket assigned" : "Ticket unassigned" })
      onChanged()
    } catch {
      toast({ title: "Couldn't update assignment", variant: "destructive" })
    } finally {
      setAssigneeBusy(false)
    }
  }

  const controlsDisabled = busy || statusBusy || assigneeBusy
  const payoutTicket = isWinnerPayout(enquiryType)

  return (
    <aside className="flex flex-col gap-4">
      {/* Ticket controls */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Ticket</h2>
          <InboxStatusBadge status={status} />
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ticket-status" className="text-xs font-medium text-muted-foreground">
              Status
            </label>
            <Select value={status} onValueChange={handleStatus} disabled={controlsDisabled}>
              <SelectTrigger id="ticket-status" className="w-full">
                {statusBusy ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Updating…
                  </span>
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                {INBOX_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "open" ? "Open" : s === "waiting" ? "Waiting" : "Resolved"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{STATUS_HINT[status]}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ticket-assignee" className="text-xs font-medium text-muted-foreground">
              Assigned to
            </label>
            <Select
              value={assignedTo ?? UNASSIGNED}
              onValueChange={handleAssignee}
              disabled={controlsDisabled}
            >
              <SelectTrigger id="ticket-assignee" className="w-full">
                {assigneeBusy ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Updating…
                  </span>
                ) : (
                  <SelectValue placeholder="Unassigned" />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a.userId} value={a.userId}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Customer identity */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Customer</h2>
        </div>
        <dl className="mt-3 flex flex-col gap-2.5 text-sm">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="text-right font-medium">{customer?.name || "—"}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all text-right">{contact.email}</dd>
          </div>
          {contact.phone ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="text-right">{contact.phone}</dd>
            </div>
          ) : null}
          {contact.tiktok ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">TikTok</dt>
              <dd className="text-right">{contact.tiktok}</dd>
            </div>
          ) : null}
        </dl>

        {customer ? (
          <Button asChild variant="outline" size="sm" className="mt-4 w-full gap-2">
            <Link href={`/admin/customers/${customer.userId}`}>
              View Customer
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <p className="mt-4 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            No matching customer account for this email address.
          </p>
        )}
      </section>

      {/* Enquiry metadata */}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Enquiry</h2>
        <dl className="mt-3 flex flex-col gap-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-right">
              <Badge variant="secondary">{enquiryTypeLabel(enquiryType)}</Badge>
            </dd>
          </div>
          {references.giveaway ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Giveaway</dt>
              <dd className="text-right">{references.giveaway}</dd>
            </div>
          ) : null}
          {references.order ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Order ref</dt>
              <dd className="text-right font-mono text-xs">{references.order}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Payout details (masked) — only for winner_payout enquiries */}
      {payoutTicket && payout ? (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Payout details</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sensitive fields are masked. Manage payouts in the Payouts workflow.
          </p>
          <dl className="mt-3 flex flex-col gap-2.5 text-sm">
            {payout.method ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Method</dt>
                <dd className="text-right">{enquiryTypeLabel(payout.method)}</dd>
              </div>
            ) : null}
            {payout.accountHolderName ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Account holder</dt>
                <dd className="text-right">{payout.accountHolderName}</dd>
              </div>
            ) : null}
            {payout.sortCodeMasked ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Sort code</dt>
                <dd className="text-right font-mono text-xs">{payout.sortCodeMasked}</dd>
              </div>
            ) : null}
            {payout.accountNumberMasked ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Account no.</dt>
                <dd className="text-right font-mono text-xs">{payout.accountNumberMasked}</dd>
              </div>
            ) : null}
            {payout.paypalEmail ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">PayPal</dt>
                <dd className="break-all text-right">{payout.paypalEmail}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
    </aside>
  )
}
