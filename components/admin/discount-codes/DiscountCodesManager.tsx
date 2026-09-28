"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Plus, Search, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  type DiscountCode,
  type DerivedStatus,
  deriveStatus,
  formatDiscount,
  friendlyError,
} from "@/lib/discounts/adminDisplay"
import {
  DiscountCodeFormDialog,
  type CampaignOption,
  type DiscountCodePayload,
} from "@/components/admin/discount-codes/DiscountCodeFormDialog"
import { DiscountCodesTable } from "@/components/admin/discount-codes/DiscountCodesTable"
import { ConfirmActionDialog } from "@/components/admin/discount-codes/ConfirmActionDialog"

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const json = await r.json().catch(() => ({}))
    if (!r.ok || json?.ok === false) {
      throw new Error(json?.error || "load_failed")
    }
    return json
  })

type StatusFilter = "all" | DerivedStatus
type ScopeFilter = "all" | "site_wide" | "campaign"

interface DiscountCodesManagerProps {
  canManage: boolean
}

export function DiscountCodesManager({ canManage }: DiscountCodesManagerProps) {
  const { toast } = useToast()

  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; items: DiscountCode[] }>(
    "/api/admin/discount-codes",
    fetcher,
  )
  const codes = data?.items ?? []

  // Campaigns for the form selector are loaded lazily (only when a form opens).
  const [formOpen, setFormOpen] = useState(false)
  const { data: campaignData, isLoading: campaignsLoading } = useSWR<{
    ok: boolean
    campaigns: CampaignOption[]
  }>(formOpen ? "/api/admin/instant-winners/campaigns" : null, fetcher)
  const campaigns = campaignData?.campaigns ?? []

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all")

  const [editing, setEditing] = useState<DiscountCode | null>(null)

  // Pending confirmation state (status toggle or material edit).
  const [statusTarget, setStatusTarget] = useState<DiscountCode | null>(null)
  const [pendingEdit, setPendingEdit] = useState<DiscountCodePayload | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return codes.filter((c) => {
      if (q && !c.code.toLowerCase().includes(q) && !(c.description ?? "").toLowerCase().includes(q)) {
        return false
      }
      if (statusFilter !== "all" && deriveStatus(c) !== statusFilter) return false
      if (scopeFilter !== "all" && c.scope !== scopeFilter) return false
      return true
    })
  }, [codes, search, statusFilter, scopeFilter])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(code: DiscountCode) {
    setEditing(code)
    setFormOpen(true)
  }

  /** Perform the actual write. Returns a stable error code, or null on success. */
  async function persist(payload: DiscountCodePayload): Promise<string | null> {
    const method = payload.id ? "PUT" : "POST"
    try {
      const res = await fetch("/api/admin/discount-codes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        return json?.error || "save_failed"
      }
      await mutate()
      toast({
        title: payload.id ? "Discount code updated" : "Discount code created",
        description: `${payload.code} saved successfully.`,
      })
      return null
    } catch {
      return "save_failed"
    }
  }

  /**
   * Form submit. A material edit to a currently-active code is routed through a
   * confirmation first; everything else saves directly.
   */
  async function handleFormSubmit(payload: DiscountCodePayload): Promise<string | null> {
    const isEditingActive = payload.id && editing?.isActive
    const isMaterialEdit =
      isEditingActive &&
      editing &&
      (editing.discountType !== payload.discountType ||
        formatDiscountValue(editing) !== payload.discountValue.trim() ||
        editing.scope !== payload.scope ||
        (editing.campaignId ?? null) !== (payload.campaignId ?? null) ||
        editing.code !== payload.code)

    if (isMaterialEdit) {
      // Defer to confirmation; close the form and stash the payload.
      setPendingEdit(payload)
      setFormOpen(false)
      return null
    }

    const err = await persist(payload)
    if (!err) setFormOpen(false)
    return err
  }

  async function confirmPendingEdit() {
    if (!pendingEdit) return
    setConfirmBusy(true)
    const err = await persist(pendingEdit)
    setConfirmBusy(false)
    if (err) {
      toast({ variant: "destructive", title: "Could not save", description: friendlyError(err) })
      return
    }
    setPendingEdit(null)
    setEditing(null)
  }

  async function confirmToggleStatus() {
    if (!statusTarget) return
    setConfirmBusy(true)
    try {
      const res = await fetch("/api/admin/discount-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: statusTarget.id, isActive: !statusTarget.isActive }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        toast({ variant: "destructive", title: "Could not update", description: friendlyError(json?.error) })
        return
      }
      await mutate()
      toast({
        title: statusTarget.isActive ? "Discount code disabled" : "Discount code enabled",
        description: `${statusTarget.code} updated.`,
      })
      setStatusTarget(null)
    } catch {
      toast({ variant: "destructive", title: "Could not update", description: friendlyError("save_failed") })
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search codes"
              className="pl-9"
              aria-label="Search discount codes"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="sm:w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as ScopeFilter)}>
            <SelectTrigger className="sm:w-40" aria-label="Filter by scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value="site_wide">Site-wide</SelectItem>
              <SelectItem value="campaign">Campaign</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create discount code
          </Button>
        ) : null}
      </div>

      {/* States */}
      {isLoading ? (
        <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading discount codes…</span>
        </Card>
      ) : error ? (
        <Card className="space-y-3 py-12 text-center">
          <p className="text-sm text-destructive">{friendlyError((error as Error).message)}</p>
          <Button variant="outline" onClick={() => mutate()} className="bg-transparent">
            Try again
          </Button>
        </Card>
      ) : codes.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No discount codes yet.{canManage ? " Create one to get started." : ""}
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No discount codes match the current filters.</p>
        </Card>
      ) : (
        <DiscountCodesTable
          codes={filtered}
          canManage={canManage}
          onEdit={openEdit}
          onToggleStatus={setStatusTarget}
        />
      )}

      {/* Create / edit form (admins only) */}
      {canManage ? (
        <DiscountCodeFormDialog
          open={formOpen}
          editing={editing}
          campaigns={campaigns}
          campaignsLoading={campaignsLoading}
          onClose={() => setFormOpen(false)}
          onSubmit={handleFormSubmit}
        />
      ) : null}

      {/* Status toggle confirmation */}
      <ConfirmActionDialog
        open={statusTarget !== null}
        title={statusTarget?.isActive ? "Disable this discount code?" : "Enable this discount code?"}
        confirmLabel={statusTarget?.isActive ? "Disable code" : "Enable code"}
        destructive={statusTarget?.isActive}
        submitting={confirmBusy}
        onConfirm={confirmToggleStatus}
        onCancel={() => setStatusTarget(null)}
        description={
          <>
            <p>
              <span className="font-mono font-semibold text-foreground">{statusTarget?.code}</span>{" "}
              {statusTarget ? `— ${formatDiscount(statusTarget)}` : ""}
            </p>
            <p>
              {statusTarget?.isActive
                ? "New checkouts will no longer be able to apply this code."
                : "New checkouts will be able to apply this code again (subject to its schedule)."}
            </p>
            <p>Existing checkout snapshots are not changed.</p>
          </>
        }
      />

      {/* Material-edit confirmation */}
      <ConfirmActionDialog
        open={pendingEdit !== null}
        title="Save changes to an active code?"
        confirmLabel="Save changes"
        submitting={confirmBusy}
        onConfirm={confirmPendingEdit}
        onCancel={() => setPendingEdit(null)}
        description={
          <>
            <p>
              You are editing{" "}
              <span className="font-mono font-semibold text-foreground">{pendingEdit?.code}</span>,
              which is currently active.
            </p>
            <p>New checkouts will use the edited values immediately after saving.</p>
            <p>Existing checkout snapshots are not changed.</p>
          </>
        }
      />
    </div>
  )
}

/** Mirror the form's discountValue string for change detection on edits. */
function formatDiscountValue(code: DiscountCode): string {
  return code.discountType === "fixed" ? (code.discountValue / 100).toFixed(2) : String(code.discountValue)
}
