"use client"

import { useState } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  type Affiliate,
  friendlyAffiliateError,
} from "@/lib/marketing/affiliateDisplay"
import { AffiliatesTable } from "@/components/admin/marketing/affiliates/AffiliatesTable"
import {
  AffiliateFormDialog,
  type AffiliatePayload,
  type SubmitResult,
} from "@/components/admin/marketing/affiliates/AffiliateFormDialog"

const AFFILIATES_KEY = "/api/admin/marketing/affiliates"

async function fetcher(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error("load_failed")
  return res.json()
}

/**
 * Client controller for the Affiliates admin page: lists affiliates, opens the
 * create/edit dialog, and toggles active state. Mirrors LinksManager. All
 * writes revalidate the list AND the active-only key used by the tracking-link
 * picker, so a newly created / (de)activated affiliate shows up correctly in
 * both places.
 */
export function AffiliatesManager() {
  const { data, error, isLoading } = useSWR<{ ok: boolean; items: Affiliate[] }>(
    AFFILIATES_KEY,
    fetcher,
  )
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Affiliate | null>(null)

  const affiliates = data?.items ?? []

  function revalidate() {
    void globalMutate(AFFILIATES_KEY)
    // The tracking-link picker reads the active-only key.
    void globalMutate(`${AFFILIATES_KEY}?active=1`)
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(a: Affiliate) {
    setEditing(a)
    setFormOpen(true)
  }

  async function handleSubmit(payload: AffiliatePayload): Promise<SubmitResult> {
    const isEdit = Boolean(payload.id)
    try {
      const res = await fetch(AFFILIATES_KEY, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        return { ok: false, error: friendlyAffiliateError(json?.error) }
      }
      revalidate()
      // The API echoes the saved row as `item`; SubmitResult requires it.
      return { ok: true, item: json.item as Affiliate }
    } catch {
      return { ok: false, error: friendlyAffiliateError("save_failed") }
    }
  }

  async function handleToggleActive(a: Affiliate): Promise<void> {
    try {
      const res = await fetch(AFFILIATES_KEY, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, isActive: !a.isActive }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.ok) revalidate()
    } catch {
      // Non-fatal; the row simply stays as-is and SWR keeps the prior value.
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add affiliate
        </Button>
      </div>

      <AffiliatesTable
        affiliates={affiliates}
        loading={isLoading}
        loadError={error ? friendlyAffiliateError("load_failed") : null}
        onEdit={openEdit}
        onToggleActive={handleToggleActive}
      />

      <AffiliateFormDialog
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
