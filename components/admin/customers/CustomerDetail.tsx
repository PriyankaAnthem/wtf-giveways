"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Ban, ShieldCheck, Copy, Mail, Phone, CalendarDays, Trophy, AlertTriangle } from "lucide-react"
import type { AdminRole } from "@/lib/admin/permissions"
import { AddCreditDialog, type CreditSuccess } from "@/components/admin/wallets/AddCreditDialog"
import { SelfExcludeDialog } from "@/components/admin/wallets/SelfExcludeDialog"
import { CustomerAvatar } from "./CustomerAvatar"
import { CustomerPurchaseHistory } from "./CustomerPurchaseHistory"
import { CustomerWinningsHistory } from "./CustomerWinningsHistory"
import { RestrictionHistory } from "./RestrictionHistory"
import {
  formatPence,
  formatPenceCompact,
  formatCount,
  formatDate,
  formatUkMobile,
  resolveCustomerName,
} from "./format"

type Customer = {
  user_id: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  real_name: string | null
  email: string | null
  mobile: string | null
  joined: string | null
}
type Balances = { balance_pence: number; reserved_pence: number; available_pence: number }
type Summary = {
  confirmed_order_count: number
  total_order_value_pence: number
  lifetime_external_pence: number
  total_wallet_credit_pence: number
  total_tickets_purchased: number
  first_confirmed_at: string | null
  last_confirmed_at: string | null
}
type WinningsSummary = {
  instant_win_count: number
  main_draw_win_count: number
  total_win_count: number
  cash_win_count: number
  site_credit_win_count: number
  manual_win_count: number
  cash_won_pence: number
  site_credit_won_pence: number
  unpaid_cash_win_count: number
  last_win_at: string | null
}

