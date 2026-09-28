"use client"

export type SpinButtonState = "ready" | "spinning" | "again" | "empty"

const LABEL: Record<SpinButtonState, string> = {
  ready: "SPIN THE WHEEL",
  spinning: "SPINNING…",
  again: "SPIN AGAIN",
  empty: "NO SPINS LEFT",
}

export function SpinButton({
  state,
  onClick,
  busy = false,
}: {
  state: SpinButtonState
  onClick: () => void
  busy?: boolean
}) {
  const disabled = busy || state === "spinning" || state === "empty"
  return (
    <button
      type="button"
      className="stw-spin-btn"
      data-state={state}
      data-spinning={state === "spinning"}
      disabled={disabled}
      onClick={onClick}
    >
      {/* Glossy red/gold plate is pure CSS; only this text ever renders on it. */}
      <span className="stw-spin-btn-gloss" aria-hidden="true" />
      <span className="stw-spin-btn-label">{LABEL[state]}</span>
    </button>
  )
}
