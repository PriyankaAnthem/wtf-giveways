'use client'

import { Component, Suspense, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { AlertCircle } from 'lucide-react'
import { NormalCheckoutReveal } from '@/components/checkout/reveal/NormalCheckoutReveal'
import { normalizeRevealType, type RevealType } from '@/lib/types/campaign'

// Lazy-loaded so normal campaigns never download/parse the scratch-card
// canvas + confetti bundle. The chunk is only fetched when a confirmed award
// identifies the campaign as scratch_card (see the reveal selector below).
const ScratchCardReveal = dynamic(
  () =>
    import('@/components/checkout/reveal/ScratchCardReveal').then(
      (module) => module.ScratchCardReveal,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <Spinner className="h-6 w-6 text-amber-400" />
        <p className="text-sm text-zinc-300">Preparing your scratch card…</p>
      </div>
    ),
  },
)

// Lazy-loaded so ONLY treasure_chest campaigns download/parse the chest
// component + its images. The chunk is fetched only when a confirmed award
// identifies the campaign as treasure_chest (see the reveal selector below).
// Normal and Scratch Card customers never load any of this.
const TreasureChestReveal = dynamic(
  () =>
    import('@/components/checkout/reveal/TreasureChestReveal').then(
      (module) => module.TreasureChestReveal,
    ),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <Spinner className="h-6 w-6 text-amber-400" />
        <p className="text-sm text-muted-foreground">Preparing your treasure…</p>
      </main>
    ),
  },
)

// Lazy-loaded so ONLY dg_football campaigns download/parse the football game
// core + its stylesheet. The chunk is fetched only when a confirmed award
// identifies the campaign as dg_football (see the reveal selector below).
// Normal, Scratch Card and Treasure Chest customers never load any of this.
const DgFootballReveal = dynamic(
  () =>
    import('@/components/checkout/reveal/DgFootballReveal').then(
      (module) => module.DgFootballReveal,
    ),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <Spinner className="h-6 w-6 text-lime-400" />
        <p className="text-sm text-muted-foreground">Warming up the pitch…</p>
      </main>
    ),
  },
)

/**
 * Isolated error boundary for optional reveal experiences. If the lazy chunk
 * fails to load or the animation throws at runtime, we render the safe
 * Normal-style fallback so the customer ALWAYS sees their confirmed result.
 */
class RevealErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: unknown) {
    console.log('[v0] reveal chunk failed, using safe fallback:', error)
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

type Prize = {
  award_id?: string | null
  title: string
  value_text?: string | null
  image_url?: string | null
}

type AwardPayload = {
  confirmed: boolean
  checkout_ref: string
  qty: number
  won: boolean
  prize: Prize | null
  /** Future: array of all prizes won in this checkout */
  prizes?: Prize[]
  ticket_start?: number | null
  ticket_end?: number | null
  campaign_slug?: string | null
  reveal_type?: RevealType | null
  /** Additive, analytics-only. Present when the confirm route resolved them. */
  campaign_id?: string | null
  external_payment_pence?: number | null
  total_pence?: number | null
  wallet_credit_pence?: number | null
}

type PageState =
  | { kind: 'missing_ref' }
  | { kind: 'confirming'; attempt: number }
  | { kind: 'confirmed'; award: AwardPayload }
  | { kind: 'failed'; error: string }

const MAX_ATTEMPTS = 20
const POLL_INTERVAL = 2500

function LoadingCard() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Spinner className="size-8 text-primary" />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-foreground">Loading...</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Preparing your checkout confirmation.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <CheckoutSuccessClient />
    </Suspense>
  )
}

