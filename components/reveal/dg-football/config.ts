/**
 * DG'S BIG BALLERS — configuration, palette, timings, mock data and copy.
 * PROTOTYPE ONLY. Deterministic. No randomisation, no backend.
 */

import type {
  Animation,
  Award,
  CharPreview,
  DemoSettings,
  DestinationOverride,
  EnergyTier,
  HoleId,
  Outcome,
  OutcomeKind,
  RevealCopy,
  RevealPlan,
  ResultPreset,
  Speed,
  TicketCount,
} from "./types"

/* -------------------------------------------------------------------------- */
/*  Palette                                                                   */
/* -------------------------------------------------------------------------- */
export const COLORS = {
  black: "#050705",
  charcoalDeep: "#0C100D",
  charcoalPanel: "#111712",
  neon: "#A8FF19",
  neon2: "#5DFF00",
  glow: "rgba(168, 255, 25, 0.35)",
  white: "#F7F7F2",
  muted: "#A7B0A4",
  gold: "#FFD84A",
  cash: "#7CFF67",
} as const

/* -------------------------------------------------------------------------- */
/*  Assets                                                                    */
/*  dg-board-reference.png is VISUAL REFERENCE ONLY — never rendered as the    */
/*  game. The board, holes, DG and effects are all independent DOM/CSS/SVG.    */
/* -------------------------------------------------------------------------- */
export const ASSETS = {
  /** Initial / choosing / shot-in-progress / non-win / between / summary. */
  dgNeutral: "/reveal/dg-football/dg-neutral.png",
  /** Winning celebration + behind the winning prize panel ONLY. */
  dgScored: "/reveal/dg-football/dg-scored.png",
} as const

/* -------------------------------------------------------------------------- */
/*  Timings (ms, at speed = 1). Multiply by the speed factor at runtime.      */
/* -------------------------------------------------------------------------- */
export const TIMING = {
  /** Opening staged entrance (spec: 800–950ms). */
  introMs: 900,
  /** "BIG BALLER MODE" flash for high ticket counts (spec: ~500ms). */
  bigBallerMs: 520,
  /** Ball lift on tap before it is locked in. */
  ballLiftMs: 200,
  /** Selection is held (spec: 220–280ms) before the shot auto-begins. */
  selectHoldMs: 260,
  /** Auto-shot flight (spec: 850–950ms). */
  flightMs: 920,
  /** Reduced-motion straight-line flight. */
  reducedFlightMs: 440,
  /** Lead before entry when the destination hole is revealed (spec: ~220ms). */
  anticipationLeadMs: 220,
  /** Ball-into-hole entry sequence (spec: 200–240ms). */
  holeEntryMs: 220,
  /** Theatrical suspense after entry, before any result (spec: 400–500ms). */
  suspenseMs: 450,
  /** Big-win suspense is a touch longer (spec: ~550ms). */
  suspenseBigMs: 550,
  /** Winning hole becomes the celebration source (shockwave + sparks). */
  winReactionMs: 380,
  /** Non-win positive hole pulse before the summary. */
  nonwinReactionMs: 420,
  /** dg-neutral → dg-scored celebration entrance (spec: ~320ms). */
  celebrateMs: 320,
  /** Small settle after the celebration before the prize panel rises. */
  pauseBeforePanelMs: 150,
  /** Prize-panel entrance. */
  panelRiseMs: 700,
  /** Auto-advance hold on a shown prize before the next win / summary. */
  prizeHoldMs: 1750,
  /** Top-prize prize hold is longer so it lands. */
  prizeHoldBigMs: 2300,
  /** "THERE'S ANOTHER WIN!" interstitial between chained CINEMATIC wins. */
  interstitialMs: 950,
  /** Auto-lift of the next cosmetic ball before its shot. */
  relaunchLiftMs: 320,
  /** Delay before the final summary rises. */
  summaryDelayMs: 260,
  /** Camera punch-in total. */
  cameraPunchMs: 300,
  /** Screen-shake duration. */
  shakeMs: 220,

  /* ---- FAST WIN STREAK (4th win onward). Every award is STILL shown, just
   *      more briefly. Target ~1.2–1.6s per award, always readable. -------- */
  fastFlightMs: 360,
  fastHoleEntryMs: 120,
  fastSuspenseMs: 110,
  fastWinReactionMs: 150,
  fastPanelRiseMs: 300,
  /** Prize stays readable long enough to read on a fast win. */
  fastPrizeHoldMs: 780,
  /** Brief "YOU'RE STILL WINNING!" beat (only shown on some fast wins). */
  fastInterstitialMs: 560,
  /** Silent quick board power-up between fast wins with no interstitial. */
  fastPowerUpMs: 260,
  /** Green energy tray reload when a fresh set of five balls is needed. */
  trayReloadMs: 520,
} as const

