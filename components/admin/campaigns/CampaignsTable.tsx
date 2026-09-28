"use client"

import { useState } from "react"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DuplicateCampaignDialog,
  type DuplicateTarget,
} from "@/components/admin/campaigns/DuplicateCampaignDialog"
import type { GiveawayCategory } from "@/lib/giveaway-classification"

export interface CampaignRow {
  id: string
  title: string
  slug: string
  status: string
  category: GiveawayCategory
  startAt: string
  endAt: string
  ticketPricePence: number
}

interface CampaignsTableProps {
  campaigns: CampaignRow[]
}

const CATEGORY_LABELS: Record<GiveawayCategory, string> = {
  live_balloon: "TikTok Live",
  instant_cash: "Instant Cash",
  other: "Other",
}

function formatDate(dateString: string) {
  if (!dateString) return "—"
  const d = new Date(dateString)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function formatPrice(pence: number) {
  return `£${(pence / 100).toFixed(2)}`
}

function getStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "live":
      return "default"
    case "draft":
      return "secondary"
    case "paused":
      return "outline"
    case "ended":
    case "closed":
      return "destructive"
    default:
      return "outline"
  }
}

/** Public giveaway page is only meaningful when there is a usable slug. */
function publicHref(c: CampaignRow): string | null {
  return c.slug ? `/giveaways/${c.slug}` : null
}

function RowActions({
  campaign,
  onDuplicate,
}: {
  campaign: CampaignRow
  onDuplicate: (t: DuplicateTarget) => void
}) {
  const href = publicHref(campaign)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-9 sm:w-9"
          aria-label={`Actions for ${campaign.title}`}
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href={`/admin/campaigns/${campaign.id}`}>Edit</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/admin/campaigns/${campaign.id}/tickets`}>View Tickets</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onDuplicate({ id: campaign.id, title: campaign.title })
          }}
        >
          Duplicate as draft
        </DropdownMenuItem>
        {href ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={href} target="_blank" rel="noopener noreferrer">
                View public page
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CampaignsTable({ campaigns }: CampaignsTableProps) {
  const [target, setTarget] = useState<DuplicateTarget | null>(null)

  return (
    <>
      {/* Mobile: compact admin cards (same data array, responsive presentation) */}
      <div className="grid gap-3 md:hidden">
        {campaigns.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{c.title}</p>
                <p className="truncate text-sm text-muted-foreground">{c.slug || "no slug"}</p>
              </div>
              <RowActions campaign={c} onDuplicate={setTarget} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant={getStatusVariant(c.status)}>{c.status}</Badge>
              <Badge variant="outline">{CATEGORY_LABELS[c.category]}</Badge>
              <span className="text-sm font-medium text-foreground">
                {formatPrice(c.ticketPricePence)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div>
                <dt className="text-muted-foreground">Start</dt>
                <dd className="text-foreground">{formatDate(c.startAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">End</dt>
                <dd className="text-foreground">{formatDate(c.endAt)}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      {/* Desktop: full table */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Ticket price</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-semibold text-foreground">{c.title}</div>
                  <div className="text-sm text-muted-foreground">{c.slug || "no slug"}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(c.status)}>{c.status}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{CATEGORY_LABELS[c.category]}</Badge>
                </TableCell>
                <TableCell>{formatDate(c.startAt)}</TableCell>
                <TableCell>{formatDate(c.endAt)}</TableCell>
                <TableCell>{formatPrice(c.ticketPricePence)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end">
                    <RowActions campaign={c} onDuplicate={setTarget} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <DuplicateCampaignDialog target={target} onClose={() => setTarget(null)} />
    </>
  )
}
