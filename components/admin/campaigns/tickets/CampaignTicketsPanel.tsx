"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CampaignTicketsTable, type CampaignTicket } from "./CampaignTicketsTable"
import { ChevronLeft, ChevronRight, RefreshCw, Download } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const PAGE_SIZE = 100

interface ApiResponse {
  ok: boolean
  tickets?: CampaignTicket[]
  page?: number
  pageSize?: number
  totalTicketsSold?: number
  error?: string
}

export function CampaignTicketsPanel({ campaignId }: { campaignId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const pageParam = Math.max(1, parseInt(searchParams.get("page") || "1", 10))

  const [tickets, setTickets] = useState<CampaignTicket[]>([])
  const [totalTicketsSold, setTotalTicketsSold] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const totalPages = Math.max(1, Math.ceil(totalTicketsSold / PAGE_SIZE))
  const currentPage = Math.min(pageParam, totalPages)

  const fetchTickets = useCallback(
    async (page: number) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/campaigns/${campaignId}/tickets?page=${page}`, {
          cache: "no-store",
        })
        const json: ApiResponse = await res.json()
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Failed to load tickets")
        }
        setTickets(json.tickets ?? [])
        setTotalTicketsSold(json.totalTicketsSold ?? 0)
      } catch (err: any) {
        setError(err?.message || "Something went wrong")
        setTickets([])
      } finally {
        setLoading(false)
      }
    },
    [campaignId],
  )

  useEffect(() => {
    fetchTickets(pageParam)
  }, [fetchTickets, pageParam])

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  // Export runs ONLY on click. The full CSV is streamed to a blob and handed to
  // the browser as a download — it is never held in React state.
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/tickets?format=csv`, {
        cache: "no-store",
      })

      if (!res.ok) {
        let message = "Export failed. Please try again."
        try {
          const json = await res.json()
          if (json?.error) message = json.error
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message)
      }

      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const match = disposition.match(/filename="?([^"]+)"?/i)
      const filename = match?.[1] || "tickets.csv"

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message || "Something went wrong while exporting.",
        variant: "destructive",
      })
    } finally {
      setExporting(false)
    }
  }

  const rangeStart = totalTicketsSold === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = totalTicketsSold === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, totalTicketsSold)

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-56 animate-pulse rounded bg-muted" />
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-5 w-16 animate-pulse rounded bg-muted" />
                <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                <div className="hidden h-4 w-40 animate-pulse rounded bg-muted sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
        <p className="text-sm font-medium text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchTickets(pageParam)} className="bg-transparent">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    )
  }

  // Empty state
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-border px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">No allocated tickets found for this campaign.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Showing tickets <span className="font-medium text-foreground">{rangeStart}</span>–
          <span className="font-medium text-foreground">{rangeEnd}</span> of{" "}
          <span className="font-medium text-foreground">{totalTicketsSold.toLocaleString("en-GB")}</span>
        </p>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="bg-transparent"
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Preparing export…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <CampaignTicketsTable tickets={tickets} />

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="bg-transparent"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="bg-transparent"
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
