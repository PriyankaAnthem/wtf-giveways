import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { createPublicClient } from "@/lib/supabase/public"
import { CountdownBadge } from "@/components/countdown-badge"
import { TicketSelector } from "@/components/ticket-selector"
import { ExpandableDescription } from "@/components/expandable-description"
import { SocialProofRow } from "@/components/social-proof-row"
import { RulesAccordion } from "@/components/rules-accordion"
import { InstantWinDisclosure } from "@/components/instant-win-disclosure"
import { InstantWinList } from "@/components/instant-win-list"
import { PublicLiveBalloonBoard } from "@/components/giveaway/PublicLiveBalloonBoard"
import { PromoMedia } from "@/components/media/PromoMedia"
import { TrustBadges } from "@/components/trust-badges"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Shield, Award, ChevronRight, Zap } from "lucide-react"
import { ScrollToTopOnMount } from "@/components/scroll-to-top-on-mount"

export const revalidate = 60

interface GiveawayPageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function GiveawayPage({ params }: GiveawayPageProps) {
  const { slug } = await params
  const supabase = createPublicClient()

  // Filter by slug at the database-query level so unrelated campaigns
  // refreshing can never push this campaign's snapshots out of the result.
  const { data, error } = await supabase
    .from('giveaway_snapshots')
    .select('kind, payload')
    .in('kind', ['detail', 'list'])
    .eq('payload->>slug', slug)
    .order('generated_at', { ascending: false })
    .limit(2)

  if (error) {
    // A temporary database/query failure must not be presented as a 404.
    console.error('[giveaways/[slug]] snapshot fetch failed', {
      slug,
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
    })
    throw error
  }

  // Prefer the detail snapshot, fall back to list.
  const matchingRows = data ?? []
  const row =
    matchingRows.find((x) => x.kind === 'detail') ??
    matchingRows[0] ??
    null

  if (!row) {
    console.error('[giveaways/[slug]] snapshot missing', { slug })
    notFound()
  }

  const p = row.payload as Record<string, any>

  const title = p.title || 'Untitled'
  const prizeTitle = p.prize_title || p.title || 'Prize'
  const description =
    p.prize_description ||
    p.description ||
    p.subtitle ||
    null
  const prizeValueText = p.prize_value_text || null
  const heroImageUrl = p.hero_image_url || '/placeholder.svg'
  const images: string[] = p.images || [heroImageUrl]
  const status = p.status as "draft" | "live" | "paused" | "ended"
  const endsAt = new Date(p.ends_at)
  const ticketPrice = (p.base_ticket_price_pence ?? 0) / 100
  const wasTicketPricePence = p.was_ticket_price_pence ?? null
  // Snapshot payload `id` is the campaign id in our current snapshot shape
  const campaignId = p.id as string

  if (!campaignId) {
    console.error('[giveaways/[slug]] missing campaignId in snapshot payload', { slug, payloadKeys: Object.keys(p || {}) })
    notFound()
  }

  // presentation_type lives on the list snapshot payload (the detail payload
  // omits it), so read it from the already-fetched list row as a fallback.
  const listPayload = matchingRows.find((r) => r.kind === 'list')?.payload as Record<string, any> | undefined
  const presentationType = p.presentation_type ?? listPayload?.presentation_type ?? null
  const isBalloonPop = presentationType === 'balloon_pop'

  // Optional promo video (Video Phase 1), read from the snapshot payload only
  // (no live query). Absent => the media area stays image-only, unchanged.
  const rawPromoVideo = p.promo_video_url ?? listPayload?.promo_video_url ?? null
  const promoVideoUrl =
    typeof rawPromoVideo === 'string' && rawPromoVideo.trim() ? rawPromoVideo.trim() : null

  // Derive soldCount from snapshot payload only (no live DB query)
  const capTotal: number | null = p.hard_cap_total_tickets ?? null
  const soldCount =
    p.tickets_sold != null && !Number.isNaN(Number(p.tickets_sold))
      ? Number(p.tickets_sold)
      : 0

