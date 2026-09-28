"use client"

import { MoreHorizontal } from "lucide-react"
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
import {
  type DiscountCode,
  type DerivedStatus,
  STATUS_LABELS,
  statusBadgeVariant,
  deriveStatus,
  formatDiscount,
  formatScope,
  formatUkDateTime,
  formatGbpFromPence,
} from "@/lib/discounts/adminDisplay"

interface DiscountCodesTableProps {
  codes: DiscountCode[]
  canManage: boolean
  onEdit: (code: DiscountCode) => void
  onToggleStatus: (code: DiscountCode) => void
}

function StatusBadge({ status }: { status: DerivedStatus }) {
  return <Badge variant={statusBadgeVariant(status)}>{STATUS_LABELS[status]}</Badge>
}

function ScopeCell({ code }: { code: DiscountCode }) {
  if (code.scope === "site_wide") {
    return <span className="text-foreground">Site-wide</span>
  }
  return (
    <div className="min-w-0">
      <div className="truncate text-foreground">{formatScope(code)}</div>
      {code.campaignSlug ? (
        <div className="truncate text-xs text-muted-foreground">{code.campaignSlug}</div>
      ) : null}
    </div>
  )
}

function RowActions({
  code,
  onEdit,
  onToggleStatus,
}: {
  code: DiscountCode
  onEdit: (code: DiscountCode) => void
  onToggleStatus: (code: DiscountCode) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-9 sm:w-9"
          aria-label={`Actions for ${code.code}`}
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onEdit(code) }}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onToggleStatus(code) }}>
          {code.isActive ? "Disable" : "Enable"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DiscountCodesTable({
  codes,
  canManage,
  onEdit,
  onToggleStatus,
}: DiscountCodesTableProps) {
  return (
    <>
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {codes.map((c) => {
          const status = deriveStatus(c)
          return (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono font-semibold text-foreground">{c.code}</p>
                  {c.description ? (
                    <p className="truncate text-sm text-muted-foreground">{c.description}</p>
                  ) : null}
                </div>
                {canManage ? (
                  <RowActions code={c} onEdit={onEdit} onToggleStatus={onToggleStatus} />
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{formatDiscount(c)}</Badge>
                <StatusBadge status={status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Scope</dt>
                  <dd className="text-foreground"><ScopeCell code={c} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Uses</dt>
                  <dd className="text-foreground">{c.uses.toLocaleString("en-GB")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Net Revenue</dt>
                  <dd className="text-foreground">{formatGbpFromPence(c.netRevenuePence)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Starts</dt>
                  <dd className="text-foreground">{formatUkDateTime(c.startsAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd className="text-foreground">{formatUkDateTime(c.expiresAt)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Last updated</dt>
                  <dd className="text-foreground">{formatUkDateTime(c.updatedAt)}</dd>
                </div>
              </dl>
            </Card>
          )
        })}
      </div>

      {/* Desktop table. overflow-x-auto lets the extra columns scroll on
          narrower viewports rather than crushing every column. */}
      <Card className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead className="text-right">Uses</TableHead>
              <TableHead className="text-right">Net Revenue</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Last updated</TableHead>
              {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.map((c) => {
              const status = deriveStatus(c)
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-mono font-semibold text-foreground">{c.code}</div>
                    {c.description ? (
                      <div className="max-w-[16rem] truncate text-sm text-muted-foreground">
                        {c.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatDiscount(c)}</TableCell>
                  <TableCell className="max-w-[14rem]"><ScopeCell code={c} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.uses.toLocaleString("en-GB")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatGbpFromPence(c.netRevenuePence)}
                  </TableCell>
                  <TableCell><StatusBadge status={status} /></TableCell>
                  <TableCell>{formatUkDateTime(c.startsAt)}</TableCell>
                  <TableCell>{formatUkDateTime(c.expiresAt)}</TableCell>
                  <TableCell>{formatUkDateTime(c.updatedAt)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <RowActions code={c} onEdit={onEdit} onToggleStatus={onToggleStatus} />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
