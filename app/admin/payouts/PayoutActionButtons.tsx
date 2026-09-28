'use client'

import { useState, useTransition } from 'react'
import { updatePayoutStatus, deletePayout } from './actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface PayoutDetails {
  name: string
  email: string | null
  phone: string | null
  amount: string
  accountHolder: string | null
  sortCode: string | null
  accountNumber: string | null
}

interface PayoutActionButtonsProps {
  id: string
  currentStatus: string | null
  details: PayoutDetails
}

export function PayoutActionButtons({ id, currentStatus, details }: PayoutActionButtonsProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmPaidOpen, setConfirmPaidOpen] = useState(false)
  const [confirmUnpaidOpen, setConfirmUnpaidOpen] = useState(false)

  const handleStatusUpdate = (newStatus: 'new' | 'paid' | 'problem', requireConfirm?: string) => {
    if (requireConfirm && !window.confirm(requireConfirm)) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await updatePayoutStatus(id, newStatus)
      if (!result.ok) {
        setError(result.error || 'Update failed')
      }
    })
  }

  // Marking as paid always goes through the confirmation dialog.
  const confirmMarkPaid = () => {
    setConfirmPaidOpen(false)
    setError(null)
    startTransition(async () => {
      const result = await updatePayoutStatus(id, 'paid')
      if (!result.ok) {
        setError(result.error || 'Update failed')
      }
    })
  }

  // Marking back to unpaid (new) also goes through a confirmation dialog.
  const confirmMarkUnpaid = () => {
    setConfirmUnpaidOpen(false)
    setError(null)
    startTransition(async () => {
      const result = await updatePayoutStatus(id, 'new')
      if (!result.ok) {
        setError(result.error || 'Update failed')
      }
    })
  }

  const handleDelete = () => {
    if (!window.confirm('Are you sure you want to delete this payout submission? This cannot be undone.')) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await deletePayout(id)
      if (!result.ok) {
        setError(result.error || 'Delete failed')
      }
    })
  }

  const buttonBase = "rounded px-2 py-0.5 text-xs font-medium disabled:opacity-50"

  const detailRow = (label: string, value: string | null) => (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right break-all">{value || '—'}</span>
    </div>
  )

  const confirmPaidDialog = (
    <AlertDialog open={confirmPaidOpen} onOpenChange={setConfirmPaidOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark this payout as paid?</AlertDialogTitle>
          <AlertDialogDescription>
            Please confirm you are marking the correct payout as paid. This updates the payout status.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border bg-muted/40 p-3">
          {detailRow('Winner', details.name)}
          {detailRow('Email', details.email)}
          {detailRow('Phone', details.phone)}
          {detailRow('Amount', details.amount)}
          {detailRow('Account holder', details.accountHolder)}
          {detailRow('Sort code', details.sortCode)}
          {detailRow('Account number', details.accountNumber)}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmMarkPaid}
            disabled={isPending}
            className="bg-green-600 text-white hover:bg-green-700"
          >
            Confirm mark as paid
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const confirmUnpaidDialog = (
    <AlertDialog open={confirmUnpaidOpen} onOpenChange={setConfirmUnpaidOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark this payout as unpaid?</AlertDialogTitle>
          <AlertDialogDescription>
            Please confirm you are reverting the correct payout back to unpaid. This updates the payout status.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border bg-muted/40 p-3">
          {detailRow('Winner', details.name)}
          {detailRow('Email', details.email)}
          {detailRow('Phone', details.phone)}
          {detailRow('Amount', details.amount)}
          {detailRow('Account holder', details.accountHolder)}
          {detailRow('Sort code', details.sortCode)}
          {detailRow('Account number', details.accountNumber)}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmMarkUnpaid}
            disabled={isPending}
            className="bg-yellow-500 text-white hover:bg-yellow-600"
          >
            Confirm mark as unpaid
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // For paid rows: show Unpaid and Delete
  if (currentStatus === 'paid') {
    return (
      <div className="flex items-center gap-1">
        {confirmUnpaidDialog}
        <button
          onClick={() => setConfirmUnpaidOpen(true)}
          disabled={isPending}
          className={`${buttonBase} bg-yellow-100 text-yellow-700 hover:bg-yellow-200`}
          title="Mark as unpaid"
        >
          {isPending ? '...' : 'Unpaid'}
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className={`${buttonBase} bg-gray-100 text-gray-700 hover:bg-gray-200`}
          title="Delete submission"
        >
          {isPending ? '...' : 'Del'}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    )
  }

  // For problem rows: show Paid, Unpaid, Delete
  if (currentStatus === 'problem') {
    return (
      <div className="flex items-center gap-1">
        {confirmPaidDialog}
        {confirmUnpaidDialog}
        <button
          onClick={() => setConfirmPaidOpen(true)}
          disabled={isPending}
          className={`${buttonBase} bg-green-100 text-green-700 hover:bg-green-200`}
          title="Mark as paid"
        >
          {isPending ? '...' : 'Paid'}
        </button>
        <button
          onClick={() => setConfirmUnpaidOpen(true)}
          disabled={isPending}
          className={`${buttonBase} bg-yellow-100 text-yellow-700 hover:bg-yellow-200`}
          title="Mark as unpaid/new"
        >
          {isPending ? '...' : 'Unpaid'}
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className={`${buttonBase} bg-gray-100 text-gray-700 hover:bg-gray-200`}
          title="Delete submission"
        >
          {isPending ? '...' : 'Del'}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    )
  }

  // For unpaid/new rows: show Paid, Problem, Delete
  return (
    <div className="flex items-center gap-1">
      {confirmPaidDialog}
      <button
        onClick={() => setConfirmPaidOpen(true)}
        disabled={isPending}
        className={`${buttonBase} bg-green-100 text-green-700 hover:bg-green-200`}
        title="Mark as paid"
      >
        {isPending ? '...' : 'Paid'}
      </button>
      <button
        onClick={() => handleStatusUpdate('problem')}
        disabled={isPending}
        className={`${buttonBase} bg-red-100 text-red-700 hover:bg-red-200`}
        title="Mark as problem"
      >
        {isPending ? '...' : 'Prob'}
      </button>
      <button
        onClick={handleDelete}
        disabled={isPending}
        className={`${buttonBase} bg-gray-100 text-gray-700 hover:bg-gray-200`}
        title="Delete submission"
      >
        {isPending ? '...' : 'Del'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
