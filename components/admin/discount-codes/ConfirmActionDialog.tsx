"use client"

import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ConfirmActionDialogProps {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  submitting?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shared confirmation used before disabling/enabling a code and before saving a
 * material edit to a currently-active code. Copy explains that new checkouts
 * use the change immediately while existing checkout snapshots are unaffected.
 */
export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  submitting,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !submitting && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={submitting}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
