import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import {
  CheckoutReviewClient,
  type ReviewOption,
  type InstantWinSummary,
} from '@/components/checkout/checkout-review-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Review your entry',
  robots: { index: false, follow: false },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Strict decimal-integer syntax for query params. These reject whitespace
// padding, exponent notation (1e2), decimals, signs, empty strings and arrays
// because Number(...) is only ever applied AFTER a successful regex match.
const QTY_RE = /^[1-9]\d{0,2}$/ // 1–999 by syntax; range re-checked to 1–500
const BUNDLE_PENCE_RE = /^\d+$/ // non-negative integer, no sign/decimal/exponent

// Non-negative SAFE integer guard (also rejects values above MAX_SAFE_INTEGER).
const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

const PAGE_BG =
  'min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top,_#3a0f4f_0%,_#1b0b2b_40%,_#0e0618_100%)] text-white'

// ---- Read-only instant-win commercial summary --------------------------------
// Derived PURELY from the already-fetched detail-snapshot payload (payload.
// instant_wins). No extra query, no new source. It only ever produces aggregate
// display facts for the checkout upsell copy — never ticket numbers, slots,
// winning positions, award identities or any prize configuration.
//
// A hero CASH prize is claimed ONLY when it is unambiguous: remaining > 0, the
// title literally contains an amount AND the word "CASH", and does NOT mention
// credit/wallet (so "£10 Site Credit" can never be labelled cash). Anything
// below £250 is not treated as a hero. Everything is defensive and total-safe.
const HERO_CASH_MIN_PENCE = 25000
const CASH_AMOUNT_RE = /£\s?([\d,]+(?:\.\d{1,2})?)/
const CASH_WORD_RE = /\bcash\b/i
const CREDIT_WORD_RE = /credit|wallet/i

function deriveInstantWinSummary(rows: unknown[]): InstantWinSummary {
  let remainingCount = 0
  let heroPence = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const remainingRaw = Number(o.remaining_count)
    if (!Number.isFinite(remainingRaw) || remainingRaw <= 0) continue
    remainingCount += Math.max(0, Math.floor(remainingRaw))

    const title = typeof o.title === 'string' ? o.title : ''
    if (!title) continue
    // Exclude anything that could be site credit / wallet credit.
    if (CREDIT_WORD_RE.test(title)) continue
    // Must explicitly be CASH and carry a parseable amount.
    if (!CASH_WORD_RE.test(title)) continue
    const m = CASH_AMOUNT_RE.exec(title)
    if (!m) continue
    const value = Number.parseFloat(m[1].replace(/,/g, ''))
    if (!Number.isFinite(value) || value <= 0) continue
    const pence = Math.round(value * 100)
    if (pence < HERO_CASH_MIN_PENCE) continue
    if (pence > heroPence) heroPence = pence
  }

  let heroCashLabel: string | null = null
  if (heroPence >= HERO_CASH_MIN_PENCE) {
    const pounds = heroPence / 100
    const formatted = Number.isInteger(pounds)
      ? pounds.toLocaleString('en-GB')
      : pounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    heroCashLabel = `£${formatted} CASH`
  }

  return { remainingCount, heroCashLabel }
}