  const instantWins = Array.isArray(p.instant_wins) ? p.instant_wins : []
  const bundles = p.bundles || undefined
  const rulesText = p.rules_text || 'See full terms and conditions for complete rules.'
  const faqSnippet = p.faq_snippet || null
  const socialProof = p.social_proof || null

  const displayImages = images
  const isLive = status === "live"

  return (
  <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#3a0f4f_0%,_#1b0b2b_40%,_#0e0618_100%)] pb-8 text-white">
  <ScrollToTopOnMount />
  {/* Prize Hero Section */}
      <section className="border-b border-purple-500/20">
        <div className="container max-w-5xl px-4 py-8">
          <div className="grid gap-8 md:grid-cols-2">
            {/* Prize media. Shared PromoMedia: the artwork renders immediately
                as the poster/LCP/fallback; an optional promo video autoplays
                silently over it. Identical behaviour to the homepage hero and
                listing cards. */}
            <div className="space-y-4">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-white/5 shadow-2xl ring-1 ring-purple-500/30">
                <PromoMedia
                  imageUrl={displayImages[0] || "/placeholder.svg"}
                  videoUrl={promoVideoUrl}
                  alt={prizeTitle}
                  priority
                  sizes="(min-width: 768px) 512px, 100vw"
                  imageFit="contain"
                />
              </div>
              {displayImages.length > 1 && (
                <div className="grid grid-cols-3 gap-2">
                  {displayImages.slice(1, 4).map((img, i) => (
                    <div key={i} className="relative aspect-square overflow-hidden rounded-lg ring-1 ring-purple-500/20">
                      <Image
                        src={img || "/placeholder.svg"}
                        alt={`${prizeTitle} view ${i + 2}`}
                        fill
                        sizes="(min-width: 768px) 170px, 30vw"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prize Details */}
            <div className="space-y-6">
              <div>
                {/* Balloon Pop pages hide these duplicate urgency badges (the
                    live board shows its own live state and the ticket selector
                    shows the countdown), keeping the top focused on the buying
                    journey. Other giveaway types keep the badges. */}
                {!isBalloonPop && (
                  <div className="flex flex-wrap items-center gap-2 pb-3">
                    <CountdownBadge endsAt={endsAt} status={status} />
                    {isLive && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-[0_0_12px_rgba(255,0,0,0.5)]">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                        </span>
                        LIVE
                      </span>
                    )}
                  </div>
                )}
                <h1 className="wtf-display text-balance text-4xl font-extrabold leading-tight tracking-tight drop-shadow-[0_0_15px_rgba(255,0,200,0.4)] md:text-5xl">{title}</h1>
                {/* On Balloon Pop pages the description moves into a collapsed
                    "About this competition" section lower down (see Main Content). */}
                {!isBalloonPop && <ExpandableDescription text={description ?? prizeTitle} />}
                {prizeValueText && (
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-sm text-purple-200">Retail Value:</span>
                    <span className="wtf-display text-2xl font-bold text-brand">{prizeValueText}</span>
                  </div>
                )}
              </div>

              {/* NOTE: No default "LIVE NOW" block here. Hosts are not live 24/7,
                  so the giveaway detail page must never imply the host is live.
                  Any "LIVE NOW" state belongs only to the separate, host-controlled
                  Live Site Takeover feature. This page stays focused on entering. */}

              <Separator />

              <div id="choose-tickets" className="scroll-mt-24">
                <TicketSelector basePrice={ticketPrice} bundles={bundles} campaignId={campaignId} soldCount={soldCount} capTotal={capTotal} startsAt={p.starts_at ?? null} endsAt={p.ends_at ?? null} ticketsSold={p.tickets_sold != null ? Number(p.tickets_sold) : null} hardCapTotalTickets={p.hard_cap_total_tickets != null ? Number(p.hard_cap_total_tickets) : null} isFreeEntry={p.is_free_entry === true || p.is_free_entry === "true"} freeEntryLimitPerUser={p.free_entry_limit_per_user != null ? Number(p.free_entry_limit_per_user) : 1} wasPricePence={wasTicketPricePence} />
              </div>

              {/* Compact trust row — short, high-converting reassurance placed
                  directly under ticket selection. The full "Why Enter" section
                  remains lower down. */}
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-purple-200">
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  Secure payments
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  Instant entry
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-pink-400" aria-hidden="true" />
                  Winners paid fast
                </span>
              </div>

              {/* Remaining Balloon Board (Balloon Pop) — sits directly under the
                  trust row so the flow stays tight: tickets → trust → board.
                  It shows remaining prize values only and renders nothing until
                  the host enables it. It does NOT imply the host is live. */}
              {isBalloonPop && isLive && (
                <PublicLiveBalloonBoard campaignId={campaignId} />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <div className="container max-w-5xl px-4 py-8">
        <div className="space-y-8">
          {/* About this competition — the campaign description moved here (below
              the hero/tickets) on Balloon Pop pages, collapsed by default so the
              top of the page stays focused on entering. */}
          {isBalloonPop && description && (
            <details className="group rounded-lg border border-purple-500/20 bg-white/5 p-4 backdrop-blur-sm">
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-lg font-semibold">
                About this competition
                <ChevronRight className="h-5 w-5 shrink-0 text-purple-300 transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <ExpandableDescription text={description} />
            </details>
          )}

          {/* Instant Win Prizes — on Balloon Pop live pages this is renamed and
              collapsed by default on mobile to avoid overlapping with the Live
              Balloon Board above. Data/grouping logic is unchanged. */}
          <InstantWinDisclosure />
          <InstantWinList
            instantWins={instantWins}
            heading={isBalloonPop && isLive ? "What can still be won?" : undefined}
            collapsibleOnMobile={isBalloonPop && isLive}
          />

          {/* Social Proof */}
          {socialProof && (
            <SocialProofRow
              entrantCountBucket={socialProof.entrantCountBucket}
              recentAvatars={socialProof.recentAvatars}
            />
          )}

          {/* Trust & Reassurance — hidden on mobile (the compact trust strip
              directly beneath the ticket bundles already covers this). Desktop
              keeps the full section unchanged. */}
          <section className="hidden space-y-4 md:block">
            <h2 className="text-xl font-semibold">Why Enter with WTF Giveaways?</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex gap-3 rounded-lg border border-purple-500/20 bg-white/5 p-4 backdrop-blur-sm">
                <Shield className="h-5 w-5 shrink-0 text-pink-400" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold">Secure & Verified</h3>
                  <p className="text-sm leading-relaxed text-purple-200">
                    All payments processed through secure, encrypted channels. Your information is protected.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg border border-purple-500/20 bg-white/5 p-4 backdrop-blur-sm">
                <Award className="h-5 w-5 shrink-0 text-pink-400" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold">Transparent Winners</h3>
                  <p className="text-sm leading-relaxed text-purple-200">
                    Fair draws with transparent winner announcements. All winners are publicly verified.
                  </p>
                </div>
              </div>
            </div>
            <TrustBadges />
          </section>

          {/* Rules & Eligibility */}
          <section className="space-y-4">
            <RulesAccordion rulesText={rulesText} />
          </section>

          {/* FAQ Snippet */}
          {faqSnippet && (
            <section className="rounded-lg border border-purple-500/20 bg-white/5 p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold">Frequently Asked Questions</h2>
              <p className="mt-2 text-sm text-purple-200">{faqSnippet}</p>
              <Link
                href="/faq"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
              >
                View all FAQs
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </section>
          )}
        </div>
      </div>

      {/* Bottom spacer so the mobile sticky purchase bar never covers the last
          of the page content (rules/FAQ). Mobile only. */}
      <div className="h-52 md:hidden" aria-hidden="true" />
    </div>
  )
}
