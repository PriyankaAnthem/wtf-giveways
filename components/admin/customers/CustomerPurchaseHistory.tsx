"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react"
import { formatPence, formatDateTime, formatTicketRange } from "./format"

type Order = {
  checkout_intent_id: string | null
  checkout_ref: string | null
  created_at: string | null
  confirmed_at: string | null
  campaign_id: string | null
  campaign_title: string | null
  qty: number
  total_pence: number
  cash_paid_pence: number
  wallet_credit_pence: number
  currency: string | null
  provider: string | null
  provider_status: string | null
  checkout_state: string | null
  start_ticket: number | null
  end_ticket: number | null
}

const PAGE_SIZE = 25

/**
 * checkout_state is the AUTHORITATIVE order status (§31). A confirmed order
 * stays CONFIRMED even when provider_status is diagnostic noise like
 * "tds_expired". We never downgrade to FAILED based on provider_status.
 */
function statusClass(state: string | null): string {
  if (state === "confirmed" || state === "completed") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  }
  if (state === "failed" || state === "cancelled" || state === "expired") {
    return "border-destructive/30 bg-destructive/10 text-destructive"
  }
  return "border-border bg-muted text-muted-foreground"
}

function formatState(state: string | null): string {
  if (!state) return "—"
  return state.charAt(0).toUpperCase() + state.slice(1).replace(/_/g, " ")
}

/**
 * Tertiary provider DIAGNOSTIC only. Shows the funding provider + its raw
 * provider_status verbatim (e.g. "Acquired · tds expired") — never invents a
 * "settled" state. A fully wallet-funded order shows "Site credit".
 */
function formatProvider(provider: string | null, providerStatus: string | null, cashPaidPence: number): string {
  if (!provider) return cashPaidPence <= 0 ? "Site credit" : "—"
  const label = provider.charAt(0).toUpperCase() + provider.slice(1)
  return providerStatus ? `${label} · ${providerStatus.replace(/_/g, " ")}` : label
}

export function CustomerPurchaseHistory({ userId }: { userId: string }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [offset, setOffset] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const res = await fetch(`/api/admin/customers/${userId}/orders?limit=${PAGE_SIZE}&offset=${offset}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (requestId !== requestIdRef.current) return
        if (!res.ok || !json.ok) {
          setError("Purchase history is temporarily unavailable.")
          setOrders([])
          setHasNext(false)
          return
        }
        setOrders(json.orders ?? [])
        setHasNext(json.hasNext === true)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setError("Purchase history is temporarily unavailable.")
        setOrders([])
        setHasNext(false)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [userId, offset])

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-5 text-muted-foreground" aria-hidden="true" />
          Purchase history
        </CardTitle>
        <p className="text-sm text-muted-foreground">Confirmed purchases only.</p>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="py-12 text-center text-destructive">{error}</p>
        ) : loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : orders.length === 0 && offset === 0 ? (
          <p className="py-12 text-center text-muted-foreground">This customer has not made any purchases yet.</p>
        ) : (
          <ul className="divide-y">
            {orders.map((o) => (
              <li
                key={o.checkout_intent_id ?? `${o.checkout_ref}-${o.created_at}`}
                className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-start lg:justify-between"
              >
                {/* Primary: competition, date, tickets */}
                <div className="min-w-0 space-y-0.5 lg:flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{o.campaign_title ?? "—"}</span>
                    <Badge variant="outline" className={`uppercase tracking-wide ${statusClass(o.checkout_state)}`}>
                      {formatState(o.checkout_state)}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">{formatDateTime(o.confirmed_at ?? o.created_at)}</div>
                  <div className="text-sm text-muted-foreground tabular-nums">
                    {o.qty} {o.qty === 1 ? "ticket" : "tickets"}
                    {(o.start_ticket !== null || o.end_ticket !== null) && (
                      <>
                        {" "}
                        <span className="text-muted-foreground/70">
                          ({formatTicketRange(o.start_ticket, o.end_ticket)})
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Money */}
                <div className="grid grid-cols-3 gap-x-6 gap-y-0.5 text-sm lg:w-[280px] lg:shrink-0 lg:text-right">
                  <Money label="Order" value={formatPence(o.total_pence)} strong />
                  <Money label="Cash" value={formatPence(o.cash_paid_pence)} />
                  <Money label="Credit" value={formatPence(o.wallet_credit_pence)} />
                </div>

                {/* Tertiary diagnostics */}
                <div className="space-y-0.5 text-xs text-muted-foreground lg:w-[180px] lg:shrink-0 lg:text-right">
                  {o.checkout_ref && <div className="truncate font-mono">{o.checkout_ref}</div>}
                  <div>{formatProvider(o.provider, o.provider_status, o.cash_paid_pence)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {!error && (orders.length > 0 || offset > 0) && (
        <div className="flex items-center justify-between border-t px-6 py-3">
          <p className="text-sm text-muted-foreground">Page {pageNumber}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasNext || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Money({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className={`tabular-nums ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {value}
      </div>
    </div>
  )
}
