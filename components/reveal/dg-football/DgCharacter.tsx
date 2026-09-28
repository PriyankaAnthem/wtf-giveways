"use client"

/**
 * DgCharacter — the host personality (Layer: DG), anchored to the LEFT of and
 * partially behind the target board, sized large enough that his face reads
 * instantly on a phone (part of his body may crop off the left edge). He is a
 * host element; the BOARD is the main game object, so DG never covers the holes
 * or the ball trajectory.
 *
 * He holds the two supplied, identically-framed photos and switches between
 * them in place (no full-screen takeover):
 *   - dg-neutral.png : initial, choosing, shot-in-flight, non-win, between,
 *                      summary.
 *   - dg-scored.png  : a winning result only — during the celebration and
 *                      behind the winning prize panel.
 * On a win a green/gold burst flashes behind him and the scored photo enters
 * with a scale-down + upward settle (stronger than a plain cross-fade). If an
 * asset is missing we show a clear dev notice naming the file.
 */

import { useState } from "react"
import { ASSETS, TIMING } from "./config"

interface DgCharacterProps {
  /** Which supplied photo to show. */
  pose: "neutral" | "scored"
  /** Green/gold celebration burst behind DG (win only). */
  winFlash: boolean
  /** Stronger burst for the top prize. */
  bigWin: boolean
  /** Dim slightly while a non-win result is up (never fully hidden). */
  dim: boolean
  reducedMotion: boolean
  speed: number
  /** Debug: outline the character image frame. */
  showBounds?: boolean
}

export function MissingAssetNotice({ file }: { file: string }) {
  return (
    <div className="dgf-missing" role="status">
      <span className="dgf-missing-badge">DEV: MISSING ASSET</span>
      <code className="dgf-missing-path">{file}</code>
      <span className="dgf-missing-hint">Drop the real DG photo here — no placeholder is shown.</span>
    </div>
  )
}

export function DgCharacter({ pose, winFlash, bigWin, dim, reducedMotion, speed, showBounds }: DgCharacterProps) {
  const [neutralError, setNeutralError] = useState(false)
  const [scoredError, setScoredError] = useState(false)

  const scored = pose === "scored"
  const enterMs = TIMING.celebrateMs * speed
  const breatheStyle = reducedMotion ? undefined : ({ animationDuration: `${6 * speed}s` } as const)

  return (
    <div
      className={`dgf-character ${showBounds ? "dgf-character-bounds" : ""} ${dim ? "dgf-character-dim" : ""} ${
        scored ? "dgf-character-scored" : ""
      }`}
      aria-hidden="true"
    >
      {/* Green rim light behind the shoulders */}
      <div className="dgf-rim" />

      {/* Green/gold celebration burst behind DG (win only) */}
      <div
        className={`dgf-win-flash ${winFlash ? "dgf-win-flash-on" : ""} ${bigWin ? "dgf-win-flash-big" : ""} ${
          reducedMotion ? "dgf-win-flash-reduced" : ""
        }`}
      />

      <div className={`dgf-character-inner ${reducedMotion || scored ? "" : "dgf-breathe"}`} style={breatheStyle}>
        {/* Both images share the exact same frame. */}
        {neutralError ? (
          <MissingAssetNotice file={ASSETS.dgNeutral} />
        ) : (
          <img
            src={ASSETS.dgNeutral || "/placeholder.svg"}
            alt=""
            className="dgf-dg-img"
            style={{ opacity: scored ? 0 : 1, transitionDuration: `${enterMs}ms` }}
            onError={() => setNeutralError(true)}
            draggable={false}
          />
        )}

        {scoredError ? (
          scored ? <MissingAssetNotice file={ASSETS.dgScored} /> : null
        ) : (
          <img
            src={ASSETS.dgScored || "/placeholder.svg"}
            alt=""
            className={`dgf-dg-img dgf-dg-scored ${scored && !reducedMotion ? "dgf-dg-scored-in" : ""}`}
            style={{
              opacity: scored ? 1 : 0,
              transitionDuration: `${enterMs}ms`,
              animationDuration: `${enterMs}ms`,
            }}
            onError={() => setScoredError(true)}
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}