/** Number of wins shown as a FULL cinematic reveal. Wins beyond this are shown
 *  in FAST WIN STREAK mode — but EVERY win is still individually revealed.
 *  There is NO cap on how many awards are displayed. */
export const MAX_CINEMATIC_WINS = 3

/* -------------------------------------------------------------------------- */
/*  Geometry                                                                  */
/* -------------------------------------------------------------------------- */
/** Tray football diameter (px) at a 390px stage. */
export const BALL_SIZE = 60

/** In-flight ball diameter (px). Stays large enough to follow (spec: 44–54px
 *  near the hole). */
export const FLIGHT_BALL_SIZE = 56

/** Number of cosmetic footballs in the tray each shot (always five). */
export const TRAY_BALL_COUNT = 5

/**
 * Target board rectangle as fractions of the stage. DG stands to the LEFT and
 * partially overlaps the board's left edge, so the board is nudged right.
 */
export const BOARD_RECT = {
  leftPct: 0.17,
  topPct: 0.235,
  widthPct: 0.77,
  heightPct: 0.475,
} as const

/**
 * The five holes as fractions of the board's INNER face, in the quincunx:
 *     1     2
 *        3
 *     4     5
 * Measured in the DOM at runtime; these drive the CSS placement.
 */
export const HOLES: Record<HoleId, { xPct: number; yPct: number }> = {
  1: { xPct: 0.29, yPct: 0.24 },
  2: { xPct: 0.71, yPct: 0.24 },
  3: { xPct: 0.5, yPct: 0.5 },
  4: { xPct: 0.29, yPct: 0.76 },
  5: { xPct: 0.71, yPct: 0.76 },
} as const

export const HOLE_IDS: HoleId[] = [1, 2, 3, 4, 5]

/* -------------------------------------------------------------------------- */
/*  Outcome helpers                                                           */
/* -------------------------------------------------------------------------- */
const pounds = (p: number) => p / 100

export function formatGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pounds(pence))
}

const O_NONE: Outcome = { kind: "none", amountPence: 0 }
const O_CREDIT5: Outcome = { kind: "credit", amountPence: 500 }
const O_CREDIT10: Outcome = { kind: "credit", amountPence: 1000 }
const O_CASH25: Outcome = { kind: "cash", amountPence: 2500 }
const O_CASH50: Outcome = { kind: "cash", amountPence: 5000 }
const O_CASH100: Outcome = { kind: "cash", amountPence: 10000 }
const O_CASH250: Outcome = { kind: "cash", amountPence: 25000 }
const O_CASH5000: Outcome = { kind: "cash", amountPence: 500000 }

/** Big-win threshold — drives the gold, light-ray, confetti treatment. */
export const BIG_WIN_PENCE = 100000

export function isBigWin(o: Outcome): boolean {
  return o.kind === "cash" && o.amountPence >= BIG_WIN_PENCE
}

export function isWinOutcome(o: Outcome): boolean {
  return o.kind !== "none"
}

/**
 * Derive the winning prize-panel copy from an outcome. (Non-winning purchases
 * are handled by the summary, never a prize panel.)
 */
