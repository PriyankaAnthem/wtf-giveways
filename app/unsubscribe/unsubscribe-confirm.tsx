'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Small client island for the unsubscribe confirmation action. The unsubscribe
 * only happens on this explicit POST — never on page load — so email security
 * scanners that pre-fetch links cannot accidentally unsubscribe anyone.
 */
export function UnsubscribeConfirm({ token }: { token: string }) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')

  const onConfirm = async () => {
    setStatus('submitting')
    try {
      const res = await fetch('/api/marketing/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      // Idempotent: a repeat unsubscribe still returns ok.
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-center">
        <p className="text-sm font-medium text-foreground">You have been unsubscribed.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You will no longer receive marketing emails from WTF Giveaways. Transactional messages
          (like order confirmations) are unaffected.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        onClick={onConfirm}
        disabled={status === 'submitting'}
        className="w-full bg-purple-600 hover:bg-purple-700"
      >
        {status === 'submitting' ? 'Unsubscribing…' : 'Unsubscribe me'}
      </Button>
      {status === 'error' && (
        <p className="text-sm text-destructive">
          Something went wrong. Please try again in a moment.
        </p>
      )}
    </div>
  )
}
