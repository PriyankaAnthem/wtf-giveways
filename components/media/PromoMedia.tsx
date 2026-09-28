'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * PromoMedia — the SINGLE promotional media renderer shared by every campaign
 * surface (homepage featured hero, /giveaways listing cards, and the
 * /giveaways/[slug] detail hero). There is deliberately ONE implementation so
 * behaviour is identical everywhere; do not fork per-surface variants.
 *
 * Contract (canonical field names `promo_video_url` / `promo_video_duration_s`
 * are mapped to `imageUrl` / `videoUrl` by each caller):
 *
 *   1. The campaign `hero_image_url` renders IMMEDIATELY as a `next/image`
 *      (fill). It is the LCP asset and is never removed — it also stays visible
 *      as the loading, error and reduced-motion fallback.
 *   2. The optional promo video is a DECORATIVE enhancement layered OVER the
 *      poster. Its `src` is assigned only after mount AND only once the media is
 *      near the viewport (IntersectionObserver), so it never delays LCP and a
 *      grid of cards never fetches every clip at once.
 *   3. Silent autoplay only: `autoPlay muted loop playsInline controls={false}`.
 *      No click-to-play, no play button, no native controls.
 *   4. No blank/black frame: the <video> stays fully transparent (poster shows
 *      through) until it is genuinely `canplay`/`playing`, and reverts to
 *      transparent on any error/stall/empty.
 *   5. `prefers-reduced-motion: reduce` => the video element is never rendered,
 *      so the poster simply remains.
 *
 * The element is `pointer-events-none` + `aria-hidden` so taps fall through to
 * any wrapping link and it is ignored by assistive tech.
 *
 * The PARENT owns the positioned, clipped, aspect-ratio container; both layers
 * fill it absolutely.
 */
export interface PromoMediaProps {
  /** Required poster / LCP / fallback image (campaign `hero_image_url`). */
  imageUrl: string
  /** Optional promo video (`promo_video_url`); absent/empty => image only. */
  videoUrl?: string | null
  alt: string
  /** `next/image` responsive sizes for the poster. */
  sizes?: string
  /** High-priority poster load — use ONLY for a true LCP image. */
  priority?: boolean
  /** Poster object-fit. Defaults to `cover`; detail hero uses `contain`. */
  imageFit?: 'cover' | 'contain'
  /** Extra classes applied to BOTH layers so transforms stay locked together
   *  (e.g. `group-hover:scale-105`). */
  className?: string
}

export function PromoMedia({
  imageUrl,
  videoUrl,
  alt,
  sizes,
  priority = false,
  imageFit = 'cover',
  className,
}: PromoMediaProps) {
  const hasVideo = typeof videoUrl === 'string' && videoUrl.trim().length > 0
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [allowMotion, setAllowMotion] = useState(false)
  const [playing, setPlaying] = useState(false)

  // Client-only gate: render the <video> only after mount and only when motion
  // is allowed. This keeps SSR/first paint as the poster alone.
  useEffect(() => {
    setMounted(true)
    setAllowMotion(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  }, [])

  // Assign the source + start playback only when the media is near the viewport.
  // Loading after mount (never before) guarantees the poster wins the LCP race,
  // and the IntersectionObserver means a listing grid loads clips lazily.
  useEffect(() => {
    if (!mounted || !hasVideo || !allowMotion) return
    const video = videoRef.current
    if (!video) return

    let started = false
    const start = () => {
      if (started) return
      started = true
      video.muted = true
      if (!video.getAttribute('src')) {
        video.setAttribute('src', videoUrl as string)
        try {
          video.load()
        } catch {
          /* any failure simply leaves the poster showing */
        }
      }
      video.play().catch(() => {
        /* muted autoplay is broadly allowed; if blocked, poster stays */
      })
    }

    if (typeof IntersectionObserver === 'undefined') {
      start()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            start()
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [mounted, hasVideo, allowMotion, videoUrl])

  return (
    <>
      <Image
        src={imageUrl || '/placeholder.svg'}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        className={cn(imageFit === 'contain' ? 'object-contain' : 'object-cover', className)}
      />

      {mounted && hasVideo && allowMotion ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          controls={false}
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          onCanPlay={() => setPlaying(true)}
          onPlaying={() => setPlaying(true)}
          onError={() => setPlaying(false)}
          onStalled={() => setPlaying(false)}
          onEmptied={() => setPlaying(false)}
          className={cn(
            'pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
            playing ? 'opacity-100' : 'opacity-0',
            className,
          )}
        />
      ) : null}
    </>
  )
}
