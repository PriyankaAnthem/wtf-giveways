"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, ChevronLeft, ChevronRight, ShieldCheck, Ban } from "lucide-react"
import { AddCreditDialog, type CreditSuccess } from "./AddCreditDialog"
import { SelfExcludeDialog } from "./SelfExcludeDialog"

type Customer = { user_id: string; name: string; email: string; mobile: string | null }
type Balances = { balance_pence: number; reserved_pence: number; available_pence: number }
type Transaction = {
  id: string
  transaction_type: string
  amount_pence: number
  balance_after_pence: number
  source_award_id: string | null
  source_checkout_intent_id: string | null
  admin_user_id: string | null
  admin_email: string | null
  reason: string | null
  idempotency_key: string | null
  internal_reference: string | null
  created_at: string
}
type Reservation = {
  id: string
  checkout_intent_id: string | null
  amount_pence: number
  status: string
  expires_at: string | null
  captured_at: string | null
  released_at: string | null
  release_reason: string | null
  created_at: string
}

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`
}

function formatSignedPence(pence: number): string {
  const sign = pence >= 0 ? "+" : "-"
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const TX_TYPE_LABELS: Record<string, string> = {
  instant_win_credit: "Instant win credit",
  admin_credit: "Admin credit",
  admin_debit: "Admin debit",
  order_spend: "Order spend",
  refund_credit: "Refund credit",
  reversal: "Reversal",
}

function txTypeLabel(type: string): string {
  return TX_TYPE_LABELS[type] ?? type
}

function reservationBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "active":
      return "default"
    case "captured":
      return "secondary"
    case "released":
      return "outline"
    case "expired":
      return "destructive"
    default:
      return "outline"
  }
}

// Customer-friendly labels for the stored (unchanged) reservation statuses.
// The underlying values in the database are never modified.
function holdStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active hold"
    case "captured":
      return "Used"
    case "released":
      return "Released"
    case "expired":
      return "Expired"
    default:
      return status
  }
}

// Single "completed or expiry" timestamp per hold: when it was used/released we
// show that moment; otherwise we show when the hold expires.
function holdCompletedOrExpiry(r: Reservation): string {
  if (r.status === "captured") return formatDateTime(r.captured_at)
  if (r.status === "released") return formatDateTime(r.released_at)
  return formatDateTime(r.expires_at)
}

export function WalletDetail({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [restricted, setRestricted] = useState(false)
  const [balances, setBalances] = useState<Balances>({ balance_pence: 0, reserved_pence: 0, available_pence: 0 })
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/wallets/${userId}?page=${page}&limit=50`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error === "invalid_identifier" ? "Invalid customer reference." : "Failed to load wallet.")
        return
      }
      setCustomer(json.customer)
      setRestricted(json.restricted === true)
      setBalances(json.balances)
      setTransactions(json.transactions ?? [])
      setHasNext(json.transactionsHasNext ?? false)
      setReservations(json.reservations ?? [])
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [userId, page])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const handleCredited = useCallback(
    (result: CreditSuccess) => {
      // Update visible balances immediately from the validated RPC response.
      setBalances({
        balance_pence: result.balancePence,
        reserved_pence: result.reservedPence,
        available_pence: result.availablePence,
      })
      // Refresh the ledger from the first page so the new entry appears.
      if (page !== 1) {
        setPage(1)
      } else {
        fetchDetail()
      }
    },
    [page, fetchDetail],
  )

  const handleExcluded = useCallback(() => {
    // Optimistically reflect the new status, then re-fetch to confirm from the
    // server (which reads the authoritative restriction).
    setRestricted(true)
    fetchDetail()
  }, [fetchDetail])

  if (loading && !customer) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error && !customer) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-destructive">{error}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Name:</dt>
              <dd className="font-medium">{customer?.name ?? "Unknown"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Email:</dt>
              <dd>{customer?.email ?? "-"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Mobile:</dt>
              <dd>{customer?.mobile ?? "-"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">User ID:</dt>
              <dd className="font-mono text-xs">{customer?.user_id}</dd>
            </div>
          </dl>
          {customer && (
            <AddCreditDialog
              userId={customer.user_id}
              customerName={customer.name}
              customerEmail={customer.email}
              onCredited={handleCredited}
            />
          )}
        </CardContent>
      </Card>

      {/* Account status — self-exclusion / purchasing restriction. Kept
          visually distinct from the ordinary wallet actions below. */}
      {restricted ? (
        <Card className="border-destructive bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" aria-hidden="true" />
              Account status
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Badge variant="destructive" className="uppercase tracking-wide">
              Self-excluded
            </Badge>
            <span className="text-sm font-semibold uppercase tracking-wide text-destructive">
              Purchasing disabled
            </span>
            <p className="w-full text-sm text-muted-foreground">
              This customer cannot make new purchases. Existing entries, winnings, transaction history and wallet
              balance are unaffected.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Account status
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="uppercase tracking-wide">
                Active
              </Badge>
              <span className="text-sm text-muted-foreground">This customer can make purchases.</span>
            </div>
            {customer && (
              <SelfExcludeDialog userId={customer.user_id} customerName={customer.name} onExcluded={handleExcluded} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Balance cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total WTF Credit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatPence(balances.balance_pence)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reserved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatPence(balances.reserved_pence)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatPence(balances.available_pence)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">No transactions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => {
                  const source = t.source_award_id
                    ? `Award ${t.source_award_id.slice(0, 8)}`
                    : t.source_checkout_intent_id
                      ? `Checkout ${t.source_checkout_intent_id.slice(0, 8)}`
                      : t.internal_reference
                        ? t.internal_reference
                        : "-"
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap font-medium">{txTypeLabel(t.transaction_type)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          t.amount_pence >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                        }`}
                      >
                        {formatSignedPence(t.amount_pence)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPence(t.balance_after_pence)}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={t.reason ?? undefined}>
                        {t.reason ?? "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{source}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{t.admin_email ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(t.created_at)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transactions pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {transactions.length} transaction{transactions.length === 1 ? "" : "s"} (Page {page})
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || loading}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Checkout credit holds (read-only) — kept secondary, beneath the wallet
          balance and transaction history. Displays customer-friendly labels
          for the underlying (unchanged) reservation statuses. */}
      <Card>
        <CardHeader>
          <CardTitle>Checkout credit holds</CardTitle>
          <p className="text-sm text-muted-foreground">
            Credit is temporarily held when a customer starts checkout. It is either used when payment completes or
            released automatically if checkout is abandoned.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {reservations.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">No checkout credit holds.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Checkout reference</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Completed / expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant={reservationBadgeVariant(r.status)}>{holdStatusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPence(r.amount_pence)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.checkout_intent_id ? r.checkout_intent_id.slice(0, 8) : "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(r.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {holdCompletedOrExpiry(r)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
