"use client"

/**
 * DgFootballReveal (PRODUCTION) — the checkout-success entry point for the
 * DG'S BIG BALLERS reveal (reveal_type = "dg_football").
 *
 * This is a THIN wrapper around the approved, shared game core that lives in
 * components/reveal/dg-football (the same code the /dgfootballidea sandbox
 * renders). It contains NONE of the demo controls, outcome presets, mock
 * awards, forced-win modes, destination selectors, speed controls or debug
 * guides — production is driven ONLY by the real, already-decided AwardPayload,
 * mapped to the presentation model by the explicit `awardToRevealPlan` adapter.
 *
 * SAFETY: presentation only. It never mutates the award, never calls an
 * API/Supabase, and never decides a win. `prizes[]` is the source of truth for
 * every animated + itemised award (no cap). Asset/animation failures are
 * additionally contained by the RevealErrorBoundary on the success page, which
 * falls back to NormalCheckoutReveal so a confirmed checkout can never blank.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { DgFootballReveal as DgFootballGame } from "@/components/reveal/dg-football/DgFootballReveal"
import { DG_FOOTBALL_CSS } from "@/components/reveal/dg-football/styles"
import type { DemoSettings, SoundCue } from "@/components/reveal/dg-football/types"
import { awardToRevealPlan, type DgFootballAward } from "./dgFootballAdapter"

type Prize = {
  award_id?: string | null
  title: string
  value_text?: string | null
  image_url?: string | null
  // Canonical, admin-chosen fulfilment metadata carried through from the live
  // RPC (via coercePrize). The adapter classifies from these first.
  fulfilment_type?: "cash" | "wallet_credit" | "manual" | null
  prize_value_pence?: number | null
}

type RevealAward = DgFootballAward & {
  confirmed?: boolean
  checkout_ref?: string
  prize: Prize | null
  prizes?: Prize[]
  campaign_slug?: string | null
}

/**
 * Fixed production presentation config. Reuses the game's settings shape but
 * every dev/demo control is pinned to a safe production value. The mock
 * `resultPreset` / `ticketCount` fields are IGNORED at runtime because a real
 * `plan` is always provided to the core.
 */
const BASE_SETTINGS: Omit<DemoSettings, "reducedMotion"> = {
  resultPreset: "none",
  ticketCount: 1,
  soundOn: false, // production launches SILENT (no autoplay audio, spec §27)
  speed: 1,
  skipIntro: false,
  destination: "auto",
  charPreview: "off",
  showHoleBounds: false,
  showHoleCentres: false,
  showBallOrigin: false,
  showControlPoints: false,
  showEndpoint: false,
  showBoardBounds: false,
  showState: false,
}

function usePrefersReducedMotion() {
  const [reduced] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  })
  return reduced
}

function useIsLandscape() {
  const [landscape, setLandscape] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 560px)")
    const update = () => setLandscape(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return landscape
}

// Production launches silent; the core still calls this for every cue, so it is
// a guaranteed no-op that can never throw or block the reveal.
const SILENT: (cue: SoundCue) => void = () => {}

export function DgFootballReveal({ award }: { award: RevealAward }) {
  const router = useRouter()
  const reducedMotion = usePrefersReducedMotion()
  const landscape = useIsLandscape()
  const [helpOpen, setHelpOpen] = useState(false)

  const plan = useMemo(() => awardToRevealPlan(award), [award])
  const settings: DemoSettings = useMemo(() => ({ ...BASE_SETTINGS, reducedMotion }), [reducedMotion])

  const handleFinish = useCallback(() => {
    const slug = award.campaign_slug
    router.push(slug ? `/giveaways/${slug}` : "/giveaways")
  }, [award.campaign_slug, router])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DG_FOOTBALL_CSS }} />
      <div className="dgf-page">
        <div className="dgf-desktop-bg" aria-hidden="true" />

        <div className="dgf-layout">
          <div className="dgf-viewport">
            <DgFootballGame
              settings={settings}
              plan={plan}
              playSound={SILENT}
              onFinish={handleFinish}
              onHelp={() => setHelpOpen(true)}
            />

            {helpOpen && (
              <div
                className="dgf-help-scrim"
                role="dialog"
                aria-modal="true"
                aria-label="How DG'S BIG BALLERS works"
                onClick={() => setHelpOpen(false)}
              >
                <div className="dgf-help-card" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="dgf-help-close"
                    onClick={() => setHelpOpen(false)}
                    aria-label="Close"
                  >
                    {"\u2715"}
                  </button>
                  <p className="dgf-help-title">HOW IT WORKS</p>
                  <ol className="dgf-help-steps">
                    <li>
                      <span className="dgf-help-step-n">1</span>
                      <span>
                        <strong>Choose a ball</strong> — tap any of the five footballs. It&apos;s just for fun; every
                        ball plays the same.
                      </span>
                    </li>
                    <li>
                      <span className="dgf-help-step-n">2</span>
                      <span>
                        <strong>We take the shot</strong> — your ball fires itself into the board and drops into one of
                        five mystery holes.
                      </span>
                    </li>
                    <li>
                      <span className="dgf-help-step-n">3</span>
                      <span>
                        <strong>See where it lands</strong> — the hole reveals your result instantly.
                      </span>
                    </li>
                  </ol>
                  <div className="dgf-help-results">
                    <p className="dgf-help-results-title">POSSIBLE RESULTS</p>
                    <ul>
                      <li>Instant win — cash</li>
                      <li>Instant win — site credit</li>
                      <li>No instant win — you&apos;re still in the final draw</li>
                    </ul>
                  </div>
                  <p className="dgf-help-foot">Every ticket is entered into the final draw, win or not.</p>
                </div>
              </div>
            )}

            {landscape && (
              <div className="dgf-rotate" role="alertdialog" aria-label="Please rotate your phone">
                <div className="dgf-rotate-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="7" y="2" width="10" height="20" rx="2" />
                    <path d="M2 12a10 10 0 0 1 10-10" />
                  </svg>
                </div>
                <p className="dgf-rotate-title">ROTATE YOUR PHONE</p>
                <p className="dgf-rotate-sub">DG&apos;S BIG BALLERS IS BEST PLAYED IN PORTRAIT</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
