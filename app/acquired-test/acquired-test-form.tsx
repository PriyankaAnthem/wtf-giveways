'use client'

import { useState } from 'react'

type ResultState = {
  status: number
  body: unknown
} | null

export function AcquiredTestForm() {
  const [ref, setRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResultState>(null)

  // Only ever called on explicit button click - never on load.
  async function handleCreateCheckout() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/payments/acquired/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: ref.trim() }),
      })

      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        body = '<no JSON body>'
      }

      setResult({ status: res.status, body })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const checkoutUrl =
    result && typeof result.body === 'object' && result.body !== null
      ? (result.body as Record<string, unknown>).checkout_url
      : undefined

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="ref" className="text-sm font-medium text-foreground">
          Checkout ref
        </label>
        <input
          id="ref"
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Paste checkout ref"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <button
        type="button"
        onClick={handleCreateCheckout}
        disabled={loading || ref.trim().length === 0}
        className="inline-flex w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Acquired Test Checkout'}
      </button>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {result ? (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-foreground">
            <span className="font-medium">HTTP status:</span> {result.status}
          </div>

          {typeof checkoutUrl === 'string' && checkoutUrl.length > 0 ? (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center justify-center rounded-md border border-input bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground"
            >
              Open Acquired Checkout
            </a>
          ) : null}

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Raw JSON response</span>
            <pre className="overflow-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
