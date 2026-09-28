'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** Compact, locale-stable timestamp for dense operational tables. */
export function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type Tone = 'live' | 'safe' | 'warn' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  live: 'border-destructive/40 bg-destructive/10 text-destructive',
  safe: 'border-trust/40 bg-trust/10 text-trust',
  warn: 'border-gold/40 bg-gold-soft text-gold',
  neutral: 'border-border bg-muted/50 text-muted-foreground',
}

/** A small, uppercase state pill used across the console. */
export function StateChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}

/** Map a recipient/run status to a tone for consistent colour coding. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'delivered':
    case 'clicked':
    case 'sent':
      return 'safe'
    case 'processing':
    case 'queued':
      return 'neutral'
    case 'skipped':
    case 'cancelled':
      return 'warn'
    case 'failed':
    case 'bounced':
    case 'complained':
      return 'live'
    default:
      return 'neutral'
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <StateChip tone={statusTone(status)}>{status}</StateChip>
}

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
}

/**
 * Controlled confirmation dialog for every deliberate arming / enable action.
 * Requires an explicit click on the confirm button; cancelling is always safe.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={loading}
            className={
              destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
          >
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
