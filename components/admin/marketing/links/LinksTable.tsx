"use client"

import { useState } from "react"
import { Check, Copy, MoreHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useToast } from "@/hooks/use-toast"
import {
  channelLabel,
  formatUkDateTime,
  shortLinkUrl,
  type TrackingLink,
} from "@/lib/marketing/linkDisplay"
import { describeDestination } from "@/lib/marketing/linkDestinations"

interface LinksTableProps {
  links: TrackingLink[]
  /** Absolute origin for building copyable short links (from the browser). */
  origin: string
  /** Live-competition slug → title, so destinations show their real name. */
  titlesBySlug: Record<string, string>
  onEdit: (link: TrackingLink) => void
  onToggleStatus: (link: TrackingLink) => void
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Disabled"}</Badge>
}

/**
 * Affiliate cell: the affiliate's name, an em dash for none, and a muted
 * "(inactive)" suffix when the attached affiliate has since been deactivated
 * (the assignment is immutable, so it stays displayed).
 */
function AffiliateCell({ name, active }: { name: string | null; active: boolean | null }) {
  if (!name) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <span className="text-sm text-foreground">
      {name}
      {active === false && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
    </span>
  )
}

/** The short-code display for a tracking link, e.g. "wtf-giveaways.co.uk/t/ABC". */
function shortDisplay(url: string): string {
  return url.replace(/^https?:\/\//, "")
}

function CopyLinkButton({ url, prominent }: { url: string; prominent?: boolean }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        // Fallback for older / insecure contexts.
        const ta = document.createElement("textarea")
        ta.value = url
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      setCopied(true)
      toast({ title: "Tracking link copied", description: url })
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({ variant: "destructive", title: "Could not copy", description: "Copy the link manually." })
    }
  }

  return (
    <Button
      variant={prominent ? "default" : "outline"}
      size="sm"
      onClick={copy}
      className={prominent ? "h-9 gap-1.5" : "h-9 gap-1.5 bg-transparent"}
      aria-label={`Copy tracking link ${url}`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      Copy link
    </Button>
  )
}

function RowActions({
  link,
  onEdit,
  onToggleStatus,
}: {
  link: TrackingLink
  onEdit: (link: TrackingLink) => void
  onToggleStatus: (link: TrackingLink) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-9 sm:w-9"
          aria-label={`More actions for ${link.label}`}
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onEdit(link) }}>
          Edit label / destination
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onToggleStatus(link) }}>
          {link.isActive ? "Disable" : "Enable"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function LinksTable({ links, origin, titlesBySlug, onEdit, onToggleStatus }: LinksTableProps) {
  return (
    <>
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {links.map((l) => {
          const url = shortLinkUrl(l.code, origin)
          const dest = describeDestination(l.destinationPath, titlesBySlug)
          return (
            <Card key={l.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{l.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{channelLabel(l.channel)}</Badge>
                    <StatusBadge active={l.isActive} />
                  </div>
                </div>
                <RowActions link={l} onEdit={onEdit} onToggleStatus={onToggleStatus} />
              </div>

              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Tracking link</p>
                <p className="break-all font-mono text-sm font-semibold text-foreground">
                  {shortDisplay(url)}
                </p>
              </div>

              <div className="mt-3 space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground">Sends customers to</p>
                <p className="truncate text-sm text-foreground">{dest.title}</p>
              </div>

              <div className="mt-3 space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground">Affiliate</p>
                <AffiliateCell name={l.affiliateName} active={l.affiliateActive} />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Created {formatUkDateTime(l.createdAt)}
              </p>

              <div className="mt-3">
                <CopyLinkButton url={url} prominent />
              </div>
            </Card>
          )
        })}
      </div>

      {/* Desktop table */}
      <Card className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Tracking link</TableHead>
              <TableHead>Sends customers to</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Affiliate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l) => {
              const url = shortLinkUrl(l.code, origin)
              const dest = describeDestination(l.destinationPath, titlesBySlug)
              return (
                <TableRow key={l.id}>
                  <TableCell className="max-w-[16rem]">
                    <div className="truncate font-medium text-foreground">{l.label}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {shortDisplay(url)}
                      </span>
                      <CopyLinkButton url={url} prominent />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <span className="truncate text-sm text-foreground">{dest.title}</span>
                  </TableCell>
                  <TableCell>{channelLabel(l.channel)}</TableCell>
                  <TableCell><AffiliateCell name={l.affiliateName} active={l.affiliateActive} /></TableCell>
                  <TableCell><StatusBadge active={l.isActive} /></TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatUkDateTime(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <RowActions link={l} onEdit={onEdit} onToggleStatus={onToggleStatus} />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
