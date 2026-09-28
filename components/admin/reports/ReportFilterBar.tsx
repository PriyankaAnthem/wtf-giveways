'use client'

import { Download } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { REPORT_RANGES, REPORT_RANGE_LABELS, type ReportRange } from '@/lib/admin/reporting/types'
import { cn } from '@/lib/utils'

export interface FilterState {
  range: ReportRange
  from: string
  to: string
  campaign: string // '' = all
  provider: string // '' = all
}

interface ReportFilterBarProps {
  value: FilterState
  onChange: (next: FilterState) => void
  campaigns: { id: string; title: string }[]
  providers: string[]
  exportHref: string
  disabled?: boolean
  /** Growth v1 has no CSV export; hide the button without touching Overview. */
  showExport?: boolean
}

export function ReportFilterBar({
  value,
  onChange,
  campaigns,
  providers,
  exportHref,
  disabled = false,
  showExport = true,
}: ReportFilterBarProps) {
  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-xl sm:border">
      {/* Range chips — horizontally scrollable on mobile */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1">
        {REPORT_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange({ ...value, range: r })}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              value.range === r
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
            aria-pressed={value.range === r}
          >
            {REPORT_RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      {value.range === 'custom' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sr-only sm:not-sr-only">From</span>
            <input
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sr-only sm:not-sr-only">To</span>
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            />
          </label>
        </div>
      )}

      {/* Campaign + provider + export */}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={value.campaign || 'all'}
          onValueChange={(v) => onChange({ ...value, campaign: v === 'all' ? '' : v })}
        >
          <SelectTrigger className="h-9 w-full sm:w-56" aria-label="Filter by campaign">
            <SelectValue placeholder="All campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.provider || 'all'}
          onValueChange={(v) => onChange({ ...value, provider: v === 'all' ? '' : v })}
        >
          <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Filter by payment provider">
            <SelectValue placeholder="All providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showExport && (
          <a
            href={disabled ? undefined : exportHref}
            aria-disabled={disabled}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:ml-auto',
              disabled && 'pointer-events-none opacity-50',
            )}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </a>
        )}
      </div>
    </div>
  )
}
