"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Ban, ShieldCheck, ShieldOff, Lock } from "lucide-react"
import type { AdminRole } from "@/lib/admin/permissions"
import { formatDateTime, restrictionSourceLabel, type RestrictionSource } from "./format"
import { RevokeRestrictionDialog } from "./RevokeRestrictionDialog"

export type RestrictionRecord = {
  id: string
  user_id: string
  restriction_type: string
  source: RestrictionSource | string
  reason: string | null
  created_at: string | null
  created_by: string | null
  created_by_name: string | null
  revoked_at: string | null
  revoked_by: string | null
  revoked_by_name: string | null
  revocation_reason: string | null
  active: boolean
}

/** ACTIVE / REVOKED status pill. */
export function RestrictionStatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <Badge variant="destructive" className="gap-1 uppercase tracking-wide">
        <Ban className="size-3" aria-hidden="true" />
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 uppercase tracking-wide text-muted-foreground">
      <ShieldOff className="size-3" aria-hidden="true" />
      Revoked
    </Badge>
  )
}

/** ADMIN / SUPPORT / CUSTOMER provenance pill. */
export function RestrictionSourceBadge({ source }: { source: string }) {
  const label = restrictionSourceLabel(source)
  const className =
    source === "admin"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : source === "support"
        ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
        : source === "customer"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "text-muted-foreground"
  return (
    <Badge variant="outline" className={`uppercase tracking-wide ${className}`}>
      {label}
    </Badge>
  )
}

/**
 * Per-customer restriction history (active + revoked), newest first. Used on
 * the customer detail page and the Self Exclusions module.
 *
 * The REMOVE action is shown ONLY when the viewer is a Super Admin AND the
 * record is active AND source === 'admin'. Support/customer exclusions display
 * a "Protected exclusion" note with no workaround.
 */
export function RestrictionHistory({
  userId,
  role,
  customerName,
  reloadKey = 0,
  onChanged,
}: {
  userId: string
  role: AdminRole
  customerName: string
  /** Bump to force a refetch (e.g. after an exclusion is applied elsewhere). */
  reloadKey?: number
  /** Called after a successful revoke so the parent can refresh its own state. */
  onChanged?: () => void
}) {
  const [records, setRecords] = useState<RestrictionRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/customers/${userId}/restrictions`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError("Restriction history is temporarily unavailable.")
        return
      }
      setRecords(json.restrictions ?? [])
    } catch {
      setError("Restriction history is temporarily unavailable.")
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const handleRevoked = useCallback(() => {
    load()
    onChanged?.()
  }, [load, onChanged])

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>
  }

  if (records === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed py-6 px-4 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        No restriction history for this customer.
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {records.map((r) => {
        const canRevoke = role === "admin" && r.active && r.source === "admin"
        const protectedActive = r.active && (r.source === "support" || r.source === "customer")
        return (
          <li
            key={r.id}
            className={`rounded-lg border p-4 ${r.active ? "border-destructive/30 bg-destructive/5" : "bg-card"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <RestrictionStatusBadge active={r.active} />
                <RestrictionSourceBadge source={r.source} />
              </div>
              {canRevoke && (
                <RevokeRestrictionDialog
                  userId={r.user_id}
                  restrictionId={r.id}
                  customerName={customerName}
                  appliedAt={r.created_at}
                  originalReason={r.reason}
                  onRevoked={handleRevoked}
                />
              )}
              {protectedActive && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Protected exclusion
                </span>
              )}
            </div>

            <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Field label="Reason" value={r.reason || "—"} wide />
              <Field label="Started" value={formatDateTime(r.created_at)} />
              <Field label="Applied by" value={r.created_by_name || "—"} />
              {!r.active && (
                <>
                  <Field label="Revoked" value={formatDateTime(r.revoked_at)} />
                  <Field label="Revoked by" value={r.revoked_by_name || "—"} />
                  <Field label="Revocation reason" value={r.revocation_reason || "—"} wide />
                </>
              )}
            </dl>

            {protectedActive && (
              <p className="mt-3 text-xs text-muted-foreground">
                Cannot be removed from admin — this exclusion was created by {restrictionSourceLabel(r.source)}.
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Field({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">{value}</dd>
    </div>
  )
}
