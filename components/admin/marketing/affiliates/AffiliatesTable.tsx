"use client"

import Link from "next/link"
import { Pencil, Power, BarChart3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Affiliate, formatCommissionRate } from "@/lib/marketing/affiliateDisplay"

interface AffiliatesTableProps {
  affiliates: Affiliate[]
  loading: boolean
  loadError: string | null
  onEdit: (a: Affiliate) => void
  onToggleActive: (a: Affiliate) => void
}

/** Deep-link into the Links list filtered to this affiliate (query param). */
function linksHref(a: Affiliate): string {
  return `/admin/marketing/links?affiliate=${encodeURIComponent(a.id)}`
}

export function AffiliatesTable({
  affiliates,
  loading,
  loadError,
  onEdit,
  onToggleActive,
}: AffiliatesTableProps) {
  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        Loading affiliates…
      </div>
    )
  }

  if (affiliates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium text-foreground">No affiliates yet</p>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Add your first partner to start attributing tracking links and revenue to them.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {affiliates.map((a) => (
          <div key={a.id} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground font-mono">{a.slug}</p>
              </div>
              <StatusBadge active={a.isActive} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Commission</p>
                <p className="text-foreground">{formatCommissionRate(a.commissionBps)}</p>
              </div>
            </div>

            {a.notes && <p className="mt-3 text-sm text-muted-foreground text-pretty">{a.notes}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onEdit(a)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={linksHref(a)}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Links
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => onToggleActive(a)}>
                <Power className="mr-2 h-4 w-4" />
                {a.isActive ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Commission</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {affiliates.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium text-foreground">{a.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{a.slug}</TableCell>
                <TableCell>{formatCommissionRate(a.commissionBps)}</TableCell>
                <TableCell><StatusBadge active={a.isActive} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(a)}>
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Edit {a.name}</span>
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={linksHref(a)}>
                        <BarChart3 className="h-4 w-4" />
                        <span className="sr-only">View links for {a.name}</span>
                      </Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onToggleActive(a)}>
                      <Power className="h-4 w-4" />
                      <span className="sr-only">
                        {a.isActive ? "Deactivate" : "Activate"} {a.name}
                      </span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Disabled"}</Badge>
}
