"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, RefreshCw } from "lucide-react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface LiveCampaign {
  id: string
  title: string
  slug: string
  status: string
  presentationType: string | null
  boardExists: boolean
  boardEnabled: boolean
  totalRemaining: number | null
}

function presentationLabel(type: string | null): string {
  if (type === "balloon_pop") return "Balloon Pop"
  if (type === "instant_cash") return "Instant Cash"
  if (!type) return "Standard"
  return type
}

export function LiveCampaignPicker() {
  const [campaigns, setCampaigns] = useState<LiveCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchCampaigns() {
    try {
      const res = await fetch("/api/admin/live-feed/campaigns")
      const data = await res.json()
      if (data.ok) {
        setCampaigns(data.campaigns)
        setError(null)
      } else {
        setError(data.error || "Failed to load live campaigns")
      }
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    // Fetch once on mount. No interval here — this picker stays lightweight;
    // the live control screen does the (admin-only) polling.
    fetchCampaigns()
  }, [])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Unable to load live campaigns: {error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshing(true)
            fetchCampaigns()
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    )
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">No campaigns are live right now.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            setRefreshing(true)
            fetchCampaigns()
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true)
            fetchCampaigns()
          }}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c) => (
          <Card key={c.id} className="flex flex-col">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-balance text-lg leading-tight">{c.title}</CardTitle>
                <Badge variant="secondary" className="shrink-0 uppercase">
                  {c.status}
                </Badge>
              </div>
              <p className="font-mono text-xs text-muted-foreground">/{c.slug}</p>
            </CardHeader>

            <CardContent className="flex-1 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{presentationLabel(c.presentationType)}</Badge>
                {c.boardExists ? (
                  <Badge
                    variant="outline"
                    className={
                      c.boardEnabled
                        ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                    }
                  >
                    {c.boardEnabled ? "Board enabled" : "Board off"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No board
                  </Badge>
                )}
              </div>

              {c.boardExists && (
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Balloons left</p>
                  <p className="text-2xl font-bold tabular-nums">{c.totalRemaining ?? 0}</p>
                </div>
              )}
            </CardContent>

            <CardFooter>
              <Button asChild className="w-full">
                <Link href={`/admin/live-feed/${c.id}`}>
                  Open Live Control
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