/** Clean, self-contained "invalid" state. Never creates an intent. */
function InvalidState() {
  return (
    <div className={PAGE_BG}>
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-purple-500/20 bg-[#160a26] p-8 text-center shadow-[0_0_40px_rgba(168,85,247,0.15)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/50">
            <AlertCircle className="h-6 w-6 text-pink-400" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold">Checkout details are invalid</h1>
          <p className="text-sm leading-relaxed text-purple-200">
            We couldn&apos;t start this checkout. Please head back and choose your tickets again.
          </p>
          <Link
            href="/giveaways"
            className="mt-2 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#F7A600] via-[#FFD46A] to-[#F7A600] px-6 py-3 text-sm font-bold text-black transition-transform hover:scale-[1.02]"
          >
            Browse giveaways
          </Link>
        </div>
      </div>
    </div>
  )
}

interface ReviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CheckoutReviewPage({ searchParams }: ReviewPageProps) {
  const sp = await searchParams

  // ---- 1) Validate untrusted query parameters ----
  const campaignIdRaw = typeof sp.campaignId === 'string' ? sp.campaignId : ''
  const qtyRaw = typeof sp.qty === 'string' ? sp.qty : ''
  const bundleRaw = typeof sp.bundlePricePence === 'string' ? sp.bundlePricePence : undefined

  const campaignId = campaignIdRaw.trim()
  if (campaignId.length === 0 || campaignId.length > 64 || !UUID_RE.test(campaignId)) {
    return <InvalidState />
  }

  // qty must match strict integer syntax, THEN be within 1–500.
  if (!QTY_RE.test(qtyRaw)) {
    return <InvalidState />
  }
  const qty = Number(qtyRaw)
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 500) {
    return <InvalidState />
  }

  let requestedBundlePence: number | null = null
  if (bundleRaw !== undefined) {
    // Optional bundle price: strict non-negative integer syntax, THEN a finite
    // safe non-negative integer value.
    if (!BUNDLE_PENCE_RE.test(bundleRaw)) {
      return <InvalidState />
    }
    const parsed = Number(bundleRaw)
    if (!isNonNegInt(parsed)) {
      return <InvalidState />
    }
    requestedBundlePence = parsed
  }

  // ---- 2) Authenticate (redirect logged-out users, preserving the URL) ----
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const params = new URLSearchParams()
    params.set('campaignId', campaignId)
    params.set('qty', String(qty))
    if (requestedBundlePence != null) params.set('bundlePricePence', String(requestedBundlePence))
    const reviewUrl = `/checkout/review?${params.toString()}`
    redirect(`/auth/login?redirect=${encodeURIComponent(reviewUrl)}`)
  }

  // ---- 3) Load authoritative campaign data (RLS-scoped client) ----
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, slug, title, status, ticket_price_pence, max_tickets_total, bundles')
    .eq('id', campaignId)
    .single()

  if (campErr || !campaign || campaign.status !== 'live') {
    return <InvalidState />
  }

  const ticketPricePence = isNonNegInt(campaign.ticket_price_pence) ? campaign.ticket_price_pence : null

  // ---- 4) Derive the authoritative display total (server-side) ----
  const rawBundles = Array.isArray(campaign.bundles) ? campaign.bundles : []

  let validatedBundlePricePence: number | null = null
  let displayTotalPence: number

  if (requestedBundlePence != null) {
    // Accept the bundle ONLY when it exactly matches a configured bundle for the
    // selected quantity — the same rule the checkout-create route enforces.
    const matched = (rawBundles as { quantity?: unknown; price_pence?: unknown }[]).find(
      (b) => Number(b.quantity) === qty && Number(b.price_pence) === requestedBundlePence,
    )
    if (!matched) {
      // Never display an unverified bundle price.
      return <InvalidState />
    }
    validatedBundlePricePence = requestedBundlePence
    displayTotalPence = requestedBundlePence
  } else {
    if (ticketPricePence == null) {
      return <InvalidState />
    }
    displayTotalPence = qty * ticketPricePence
  }

  if (!isNonNegInt(displayTotalPence)) {
    return <InvalidState />
  }

  // ---- 4b) Build the selectable ticket options from CONFIGURED bundles only ----
  // Every option here is server-authoritative. The client uses these purely to
  // let the customer switch selection and preview totals; the create API still
  // re-validates the chosen qty + bundlePricePence.
  const options: ReviewOption[] = []
  const seenKeys = new Set<string>()

  const pushOption = (opt: ReviewOption) => {
    if (seenKeys.has(opt.key)) return
    seenKeys.add(opt.key)
    options.push(opt)
  }

  for (const b of rawBundles as { quantity?: unknown; price_pence?: unknown }[]) {
    const bq = Number(b.quantity)
    const bp = Number(b.price_pence)
    if (!Number.isSafeInteger(bq) || bq < 1 || bq > 500) continue
    if (!Number.isSafeInteger(bp) || bp < 0) continue
    const savings = ticketPricePence != null ? Math.max(bq * ticketPricePence - bp, 0) : 0
    pushOption({
      key: `bundle:${bq}:${bp}`,
      qty: bq,
      bundlePricePence: bp,
      totalPence: bp,
      savingsPence: savings,
    })
  }

  // The current selection. When it is a per-ticket order (no bundle) it may not
  // exist among configured bundles, so add it explicitly.
  const initialKey =
    validatedBundlePricePence != null ? `bundle:${qty}:${validatedBundlePricePence}` : `single:${qty}`

  if (validatedBundlePricePence == null) {
    pushOption({
      key: initialKey,
      qty,
      bundlePricePence: null,
      totalPence: displayTotalPence,
      savingsPence: 0,
    })
  }

  options.sort((a, b) => a.qty - b.qty || a.totalPence - b.totalPence)

  // ---- 5) Wallet balance (authenticated, RLS-scoped, never service role) ----
  let availableWalletPence = 0
  const { data: walletRow, error: walletErr } = await supabase
    .from('wallet_accounts')
    .select('balance_pence, reserved_pence')
    .eq('user_id', user.id)
    .maybeSingle()

  if (walletErr) {
    console.error('[checkout/review] wallet_accounts lookup failed:', walletErr.message)
  } else if (walletRow) {
    const balancePence = isNonNegInt(walletRow.balance_pence) ? walletRow.balance_pence : 0
    const reservedPence = isNonNegInt(walletRow.reserved_pence) ? walletRow.reserved_pence : 0
    availableWalletPence = Math.max(balancePence - reservedPence, 0)
  }

  // ---- 6) Prize imagery/copy from the SAME trusted snapshot source as the
  // giveaway detail page (read-only, best-effort; never blocks checkout) ----
  let heroImageUrl: string | null = null
  let prizeTitle: string | null = null
  let prizeValueText: string | null = null
  // Read-only upsell summary from the SAME snapshot payload (no extra query).
  let instantWinSummary: InstantWinSummary | null = null

  const campaignSlug = typeof campaign.slug === 'string' && campaign.slug.length > 0 ? campaign.slug : null
  if (campaignSlug) {
    try {
      const publicClient = createPublicClient()
      const { data: snapRows } = await publicClient
        .from('giveaway_snapshots')
        .select('kind, payload')
        .in('kind', ['detail', 'list'])
        .eq('payload->>slug', campaignSlug)
        .order('generated_at', { ascending: false })
        .limit(2)

      const rows = snapRows ?? []
      const snap = (rows.find((x) => x.kind === 'detail') ?? rows[0])?.payload as
        | Record<string, unknown>
        | undefined

      if (snap) {
        const hero = snap.hero_image_url
        const imagesArr = Array.isArray(snap.images) ? (snap.images as unknown[]) : []
        const firstImage = typeof imagesArr[0] === 'string' ? (imagesArr[0] as string) : null
        heroImageUrl =
          (typeof hero === 'string' && hero.length > 0 ? hero : null) ?? firstImage ?? null
        prizeTitle = typeof snap.prize_title === 'string' && snap.prize_title.length > 0 ? snap.prize_title : null
        prizeValueText =
          typeof snap.prize_value_text === 'string' && snap.prize_value_text.length > 0
            ? snap.prize_value_text
            : null

        // Aggregate instant-win facts for the upsell (already in the payload).
        if (Array.isArray(snap.instant_wins)) {
          instantWinSummary = deriveInstantWinSummary(snap.instant_wins as unknown[])
        }
      }
    } catch (e) {
      // Imagery is decorative — never fail checkout because of it.
      console.error('[checkout/review] snapshot imagery lookup failed:', (e as Error).message)
    }
  }

  return (
    <div className={PAGE_BG}>
      <CheckoutReviewClient
        campaignId={campaign.id}
        slug={campaignSlug}
        title={typeof campaign.title === 'string' && campaign.title.length > 0 ? campaign.title : 'Your entry'}
        prizeTitle={prizeTitle}
        prizeValueText={prizeValueText}
        heroImageUrl={heroImageUrl}
        ticketPricePence={ticketPricePence ?? 0}
        options={options}
        initialKey={initialKey}
        availableWalletPence={availableWalletPence}
        instantWins={instantWinSummary}
      />
    </div>
  )
}
