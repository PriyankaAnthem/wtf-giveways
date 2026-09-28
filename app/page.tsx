import { Button } from "@/components/ui/button"
import Link from "next/link"
import Image from "next/image"
import { ChevronRight } from "lucide-react"
import { HomepageHero } from "@/components/home/HomepageHero"
import { loadHomepageHero } from "@/lib/homepage-hero"
import { HomeRailNav, type HomeNavItem } from "@/components/home/HomeRailNav"
import { RailScroller } from "@/components/home/RailScroller"
import { RailIcon } from "@/components/home/rail-icons"
import { PublicGiveawayCard } from "@/components/public-giveaway-card"
import { loadHomepageRails } from "@/lib/admin/homepage-merchandising"
import { RAIL_PRESENTATION, type RailIconKey, type CardAccent } from "@/lib/admin/homepage-rails"
import { classifyGiveaway, sortGiveaways, type GiveawayCategory } from "@/lib/giveaway-classification"

// Emergency fallback data - used only if there are no eligible competitions.
const emergencyFeaturedGiveaway = {
  title: "Super Holiday",
  subtitle: "Enter now for your chance to win our live Super Holiday giveaway.",
  status: "Live now",
  ctaHref: "/giveaways/superholiday",
  ctaLabel: "Enter Now",
}

// Presentation defaults for the single safety rail (only used when merchandising
// produced no rails but eligible competitions exist). Amber/gold, links to the
// full catalogue — a real route, never an invented category URL.
const FALLBACK_PRESENTATION = {
  icon: "hot" as RailIconKey,
  cardAccent: "gold" as CardAccent,
  navActiveClass:
    "bg-gradient-to-b from-amber-400/30 to-amber-500/10 text-amber-100 ring-1 ring-amber-300/70 shadow-[0_0_20px_rgba(251,191,36,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]",
  navIdleClass: "bg-[#15012e] text-amber-100/75 ring-1 ring-amber-400/25 hover:ring-amber-300/50 hover:text-amber-100",
  accentText: "text-amber-300",
  sectionGlow: "bg-[radial-gradient(130%_90%_at_0%_0%,rgba(251,191,36,0.18),transparent_62%)]",
  viewAllHref: "/giveaways",
}

interface RailSection {
  key: string
  navLabel: string
  heading: string
  tagline: string
  icon: RailIconKey
  cardAccent: CardAccent
  navActiveClass: string
  navIdleClass: string
  accentText: string
  sectionGlow: string
  viewAllHref: string
  items: { giveaway: any; category: GiveawayCategory }[]
}

/** Split a heading into its first word (accented) and the remainder (white),
 *  matching the approved concept ("MEGA" gold, "JACKPOT DROPS" white). */
function splitHeading(heading: string): { lead: string; rest: string } {
  const idx = heading.indexOf(" ")
  if (idx === -1) return { lead: heading, rest: "" }
  return { lead: heading.slice(0, idx), rest: heading.slice(idx + 1) }
}

