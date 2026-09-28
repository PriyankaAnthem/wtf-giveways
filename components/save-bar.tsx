"use client"

import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SaveBarProps {
  onSave: () => void
  disabled?: boolean
  loading?: boolean
  success?: boolean
  error?: string
}

export function SaveBar({ onSave, disabled, loading, success, error }: SaveBarProps) {
  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Failed to save changes</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={disabled || loading || success} className="min-w-32" size="lg">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {success && <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
          {success ? "Saved (demo)" : loading ? "Saving..." : "Save changes"}
        </Button>

        {success && (
          <p className="text-sm font-medium text-primary" role="status">
            Changes saved locally (demo)
          </p>
        )}
      </div>
    </div>
  )
}
