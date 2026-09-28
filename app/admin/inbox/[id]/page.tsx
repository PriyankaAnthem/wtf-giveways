import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/auth"
import {
  getInboxServiceClient,
  loadEnquiry,
  loadMessages,
  listAssignees,
  resolveInboxCustomer,
  UUID_RE,
} from "@/lib/admin/inbox/service"
import {
  maskAccountNumber,
  maskSortCode,
  resolveStaffName,
  enquiryTypeLabel,
} from "@/lib/admin/inbox/format"
import {
  InboxConversation,
  type ConversationData,
  type ConversationMessage,
} from "@/components/admin/inbox/InboxConversation"
import type {
  ConversationAssignee,
  ConversationCustomer,
} from "@/components/admin/inbox/InboxSidebar"
import type { InboxStatus } from "@/lib/admin/inbox/types"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Conversation · Inbox · Admin",
  robots: { index: false, follow: false },
}

/** Normalises a possibly-legacy status value to a supported Inbox status. */
function normaliseStatus(raw: string | null | undefined): InboxStatus {
  return raw === "waiting" || raw === "resolved" ? raw : "open"
}

export default async function InboxConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Page re-guards independently of the admin layout.
  await requireAdmin({ roles: ["admin", "operations_admin"] })

  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const svc = getInboxServiceClient()
  if (!svc) notFound()

  const enquiry = await loadEnquiry(svc, id)
  if (!enquiry) notFound()

  // Payout enquiries are owned by the Payouts module and must never be exposed
  // as an Inbox ticket. Send the admin to the Payouts module (the record lives
  // there); there is no per-record payout route, so this is the safe existing
  // destination.
  if (enquiry.enquiry_type === "winner_payout") {
    redirect("/admin/payouts")
  }

  // Load conversation context in parallel. Customer resolution is by email and
  // may legitimately return null (guest / unmatched) — never fabricated.
  const [messages, assigneeRows, resolvedCustomer] = await Promise.all([
    loadMessages(svc, id),
    listAssignees(svc),
    resolveInboxCustomer(svc, enquiry.email),
  ])

  // Staff display-name map for attributing outbound replies.
  const staffNames = new Map<string, string>()
  for (const a of assigneeRows) {
    staffNames.set(
      a.user_id,
      resolveStaffName({
        first_name: a.first_name,
        last_name: a.last_name,
        display_name: a.display_name,
        email: a.email,
      }),
    )
  }

  const assignees: ConversationAssignee[] = assigneeRows.map((a) => ({
    userId: a.user_id,
    name: staffNames.get(a.user_id) ?? "Unknown",
    role: a.role,
  }))

  const conversationMessages: ConversationMessage[] = messages.map((m) => ({
    id: m.id,
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    body: m.body,
    created_at: m.created_at,
    email_status:
      m.email_status === "sent" ||
      m.email_status === "failed" ||
      m.email_status === "not_required"
        ? m.email_status
        : "pending",
    author_name:
      m.direction === "outbound"
        ? (m.author_user_id && staffNames.get(m.author_user_id)) || "Staff"
        : null,
  }))

  const customer: ConversationCustomer | null = resolvedCustomer
    ? {
        userId: resolvedCustomer.user_id,
        name:
          resolvedCustomer.real_name ||
          resolvedCustomer.display_name ||
          [resolvedCustomer.first_name, resolvedCustomer.last_name].filter(Boolean).join(" ") ||
          enquiry.full_name ||
          enquiry.email,
        email: resolvedCustomer.email ?? enquiry.email,
        mobile: resolvedCustomer.mobile,
      }
    : null

  const isPayout = enquiry.enquiry_type === "winner_payout"

  const data: ConversationData = {
    id: enquiry.id,
    enquiry_type: enquiry.enquiry_type,
    full_name: enquiry.full_name || enquiry.email,
    email: enquiry.email,
    original_message: enquiry.message,
    original_created_at: enquiry.created_at,
    inbox_status: normaliseStatus(enquiry.inbox_status),
    inbox_assigned_to: enquiry.inbox_assigned_to,
    messages: conversationMessages,
    customer,
    assignees,
    phone: enquiry.phone,
    giveaway_name: enquiry.giveaway_name,
    order_reference: enquiry.order_reference,
    tiktok_username: enquiry.tiktok_username,
    payout: isPayout
      ? {
          method: enquiry.preferred_payout_method,
          amountClaimedPence: enquiry.amount_claimed_pence,
          verifiedAmountPence: enquiry.verified_amount_pence,
          accountHolderName: enquiry.payout_account_holder_name,
          // Sensitive fields are masked before they ever reach the client.
          sortCodeMasked: maskSortCode(enquiry.payout_sort_code),
          accountNumberMasked: maskAccountNumber(enquiry.payout_account_number),
          paypalEmail: enquiry.payout_paypal_email,
          contactDetail: enquiry.payout_contact_detail,
          adminNotes: enquiry.payout_admin_notes,
          paidAt: enquiry.payout_paid_at,
          processedAt: enquiry.payout_processed_at,
          legacyStatus: enquiry.status,
        }
      : null,
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/inbox"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Inbox
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            {data.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {enquiryTypeLabel(data.enquiry_type)} · {data.email}
          </p>
        </div>
      </div>

      <InboxConversation data={data} />
    </div>
  )
}