export function revealCopyFor(o: Outcome): RevealCopy {
  switch (o.kind) {
    case "cash":
      if (isBigWin(o)) {
        return {
          tone: "big",
          eyebrow: "INSTANT WIN!",
          amount: formatGBP(o.amountPence),
          unit: "CASH",
          support: "YOU'VE HIT THE BIG ONE!",
          isMoney: true,
        }
      }
      return {
        tone: "cash",
        eyebrow: "INSTANT WIN!",
        amount: formatGBP(o.amountPence),
        unit: "CASH",
        support: "WHAT A STRIKE!",
        isMoney: true,
      }
    case "credit":
      return {
        tone: "credit",
        eyebrow: "BONUS WIN!",
        amount: formatGBP(o.amountPence),
        unit: "SITE CREDIT",
        support: "NICE ONE!",
        isMoney: true,
      }
    case "manual":
      // Physical / manually fulfilled prize. No reliable cash value — present
      // the prize by its title (and optional image), never a fabricated amount.
      return {
        tone: "big",
        eyebrow: "YOU'VE WON!",
        amount: o.title?.trim() || o.valueText?.trim() || "A PRIZE",
        unit: "",
        support: "WHAT A STRIKE!",
        isMoney: false,
        isManual: true,
        imageUrl: o.imageUrl,
      }
    default:
      // Should never be shown on a panel; harmless fallback.
      return {
        tone: "cash",
        eyebrow: "INSTANT WIN!",
        amount: "",
        unit: "",
        support: "",
        isMoney: true,
      }
  }
}