function CheckoutSuccessClient() {
  const searchParams = useSearchParams()
  const ref = searchParams.get('ref')
  const provider = searchParams.get('provider') || 'debug'
  const paymentIntent = searchParams.get('payment_intent') || undefined
  const paypalOrder = searchParams.get('paypal_order') || undefined

  const [state, setState] = useState<PageState>(
    ref ? { kind: 'confirming', attempt: 0 } : { kind: 'missing_ref' }
  )

  const attemptRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doneRef = useRef(false)
  // In-memory guard so the Meta Pixel Purchase event fires at most once per
  // mounted page, regardless of re-renders or confirmation polling.
  const purchaseFiredRef = useRef(false)

  // Auth-aware header refresh (UI only).
  //
  // The site header is server-rendered in the root layout via
  // supabase.auth.getUser(). When the customer is returned here by a top-level
  // cross-site navigation from Acquired's hosted checkout, that initial
  // document can render the header before the same-site session cookies are
  // applied, so the nav shows "Log in / Create account" even though the session
  // is valid (which is why /me and this page's confirm call still work). A
  // single same-origin router.refresh() re-runs the server components with the
  // now-present cookies so the header reflects the real session. Guarded to run
  // once; it does not touch payment/confirm logic.
  const router = useRouter()
  const refreshedRef = useRef(false)
  useEffect(() => {
    if (refreshedRef.current) return
    refreshedRef.current = true
    router.refresh()
  }, [router])

  // Best-effort Meta Pixel Purchase tracking. Browser-only (no Conversions
  // API here). Fires exactly once per confirmed, non-zero external payment,
  // deduped in-memory AND via localStorage (keyed by checkout ref) so polling,
  // re-renders, refreshes and URL revisits cannot re-fire. eventID === the
  // checkout ref for future browser/server dedup. Any failure is swallowed:
  // it must never change checkout state, block the reveal, or log PII.
  useEffect(() => {
    if (state.kind !== 'confirmed') return
    if (purchaseFiredRef.current) return

    const award = state.award
    const checkoutRef = award.checkout_ref
    const campaignId = award.campaign_id
    const qty = award.qty

    // Externally paid amount for the Purchase `value`. Prefer the explicit
    // external_payment_pence when the provider set it; otherwise derive it from
    // the final checkout total minus the wallet-credit portion (Acquired
    // currently leaves external_payment_pence null even on success). Never use
    // subtotal_pence and never add the discount back — total_pence is already
    // the final total, and wallet_credit_pence is subtracted only to isolate
    // the externally paid amount.
    const paidPence =
      typeof award.external_payment_pence === 'number'
        ? award.external_payment_pence
        : typeof award.total_pence === 'number' &&
            typeof award.wallet_credit_pence === 'number'
          ? Math.max(award.total_pence - award.wallet_credit_pence, 0)
          : null

    // Validate the confirmed Purchase values ONCE. If anything is missing or
    // invalid we never fire and never retry (the retry loop below only waits
    // for the Pixel, not for data). Note: window.fbq availability is
    // intentionally NOT part of this gate — it is handled by the bounded retry.
    if (
      award.confirmed !== true ||
      typeof checkoutRef !== 'string' ||
      checkoutRef.length === 0 ||
      typeof campaignId !== 'string' ||
      campaignId.length === 0 ||
      typeof qty !== 'number' ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      typeof paidPence !== 'number' ||
      !Number.isFinite(paidPence) ||
      paidPence <= 0
    ) {
      return
    }

    const storageKey = `meta_purchase_fired:${checkoutRef}`

    // Attempts to fire once. Returns true when the work is finished (fired OR
    // already-fired), false only when fbq is not yet available and we should
    // keep waiting. Preserves both duplicate guards and never sets the
    // localStorage marker unless fbq was actually called.
    const tryFirePurchase = (): boolean => {
      if (purchaseFiredRef.current) return true
      if (typeof window.fbq !== 'function') return false

      try {
        // 1) in-memory guard (checked above) → 2) persistent guard.
        if (typeof window.localStorage !== 'undefined' && window.localStorage.getItem(storageKey)) {
          purchaseFiredRef.current = true
          return true
        }

        // 3) fire the event.
        window.fbq(
          'track',
          'Purchase',
          {
            value: paidPence / 100,
            currency: 'GBP',
            content_ids: [campaignId],
            content_type: 'product',
            num_items: qty,
            order_id: checkoutRef,
          },
          {
            eventID: checkoutRef,
          },
        )

        // 4) only after fbq() returned without throwing, persist both markers.
        purchaseFiredRef.current = true
        try {
          window.localStorage?.setItem(storageKey, '1')
        } catch {
          // localStorage unavailable (private mode / quota); in-memory guard stands.
        }
      } catch {
        // Best-effort only: never disrupt the confirmed reveal. Treat as done
        // so we do not spin retrying a throwing fbq.
        purchaseFiredRef.current = true
      }
      return true
    }

    // Fast path: Pixel already initialised.
    if (tryFirePurchase()) return

    // Slow path: values are valid but the Meta Pixel has not finished loading
    // yet. Poll ONLY the Pixel availability, ~every 250ms for at most 5s. This
    // does NOT re-run confirmation, does not touch state, and does not block the
    // reveal. The single interval lives for this effect run; the cleanup clears
    // it so React re-renders cannot stack multiple simultaneous loops.
    const RETRY_INTERVAL_MS = 250
    const MAX_WAIT_MS = 5000
    const startedAt = Date.now()
    let intervalId: ReturnType<typeof setInterval> | null = null

    intervalId = setInterval(() => {
      if (tryFirePurchase() || Date.now() - startedAt >= MAX_WAIT_MS) {
        if (intervalId !== null) {
          clearInterval(intervalId)
          intervalId = null
        }
      }
    }, RETRY_INTERVAL_MS)

    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
  }, [state])

  const confirm = useCallback(async () => {
    if (!ref) return
    if (doneRef.current) return

    attemptRef.current += 1
    const currentAttempt = attemptRef.current
    setState({ kind: 'confirming', attempt: currentAttempt })

    try {
      abortRef.current = new AbortController()

      const body: Record<string, string> = { ref, provider }
      if (paymentIntent) body.stripePaymentIntentId = paymentIntent
      if (paypalOrder) body.paypalOrderId = paypalOrder

      const res = await fetch('/api/checkout/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      if (res.status === 401) {
        const returnTo = window.location.pathname + window.location.search
        window.location.href = `/auth/login?redirect=${encodeURIComponent(returnTo)}`
        return
      }

      const json = await res.json()

      if (res.ok && json.ok) {
        doneRef.current = true
        setState({ kind: 'confirmed', award: json.award })
        return
      }

      if (res.status === 409 && json.error === 'awaiting_provider_confirmation') {
        if (currentAttempt >= MAX_ATTEMPTS) {
          doneRef.current = true
          setState({ kind: 'failed', error: 'Payment confirmation timed out. Please contact support.' })
          return
        }
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => confirm(), POLL_INTERVAL)
        return
      }

      doneRef.current = true
      setState({ kind: 'failed', error: json.error || 'Something went wrong. Please try again.' })
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      doneRef.current = true
      setState({ kind: 'failed', error: 'Network error. Please check your connection and try again.' })
    }
  }, [ref, provider, paymentIntent, paypalOrder])

  useEffect(() => {
    if (!ref) return
    doneRef.current = false
    attemptRef.current = 0
    confirm()

    return () => {
      abortRef.current?.abort()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [ref, confirm])

  const handleRetry = () => {
    doneRef.current = false
    attemptRef.current = 0
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    confirm()
  }

  // Presentation-only reveal routing. The result in `state.award` is ALREADY
  // final at this point (confirmPaymentAndAward has run server-side); these
  // branches only choose how it is displayed.
  //   - treasure_chest → full-screen TreasureChestReveal (lazy chunk), wrapped
  //     in an error boundary that falls back to the normal reveal.
  //   - dg_football → full-screen DgFootballReveal (lazy chunk), wrapped in the
  //     same error boundary so any asset/animation failure falls back safely.
  //   - normal (and any unknown/null value) → full-screen NormalCheckoutReveal.
  //   - scratch_card → falls through to the card layout below (unchanged).
  if (state.kind === 'confirmed') {
    const revealType = normalizeRevealType(state.award.reveal_type)
    if (revealType === 'treasure_chest') {
      return (
        <RevealErrorBoundary fallback={<NormalCheckoutReveal award={state.award} />}>
          <TreasureChestReveal award={state.award} />
        </RevealErrorBoundary>
      )
    }
    if (revealType === 'dg_football') {
      return (
        <RevealErrorBoundary fallback={<NormalCheckoutReveal award={state.award} />}>
          <DgFootballReveal award={state.award} />
        </RevealErrorBoundary>
      )
    }
    if (revealType !== 'scratch_card') {
      return <NormalCheckoutReveal award={state.award} />
    }
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
          {state.kind === 'missing_ref' && <MissingRefState />}
          {state.kind === 'confirming' && <ConfirmingState attempt={state.attempt} />}
          {state.kind === 'confirmed' && <ScratchCardReveal award={state.award} />}
          {state.kind === 'failed' && <FailedState error={state.error} onRetry={handleRetry} />}
        </CardContent>
      </Card>
    </main>
  )
}

function MissingRefState() {
  return (
    <>
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="size-8 text-destructive" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Missing Reference</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {"We couldn't find a payment reference. If you just completed a purchase, please check your email for confirmation."}
        </p>
      </div>
      <Button asChild className="w-full">
        <Link href="/giveaways">Browse Giveaways</Link>
      </Button>
    </>
  )
}

function ConfirmingState({ attempt }: { attempt: number }) {
  return (
    <>
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
        <Spinner className="size-8 text-primary" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Confirming Your Entry</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {"We're verifying your payment and entering you into the draw. This usually takes just a moment."}
        </p>
      </div>
      {attempt > 3 && (
        <p className="text-xs text-muted-foreground">Still working... please hold tight.</p>
      )}
    </>
  )
}

function FailedState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <>
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="size-8 text-destructive" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Something Went Wrong</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
      </div>
      <div className="flex flex-col gap-2 w-full">
        <Button onClick={onRetry} className="w-full">
          Try Again
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/giveaways">Back to Giveaways</Link>
        </Button>
      </div>
    </>
  )
}
