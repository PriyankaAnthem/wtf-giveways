'use client'

import { useState, useTransition } from 'react'
import { PayoutActionButtons } from './PayoutActionButtons'
import { bulkUpdatePayoutStatus } from './actions'

interface PayoutRow {
  id: string
  created_at: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  tiktok_username: string | null
  order_reference: string | null
  phone: string | null
  email: string | null
  amount_claimed_pence: number | null
  payout_account_holder_name: string | null
  payout_sort_code: string | null
  payout_account_number: string | null
  status: string | null
  status_updated_at: string | null
  message: string | null
}

interface PayoutTableProps {
  payouts: PayoutRow[]
  statusFilter?: string
}

export function PayoutTable({ payouts, statusFilter }: PayoutTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Show the dedicated Paid date column on the Paid tab (and on "all",
  // where paid rows can appear). Keeps other tabs unchanged.
  const showPaidDate = statusFilter === 'paid' || statusFilter === 'all'

  const allSelected = payouts.length > 0 && selectedIds.size === payouts.length
  const someSelected = selectedIds.size > 0

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(payouts.map(p => p.id)))
    }
  }

  function toggleSelect(id: string) {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
  }

  function handleBulkMarkPaid() {
    const count = selectedIds.size
    if (count === 0) return

    const totalPence = payouts
      .filter((p) => selectedIds.has(p.id))
      .reduce((sum, p) => sum + (p.amount_claimed_pence || 0), 0)

    if (
      !window.confirm(
        `Mark ${count} selected payout record${count > 1 ? 's' : ''} as paid?\n\nTotal payout value: ${formatPence(totalPence)}`,
      )
    ) {
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await bulkUpdatePayoutStatus([...selectedIds], 'paid')
      if (!result.ok) {
        setError(result.error || 'Bulk update failed')
      } else {
        setSelectedIds(new Set())
      }
    })
  }

  function formatPence(pence: number | null): string {
    if (pence == null) return "—"
    return `£${(pence / 100).toFixed(2)}`
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—"
    return new Date(dateStr).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getDisplayName(row: PayoutRow): string {
    if (row.first_name && row.last_name) {
      return `${row.first_name} ${row.last_name}`
    }
    return row.full_name || "—"
  }

  function getTikTokUsername(row: PayoutRow): string {
    return row.tiktok_username || row.order_reference || "—"
  }

  function getStatusBadgeClass(status: string | null): string {
    switch (status) {
      case "new":
        return "bg-yellow-100 text-yellow-800"
      case "paid":
        return "bg-green-100 text-green-800"
      case "problem":
        return "bg-red-100 text-red-800"
      default:
        return "bg-yellow-100 text-yellow-800"
    }
  }

  function getStatusLabel(status: string | null): string {
    switch (status) {
      case "new":
        return "New"
      case "paid":
        return "Paid"
      case "problem":
        return "Problem"
      default:
        return "New"
    }
  }

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 rounded-lg border bg-blue-50 px-4 py-2">
          <span className="text-sm font-medium text-blue-700">
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleBulkMarkPaid}
            disabled={isPending}
            className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? 'Updating...' : 'Mark selected as paid'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={isPending}
            className="rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            Clear selection
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}

      {/* Table */}
      <div className="w-full overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-[1500px] w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="whitespace-nowrap px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  title={allSelected ? "Deselect all" : "Select all on page"}
                />
              </th>
              <th className="whitespace-nowrap px-3 py-2">Date</th>
              <th className="whitespace-nowrap px-3 py-2">Status</th>
              <th className="whitespace-nowrap px-3 py-2">Name</th>
              <th className="whitespace-nowrap px-3 py-2">TikTok</th>
              <th className="whitespace-nowrap px-3 py-2">Claimed</th>
              <th className="whitespace-nowrap px-3 py-2">Mobile</th>
              <th className="whitespace-nowrap px-3 py-2">Email</th>
              <th className="whitespace-nowrap px-3 py-2">Acc Holder</th>
              <th className="whitespace-nowrap px-3 py-2">Sort Code</th>
              <th className="whitespace-nowrap px-3 py-2">Acc No</th>
              {showPaidDate && <th className="whitespace-nowrap px-3 py-2">Paid date</th>}
              <th className="whitespace-nowrap px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {payouts.map((row) => (
              <tr 
                key={row.id} 
                className={`hover:bg-gray-50 ${selectedIds.has(row.id) ? 'bg-blue-50' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {formatDate(row.created_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(row.status)}`}
                  >
                    {getStatusLabel(row.status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                  {getDisplayName(row)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {getTikTokUsername(row)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-amber-600">
                  {formatPence(row.amount_claimed_pence)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {row.phone || "—"}
                </td>
                <td className="max-w-[180px] truncate px-3 py-2 text-gray-600" title={row.email || ""}>
                  {row.email || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {row.payout_account_holder_name || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-600">
                  {row.payout_sort_code || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-600">
                  {row.payout_account_number || "—"}
                </td>
                {showPaidDate && (
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {row.status === 'paid' && row.status_updated_at ? (
                      <span className="font-medium text-green-700">{formatDate(row.status_updated_at)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2">
                  <PayoutActionButtons
                    id={row.id}
                    currentStatus={row.status}
                    details={{
                      name: getDisplayName(row),
                      email: row.email,
                      phone: row.phone,
                      amount: formatPence(row.amount_claimed_pence),
                      accountHolder: row.payout_account_holder_name,
                      sortCode: row.payout_sort_code,
                      accountNumber: row.payout_account_number,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