/* -------------------------------------------------------------------------- */
/*  Ticket-count messaging (LOADED → GAME → CHECKED) + energy tiers            */
/* -------------------------------------------------------------------------- */
export function ticketsLoaded(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "TICKET" : "TICKETS"} LOADED`
}
export function ticketsChecked(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "TICKET" : "TICKETS"} CHECKED`
}
export function chancesLine(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "CHANCE" : "CHANCES"} TO HIT AN INSTANT WIN`
}
export function ticketsInDraw(n: number): string {
  return `ALL ${n.toLocaleString("en-GB")} ${n === 1 ? "TICKET REMAINS" : "TICKETS REMAIN"} IN THE FINAL DRAW`
}
export function ticketsAlsoInDraw(n: number): string {
  return `ALL ${n.toLocaleString("en-GB")} ${n === 1 ? "TICKET IS" : "TICKETS ARE"} ALSO IN THE FINAL DRAW`
}

/** Cosmetic energy tier from purchased quantity (COSMETIC ONLY). */
export function energyTierFor(count: number): EnergyTier {
  if (count >= 250) return "max"
  if (count >= 100) return "bigballer"
  if (count >= 50) return "charged"
  if (count >= 10) return "raised"
  return "standard"
}

/** Whether to show the optional "BIG BALLER MODE" beat during the intro. */
export function showsBigBaller(count: number): boolean {
  return count >= 100
}

/* -------------------------------------------------------------------------- */
/*  Instruction copy per state                                                */
/* -------------------------------------------------------------------------- */
export const INSTRUCTIONS: Record<string, { text: string; key?: string; sub?: string } | null> = {
  intro: null,
  choosing: { text: "CHOOSE A", key: "BALL", sub: "WATCH WHERE IT LANDS..." },
  selected: { text: "HERE WE", key: "GO!" },
  launching: { text: "HERE WE", key: "GO!" },
  approaching_hole: null,
  entering_hole: null,
  suspense: null,
  win_reaction: null,
  nonwin_reaction: null,
  celebrating: null,
  revealing: null,
  revealed: null,
  checking_additional: null,
  auto_relaunch: null,
  summary: null,
  complete: null,
}

/** The primary call-to-action shown directly above the tray. */
export const TAP_A_BALL = "TAP A BALL"

/* -------------------------------------------------------------------------- */
/*  Deterministic mock reveal plans                                           */
/*  Awards are the instant wins contained in the purchase. Holes rotate so    */
/*  chained wins land in visibly different holes.                             */
/* -------------------------------------------------------------------------- */
const PRESET_AWARDS: Record<ResultPreset, Award[]> = {
  none: [],
  credit5: [{ outcome: O_CREDIT5, destinationHole: 2 }],
  cash100: [{ outcome: O_CASH100, destinationHole: 5 }],
  cash5000: [{ outcome: O_CASH5000, destinationHole: 3 }],
  twoWins: [
    { outcome: O_CASH100, destinationHole: 5 },
    { outcome: O_CREDIT5, destinationHole: 2 },
  ],
  threeWins: [
    { outcome: O_CASH100, destinationHole: 5 },
    { outcome: O_CASH25, destinationHole: 1 },
    { outcome: O_CREDIT5, destinationHole: 2 },
  ],
  // Five wins — EVERY win is revealed. The first three are full cinematic
  // (building to the £5,000 climax); wins 4–5 use FAST WIN STREAK mode.
  fiveWins: [
    { outcome: O_CASH100, destinationHole: 5 },
    { outcome: O_CASH25, destinationHole: 1 },
    { outcome: O_CASH5000, destinationHole: 3 },
    { outcome: O_CASH50, destinationHole: 4 },
    { outcome: O_CREDIT5, destinationHole: 2 },
  ],
  // Seven wins — proves >5 works: the tray reloads, holes are reused, every
  // award is shown, and the summary reconciles exactly. Cinematic 1–3 build to
  // the £5,000; wins 4–7 are fast.
  sevenWins: [
    { outcome: O_CASH100, destinationHole: 5 },
    { outcome: O_CASH250, destinationHole: 1 },
    { outcome: O_CASH5000, destinationHole: 3 },
    { outcome: O_CASH50, destinationHole: 4 },
    { outcome: O_CASH25, destinationHole: 2 },
    { outcome: O_CREDIT10, destinationHole: 5 },
    { outcome: O_CREDIT5, destinationHole: 1 },
  ],
}

/** Build the deterministic reveal plan for a preset + purchased quantity. */
export function buildRevealPlan(preset: ResultPreset, ticketCount: TicketCount): RevealPlan {
  return { ticketCount, awards: PRESET_AWARDS[preset] }
}

/** Non-winning single-shot uses this hole (feels central + neutral). */
const NONWIN_HOLE: HoleId = 4

/**
 * Turn a plan into the ordered list of animations. EVERY win is animated — the
 * first MAX_CINEMATIC_WINS as full cinematic reveals, the rest in FAST WIN
 * STREAK mode. There is NO cap: a 7-win purchase yields 7 animations. A
 * zero-win plan animates exactly one non-winning shot.
 *
 * The cosmetic ball for each animation starts from the tapped ball, then walks
 * the remaining tray balls; after five it wraps (the tray "reloads"). Holes are
 * reused (there are only five) but never repeat back-to-back.
 */
export function buildAnimations(plan: RevealPlan, tappedBall: number): Animation[] {
  const ballSeq = ballSequence(tappedBall)
  if (plan.awards.length === 0) {
    return [
      {
        isWin: false,
        outcome: O_NONE,
        destinationHole: NONWIN_HOLE,
        ballNumber: ballSeq[0],
        fast: false,
        traySlot: 0,
      },
    ]
  }
  let prevHole: HoleId | null = null
  return plan.awards.map((a, i) => {
    // Keep the authored hole unless it repeats the previous one, in which case
    // rotate to the next free hole so consecutive shots never share a hole.
    let hole = a.destinationHole
    if (hole === prevHole) {
      hole = (HOLE_IDS.find((h) => h !== prevHole) ?? hole) as HoleId
    }
    prevHole = hole
    return {
      isWin: true,
      outcome: a.outcome,
      destinationHole: hole,
      ballNumber: ballSeq[i % ballSeq.length],
      fast: i >= MAX_CINEMATIC_WINS,
      traySlot: i % ballSeq.length,
    }
  })
}

/** Tap order → [tapped, then the other four ascending]. */
export function ballSequence(tapped: number): number[] {
  const rest = [1, 2, 3, 4, 5].filter((n) => n !== tapped)
  return [tapped, ...rest]
}

/* -------------------------------------------------------------------------- */
/*  Run summary maths                                                         */
/* -------------------------------------------------------------------------- */
/** One line in the itemised summary: the exact award, and how many identical
 *  awards were won (so "3 × £25 CASH" reads cleanly for big purchases). */
export interface SummaryItem {
  kind: OutcomeKind
  amountPence: number
  count: number
  label: string
}

export interface PlanSummary {
  ticketCount: number
  instantWins: number
  cashPence: number
  creditPence: number
  /** Every award, itemised largest-first. Shown BEFORE the aggregate totals. */
  items: SummaryItem[]
}

/**
 * Derive the summary from the SAME awards array the animation walks, so the
 * itemised list, the win count and the totals can never disagree.
 */
export function summarisePlan(plan: RevealPlan): PlanSummary {
  let cashPence = 0
  let creditPence = 0
  // Group identical awards, remembering first-seen order value for sorting.
  // Cash/credit group by (kind + amount); manual/physical prizes group by their
  // title so distinct physical prizes stay separate lines while identical ones
  // collapse to "N ×". Either way the SUM of item counts always equals
  // plan.awards.length, so the summary can never silently drop or duplicate.
  const groups = new Map<string, SummaryItem>()
  for (const a of plan.awards) {
    const o = a.outcome
    if (o.kind === "cash") cashPence += o.amountPence
    if (o.kind === "credit") creditPence += o.amountPence
    const manualLabel = o.title?.trim() || o.valueText?.trim() || "PRIZE"
    const key = o.kind === "manual" ? `manual:${manualLabel.toLowerCase()}` : `${o.kind}:${o.amountPence}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, {
        kind: o.kind,
        amountPence: o.amountPence,
        count: 1,
        label: o.kind === "manual" ? manualLabel : o.kind === "credit" ? "SITE CREDIT" : "CASH",
      })
    }
  }
  const kindOrder: Record<OutcomeKind, number> = { cash: 0, manual: 1, credit: 2, none: 3 }
  const items = Array.from(groups.values()).sort((a, b) => {
    // Cash first, then physical prizes, then site credit; within a kind by
    // value descending (manual prizes have no value, so keep insertion order).
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind]
    return b.amountPence - a.amountPence
  })
  return {
    ticketCount: plan.ticketCount,
    instantWins: plan.awards.length,
    cashPence,
    creditPence,
    items,
  }
}

