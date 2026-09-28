"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react"
import type { BigWinDTO } from "@/lib/big-wins"
import { formatTicket, formatWonOn } from "@/lib/big-wins"
import { BigWinFormDialog } from "./BigWinFormDialog"
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

export function BigWinsManager() {
  const { toast } = useToast()
  const [items, setItems] = useState<BigWinDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BigWinDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BigWinDTO | null>(null)
  const [reordering, setReordering] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch("/api/admin/big-wins", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load_failed")
      setItems(json.items as BigWinDTO[])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (item: BigWinDTO) => {
    setEditing(item)
    setDialogOpen(true)
  }

  const handleSaved = (item: BigWinDTO) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id)
      if (idx === -1) return [...prev, item]
      const next = [...prev]
      next[idx] = item
      return next
    })
    setDialogOpen(false)
    void load() // re-sort by the canonical server order
  }

  const toggleActive = async (item: BigWinDTO) => {
    const nextActive = !item.isActive
    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, isActive: nextActive } : p)))
    try {
      const res = await fetch("/api/admin/big-wins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, isActive: nextActive }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error()
    } catch {
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, isActive: item.isActive } : p)))
      toast({ title: "Could not update visibility", variant: "destructive" })
    }
  }

  const persistOrder = async (ordered: BigWinDTO[]) => {
    setReordering(true)
    try {
      const res = await fetch("/api/admin/big-wins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ordered.map((o) => o.id) }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error()
    } catch {
      toast({ title: "Could not save order", variant: "destructive" })
      void load()
    } finally {
      setReordering(false)
    }
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next.map((it, i) => ({ ...it, displayOrder: i })))
    void persistOrder(next)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    try {
      const res = await fetch(`/api/admin/big-wins?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error()
      setItems((prev) => prev.filter((p) => p.id !== id))
      toast({ title: "Big Win deleted" })
    } catch {
      toast({ title: "Could not delete", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${items.length} card${items.length === 1 ? "" : "s"}`}
          {reordering ? " · saving order…" : ""}
        </p>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1.5 size-4" />
          Add Big Win
        </Button>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
          <p className="mb-3 text-destructive">Could not load Big Wins.</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No Big Wins yet. Add your first curated winner to feature it on the Winners page.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => {
            const ticket = formatTicket(item.ticketNumber)
            return (
              <li
                key={item.id}
                className="flex items-center gap-4 rounded-lg border bg-card p-3 shadow-sm"
              >
                {/* Reorder */}
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Move up"
                    disabled={index === 0 || reordering}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Move down"
                    disabled={index === items.length - 1 || reordering}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </div>

                {/* Portrait thumbnail with admin crop applied */}
                <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl || "/placeholder.svg"}
                    alt={`${item.winnerName} winner photo`}
                    className="h-full w-full object-cover"
                    style={{ objectPosition: `${item.imagePosX}% ${item.imagePosY}%` }}
                  />
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{item.prizeText}</span>
                    {!item.isActive && (
                      <Badge variant="outline" className="shrink-0 text-muted-foreground">
                        Hidden
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {item.winnerName} · {item.competition}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatWonOn(item.wonOn)}
                    {ticket ? ` · ${ticket}` : ""}
                  </p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={item.isActive}
                      onCheckedChange={() => void toggleActive(item)}
                      aria-label={item.isActive ? "Hide" : "Show"}
                    />
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {item.isActive ? "Live" : "Hidden"}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(item)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <BigWinFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={handleSaved}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Big Win?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.prizeText}" (${deleteTarget.winnerName}) will be permanently removed from the Winners page.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
