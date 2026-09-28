'use client'

import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'

interface PreferenceState {
  enabled: boolean
  canEnable: boolean
}

/**
 * Account "Email preferences" control for competition news + offers.
 *
 * It reads the current preference ONCE when it mounts (i.e. when the Settings
 * tab is opened) via the authenticated API and does not poll. It never loads
 * checkout history or suppression details — the API returns only two booleans.
 * The toggle is gated: when re-enabling is blocked by another suppression
 * (bounce/complaint/manual), a neutral message is shown without disclosing why.
 */
export function MarketingEmailPreference() {
  const [state, setState] = useState<PreferenceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/account/marketing-preferences', {
          method: 'GET',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('load_failed')
        const data = (await res.json()) as PreferenceState
        if (active) setState(data)
      } catch {
        if (active) setError('We could not load your email preferences right now.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const onToggle = async (next: boolean) => {
    if (!state) return
    const previous = state
    setState({ ...state, enabled: next })
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/account/marketing-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        setState(previous)
        setError(
          res.status === 409
            ? 'Marketing emails can’t be re-enabled for this account right now. Please contact support if you think this is a mistake.'
            : 'We could not save your preference. Please try again.',
        )
        return
      }
      const data = (await res.json()) as PreferenceState
      setState(data)
    } catch {
      setState(previous)
      setError('We could not save your preference. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const blocked = Boolean(state && !state.enabled && !state.canEnable)

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">Competition news and offers</p>
          <p className="text-sm text-white/60">
            Receive emails about new competitions, instant wins and selected WTF Giveaways offers.
          </p>
        </div>
        <Switch
          checked={state?.enabled ?? false}
          onCheckedChange={onToggle}
          disabled={loading || saving || blocked}
          aria-label="Competition news and offers"
          className="data-[state=checked]:bg-yellow-500"
        />
      </div>

      {loading && <p className="mt-2 text-xs text-white/50">Loading…</p>}

      {blocked && !error && (
        <p className="mt-2 text-xs text-white/50">
          Marketing emails are currently switched off for this account and can’t be turned back on
          here.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}
