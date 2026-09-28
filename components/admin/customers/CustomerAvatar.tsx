import { getInitials } from "./format"

/**
 * A purely presentational initials avatar. The colour is derived
 * deterministically from the name so the same customer always gets the same
 * chip — no image fetching, no avatar API, no extra requests.
 */
const PALETTE = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
]

function hashToIndex(value: string, mod: number): number {
  let h = 0
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0
  }
  return h % mod
}

export function CustomerAvatar({
  name,
  seed,
  size = "md",
}: {
  name: string
  /** Stable seed (e.g. user_id) for colour selection; falls back to the name. */
  seed?: string
  size?: "md" | "lg"
}) {
  const initials = getInitials(name)
  const colour = PALETTE[hashToIndex(seed || name, PALETTE.length)]
  const dimensions = size === "lg" ? "size-14 text-lg" : "size-11 text-sm"

  return (
    <div
      aria-hidden="true"
      className={`flex ${dimensions} shrink-0 items-center justify-center rounded-full font-semibold uppercase tracking-wide ${colour}`}
    >
      {initials}
    </div>
  )
}
