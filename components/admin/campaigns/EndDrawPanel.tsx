"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Trophy, AlertCircle } from "lucide-react"

export interface ExistingMainWinner {
  id: string
  user_id: string | null
  prize_title: string | null
  announced_at: string | null
}

interface EndDrawPanelProps {
  campaignId: string
  /** Number of issued tickets. Passed in from the server; no client-side scan. */
  ticketsIssued: number
  /** The existing placed = 1 winner, when one exists. */
  existingWinner: ExistingMainWinner | null
}

interface DrawnWinner {
  user_id: string | null
  prize_title: string | null
  winning_ticket: number | null
}

/**
 * Admin panel for a MANUAL end-prize draw.
 *
 * Only rendered by the campaign edit page when the campaign is
 * end_draw_mode = 'manual' AND status = 'ended'. It shows either the
 * "Awaiting End Draw" state with a confirm-gated Draw Winner button, or the
 * winner once one exists.
 */
export function EndDrawPanel({ campaignId, ticketsIssued, existingWinner }: EndDrawPanelProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<DrawnWinner | null>(null)

  const hasWinner = existingWinner !== null || drawn !== null
  const canDraw = !hasWinner && ticketsIssued > 0

  async function handleDraw() {
    setConfirmOpen(false)
    setIsDrawing(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/draw`, { method: "POST" })
      const json = await res.json()

      if (!res.ok || !json.ok) {
        setError(json?.error || `Draw failed (${res.status})`)
        return
      }

      setDrawn({
        user_id: json.winner?.user_id ?? null,
        prize_title: json.winner?.prize_title ?? null,
        winning_ticket: json.winner?.winning_ticket ?? null,
      })
      router.refresh()
    } catch (err: any) {
      setError(err?.message || "Draw failed")
    } finally {
      setIsDrawing(false)
    }
  }

  // ---- Winner already exists (pre-existing or just drawn) ----
  if (hasWinner) {
    const ticket = drawn?.winning_ticket ?? null
    return (
      <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-5 w-5" aria-hidden="true" />
            End Prize Winner Selected
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            The end-prize winner has been selected for{" "}
            <span className="font-medium">
              {existingWinner?.prize_title || drawn?.prize_title || "the end prize"}
            </span>
            .
          </p>
          {ticket !== null ? (
            <p className="text-sm">
              Winning ticket: <span className="font-mono font-medium">#{ticket}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            A competition can only have one end-prize winner, so this cannot be drawn again. Full
            winner details are available on the Winners screen.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ---- Awaiting manual draw ----
  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          Awaiting End Draw
          <Badge variant="outline">Manual Draw</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          This competition has closed without an end-prize winner because it is set to Manual Draw.
          An admin must now draw the winner.
        </p>
        <p className="text-sm">
          Issued tickets:{" "}
          <span className="font-medium">{ticketsIssued.toLocaleString("en-GB")}</span>
        </p>

        {ticketsIssued <= 0 ? (
          <p className="text-sm font-medium">
            No tickets were issued for this competition, so a winner cannot be drawn.
          </p>
        ) : null}

        {error ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button onClick={() => setConfirmOpen(true)} disabled={!canDraw || isDrawing}>
          <Trophy className="mr-2 h-4 w-4" aria-hidden="true" />
          {isDrawing ? "Drawing…" : "Draw Winner"}
        </Button>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Draw the end-prize winner now?</AlertDialogTitle>
              <AlertDialogDescription>
                The winning ticket will be selected at random from the{" "}
                {ticketsIssued.toLocaleString("en-GB")} issued tickets for this competition. Once an
                end-prize winner exists this action cannot be repeated or undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDraw}>Draw Winner</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
