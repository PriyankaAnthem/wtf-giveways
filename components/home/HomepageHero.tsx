import Link from "next/link"
import Image from "next/image"
import { PromoMedia } from "@/components/media/PromoMedia"
import { ArrowRight, Flame, Info, Radio } from "lucide-react"
import type { HomepageHeroData } from "@/lib/homepage-hero"
import { HeroUrgency } from "./HeroUrgency"
import { HeroLiveStats } from "./HeroLiveStats"
import { HeroLiveShell } from "./HeroLiveShell"

/**
 * Bespoke Homepage Main Banner (hero) — the single promotional banner in the
 * homepage's top slot (directly above JACKPOTS / TIKTOK POPS).
 *
 * Server component shell (artwork + commerce area). Client behaviour is
 * isolated to the smallest live elements: the compact urgency line
 * (HeroUrgency) and the live balloon totals + pop event (HeroLiveStats).
 *
 * Composition is deliberately compact on mobile and sales-first: the campaign
 * artwork is kept clean (the creative sells the dream), and the decision UI
 * sits immediately BELOW it (title, urgency, price + strongest metric,
 * progress, CTA). Two purpose-built states:
 *   - FEATURED (default): gold neon banner, clean tappable artwork with at most
 *     one small admin badge, title + compact urgency below, price + genuine
 *     remaining-opportunity stat, gold progress (with % sold), big "PLAY NOW".
 *   - LIVE (selected Balloon Pop with its OWN takeover enabled): red/pink neon
 *     with a controlled motion system (breathing border, LIVE signal,
 *     broadcast lighting, subtle artwork drift, genuine value/pop animation),
 *     real balloon totals, admin-entered copy, "GET YOUR TICKETS NOW" +
 *     optional "WATCH LIVE" (only with a real URL).
 *
 * All figures are genuine snapshot / live-board data. No viewer counts, no
 * fabricated winner tickers, no invented prize totals.
 */

/** Customer-friendly price: below £1 -> "69p", £1+ -> "£1.50". */
function priceText(pence: number): string {
  if (pence < 100) return `${Math.round(pence)}p`
  return `£${(pence / 100).toFixed(2)}`
}

/**
 * Natural GBP for a prize value in pence: whole pounds show no decimals
 * (£15, £250, £12,750); non-zero pence show two decimals (£12,750.50).
 */
function formatGBP(pence: number): string {
  const whole = pence % 100 === 0
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

/**
 * The FEATURED hero's third selling tile. Sells the genuine remaining
 * opportunity — NEVER unsold ticket inventory. Priority:
 *   1. CASH STILL TO WIN — genuine unclaimed cash value, only when a trusted
 *      total is available (never parsed from titles; null when incomplete).
 *   2. INSTANT WINS LEFT — genuine unclaimed instant-win slot count.
 *   3. null — omit the tile cleanly (the hero drops to two tiles).
 */
function featuredThirdMetric(
  hero: HomepageHeroData,
): { value: string; label: string; srLabel: string } | null {
  if (hero.instantCashRemainingPence != null && hero.instantCashRemainingPence > 0) {
    const value = formatGBP(hero.instantCashRemainingPence)
    return { value, label: "Still to win", srLabel: `${value} cash still to win` }
  }
  if (hero.instantWinsRemaining != null && hero.instantWinsRemaining > 0) {
    const n = hero.instantWinsRemaining
    return {
      value: n.toLocaleString("en-GB"),
      label: n === 1 ? "Instant win left" : "Instant wins left",
      srLabel: `${n.toLocaleString("en-GB")} instant wins left`,
    }
  }
  return null
}

export function HomepageHero({ hero }: { hero: HomepageHeroData | null }) {
  // Slot hidden when nothing is selected / selection is not currently eligible.
  if (!hero) return null
  return hero.state === "live" ? <LiveHero hero={hero} /> : <FeaturedHero hero={hero} />
}

/* ---------------------------------- shared --------------------------------- */

function ArtworkFallback({ live }: { live?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={
        "h-full w-full " +
        (live
          ? "bg-[radial-gradient(120%_100%_at_50%_0%,#3a0033_0%,#1a0020_60%,#0a0012_100%)]"
          : "bg-[radial-gradient(120%_100%_at_50%_0%,#2a1400_0%,#1a0a20_60%,#0a0012_100%)]")
      }
    />
  )
}

function ProgressBar({ percent, tone }: { percent: number; tone: "gold" | "live" }) {
  const fill =
    tone === "gold"
      ? "bg-[linear-gradient(90deg,#FFB900_0%,#FFD94C_72%,#FFF0A6_100%)] shadow-[0_0_6px_rgba(255,183,0,0.5)]"
      : "bg-[linear-gradient(90deg,#EC3CB5_0%,#FF5FC6_60%,#FF9AD9_100%)] shadow-[0_0_6px_rgba(236,60,181,0.55)]"
  const label = tone === "gold" ? "text-amber-300" : "text-pink-300"
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/70 ring-1 ring-inset ring-white/10">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={`shrink-0 text-xs font-black uppercase tracking-wide ${label}`}>
        {percent}% sold
      </span>
    </div>
  )
}

