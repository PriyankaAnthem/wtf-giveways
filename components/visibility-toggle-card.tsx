"use client"

import { AlertTriangle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

interface VisibilityToggleCardProps {
  publicVisible: boolean
  onChange: (visible: boolean) => void
}

export function VisibilityToggleCard({ publicVisible, onChange }: VisibilityToggleCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="public-visibility" className="text-base font-semibold">
            Show my profile publicly
          </Label>
          <p className="text-sm text-muted-foreground">
            When enabled, your profile appears on public winners pages and profile pages.
          </p>
        </div>
        <Switch
          id="public-visibility"
          checked={publicVisible}
          onCheckedChange={onChange}
          aria-describedby="visibility-description"
        />
      </div>

      {!publicVisible && (
        <div id="visibility-description" className="mt-4 flex gap-3 rounded-md bg-warning/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-medium text-warning">Your profile is hidden from public view</p>
            <p className="mt-1 text-muted-foreground">
              You will not appear on public winners pages or public profile pages. Your entries and eligibility are not
              affected.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
