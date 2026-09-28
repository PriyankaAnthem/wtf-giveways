// Isolated demo only. Static visual configuration — no odds, no awards, no backend.
export type DemoPrizeType = "cash" | "credit" | "free_spin" | "loss"

export interface DemoPrize {
  id: string
  /** Primary display line, e.g. "£100" or "FREE" or "✕" */
  label: string
  /** Secondary display line, e.g. "CASH" / "CREDIT" / "SPIN" */
  sublabel?: string
  type: DemoPrizeType
  value?: number
  segmentIndex: number
}

/**
 * Exact approved demo order, clockwise from the top (12 o'clock).
 * Array index intentionally equals segmentIndex so PRIZES[i].segmentIndex === i.
 */
export const PRIZES: DemoPrize[] = [
  { id: "s0", label: "£100", sublabel: "CASH", type: "cash", value: 100, segmentIndex: 0 },
  { id: "s1", label: "£25", sublabel: "CASH", type: "cash", value: 25, segmentIndex: 1 },
  { id: "s2", label: "✕", type: "loss", segmentIndex: 2 },
  { id: "s3", label: "£10", sublabel: "CASH", type: "cash", value: 10, segmentIndex: 3 },
  { id: "s4", label: "FREE", sublabel: "SPIN", type: "free_spin", segmentIndex: 4 },
  { id: "s5", label: "£5", sublabel: "CASH", type: "cash", value: 5, segmentIndex: 5 },
  { id: "s6", label: "✕", type: "loss", segmentIndex: 6 },
  { id: "s7", label: "£50", sublabel: "CASH", type: "cash", value: 50, segmentIndex: 7 },
  { id: "s8", label: "FREE", sublabel: "SPIN", type: "free_spin", segmentIndex: 8 },
  { id: "s9", label: "£10", sublabel: "CREDIT", type: "credit", value: 10, segmentIndex: 9 },
  { id: "s10", label: "£5", sublabel: "CREDIT", type: "credit", value: 5, segmentIndex: 10 },
  { id: "s11", label: "FREE", sublabel: "SPIN", type: "free_spin", segmentIndex: 11 },
]

export const SEGMENT_COUNT = PRIZES.length // 12
export const SEGMENT_ANGLE = 360 / SEGMENT_COUNT // 30

/** Human-readable result headline/body used by the reveal panel. */
export function prizeResultText(p: DemoPrize): { title: string; body: string } {
  switch (p.type) {
    case "cash":
      return { title: "YOU WON", body: `£${p.value} CASH` }
    case "credit":
      return { title: "YOU WON", body: `£${p.value} CREDIT` }
    case "free_spin":
      return { title: "FREE SPIN!", body: "SPIN AGAIN" }
    case "loss":
    default:
      return { title: "NO PRIZE", body: "THIS TIME" }
  }
}
