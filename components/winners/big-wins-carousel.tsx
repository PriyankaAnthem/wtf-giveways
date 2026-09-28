"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronRight, Flame } from "lucide-react"
import { type BigWinDTO, formatTicket, formatWonOn } from "@/lib/big-wins"
import { cn } from "@/lib/utils"

interface BigWinsCarouselProps {
  items: BigWinDTO[]
}

/**
 * BIG WINS — curated marketing / social-proof cards (NOT the automatic feed).
 *
 * A CSS scroll-snap rail of compact PORTRAIT cards: on mobile ~2.5–3 cards are
 * visible at once with the next card peeking in from the right; on desktop the
 * larger cards show ~4–5 across. Winner photography dominates each card. Small
 * pagination dots track scroll position (click to jump). No autoplay, no big
 * arrows.
 *
 * Renders nothing when there are no active curated wins, so the public page
 * degrades cleanly before any Big Wins are added in the admin.
 */
export function BigWinsCarousel({ items }: BigWinsCarouselProps) {
  const scrollerRef = useRef<HTMLUListElement>(null)
  const cardRefs = useRef<(HTMLLIElement | null)[]>([])
  const [active, setActive] = useState(0)

  const hasItems = items && items.length > 0

  // Track which card is nearest the left edge to highlight the matching dot.
  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const left = scroller.scrollLeft
    let nearest = 0
    let best = Number.POSITIVE_INFINITY
    cardRefs.current.forEach((el, i) => {
      if (!el) return
      const dist = Math.abs(el.offsetLeft - scroller.offsetLeft - left)
      if (dist < best) {
        best = dist
        nearest = i
      }
    })
    setActive(nearest)
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [onScroll])

  if (!hasItems) return null

  function jumpTo(i: number) {
    const el = cardRefs.current[i]
    const scroller = scrollerRef.current
    if (!el || !scroller) return
    scroller.scrollTo({ left: el.offsetLeft - scroller.offsetLeft, behavior: "smooth" })
  }

  return (
    <section aria-labelledby="big-wins-heading" className="mt-6 md:mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="big-wins-heading" className="flex items-center gap-2 text-lg font-black text-white md:text-xl">
            Big Wins
            <Flame className="h-5 w-5 text-orange-400" aria-hidden="true" />
          </h2>
          <p className="mt-0.5 text-sm text-white/55">Some of our biggest WTF wins</p>
        </div>
        <Link
          href="/giveaways"
          className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-[#FCD253] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FCD253]/60"
        >
          See more
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="-mx-4 md:mx-0">
        <ul
          ref={scrollerRef}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:gap-4 md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item, i) => (
            <li
              key={item.id}
              ref={(el) => {
                cardRefs.current[i] = el
              }}
              className="w-[132px] shrink-0 snap-start sm:w-[150px] md:w-[190px]"
            >
              <BigWinCard item={item} />
            </li>
          ))}
        </ul>
      </div>

      {/* Pagination dots */}
      {items.length > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-1.5" role="tablist" aria-label="Big wins">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active === i}
              aria-label={`Show big win ${i + 1}`}
              onClick={() => jumpTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FCD253]/60 motion-reduce:transition-none",
                active === i ? "w-5 bg-[#FCD253]" : "w-1.5 bg-white/25 hover:bg-white/40",
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function BigWinCard({ item }: { item: BigWinDTO }) {
  const ticket = formatTicket(item.ticketNumber)

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#FCD253]/25 bg-gradient-to-b from-[#2b0f47] to-[#160826] shadow-[0_8px_26px_rgba(0,0,0,0.45)]">
      {/* Prize headline — bold bar at the very top. */}
      <div className="bg-black/30 px-2.5 py-1.5">
        <p className="truncate text-center text-sm font-black leading-tight text-[#FCD253] tabular-nums md:text-base">
          {item.prizeText}
        </p>
      </div>

      {/* Winner photo — the dominant visual (~62% of card height). */}
      <div className="relative h-[128px] w-full overflow-hidden bg-[#0f0620] md:h-[176px]">
        <Image
          src={item.imageUrl || "/placeholder.svg"}
          alt={`${item.winnerName} — ${item.prizeText} winner`}
          fill
          sizes="(min-width: 768px) 190px, 150px"
          className="object-cover"
          style={{ objectPosition: `${item.imagePosX}% ${item.imagePosY}%` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#160826] to-transparent"
        />
      </div>

      {/* Winner name + competition + date. */}
      <div className="flex flex-1 flex-col gap-0.5 px-2.5 py-2">
        <p className="truncate text-sm font-bold text-white">{item.winnerName}</p>
        <p className="line-clamp-1 text-[11px] text-white/55">{item.competition}</p>
        <p className="mt-0.5 text-[10px] text-white/40">
          {formatWonOn(item.wonOn)}
          {ticket ? <span className="tabular-nums"> · {ticket}</span> : null}
        </p>
      </div>
    </article>
  )
}
