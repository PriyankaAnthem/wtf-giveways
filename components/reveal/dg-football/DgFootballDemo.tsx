"use client"

/**
 * DgFootballDemo — top-level wrapper for the isolated /dgfootballidea prototype.
 * Owns the dev DemoSettings, builds deterministic mock tickets, frames the game
 * in a portrait viewport (centred on desktop, full-bleed on mobile), shows the
 * landscape rotate prompt, and provides an optional self-contained sound synth
 * (no external audio files, never autoplays before a user gesture).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { DemoSettings, SoundCue } from "./types"
import { DEFAULT_SETTINGS } from "./config"
import { DgFootballReveal } from "./DgFootballReveal"
import { DemoControls } from "./DemoControls"

/* -------------------------------------------------------------------------- */
/*  Minimal WebAudio sound synth (conceptual cues, no asset files)            */
/* -------------------------------------------------------------------------- */
const CUE_TONE: Record<SoundCue, { freq: number; dur: number; type: OscillatorType }> = {
  select: { freq: 520, dur: 0.08, type: "triangle" },
  launch: { freq: 180, dur: 0.18, type: "sawtooth" },
  whoosh: { freq: 260, dur: 0.16, type: "sawtooth" },
  drop: { freq: 140, dur: 0.14, type: "sine" },
  suspense: { freq: 300, dur: 0.4, type: "sine" },
  impact: { freq: 90, dur: 0.22, type: "square" },
  prize: { freq: 720, dur: 0.35, type: "triangle" },
  credit: { freq: 620, dur: 0.28, type: "triangle" },
  nowin: { freq: 440, dur: 0.22, type: "sine" },
  another: { freq: 660, dur: 0.16, type: "triangle" },
  streak: { freq: 780, dur: 0.12, type: "triangle" },
  reload: { freq: 340, dur: 0.2, type: "sawtooth" },
}

function useSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)

  const ensureCtx = useCallback(() => {
    if (typeof window === "undefined") return null
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      try {
        ctxRef.current = new Ctor()
      } catch {
        return null
      }
    }
    return ctxRef.current
  }, [])

  const play = useCallback(
    (cue: SoundCue) => {
      if (!enabled) return
      const ctx = ensureCtx()
      if (!ctx) return
      if (ctx.state === "suspended") void ctx.resume()
      const { freq, dur, type } = CUE_TONE[cue]
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, now)
      if (cue === "prize") osc.frequency.exponentialRampToValueAtTime(freq * 1.8, now + dur)
      if (cue === "launch") osc.frequency.exponentialRampToValueAtTime(freq * 2.4, now + dur)
      if (cue === "suspense") osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + dur)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + dur + 0.02)
    },
    [enabled, ensureCtx],
  )

  useEffect(() => {
    return () => {
      void ctxRef.current?.close().catch(() => {})
    }
  }, [])

  return play
}

/* -------------------------------------------------------------------------- */
/*  Orientation                                                               */
/* -------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------- */

export function DgFootballDemo() {
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS)
  const [runNonce, setRunNonce] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const play = useSound(settings.soundOn)
  const landscape = useIsLandscape()

  // Respect the OS reduced-motion setting as the initial default.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (mq.matches) setSettings((s) => ({ ...s, reducedMotion: true }))
  }, [])

  const patch = useCallback((p: Partial<DemoSettings>) => {
    setSettings((s) => ({ ...s, ...p }))
    // Changing the outcome/ticket config restarts the run so the new setting
    // applies cleanly from the top.
    if (p.resultPreset !== undefined || p.ticketCount !== undefined || p.skipIntro !== undefined) {
      setRunNonce((n) => n + 1)
    }
  }, [])

  const resetExperience = useCallback(() => {
    setRunNonce((n) => n + 1)
    setSheetOpen(false)
  }, [])

  const handleFinish = useCallback(() => {
    setRunNonce((n) => n + 1)
  }, [])

  // Remount key: rebuild the whole run when config changes or on reset.
  const runKey = `${settings.resultPreset}-${settings.ticketCount}-${settings.skipIntro}-${runNonce}`

  return (
    <div className="dgf-page">
      <div className="dgf-desktop-bg" aria-hidden="true" />

      <div className="dgf-layout">
        {/* Portrait game viewport */}
        <div className="dgf-viewport">
          <DgFootballReveal
            key={runKey}
            settings={settings}
            playSound={play}
            onFinish={handleFinish}
            onHelp={() => setHelpOpen(true)}
          />

          {/* How-it-works overlay */}
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
                  ✕
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

          {/* Sound toggle (top-right, unobtrusive) */}
          <button
            type="button"
            className="dgf-sound-toggle"
            aria-pressed={settings.soundOn}
            aria-label={settings.soundOn ? "Turn sound off" : "Turn sound on"}
            onClick={() => patch({ soundOn: !settings.soundOn })}
          >
            {settings.soundOn ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
                <path d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
                <path d="M17 9l5 6M22 9l-5 6" />
              </svg>
            )}
          </button>

          {/* Landscape rotate prompt */}
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

        {/* Desktop-side dev panel */}
        <aside className="dgf-side-controls">
          <DemoControls settings={settings} onChange={patch} onReset={resetExperience} variant="sidebar" />
        </aside>
      </div>

      {/* Mobile controls trigger + sheet */}
      <button type="button" className="dgf-controls-trigger" onClick={() => setSheetOpen(true)}>
        DEMO CONTROLS
      </button>
      {sheetOpen && (
        <div className="dgf-sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div className="dgf-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Demo controls">
            <button type="button" className="dgf-sheet-close" onClick={() => setSheetOpen(false)} aria-label="Close demo controls">
              ✕
            </button>
            <DemoControls settings={settings} onChange={patch} onReset={resetExperience} variant="sheet" />
          </div>
        </div>
      )}
    </div>
  )
}
