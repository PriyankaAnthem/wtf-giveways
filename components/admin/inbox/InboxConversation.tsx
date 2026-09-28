"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Send, Loader2, AlertTriangle, CheckCircle2, RotateCcw, Clock } from "lucide-react"
import { CustomerAvatar } from "@/components/admin/customers/CustomerAvatar"
import { formatDateTime } from "@/components/admin/customers/format"
import { InboxSidebar, type ConversationCustomer, type ConversationAssignee } from "./InboxSidebar"
import { emailStatusMeta, validateReplyBody } from "@/lib/admin/inbox/format"
import { REPLY_MAX_LEN, type InboxStatus } from "@/lib/admin/inbox/types"

/** A serialisable message for the thread (raw text preserved; rendered safely). */
export interface ConversationMessage {
  id: string
  direction: "inbound" | "outbound"
  body: string
  created_at: string
  email_status: "pending" | "sent" | "failed" | "not_required"
  author_name: string | null
}

/** Everything the conversation needs — all loaded + sanitised server-side. */
export interface ConversationData {
  id: string
  enquiry_type: string
  full_name: string
  email: string
  original_message: string
  original_created_at: string
  inbox_status: InboxStatus
  inbox_assigned_to: string | null
  messages: ConversationMessage[]
  customer: ConversationCustomer | null
  assignees: ConversationAssignee[]
  // Ticket metadata (already masked where sensitive).
  phone: string | null
  giveaway_name: string | null
  order_reference: string | null
  tiktok_username: string | null
  payout: {
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
  } | null
}

export function InboxConversation({ data }: { data: ConversationData }) {
  const router = useRouter()
  const { toast } = useToast()

  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [isPending, startTransition] = useTransition()

  const refresh = () => startTransition(() => router.refresh())

  const sendReply = async () => {
    const validation = validateReplyBody(reply)
    if (!validation.ok) {
      toast({
        title: validation.error === "too_long" ? "Reply is too long" : "Reply is empty",
        description:
          validation.error === "too_long"
            ? `Please keep replies under ${REPLY_MAX_LEN.toLocaleString()} characters.`
            : "Type a message before sending.",
        variant: "destructive",
      })
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/admin/inbox/${data.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: validation.body }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: "Couldn't send reply", description: "Please try again.", variant: "destructive" })
        return
      }
      if (json.emailStatus === "sent") {
        toast({ title: "Reply sent", description: "The customer has been emailed. Ticket set to Waiting." })
        setReply("")
      } else {
        toast({
          title: "Reply saved, email failed",
          description: "The reply is stored but the email didn't send. You can retry it below.",
          variant: "destructive",
        })
        setReply("")
      }
      refresh()
    } catch {
      toast({ title: "Couldn't send reply", description: "Please try again.", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  const retryMessage = async (messageId: string) => {
    try {
      const res = await fetch(`/api/admin/inbox/${data.id}/messages/${messageId}/retry`, {
        method: "POST",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: "Retry failed", description: "Please try again.", variant: "destructive" })
        return
      }
      if (json.emailStatus === "sent") {
        toast({ title: "Email sent", description: "The retry succeeded. Ticket set to Waiting." })
      } else {
        toast({ title: "Email failed again", description: "The message is still marked failed.", variant: "destructive" })
      }
      refresh()
    } catch {
      toast({ title: "Retry failed", description: "Please try again.", variant: "destructive" })
    }
  }

  const busy = sending || isPending

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* MAIN: conversation thread + reply */}
      <div className="order-2 flex flex-col gap-4 lg:order-1">
        <div className="space-y-3">
          {/* Original enquiry — always first, always inbound. */}
          <MessageBubble
            direction="inbound"
            author={data.full_name}
            timestamp={data.original_created_at}
            body={data.original_message}
          />

          {data.messages.map((m) => (
            <MessageBubble
              key={m.id}
              direction={m.direction}
              author={m.direction === "outbound" ? m.author_name ?? "Staff" : data.full_name}
              timestamp={m.created_at}
              body={m.body}
              emailStatus={m.direction === "outbound" ? m.email_status : undefined}
              onRetry={m.direction === "outbound" && m.email_status === "failed" ? () => retryMessage(m.id) : undefined}
            />
          ))}
        </div>

        {/* Reply composer */}
        <div className="rounded-xl border bg-card p-4">
          <label htmlFor="inbox-reply" className="mb-2 block text-sm font-medium">
            Reply to {data.full_name}
          </label>
          <Textarea
            id="inbox-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your reply. The customer will receive this by email."
            rows={5}
            maxLength={REPLY_MAX_LEN}
            className="resize-y"
            disabled={busy}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Emailed to {data.email || "the customer"}. Sending sets the ticket to Waiting.
            </span>
            <Button onClick={sendReply} disabled={busy || reply.trim().length === 0} className="gap-2">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send reply
            </Button>
          </div>
        </div>
      </div>

      {/* SIDEBAR: customer + status + assignee + metadata */}
      <div className="order-1 lg:order-2">
        <InboxSidebar
          enquiryId={data.id}
          enquiryType={data.enquiry_type}
          status={data.inbox_status}
          assignedTo={data.inbox_assigned_to}
          assignees={data.assignees}
          customer={data.customer}
          contact={{
            email: data.email,
            phone: data.phone,
            tiktok: data.tiktok_username,
          }}
          references={{ giveaway: data.giveaway_name, order: data.order_reference }}
          payout={data.payout}
          busy={busy}
          onChanged={refresh}
        />
      </div>
    </div>
  )
}

/**
 * A single message bubble. Customer (inbound) sits left/neutral; staff
 * (outbound) sits right with an admin accent. Body is rendered as SAFE PLAIN
 * TEXT with `whitespace-pre-wrap` (never dangerouslySetInnerHTML), preserving
 * newlines and spacing.
 */
function MessageBubble({
  direction,
  author,
  timestamp,
  body,
  emailStatus,
  onRetry,
}: {
  direction: "inbound" | "outbound"
  author: string
  timestamp: string
  body: string
  emailStatus?: "pending" | "sent" | "failed" | "not_required"
  onRetry?: () => void
}) {
  const outbound = direction === "outbound"
  const email = emailStatus ? emailStatusMeta(emailStatus) : null

  return (
    <div className={`flex gap-3 ${outbound ? "flex-row-reverse" : "flex-row"}`}>
      <CustomerAvatar name={author} seed={author} />
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{author}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDateTime(timestamp)}</span>
        </div>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            outbound
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border bg-muted/50 text-foreground"
          }`}
        >
          {body}
        </div>
        {email && (
          <div className="flex items-center gap-2">
            <EmailStatusChip tone={email.tone} label={email.label} />
            {onRetry && (
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onRetry}>
                <RotateCcw className="size-3" aria-hidden="true" />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmailStatusChip({
  tone,
  label,
}: {
  tone: "sent" | "pending" | "failed" | "muted"
  label: string
}) {
  if (tone === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3" aria-hidden="true" />
        {label}
      </span>
    )
  }
  if (tone === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" aria-hidden="true" />
        {label}
      </span>
    )
  }
  if (tone === "muted") {
    return <span className="text-xs text-muted-foreground">{label}</span>
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3" aria-hidden="true" />
      {label}
    </span>
  )
}
