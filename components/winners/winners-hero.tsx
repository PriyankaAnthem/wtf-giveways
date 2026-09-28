import Image from "next/image"
import { Trophy } from "lucide-react"

interface WinnersHeroProps {
  /** Exact eligible-winner count (server-cached). null → fixed fallback. */
  winnerCount?: number | null
}

/** Format an integer with locale thousands separators (e.g. 1866 -> "1,866"). */
function formatCount(n: number): string {
  return n.toLocaleString("en-GB")
}

/**
 * Winners hero — a high-converting WTF promotional creative (NOT a dashboard
 * stats card).
 *
 * Composition: deep near-black WTF-purple panel with a magenta radial glow,
 * the supplied gold trophy graphic integrated to the right of the copy (it
 * overlaps the headline slightly), large marketing typography on the left, and
 * two compact stat chips underneath. The winner count is live (falls back to
 * 1,866+ only when unavailable); the paid-out figure is a fixed trust
 * statement. No fetch/state/reporting here.
 */
export function WinnersHero({ winnerCount }: WinnersHeroProps) {
  const winnersValue =
    typeof winnerCount === "number" && winnerCount > 0 ? `${formatCount(winnerCount)}+` : "1,866+"

  return (
    <section
      aria-labelledby="winners-hero-heading"
      className="relative overflow-hidden rounded-[24px] bg-[#12001f] px-5 py-6 md:px-10 md:py-10"
    >
      {/* Purple/magenta radial glow bloom behind the trophy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 top-1/2 h-[130%] w-[75%] -translate-y-1/2 rounded-full opacity-90"
        style={{
          background:
            "radial-gradient(circle at 60% 50%, rgba(214,64,255,0.42) 0%, rgba(124,32,181,0.30) 34%, rgba(18,0,31,0) 68%)",
        }}
      />
      {/* Soft top-left brand wash + gold hairline for a premium edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 0% 0%, rgba(93,20,140,0.55) 0%, rgba(18,0,31,0) 55%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FCD253]/50 to-transparent"
      />

      <div className="relative z-10 flex items-center gap-2 sm:gap-4">
        {/* Copy */}
        <div className="min-w-0 flex-1">
          {/* Eyebrow pill */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FCD253]/30 bg-[#FCD253]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#FCD253] md:text-[11px]">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            WTF Winners
          </span>

          <h1 id="winners-hero-heading" className="mt-3 md:mt-4">
            <span className="block bg-gradient-to-b from-[#FFF3C4] via-[#FCD253] to-[#EE9C0C] bg-clip-text text-[38px] font-black leading-[0.88] tracking-tight text-transparent tabular-nums [text-shadow:0_2px_18px_rgba(238,156,12,0.25)] sm:text-[54px] md:text-[80px]">
              £200,000+
            </span>
            <span className="mt-1.5 block text-[15px] font-extrabold uppercase leading-tight tracking-[0.12em] text-white sm:text-lg md:mt-2 md:text-3xl">
              Won by WTF players
            </span>
          </h1>

          <p className="mt-2.5 max-w-sm text-pretty text-[13px] text-white/70 sm:text-sm md:mt-3 md:text-base">
            Real winners. Real prizes. Every week.
          </p>
        </div>

        {/* Trophy — supplied graphic, integrated on the right and overlapping
            the headline slightly. Floats gently; glow breathes behind it. */}
        <div className="relative shrink-0 -ml-1 w-[136px] sm:ml-0 sm:w-[184px] md:w-[264px] lg:w-[288px]">
          <div
            aria-hidden="true"
            className="trophy-glow pointer-events-none absolute left-1/2 top-1/2 h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(245,197,66,0.45) 0%, rgba(245,158,11,0.20) 40%, rgba(245,158,11,0) 70%)",
            }}
          />
          <Image
            src="/winners/wtf-trophy.png"
            alt="WTF Giveaways championship trophy"
            width={576}
            height={634}
            priority
            sizes="(min-width: 1024px) 288px, (min-width: 768px) 264px, (min-width: 640px) 184px, 150px"
            className="trophy-float relative h-auto w-full drop-shadow-[0_16px_28px_rgba(0,0,0,0.45)]"
          />
        </div>
      </div>

      {/* Two compact stats */}
      <dl className="relative z-10 mt-5 grid max-w-md grid-cols-2 gap-2.5 md:mt-7 md:gap-3">
        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-sm">
          <dt className="text-xl font-black leading-none text-[#FCD253] tabular-nums md:text-2xl">£200k+</dt>
          <dd className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-white/60">Paid out</dd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-sm">
          <dt className="text-xl font-black leading-none text-[#FCD253] tabular-nums md:text-2xl">{winnersValue}</dt>
          <dd className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-white/60">Winners</dd>
        </div>
      </dl>
    </section>
  )
}