function Microcopy() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-white/45">
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Instant prizes awarded automatically
    </p>
  )
}

/* --------------------------------- FEATURED -------------------------------- */

function FeaturedHero({ hero }: { hero: HomepageHeroData }) {
  const href = hero.slug ? `/giveaways/${hero.slug}` : "/giveaways"
  const priceLabel = hero.isFreeEntry
    ? "FREE"
    : hero.basePricePence != null
      ? priceText(hero.basePricePence)
      : null
  const showWas =
    !hero.isFreeEntry &&
    hero.wasPricePence != null &&
    hero.basePricePence != null &&
    hero.wasPricePence > hero.basePricePence

  // Genuine third selling metric (cash-to-win / instant-wins-left) or null.
  const thirdMetric = featuredThirdMetric(hero)

  return (
    <section className="mb-6 md:mb-9" aria-label="Featured competition">
      <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-[24px] border border-[#DFA90A] bg-[#0a0012] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_4px_rgba(255,247,211,0.35),0_0_22px_rgba(255,194,29,0.28),0_0_60px_-18px_rgba(255,153,0,0.6)]">
        {/* Clean, tappable campaign artwork. The creative sells the dream, so
            the only UI allowed over it is one small admin badge (if configured).
            The whole image links to the giveaway — the visible primary action
            stays the "PLAY NOW" button below. */}
        <Link
          href={href}
          aria-label={hero.title ? `${hero.title} — play now` : "Featured competition — play now"}
          className="relative block aspect-[16/10] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 sm:aspect-[16/9]"
        >
          {hero.heroImageUrl ? (
            // Shared PromoMedia: poster renders immediately (LCP) and the
            // optional promo video autoplays silently over it. Identical
            // behaviour to the listing cards and detail hero.
            <PromoMedia
              imageUrl={hero.heroImageUrl}
              videoUrl={hero.promoVideoUrl}
              alt=""
              priority
              sizes="(max-width: 768px) 100vw, 672px"
            />
          ) : (
            <ArtworkFallback />
          )}

          {hero.badge ? (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-[linear-gradient(180deg,#FFE36A_0%,#FFC52E_45%,#FFA400_100%)] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-black shadow-[0_0_12px_rgba(255,183,0,0.5)]">
              <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {hero.badge}
            </span>
          ) : null}
        </Link>

        {/* Decision zone — everything the buyer weighs, directly under the art. */}
        <div className="space-y-2 px-4 pb-3 pt-2.5 sm:space-y-2.5 sm:pb-4 sm:pt-3 sm:px-5">
          <div className="space-y-1">
            <h2 className="wtf-display text-balance text-2xl font-black uppercase leading-[0.95] tracking-[-0.02em] text-white sm:text-3xl">
              {hero.title}
            </h2>
            {hero.endsAtMs != null ? <HeroUrgency endsAtMs={hero.endsAtMs} /> : null}
          </div>

          {/* Two strong commercial stats: entry price + genuine remaining
              opportunity (cash-to-win or instant-wins-left). % sold is NOT a
              tile here — it lives only on the progress bar below. Never unsold
              ticket inventory. Falls back to price-only when no genuine
              opportunity metric is available. */}
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col justify-center rounded-xl border border-amber-400/25 bg-black/45 px-3 py-1.5 text-center">
              {showWas ? (
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/40 line-through">
                  {priceText(hero.wasPricePence as number)}
                </span>
              ) : (
                <span className="text-[9px] font-bold uppercase tracking-wide text-white/45">
                  Tickets from
                </span>
              )}
              <span className="wtf-display text-xl font-black leading-none text-amber-300">
                {priceLabel ?? "—"}
              </span>
            </div>

            {thirdMetric ? (
              <div className="flex flex-1 flex-col justify-center rounded-xl border border-amber-400/25 bg-black/45 px-3 py-1.5 text-center">
                <span
                  className="wtf-display text-xl font-black leading-none text-amber-300"
                  title={thirdMetric.srLabel}
                >
                  {thirdMetric.value}
                </span>
                <span className="mt-1 text-[9px] font-bold uppercase tracking-wide text-white/45">
                  {thirdMetric.label}
                </span>
              </div>
            ) : null}
          </div>

          {hero.percentSold != null ? <ProgressBar percent={hero.percentSold} tone="gold" /> : null}

          <Link
            href={href}
            className="group flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl border border-[#FFE06A]/85 bg-[linear-gradient(180deg,#FFE36A_0%,#FFC52E_44%,#FFA400_100%)] px-4 text-lg font-black uppercase tracking-wide text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_0_14px_rgba(255,174,0,0.5)] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0012]"
          >
            Play Now
            <ArrowRight
              className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
              aria-hidden="true"
            />
          </Link>

          <Microcopy />
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------- LIVE ---------------------------------- */

function LiveHero({ hero }: { hero: HomepageHeroData }) {
  const href = hero.slug ? `/giveaways/${hero.slug}` : "/giveaways"
  const headline = hero.liveHeadline || "We're live right now"
  const subtext =
    hero.liveSubtext || "Watch the balloons pop live — pick your numbers and you could be next."
  const ctaLabel = hero.livePrimaryLabel || "Get Your Tickets Now"

  return (
    <section className="mb-6 md:mb-9" aria-label="Live now">
      <HeroLiveShell className="hero-live-shell relative mx-auto w-full max-w-2xl overflow-hidden rounded-[24px] border border-pink-500/60 bg-[#0a0012]">
        {/* Artwork zone with cinematic, animated live overlay. */}
        <div className="relative aspect-[16/11] w-full overflow-hidden sm:aspect-[16/9]">
          {hero.heroImageUrl ? (
            <Image
              src={hero.heroImageUrl}
              alt={hero.title || "Live competition"}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 672px"
              className="hero-kenburns object-cover"
            />
          ) : (
            <ArtworkFallback live />
          )}

          {/* Animated broadcast lighting — behind the UI, over the artwork. */}
          <div
            aria-hidden="true"
            className="hero-lighting pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_25%_15%,rgba(255,60,181,0.5)_0%,transparent_60%)] mix-blend-screen"
          />

          {/* Occasional diagonal studio-lighting sweep across the artwork. */}
          <div aria-hidden="true" className="hero-sweep pointer-events-none" />

          {/* Sparse ambient light glints (decorative — never implies a win). */}
          <span aria-hidden="true" className="hero-particle" style={{ left: "18%", top: "62%", animationDelay: "0s", animationDuration: "6.5s" }} />
          <span aria-hidden="true" className="hero-particle" style={{ left: "72%", top: "48%", animationDelay: "2.2s", animationDuration: "7.5s" }} />
          <span aria-hidden="true" className="hero-particle" style={{ left: "45%", top: "70%", animationDelay: "4.1s", animationDuration: "8s" }} />

          {/* Top scrim keeps the LIVE + Instant Wins pills legible over art. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/65 via-black/20 to-transparent"
          />

          {/* Top row: LIVE header — animated LIVE signal (left), INSTANT WINS
              (right). Reads as a live overlay, not ecommerce badges. */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white shadow-[0_0_16px_rgba(239,68,68,0.7)]">
                <span className="hero-eq" aria-hidden="true">
                  <span className="hero-eq-bar" />
                  <span className="hero-eq-bar" />
                  <span className="hero-eq-bar" />
                  <span className="hero-eq-bar" />
                </span>
                Live Now
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/85 backdrop-blur-sm">
              <Radio className="h-3.5 w-3.5 shrink-0 text-pink-300" aria-hidden="true" />
              Instant Wins Live
            </span>
          </div>

          {/* Lower fade + title + "we're live" banner. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#0a0012] via-[#0a0012]/92 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 space-y-2 p-4">
            {/* Compact broadcast status strip — true static status only, with a
                restrained horizontal shimmer. Overlaid on the artwork so it
                adds no card height. */}
            <div className="relative inline-flex max-w-full items-center gap-2 overflow-hidden rounded-md border border-pink-400/25 bg-black/45 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/75 backdrop-blur-sm">
              <span className="flex items-center gap-1.5 text-pink-200">
                <span className="relative flex size-1.5" aria-hidden="true">
                  <span className="hero-signal absolute inline-flex size-full rounded-full bg-pink-400" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-pink-400" />
                </span>
                WTF Live
              </span>
              <span className="text-white/25" aria-hidden="true">•</span>
              <span>Balloon Pop</span>
              <span className="text-white/25" aria-hidden="true">•</span>
              <span className="whitespace-nowrap">Instant Wins Live</span>
              <span className="hero-shimmer pointer-events-none" aria-hidden="true" />
            </div>

            <h2 className="wtf-display text-balance text-2xl font-black uppercase leading-[0.95] tracking-[-0.02em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)] sm:text-3xl">
              {hero.title}
            </h2>

            {/* Active LIVE status message — glow + moving highlight, text fixed. */}
            <div className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-[linear-gradient(90deg,#E11D48_0%,#EC3CB5_100%)] px-3 py-1 text-xs font-black uppercase italic tracking-wide text-white shadow-[0_0_14px_rgba(236,60,181,0.5)]">
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className="hero-signal absolute inline-flex size-full rounded-full bg-white" />
                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
              </span>
              {headline}
              <span className="hero-shimmer pointer-events-none" aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* Commerce area — compact. */}
        <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5">
          <p className="text-pretty text-sm font-medium leading-snug text-white/70">{subtext}</p>

          {/* Genuine live-board totals + pop event (client-polled, server-seeded).
              Omitted entirely when the board has no prize items configured —
              LIVE never depends on prize-board data. */}
          {hero.hasPrizeBoard ? (
            <HeroLiveStats
              campaignId={hero.campaignId}
              initialTotalLeft={hero.totalLeft}
              initialVipLeft={hero.vipLeft}
              initialLastEventLabel={hero.lastEventLabel}
              initialLastEventAt={hero.lastEventAt}
            />
          ) : null}

          {hero.percentSold != null ? <ProgressBar percent={hero.percentSold} tone="live" /> : null}

          <div className="space-y-2">
            <Link
              href={href}
              className="hero-live-cta group relative flex min-h-[54px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-pink-300/70 bg-[linear-gradient(180deg,#FF5FC6_0%,#EC3CB5_48%,#C31387_100%)] px-4 text-lg font-black uppercase tracking-wide text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0012]"
            >
              <Flame className="hero-flame-pulse relative h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="relative">{ctaLabel}</span>
              {/* Light moving through the gradient — button stays stationary. */}
              <span className="hero-shimmer pointer-events-none" aria-hidden="true" />
            </Link>

            {hero.watchUrl ? (
              <a
                href={hero.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-black/40 px-4 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0012]"
              >
                <span className="relative inline-flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                  <span className="hero-signal absolute inline-flex size-4 rounded-full bg-pink-500/50" />
                  <span className="hero-signal absolute inline-flex size-4 rounded-full bg-pink-500/40" style={{ animationDelay: "0.7s" }} />
                  <Radio className="relative h-4 w-4 text-pink-300" />
                </span>
                Watch Live
              </a>
            ) : null}
          </div>

          <Microcopy />
        </div>
      </HeroLiveShell>
    </section>
  )
}