export default async function HomePage() {
  // Exactly TWO Supabase queries (list snapshots + placements), then in-memory
  // grouping/ordering via the shared builder. No query-per-category, no N+1,
  // no client-side Supabase.
  const { rails, eligiblePayloads, railOrder } = await loadHomepageRails()

  // Resolve the single Homepage Main Banner (hero) from the pre-existing
  // homepage_hero singleton, using the ALREADY-loaded eligible payloads (no
  // extra list query). Returns null when the slot is hidden — so the top slot
  // simply renders nothing, exactly like the previous LiveNowTakeover.
  const hero = await loadHomepageHero(eligiblePayloads)

  // Build only NON-EMPTY rails, in the ADMIN-CONFIGURED section order (which
  // always resolves to the full six rails, falling back to the canonical
  // HOMEPAGE_RAILS order). Each carries its customer-facing presentation copy +
  // accent identity; each payload's badge category comes from the shared
  // classifier so the card matches the product. Order of campaigns WITHIN a
  // rail is unchanged — that still comes from the rail builder.
  const sections: RailSection[] = railOrder.map((rail) => {
    const pres = RAIL_PRESENTATION[rail]
    return {
      key: rail,
      navLabel: pres.navLabel,
      heading: pres.heading,
      tagline: pres.tagline,
      icon: pres.icon,
      cardAccent: pres.cardAccent,
      navActiveClass: pres.navActiveClass,
      navIdleClass: pres.navIdleClass,
      accentText: pres.accentText,
      sectionGlow: pres.sectionGlow,
      viewAllHref: pres.viewAllHref,
      items: rails[rail].map((e) => ({
        giveaway: e.payload,
        category: classifyGiveaway(e.payload),
      })),
    }
  }).filter((v) => v.items.length > 0)

  // Fail-safe: if merchandising produced no rails but there ARE eligible live
  // competitions, show a single safety rail from the already-fetched payloads —
  // no extra query. Only when nothing is eligible at all do we fall back to the
  // static emergency card below.
  if (sections.length === 0 && eligiblePayloads.length > 0) {
    sections.push({
      key: "all",
      navLabel: "LIVE",
      heading: "LIVE GIVEAWAYS",
      tagline: "Every competition open right now.",
      ...FALLBACK_PRESENTATION,
      items: sortGiveaways(eligiblePayloads).map((p) => ({
        giveaway: p,
        category: classifyGiveaway(p),
      })),
    })
  }

  const hasAny = sections.length > 0
  const navItems: HomeNavItem[] = sections.map((s) => ({
    key: s.key,
    label: s.navLabel,
    icon: s.icon,
    activeClass: s.navActiveClass,
    idleClass: s.navIdleClass,
  }))

  return (
    // Near-black casino base. Room sections layer their own faint accent glows;
    // the competition artwork stays the dominant visual on this dark ground.
    <div className="min-h-screen bg-[#08000f]">
      {/* LIVE NOW site takeover — renders only when a takeover is enabled. Tight
          top padding keeps conversion content high on first load. */}
      <div className="container px-4 pt-4 md:pt-10">
        {/* Approved Homepage Main Banner — the single hero slot. Renders the
            Featured or Balloon-LIVE design, or nothing when no hero is set. */}
        <HomepageHero hero={hero} />
        {/* Accessible page title without disrupting the visual hierarchy. */}
        <h1 className="sr-only">Win with WTF Giveaways</h1>
      </div>

      {hasAny ? (
        // Nav + sections share ONE container so the sticky nav stays pinned
        // while the reader travels through every section (a sticky element only
        // sticks within its own parent's box).
        <div className="container px-4 pb-16">
          {/* Sticky scroll-spy casino lobby nav (client, tiny). */}
          <HomeRailNav items={navItems} />

          <div className="space-y-10 md:space-y-14">
            {sections.map((section, sectionIndex) => (
              <section
                key={section.key}
                id={`home-rail-${section.key}`}
                data-home-rail-section
                data-rail-key={section.key}
                aria-label={section.heading}
                // Offset for the sticky header (64px) + sticky nav so smooth
                // scroll / anchor jumps land below the chrome, not under it.
                className="relative scroll-mt-32 isolate"
              >
                {/* Very faint per-category radial atmosphere behind the header.
                    CSS-only, pointer-events-none, sits below content (-z-10). */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute -inset-x-4 -top-4 -z-10 h-40 ${section.sectionGlow}`}
                />

                {/* Premium casino-room header. PRESENTATION ONLY:
                    same heading/copy/link data, stronger layered lighting. */}
                <header className="mb-5">
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/* Layered illuminated hex emblem:
                          outer bloom -> halo -> crisp hex -> dark face -> icon. */}
                      <span
                        aria-hidden="true"
                        className={`relative inline-flex h-[50px] w-[50px] shrink-0 items-center justify-center ${section.accentText} sm:h-14 sm:w-14`}
                      >
                        <span className="absolute -inset-[7px] bg-current opacity-[0.16] blur-[9px] [clip-path:polygon(50%_0%,100%_25%,100%_75%,50%_100%,0%_75%,0%_25%)]" />
                        <span className="absolute -inset-[3px] bg-current opacity-[0.20] blur-[4px] [clip-path:polygon(50%_0%,100%_25%,100%_75%,50%_100%,0%_75%,0%_25%)]" />
                        <span className="absolute inset-0 bg-current [clip-path:polygon(50%_0%,100%_25%,100%_75%,50%_100%,0%_75%,0%_25%)]" />
                        <span className="absolute inset-[2px] bg-[#08000f] [clip-path:polygon(50%_0%,100%_25%,100%_75%,50%_100%,0%_75%,0%_25%)]" />
                        <span className="absolute inset-[3px] bg-[linear-gradient(155deg,rgba(255,255,255,0.14)_0%,transparent_42%,rgba(0,0,0,0.22)_100%)] [clip-path:polygon(50%_0%,100%_25%,100%_75%,50%_100%,0%_75%,0%_25%)]" />
                        <span className="absolute left-[18%] right-[18%] top-[1px] h-px bg-white/80 blur-[0.5px]" />
                        <RailIcon name={section.icon} className="relative h-[23px] w-[23px] drop-shadow-[0_0_5px_currentColor] sm:h-6 sm:w-6" />
                      </span>

                      {(() => {
                        const { lead, rest } = splitHeading(section.heading)
                        return (
                          <h2 className="wtf-display min-w-0 whitespace-nowrap text-[20px] font-black uppercase leading-none tracking-[-0.035em] sm:text-[24px] md:text-4xl">
                            <span className={section.accentText}>{lead}</span>
                            {rest ? <span className="text-white"> {rest}</span> : null}
                          </h2>
                        )
                      })()}
                    </div>

                    <Link
                      href={section.viewAllHref}
                      prefetch={false}
                      className={`group/viewall relative inline-flex h-[42px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[15px] border border-current bg-[#070009]/90 px-3 text-[10px] font-black uppercase tracking-[0.045em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[filter,box-shadow] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08000f] sm:px-4 sm:text-[11px] ${section.accentText}`}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -inset-[4px] -z-10 rounded-[18px] bg-current opacity-[0.10] blur-[7px]"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-[18%] right-[18%] top-[-1px] h-px bg-white/65 blur-[0.5px]"
                      />
                      View all
                      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover/viewall:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
                    </Link>
                  </div>

                  <p className="mt-2 text-pretty text-[13px] font-medium leading-snug text-white/58 sm:text-sm">
                    {section.tagline}
                  </p>

                  {/* Casino light seam: mostly dark with one white-hot accent node. */}
                  <div className={`relative mt-3 h-px w-full ${section.accentText}`}>
                    <span className="absolute inset-0 bg-current opacity-25" />
                    <span className="absolute left-[6%] top-1/2 h-[3px] w-[38%] -translate-y-1/2 bg-current opacity-38 blur-[2px]" />
                    <span className="absolute left-[22%] top-1/2 h-[2px] w-[86px] -translate-y-1/2 bg-current opacity-95 blur-[0.4px]" />
                    <span className="absolute left-[31%] top-1/2 h-[7px] w-[18px] -translate-y-1/2 rounded-full bg-white opacity-65 blur-[4px]" />
                  </div>
                </header>

                {/* Cards are SERVER-rendered here and passed into the client
                    RailScroller as children — giveaway payloads stay server-side. */}
                <RailScroller
                  label={section.heading}
                  topGutter={
                    section.key === "featured" &&
                    section.items.some((item) => item.giveaway.slug === "lvbag")
                  }
                >
                  {section.items.map((item, itemIndex) => {
                    // Stage-3 pilot: a PRESENTATIONAL foreground breakout for
                    // Liz's LV Alma BB competition in Featured only.
                    //
                    // This does not alter rail membership, card data, click
                    // behaviour, /giveaways, or any other competition.
                    const isLizLvBreakout =
                      section.key === "featured" && item.giveaway.slug === "lvbag"

                    return (
                      <div
                        key={`${section.key}:${item.giveaway.slug ?? item.giveaway.id}`}
                        className="relative w-[85%] shrink-0 snap-start sm:w-[60%] md:w-[46%] lg:w-[31%] xl:w-[23%]"
                      >
                        {isLizLvBreakout && (
                          <>
                            {/* Cheap CSS atmosphere behind the transparent cutout. */}
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute -right-[8%] -top-[58px] z-[4] h-[290px] w-[230px] rounded-full bg-fuchsia-500/15 blur-[34px]"
                            />

                            {/* Transparent foreground layer.
                                - Lives OUTSIDE PublicGiveawayCard so the shared
                                  card component remains untouched.
                                - pointer-events-none means the existing card link
                                  remains the interactive target.
                                - Bottom mask gently merges Liz into the artwork
                                  instead of ending on a hard PNG crop. */}
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute -right-[7%] -top-[68px] z-[5] w-[70%] max-w-[280px] select-none"
                              style={{
                                WebkitMaskImage:
                                  "linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%)",
                                maskImage:
                                  "linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%)",
                              }}
                            >
                              <Image
                                src="/images/liz-lv-alma-bb-breakout.webp"
                                alt=""
                                width={640}
                                height={960}
                                loading={sectionIndex === 0 ? "eager" : "lazy"}
                                sizes="(max-width: 640px) 250px, 280px"
                                className="h-auto w-full [filter:drop-shadow(0_0_4px_rgba(255,237,186,0.38))_drop-shadow(0_0_13px_rgba(255,45,183,0.34))_drop-shadow(0_16px_18px_rgba(0,0,0,0.34))]"
                              />
                            </div>
                          </>
                        )}

                        {/* Keep exactly ONE prioritised artwork image on the
                            homepage. When the hero is present it is the mobile
                            LCP candidate, so it alone gets priority; the first
                            rail card only claims priority when there is no hero.
                            The breakout image uses eager/lazy loading only. */}
                        <PublicGiveawayCard
                          giveaway={item.giveaway}
                          category={item.category}
                          compact
                          accent={section.cardAccent}
                          imagePriority={!hero && sectionIndex === 0 && itemIndex === 0}
                        />
                      </div>
                    )
                  })}
                </RailScroller>
              </section>
            ))}
          </div>
        </div>
      ) : (
        // Emergency fallback - single static card when nothing is eligible.
        <div className="container px-4 pb-16">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm md:p-8">
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="inline-flex items-center rounded-full bg-green-500/20 px-3 py-1 text-sm font-medium text-green-400">
                {emergencyFeaturedGiveaway.status}
              </span>
              <h2 className="wtf-display text-2xl font-bold text-white md:text-3xl">{emergencyFeaturedGiveaway.title}</h2>
              <p className="max-w-md text-white/70">{emergencyFeaturedGiveaway.subtitle}</p>
              <Button
                size="lg"
                className="mt-4 rounded-xl bg-gradient-to-r from-[#FFD700] to-[#FFA500] font-semibold text-black shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                asChild
              >
                <Link href={emergencyFeaturedGiveaway.ctaHref}>{emergencyFeaturedGiveaway.ctaLabel}</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
