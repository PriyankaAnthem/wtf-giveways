import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Radio } from "lucide-react"
import { getLiveNow } from "@/lib/live-now"

/**
 * Public "LIVE NOW" site takeover banner.
 *
 * Server component. Renders nothing unless a takeover is enabled, and
 * getLiveNow() never throws, so the homepage/listing always loads even if the
 * lookup fails. No polling, no realtime, no animation libraries — the live
 * pulse/glow is pure CSS.
 */
export async function LiveNowTakeover() {
  const live = await getLiveNow()
  if (!live) return null

  const href = live.slug ? `/giveaways/${live.slug}` : "/giveaways"
  const primaryLabel = live.primaryLabel?.trim() || "Enter Now"

  return (
    <section className="mb-10">
      <div className="relative overflow-hidden rounded-2xl border border-pink-500/40 bg-gradient-to-r from-[#2a0025] via-[#3a0040] to-[#1a0030] shadow-[0_0_40px_rgba(236,72,153,0.35)]">
        {/* CSS-only glow pulse layer (decorative). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_20%_50%,rgba(236,72,153,0.25),transparent_60%)]"
        />

        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          {live.heroImageUrl ? (
            <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl sm:aspect-square sm:w-32">
              <Image
                src={live.heroImageUrl}
                alt={live.title || "Live giveaway"}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, 128px"
              />
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">
                {/* CSS-only blinking live dot. */}
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-white" />
                </span>
                Live Now
              </span>
              <Radio className="size-4 text-pink-300" aria-hidden="true" />
            </div>

            <h2 className="mt-2 text-balance text-xl font-bold text-white sm:text-2xl">
              {live.headline || live.title || "We're live now"}
            </h2>
            {live.subtext ? (
              <p className="mt-1 text-pretty text-sm text-white/70">{live.subtext}</p>
            ) : null}

            {live.totalLeft > 0 ? (
              <p className="mt-2 text-sm font-medium text-pink-200">
                {live.totalLeft} prizes left
                {live.vipLeft > 0 ? <span className="text-amber-300"> · {live.vipLeft} VIP</span> : null}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:w-44">
            <Link
              href={href}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#FFD700] to-[#FFA500] px-4 py-2.5 text-sm font-bold text-black transition-transform hover:-translate-y-0.5"
            >
              {primaryLabel}
              <ArrowRight className="ml-2 size-4" aria-hidden="true" />
            </Link>
            {live.watchUrl ? (
              <a
                href={live.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-white/25 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Watch live
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
