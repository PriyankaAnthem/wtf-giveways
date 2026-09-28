"use client"

/**
 * DemoControls — development-only control panel for the /dgfootballidea
 * prototype. Lets a designer force outcomes, ticket counts, the destination
 * hole and playback speed, preview DG's poses, and switch on alignment
 * overlays. These controls never touch production code paths — they only drive
 * this isolated demo's local state.
 */

import type { CharPreview, DemoSettings, DestinationOverride, ResultPreset, Speed, TicketCount } from "./types"
import {
  CHAR_PREVIEW_OPTIONS,
  DESTINATION_OPTIONS,
  RESULT_PRESET_OPTIONS,
  SPEED_OPTIONS,
  TICKET_COUNT_OPTIONS,
} from "./config"

interface DemoControlsProps {
  settings: DemoSettings
  onChange: (patch: Partial<DemoSettings>) => void
  onReset: () => void
  variant: "sidebar" | "sheet"
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="dgf-ctl-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dgf-ctl-track" aria-hidden="true">
        <span className="dgf-ctl-thumb" />
      </span>
      <span className="dgf-ctl-toggle-label">{label}</span>
    </label>
  )
}

export function DemoControls({ settings, onChange, onReset, variant }: DemoControlsProps) {
  return (
    <div className={`dgf-controls dgf-controls-${variant}`}>
      <div className="dgf-ctl-head">
        <span className="dgf-ctl-title">DEMO CONTROLS</span>
        <span className="dgf-ctl-badge">DEV ONLY</span>
      </div>

      <fieldset className="dgf-ctl-group">
        <legend>Result preset</legend>
        <div className="dgf-ctl-chips">
          {RESULT_PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dgf-chip ${settings.resultPreset === opt.value ? "dgf-chip-on" : ""}`}
              onClick={() => onChange({ resultPreset: opt.value as ResultPreset })}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="dgf-ctl-note">
          The instant wins in the purchase. Multiple wins auto-chain; the tapped ball never decides them.
        </p>
      </fieldset>

      <fieldset className="dgf-ctl-group">
        <legend>Ticket count</legend>
        <div className="dgf-ctl-chips">
          {TICKET_COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={`dgf-chip ${settings.ticketCount === n ? "dgf-chip-on" : ""}`}
              onClick={() => onChange({ ticketCount: n as TicketCount })}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="dgf-ctl-group">
        <legend>Destination hole</legend>
        <div className="dgf-ctl-chips">
          {DESTINATION_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={`dgf-chip ${settings.destination === opt.value ? "dgf-chip-on" : ""}`}
              onClick={() => onChange({ destination: opt.value as DestinationOverride })}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="dgf-ctl-note">Forces which hole the ball enters. The result stays the ticket&apos;s outcome.</p>
      </fieldset>

      <fieldset className="dgf-ctl-group">
        <legend>Playback speed</legend>
        <div className="dgf-ctl-chips">
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dgf-chip ${settings.speed === opt.value ? "dgf-chip-on" : ""}`}
              onClick={() => onChange({ speed: opt.value as Speed })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="dgf-ctl-group">
        <legend>Character preview</legend>
        <div className="dgf-ctl-chips">
          {CHAR_PREVIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dgf-chip ${settings.charPreview === opt.value ? "dgf-chip-on" : ""}`}
              onClick={() => onChange({ charPreview: opt.value as CharPreview })}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="dgf-ctl-note">Freezes DG on a single pose so you can inspect each asset&apos;s framing.</p>
      </fieldset>

      <fieldset className="dgf-ctl-group">
        <legend>Options</legend>
        <div className="dgf-ctl-toggles">
          <Toggle label="Skip intro" checked={settings.skipIntro} onChange={(v) => onChange({ skipIntro: v })} />
          <Toggle label="Sound on" checked={settings.soundOn} onChange={(v) => onChange({ soundOn: v })} />
          <Toggle
            label="Reduced motion"
            checked={settings.reducedMotion}
            onChange={(v) => onChange({ reducedMotion: v })}
          />
        </div>
      </fieldset>

      <fieldset className="dgf-ctl-group">
        <legend>Debug overlays</legend>
        <div className="dgf-ctl-toggles">
          <Toggle
            label="Board bounds"
            checked={settings.showBoardBounds}
            onChange={(v) => onChange({ showBoardBounds: v })}
          />
          <Toggle
            label="Hole bounds"
            checked={settings.showHoleBounds}
            onChange={(v) => onChange({ showHoleBounds: v })}
          />
          <Toggle
            label="Hole centres"
            checked={settings.showHoleCentres}
            onChange={(v) => onChange({ showHoleCentres: v })}
          />
          <Toggle
            label="Ball origin"
            checked={settings.showBallOrigin}
            onChange={(v) => onChange({ showBallOrigin: v })}
          />
          <Toggle
            label="Flight control points"
            checked={settings.showControlPoints}
            onChange={(v) => onChange({ showControlPoints: v })}
          />
          <Toggle
            label="Ball endpoint"
            checked={settings.showEndpoint}
            onChange={(v) => onChange({ showEndpoint: v })}
          />
          <Toggle label="Animation state" checked={settings.showState} onChange={(v) => onChange({ showState: v })} />
        </div>
      </fieldset>

      <button type="button" className="dgf-ctl-reset" onClick={onReset}>
        Reset experience
      </button>
    </div>
  )
}
