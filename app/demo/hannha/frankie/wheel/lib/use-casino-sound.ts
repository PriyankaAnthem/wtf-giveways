"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Isolated demo audio. All sound effects (ticks, whoosh, stings) are
 * synthesized with the Web Audio API so the prototype needs no binary SFX.
 *
 * AMBIENT background music is intentionally NOT synthesized (synth pads sound
 * cheap). The ambient hooks are wired and will play `/demo/wtf-spin/ambient.mp3`
 * if that asset is added later; until then they are silent no-ops.
 */
export function useCasinoSound() {
  const [muted, setMutedState] = useState(false)
  const mutedRef = useRef(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const ambientRef = useRef<HTMLAudioElement | null>(null)
  const duckTimerRef = useRef<number | null>(null)

  const ctx = useCallback(() => {
    if (typeof window === "undefined") return null
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      const c = new AC()
      const master = c.createGain()
      master.gain.value = 0.9
      master.connect(c.destination)
      ctxRef.current = c
      masterRef.current = master
    }
    return ctxRef.current
  }, [])

  /** Call on a user gesture (spin click) to satisfy autoplay policies. */
  const unlock = useCallback(() => {
    const c = ctx()
    if (c && c.state === "suspended") void c.resume()
  }, [ctx])

  const now = () => ctxRef.current?.currentTime ?? 0

  const blip = useCallback(
    (
      freq: number,
      dur: number,
      opts: { type?: OscillatorType; gain?: number; sweepTo?: number; delay?: number } = {},
    ) => {
      const c = ctx()
      if (!c || mutedRef.current || !masterRef.current) return
      const t0 = c.currentTime + (opts.delay ?? 0)
      const osc = c.createOscillator()
      const g = c.createGain()
      osc.type = opts.type ?? "triangle"
      osc.frequency.setValueAtTime(freq, t0)
      if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur)
      const peak = opts.gain ?? 0.25
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(g).connect(masterRef.current)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    },
    [ctx],
  )

  const noiseBurst = useCallback(
    (dur: number, opts: { gain?: number; band?: number; q?: number; sweepTo?: number } = {}) => {
      const c = ctx()
      if (!c || mutedRef.current || !masterRef.current) return
      const t0 = c.currentTime
      const frames = Math.floor(c.sampleRate * dur)
      const buffer = c.createBuffer(1, frames, c.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
      const src = c.createBufferSource()
      src.buffer = buffer
      const bp = c.createBiquadFilter()
      bp.type = "bandpass"
      bp.frequency.setValueAtTime(opts.band ?? 1400, t0)
      if (opts.sweepTo) bp.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur)
      bp.Q.value = opts.q ?? 0.8
      const g = c.createGain()
      const peak = opts.gain ?? 0.2
      g.gain.setValueAtTime(peak, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      src.connect(bp).connect(g).connect(masterRef.current)
      src.start(t0)
      src.stop(t0 + dur + 0.02)
    },
    [ctx],
  )

  // --- SFX layers -----------------------------------------------------------

  /** Mechanical peg tick. Intensity 0..1 (1 = fast/hard). */
  const tick = useCallback(
    (intensity = 1) => {
      const band = 900 + intensity * 1600
      noiseBurst(0.028, { gain: 0.1 + intensity * 0.22, band, q: 1.2 })
      blip(320 + intensity * 120, 0.03, { type: "square", gain: 0.05 + intensity * 0.08 })
    },
    [noiseBurst, blip],
  )

  /** Rising whoosh at spin start. */
  const whoosh = useCallback(() => {
    noiseBurst(0.42, { gain: 0.16, band: 300, sweepTo: 2600, q: 0.6 })
  }, [noiseBurst])

  /**
   * Layered game-show jackpot sting for CASH wins: an ascending triumphant
   * run, a chord stab on arrival, a bright bell shimmer tail, a soft sub thump
   * for body, and a sparkle noise sweep. ~2s, deliberately not a single beep.
   */
  const winCash = useCallback(() => {
    const run = [392, 523.25, 659.25, 783.99, 1046.5] // G C E G C
    run.forEach((f, i) => blip(f, 0.55, { type: "triangle", gain: 0.24, delay: i * 0.08 }))
    // Chord stab lands with the top of the run.
    ;[523.25, 659.25, 783.99].forEach((f) => blip(f, 0.75, { type: "sawtooth", gain: 0.1, delay: 0.4 }))
    // Bell shimmer tail.
    blip(1567.98, 0.9, { type: "sine", gain: 0.12, delay: 0.42 })
    blip(2093, 1.0, { type: "sine", gain: 0.07, delay: 0.5 })
    // Soft sub thump gives the moment weight without boom.
    blip(110, 0.42, { type: "sine", gain: 0.16, delay: 0.38 })
    noiseBurst(0.6, { gain: 0.07, band: 6000, q: 0.4 })
  }, [blip, noiseBurst])

  /** Magical, rewarding sting for CREDIT wins — softer than cash, bell-led. */
  const winCredit = useCallback(() => {
    const notes = [587.33, 739.99, 987.77] // D F# B
    notes.forEach((f, i) => blip(f, 0.6, { type: "triangle", gain: 0.2, delay: i * 0.1 }))
    // Rising magical bell arpeggio.
    ;[1174.66, 1479.98, 1760].forEach((f, i) => blip(f, 0.7, { type: "sine", gain: 0.1, delay: 0.32 + i * 0.09 }))
    blip(146.83, 0.4, { type: "sine", gain: 0.11, delay: 0.3 })
  }, [blip])

  /** Playful bouncing reward sting for FREE SPIN. */
  const winFree = useCallback(() => {
    const bounce = [659.25, 830.61, 987.77, 1318.51] // E G# B E
    bounce.forEach((f, i) => blip(f, 0.34, { type: "triangle", gain: 0.24, delay: i * 0.09 }))
    blip(1975.53, 0.5, { type: "sine", gain: 0.1, delay: 0.34 })
  }, [blip])

  /** Neutral, non-negative transition for NO PRIZE. */
  const noPrize = useCallback(() => {
    blip(392, 0.26, { type: "sine", gain: 0.14 })
    blip(311.13, 0.32, { type: "sine", gain: 0.1, delay: 0.12 })
  }, [blip])

  /** Short, warm "round is over — nice haul" sting (gentler than winCash). */
  const sessionWin = useCallback(() => {
    const notes = [523.25, 783.99] // C G
    notes.forEach((f, i) => blip(f, 0.42, { type: "triangle", gain: 0.2, delay: i * 0.11 }))
    blip(1046.5, 0.5, { type: "sine", gain: 0.09, delay: 0.24 }) // soft shimmer
  }, [blip])

  /** Neutral, non-failure transition used when the round ends with no winnings. */
  const sessionNeutral = useCallback(() => {
    blip(440, 0.28, { type: "sine", gain: 0.13 })
    blip(587.33, 0.34, { type: "sine", gain: 0.1, delay: 0.13 })
  }, [blip])

  /** Duck the mix during the dramatic slowdown, then restore. */
  const duck = useCallback((amount = 0.55, holdMs = 900) => {
    const master = masterRef.current
    const c = ctxRef.current
    if (!master || !c) return
    master.gain.cancelScheduledValues(c.currentTime)
    master.gain.linearRampToValueAtTime(0.9 * amount, c.currentTime + 0.12)
    if (duckTimerRef.current) window.clearTimeout(duckTimerRef.current)
    duckTimerRef.current = window.setTimeout(() => {
      if (masterRef.current && ctxRef.current) {
        masterRef.current.gain.linearRampToValueAtTime(0.9, ctxRef.current.currentTime + 0.4)
      }
    }, holdMs)
  }, [])

  // --- Ambient (asset-backed, silent until provided) ------------------------

  const startAmbient = useCallback(() => {
    if (typeof window === "undefined" || mutedRef.current) return
    if (!ambientRef.current) {
      const a = new Audio("/demo/wtf-spin/ambient.mp3")
      a.loop = true
      a.volume = 0.35
      a.addEventListener("error", () => {
        // Asset not present yet — stay silent (no cheesy synth fallback).
      })
      ambientRef.current = a
    }
    void ambientRef.current.play().catch(() => {})
  }, [])

  const stopAmbient = useCallback(() => {
    ambientRef.current?.pause()
  }, [])

  const setMuted = useCallback((v: boolean) => {
    mutedRef.current = v
    setMutedState(v)
    if (masterRef.current && ctxRef.current) {
      masterRef.current.gain.value = v ? 0 : 0.9
    }
    if (v) ambientRef.current?.pause()
  }, [])

  useEffect(() => {
    return () => {
      if (duckTimerRef.current) window.clearTimeout(duckTimerRef.current)
      ambientRef.current?.pause()
      void ctxRef.current?.close()
    }
  }, [])

  return {
    unlock,
    tick,
    whoosh,
    winCash,
    winCredit,
    winFree,
    noPrize,
    sessionWin,
    sessionNeutral,
    duck,
    startAmbient,
    stopAmbient,
    muted,
    setMuted,
    now,
  }
}
