"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Check, Copy } from "lucide-react"

export interface CampaignTicket {
  ticket_number: number | string
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile: string | null
  order_reference: string | null
  purchased_at: string | null
}

function formatUkDateTime(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable - no-op */
        }
      }}
      className="inline-flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function CopyableValue({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="truncate">{value}</span>
      <CopyButton value={value} label={label} />
    </span>
  )
}

export function CampaignTicketsTable({ tickets }: { tickets: CampaignTicket[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[1%] whitespace-nowrap">Ticket</TableHead>
            <TableHead className="hidden sm:table-cell">First name</TableHead>
            <TableHead className="hidden sm:table-cell">Last name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="hidden md:table-cell">Mobile</TableHead>
            <TableHead className="hidden lg:table-cell">Order reference</TableHead>
            <TableHead className="hidden md:table-cell">Purchased</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((t) => (
            <TableRow key={String(t.ticket_number)}>
              <TableCell className="whitespace-nowrap align-top font-mono text-base font-bold text-foreground tabular-nums">
                #{t.ticket_number}
              </TableCell>

              {/* Desktop name columns */}
              <TableCell className="hidden align-top sm:table-cell">
                {t.first_name || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="hidden align-top sm:table-cell">
                {t.last_name || <span className="text-muted-foreground">—</span>}
              </TableCell>

              {/* Email - always visible, copyable. On mobile, carries the secondary info. */}
              <TableCell className="align-top">
                <div className="max-w-[220px] sm:max-w-none">
                  <CopyableValue value={t.email} label="email" />
                </div>
                {/* Compact details for mobile only */}
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground sm:hidden">
                  <div>
                    {(t.first_name || "—") + " " + (t.last_name || "")}
                  </div>
                  <div className="flex items-center gap-1">
                    <span>Mobile:</span>
                    {t.mobile ? (
                      <CopyableValue value={t.mobile} label="mobile" />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  {t.order_reference && <div>Ref: {t.order_reference}</div>}
                  <div>{formatUkDateTime(t.purchased_at)}</div>
                </div>
              </TableCell>

              <TableCell className="hidden align-top md:table-cell">
                <CopyableValue value={t.mobile} label="mobile" />
              </TableCell>
              <TableCell className="hidden align-top font-mono text-sm lg:table-cell">
                {t.order_reference || <span className="font-sans text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="hidden whitespace-nowrap align-top text-sm text-muted-foreground md:table-cell">
                {formatUkDateTime(t.purchased_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