/* -------------------------------------------------------------------------- */
/*  Dev option lists                                                          */
/* -------------------------------------------------------------------------- */
export const RESULT_PRESET_OPTIONS: { value: ResultPreset; label: string }[] = [
  { value: "none", label: "No instant win" },
  { value: "credit5", label: "£5 site credit" },
  { value: "cash100", label: "£100 cash" },
  { value: "cash5000", label: "£5,000 cash" },
  { value: "twoWins", label: "2 wins" },
  { value: "threeWins", label: "3 wins" },
  { value: "fiveWins", label: "5 wins" },
  { value: "sevenWins", label: "7 wins" },
]

export const DESTINATION_OPTIONS: { value: DestinationOverride; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
]

export const TICKET_COUNT_OPTIONS: TicketCount[] = [1, 10, 50, 100, 125, 250, 500]

export const SPEED_OPTIONS: { value: Speed; label: string }[] = [
  { value: 1, label: "Normal" },
  { value: 2, label: "0.5×" },
  { value: 4, label: "0.25×" },
]

export const CHAR_PREVIEW_OPTIONS: { value: CharPreview; label: string }[] = [
  { value: "off", label: "Live game" },
  { value: "neutral", label: "Neutral" },
  { value: "scored", label: "Scored" },
]

export const DEFAULT_SETTINGS: DemoSettings = {
  resultPreset: "cash100",
  ticketCount: 125,
  soundOn: false,
  reducedMotion: false,
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

/** Human labels for outcome kinds (dev summary use). */
export const KIND_LABEL: Record<OutcomeKind, string> = {
  none: "No win",
  credit: "Site credit",
  cash: "Cash",
  manual: "Prize",
}
