"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { CHANNELS, CHANNEL_VALUES } from "@/lib/marketing/attribution"
import { channelLabel, friendlyError, type TrackingLink } from "@/lib/marketing/linkDisplay"
import type { Affiliate } from "@/lib/marketing/affiliateDisplay"
import { LinksTable } from "@/components/admin/marketing/links/LinksTable"
import {
  LinkFormDialog,
  type Competition,
  type LinkPayload,
  type SubmitResult,
} from "@/components/admin/marketing/links/LinkFormDialog"
import { ConfirmActionDialog } from "@/components/admin/discount-codes/ConfirmActionDialog"

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const json = await r.json().catch(() => ({}))
    if (!r.ok || json?.ok === false) {
      throw new Error(json?.error || "load_failed")
    }
    return json
  })

type StatusFilter = "all" | "active" | "disabled"
type ChannelFilter = "all" | string

/**
 * Admin Tracking Links manager — the Marketing → Links tab.
 *
 * Read/create/edit/enable/disable over `/api/admin/marketing/links` (admin-only,
 * service-role). Attribution-defining fields are immutable on edit; disabling a
 * link only stops it resolving at /t and never rewrites captured checkout
 * snapshots (mirrors the discount-codes safety copy).
 */
export function LinksManager() {
  const { toast } = useToast()
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; items: TrackingLink[] }>(
    "/api/admin/marketing/links",
    fetcher,
  )
  const links = data?.items ?? []

  // Live competitions available as friendly destinations (read-only helper).
  const { data: destData } = useSWR<{ ok: boolean; items: Competition[] }>(
    "/api/admin/marketing/link-destinations",
    fetcher,
  )
  const competitions = destData?.items ?? []
  const titlesBySlug = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of competitions) map[c.slug] = c.title
    return map
  }, [competitions])

  // Active affiliates for the create picker. Only active ones may be attached to
  // a NEW link; the server re-checks this. A failure here is non-fatal — the
  // picker simply shows "None" only.
  const { data: affData } = useSWR<{ ok: boolean; items: Affiliate[] }>(
    "/api/admin/marketing/affiliates?active=1",
    fetcher,
  )
  const affiliates = affData?.items ?? []

  // The browser origin, resolved after mount, for building copyable short links.
  const [origin, setOrigin] = useState("")
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin)
  }, [])

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all")
  // Optional deep-link filter from the Affiliates page (?affiliate=<uuid>).
  const [affiliateFilter, setAffiliateFilter] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === "undefined") return
    const id = new URLSearchParams(window.location.search).get("affiliate")
    if (id) setAffiliateFilter(id)
  }, [])
  // Friendly name for the active affiliate filter, resolved from the loaded links.
  const affiliateFilterName = useMemo(() => {
    if (!affiliateFilter) return null
    const hit = links.find((l) => l.affiliateId === affiliateFilter)
    return hit?.affiliateName ?? null
  }, [affiliateFilter, links])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TrackingLink | null>(null)

  const [statusTarget, setStatusTarget] = useState<TrackingLink | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return links.filter((l) => {
      if (
        q &&
        !l.label.toLowerCase().includes(q) &&
        !l.code.toLowerCase().includes(q) &&
        !l.campaign.toLowerCase().includes(q)
      ) {
        return false
      }
      if (statusFilter === "active" && !l.isActive) return false
      if (statusFilter === "disabled" && l.isActive) return false
      if (channelFilter !== "all" && l.channel !== channelFilter) return false
      if (affiliateFilter && l.affiliateId !== affiliateFilter) return false
      return true
    })
  }, [links, search, statusFilter, channelFilter, affiliateFilter])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(link: TrackingLink) {
    setEditing(link)
    setFormOpen(true)
  }

  async function persist(payload: LinkPayload): Promise<SubmitResult> {
    const method = payload.id ? "PUT" : "POST"
    try {
      const res = await fetch("/api/admin/marketing/links", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false || !json?.item) {
        return { ok: false, error: json?.error || "save_failed" }
      }
      await mutate()
      toast({
        title: payload.id ? "Tracking link updated" : "Tracking link created",
        description: `${payload.label} saved successfully.`,
      })
      return { ok: true, item: json.item as TrackingLink }
    } catch {
      return { ok: false, error: "save_failed" }
    }
  }

  async function handleFormSubmit(payload: LinkPayload): Promise<SubmitResult> {
    const result = await persist(payload)
    // On edit, close immediately; on create, keep the dialog open so it can show
    // the success panel with the generated tracking link.
    if (result.ok && payload.id) setFormOpen(false)
    return result
  }

  async function confirmToggleStatus() {
    if (!statusTarget) return
    setConfirmBusy(true)
    try {
      const res = await fetch("/api/admin/marketing/links", {
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
        title: statusTarget.isActive ? "Tracking link disabled" : "Tracking link enabled",
        description: `${statusTarget.label} updated.`,
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
      {/* Deep-link filter from the Affiliates page. */}
      {affiliateFilter && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            Showing links for affiliate{" "}
            <span className="font-medium text-foreground">
              {affiliateFilterName ?? "selected affiliate"}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setAffiliateFilter(null)}>
            Clear
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search links"
              className="pl-9"
              aria-label="Search tracking links"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="sm:w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={(v) => setChannelFilter(v)}>
            <SelectTrigger className="sm:w-44" aria-label="Filter by channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {CHANNEL_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CHANNELS[c].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create tracking link
        </Button>
      </div>

      {/* States */}
      {isLoading ? (
        <Card className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading tracking links…</span>
        </Card>
      ) : error ? (
        <Card className="space-y-3 py-12 text-center">
          <p className="text-sm text-destructive">{friendlyError((error as Error).message)}</p>
          <Button variant="outline" onClick={() => mutate()} className="bg-transparent">
            Try again
          </Button>
        </Card>
      ) : links.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No tracking links yet. Create one to start attributing traffic.
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No tracking links match the current filters.</p>
        </Card>
      ) : (
        <LinksTable
          links={filtered}
          origin={origin}
          titlesBySlug={titlesBySlug}
          onEdit={openEdit}
          onToggleStatus={setStatusTarget}
        />
      )}

      {/* Create / edit form */}
      <LinkFormDialog
        open={formOpen}
        editing={editing}
        origin={origin}
        competitions={competitions}
        affiliates={affiliates}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      {/* Enable / disable confirmation */}
      <ConfirmActionDialog
        open={statusTarget !== null}
        title={statusTarget?.isActive ? "Disable this tracking link?" : "Enable this tracking link?"}
        confirmLabel={statusTarget?.isActive ? "Disable link" : "Enable link"}
        destructive={statusTarget?.isActive}
        submitting={confirmBusy}
        onConfirm={confirmToggleStatus}
        onCancel={() => setStatusTarget(null)}
        description={
          <>
            <p>
              <span className="font-semibold text-foreground">{statusTarget?.label}</span>{" "}
              {statusTarget ? `(${channelLabel(statusTarget.channel)})` : ""}
            </p>
            <p>
              {statusTarget?.isActive
                ? "The short link will stop resolving and new clicks will land on the homepage."
                : "The short link will resolve again and attribute new clicks."}
            </p>
            <p>Attribution already captured on existing checkouts is not changed.</p>
          </>
        }
      />
    </div>
  )
}