export function CustomerDetail({ userId, role }: { userId: string; role: AdminRole }) {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [restricted, setRestricted] = useState(false)
  const [balances, setBalances] = useState<Balances>({ balance_pence: 0, reserved_pence: 0, available_pence: 0 })

  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [winnings, setWinnings] = useState<WinningsSummary | null>(null)
  const [winningsError, setWinningsError] = useState<string | null>(null)

  // Bumped to force the restriction history to refetch (after apply/revoke).
  const [restrictionsReloadKey, setRestrictionsReloadKey] = useState(0)

  const fetchAccount = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/customers/${userId}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json?.error === "invalid_identifier" ? "Invalid customer reference." : "Failed to load this customer.")
        return
      }
      setCustomer(json.customer)
      setRestricted(json.restricted === true)
      setBalances(json.balances)
    } catch {
      setError("This customer is temporarily unavailable. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [userId])

  const fetchSummary = useCallback(async () => {
    setSummaryError(null)
    try {
      const res = await fetch(`/api/admin/customers/${userId}/summary`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setSummaryError("Purchase summary is temporarily unavailable.")
        return
      }
      setSummary(json.summary)
    } catch {
      setSummaryError("Purchase summary is temporarily unavailable.")
    }
  }, [userId])

  const fetchWinnings = useCallback(async () => {
    setWinningsError(null)
    try {
      const res = await fetch(`/api/admin/customers/${userId}/winnings-summary`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setWinningsError("Winnings summary is temporarily unavailable.")
        return
      }
      setWinnings(json.summary)
    } catch {
      setWinningsError("Winnings summary is temporarily unavailable.")
    }
  }, [userId])

  useEffect(() => {
    // Independent fetches so a slow secondary section never blocks the header.
    fetchAccount()
    fetchSummary()
    fetchWinnings()
  }, [fetchAccount, fetchSummary, fetchWinnings])

  const handleCredited = useCallback((result: CreditSuccess) => {
    setBalances({
      balance_pence: result.balancePence,
      reserved_pence: result.reservedPence,
      available_pence: result.availablePence,
    })
  }, [])

  const handleExcluded = useCallback(() => {
    // Optimistically reflect, then re-confirm from the authoritative endpoint.
    setRestricted(true)
    fetchAccount()
    setRestrictionsReloadKey((k) => k + 1)
  }, [fetchAccount])

  const handleRestrictionChanged = useCallback(() => {
    // A revoke happened inside the history list — re-confirm the header status.
    fetchAccount()
  }, [fetchAccount])

  const copyUserId = async () => {
    try {
      await navigator.clipboard.writeText(userId)
      toast({ title: "User ID copied" })
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" })
    }
  }

  if (loading && !customer) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error && !customer) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 py-16 text-center text-destructive">
        {error}
      </div>
    )
  }

  const name = customer ? resolveCustomerName(customer) : "Unknown customer"

  return (
    <div className="space-y-6">
      {/* 1 — IDENTITY HERO */}
      <Card>
        <CardContent className="flex flex-col gap-6 py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <CustomerAvatar name={name} seed={userId} size="lg" />
            <div className="min-w-0 space-y-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-balance">{name}</h1>
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="inline-flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                  {customer?.email || "No email on file"}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                  {customer?.mobile ? formatUkMobile(customer.mobile) : "No mobile on file"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span>User ID</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{userId}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={copyUserId}
                    aria-label="Copy user ID"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  Joined {formatDate(customer?.joined ?? null)}
                </span>
              </div>
            </div>
          </div>

          <div className="shrink-0">
            {restricted ? (
              <div className="flex flex-col items-start gap-1 lg:items-end">
                <Badge variant="destructive" className="gap-1 uppercase tracking-wide">
                  <Ban className="size-3.5" aria-hidden="true" />
                  Self-Excluded
                </Badge>
                <span className="text-xs font-semibold uppercase tracking-wide text-destructive">
                  Purchasing disabled
                </span>
              </div>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-500/30 bg-emerald-500/10 uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Active
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2 — COMMERCIAL SUMMARY */}
      <section aria-label="Commercial summary" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commercial</h2>
        {summaryError ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">{summaryError}</CardContent>
          </Card>
        ) : !summary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Total Order Value" value={formatPence(summary.total_order_value_pence)} emphasis />
              <Stat label="Cash Paid" value={formatPence(summary.lifetime_external_pence)} />
              <Stat label="Orders" value={formatCount(summary.confirmed_order_count)} />
              <Stat label="Tickets" value={formatCount(summary.total_tickets_purchased)} />
            </div>
            <p className="text-sm text-muted-foreground">
              Site credit used:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatPence(summary.total_wallet_credit_pence)}
              </span>
              {summary.first_confirmed_at && <> · First purchase {formatDate(summary.first_confirmed_at)}</>}
              {summary.last_confirmed_at && <> · Last purchase {formatDate(summary.last_confirmed_at)}</>}
            </p>
          </div>
        )}
      </section>

      {/* 3 — WINNINGS SUMMARY */}
      <section aria-label="Winnings summary" className="space-y-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Trophy className="size-4 text-amber-500" aria-hidden="true" />
          Winnings
        </h2>
        {winningsError ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">{winningsError}</CardContent>
          </Card>
        ) : !winnings ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : winnings.total_win_count === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              This customer has not won anything yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {winnings.unpaid_cash_win_count > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                {formatCount(winnings.unpaid_cash_win_count)} cash{" "}
                {winnings.unpaid_cash_win_count === 1 ? "win" : "wins"} awaiting payout
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Stat label="Total Wins" value={formatCount(winnings.total_win_count)} emphasis />
              <Stat label="Cash Won" value={formatPenceCompact(winnings.cash_won_pence)} />
              <Stat label="Site Credit Won" value={formatPenceCompact(winnings.site_credit_won_pence)} />
              <Stat label="Cash Wins" value={formatCount(winnings.cash_win_count)} />
              <Stat label="Credit Wins" value={formatCount(winnings.site_credit_win_count)} />
              <Stat label="Draw Wins" value={formatCount(winnings.main_draw_win_count)} />
            </div>
          </div>
        )}
      </section>

      {/* 4 — PURCHASE HISTORY (independent, paginated) */}
      <CustomerPurchaseHistory userId={userId} />

      {/* 5 — WINNINGS HISTORY (independent, paginated) */}
      <CustomerWinningsHistory userId={userId} />

      {/* 6 — WALLET & CREDIT (reuses existing Add Credit dialog + endpoint) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>Wallet &amp; Credit</CardTitle>
          {customer && (
            <AddCreditDialog
              userId={customer.user_id}
              customerName={name}
              customerEmail={customer.email ?? ""}
              onCredited={handleCredited}
            />
          )}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Metric label="Available balance" value={formatPence(balances.available_pence)} emphasis />
          <Metric label="Total balance" value={formatPence(balances.balance_pence)} />
          <Metric label="Reserved" value={formatPence(balances.reserved_pence)} />
        </CardContent>
      </Card>

      {/* 7 — ACCOUNT & CONTACT */}
      <Card>
        <CardHeader>
          <CardTitle>Account &amp; Contact</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <Field label="First name" value={customer?.first_name || "—"} />
            <Field label="Last name" value={customer?.last_name || "—"} />
            <Field label="Email" value={customer?.email || "No email on file"} />
            <Field
              label="Mobile"
              value={customer?.mobile ? formatUkMobile(customer.mobile) : "No mobile on file"}
            />
            <Field label="Joined" value={formatDate(customer?.joined ?? null)} />
            <Field label="Account status" value={restricted ? "Self-excluded" : "Active"} />
          </dl>
        </CardContent>
      </Card>

      {/* 8 — ACCOUNT RESTRICTIONS (self-exclusion action is admin-only) */}
      <Card className={restricted ? "border-destructive/40 bg-destructive/5" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {restricted ? (
              <Ban className="size-5 text-destructive" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            )}
            Account Restrictions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {restricted ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge variant="destructive" className="uppercase tracking-wide">
                  Self-Excluded
                </Badge>
                <span className="text-sm font-semibold uppercase tracking-wide text-destructive">
                  Purchasing disabled
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                This customer cannot make new purchases. Existing entries, winnings, purchase history and wallet balance
                are unaffected.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">This customer is active and can make purchases.</p>
              {/* Self-exclusion is a Super-Admin-only action. Operations Admins
                  see the status but no actionable control. */}
              {role === "admin" && customer && (
                <SelfExcludeDialog userId={customer.user_id} customerName={name} onExcluded={handleExcluded} />
              )}
            </div>
          )}

          {/* Restriction history (active + revoked). The remove action inside
              is Super-Admin-only and only for admin-originated active rows. */}
          <div className="space-y-3 border-t pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Restriction History
            </h3>
            <RestrictionHistory
              userId={userId}
              role={role}
              customerName={name}
              reloadKey={restrictionsReloadKey}
              onChanged={handleRestrictionChanged}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${emphasis ? "border-primary/30 bg-primary/5" : "bg-card"}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 tabular-nums ${emphasis ? "text-2xl font-bold" : "text-xl font-semibold"}`}>{value}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${emphasis ? "text-2xl font-bold" : "text-xl font-semibold"}`}>{value}</dd>
    </div>
  )
}
