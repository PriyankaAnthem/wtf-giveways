/**
 * DG'S BIG BALLERS — shared types for the isolated /dgfootballidea prototype.
 *
 * PROTOTYPE ONLY. No Supabase, no checkout, no payments, no award allocation,
 * no API routes. Every value here is mock/presentation data.
 *
 * MECHANIC (approved): the customer performs ONE interaction — TAP A BALL. The
 * selected football automatically launches on a curved path into a five-hole
 * target board and visibly enters ONE mystery hole, which reveals a
 * PREDETERMINED result. No flicking / swiping / dragging / aiming.
 *
 * TICKETS: the customer buys N tickets; EACH ticket is independently checked
 * against the instant-win allocation (more tickets = more chances). The five
 * footballs and five holes are COSMETIC game mechanics — never the customer's
 * odds. One tap reveals ALL predetermined results for the purchase: winning
 * results auto-chain (up to a small maximum of full animations, the rest are
 * summarised) so a 500-ticket buyer never has to interact 500 times.
 */

/**
 * The single, typed game state. Never model this with loose booleans.
 *
 *   intro → choosing → selected → launching → approaching_hole → entering_hole
 *     → suspense
 *       WIN:  → win_reaction → celebrating → revealing → revealed
 *       MISS: → nonwin_reaction → summary
 *   revealed (win) → (more wins) checking_additional → auto_relaunch → launching
 *                  → (no more)   summary
 *   summary → complete
 */
export type GameState =
  | "intro"
  | "choosing"
  | "selected"
  | "launching"
  | "approaching_hole"
  | "entering_hole"
  | "suspense"
  | "win_reaction"
  | "nonwin_reaction"
  | "celebrating"
  | "revealing"
  | "revealed"
  | "checking_additional"
  | "auto_relaunch"
  | "summary"
  | "complete"

/** Which supplied photo DG is showing. Derived from GameState — never ad-hoc.
 *  dg-neutral: everything except a winning celebration.
 *  dg-scored:  winning celebration + behind the winning prize panel only. */
export type CharacterPose = "neutral" | "scored"

/** The five target-board holes. These are HOLE identifiers, not ticket numbers. */
export type HoleId = 1 | 2 | 3 | 4 | 5

/** Dev destination override for the FIRST animation. `auto` = predetermined. */
export type DestinationOverride = "auto" | HoleId

/** Dev timing multiplier: 1 = normal, 2 = 0.5×, 4 = 0.25×. */
export type Speed = 1 | 2 | 4

/** Dev static character preview (inspect a single asset), or "off" for live. */
export type CharPreview = "off" | "neutral" | "scored"

/** The kind of instant-win outcome. "none" only ever appears as a whole-purchase
 *  zero-win result, never as an award. "manual" is a physical / manually
 *  fulfilled prize that has NO reliable numeric cash value — it is presented by
 *  its title (and optional image) instead of a money amount. */
export type OutcomeKind = "none" | "credit" | "cash" | "manual"

/** A single outcome. `amountPence` is meaningful for cash / credit; 0 for
 *  none / manual. The optional display fields are populated by the PRODUCTION
 *  adapter for manual/physical prizes (the mock prototype never sets them). */
export interface Outcome {
  kind: OutcomeKind
  amountPence: number
  /** Manual/physical prize display title (e.g. "PlayStation 5"). */
  title?: string
  /** Optional prize image (manual/physical prizes only). */
  imageUrl?: string
  /** Optional raw value text straight from the server (display only). */
  valueText?: string
}

/**
 * One instant win contained in the purchase. `destinationHole` is the board
 * hole the ball visibly enters for this win's animation; the cosmetic football
 * the customer taps NEVER changes the outcome or the hole.
 */
export interface Award {
  outcome: Outcome
  destinationHole: HoleId
}

/**
 * The predetermined reveal for a whole purchase. `ticketCount` is the real
 * purchased quantity (the customer's true number of chances). `awards` are the
 * instant wins found across those tickets (0..N).
 */
export interface RevealPlan {
  ticketCount: number
  awards: Award[]
  /** Optional compact ticket-range label for parity with other reveals, e.g.
   *  "TICKETS #1201–#1325". Set by the PRODUCTION adapter; omitted (undefined)
   *  by the mock prototype and rendered only when present. */
  ticketRangeText?: string
}

/** One thing the reveal actually animates: a win, or (when there are zero
 *  wins) a single non-winning shot. EVERY win in the purchase becomes one of
 *  these — there is no cap. `fast` marks the shorter FAST WIN STREAK treatment
 *  used from the 4th win onward. */
export interface Animation {
  isWin: boolean
  outcome: Outcome
  destinationHole: HoleId
  /** Cosmetic tray ball this animation launches (1..5, then it repeats). */
  ballNumber: number
  /** Full cinematic (false) vs FAST WIN STREAK (true, 4th win onward). */
  fast: boolean
  /** True when this shot begins a fresh tray of five cosmetic footballs. */
  traySlot: number
}

/** Copy shown on the winning prize panel, derived from an Outcome. */
export interface RevealCopy {
  tone: "big" | "cash" | "credit"
  eyebrow: string
  amount: string
  unit: string
  support: string
  isMoney: boolean
  /** Manual/physical prize: render title text (smaller) instead of a money
   *  amount, plus an optional image. Cash/credit leave these undefined. */
  isManual?: boolean
  imageUrl?: string
}

/** Cosmetic energy tier derived purely from ticket quantity. Affects ONLY
 *  visual intensity — never hole size, probability or outcome. */
export type EnergyTier = "standard" | "raised" | "charged" | "bigballer" | "max"

/** Dev-only result preset (what wins the purchase contains). */
export type ResultPreset =
  | "none"
  | "credit5"
  | "cash100"
  | "cash5000"
  | "twoWins"
  | "threeWins"
  | "fiveWins"
  | "sevenWins"

/** Purchased ticket quantity (the customer's real number of chances). */
export type TicketCount = number

/** Dev-only settings. These never affect production code paths. */
export interface DemoSettings {
  /** What instant wins the purchase contains. */
  resultPreset: ResultPreset
  /** Purchased ticket quantity (drives LOADED/CHECKED messaging + energy). */
  ticketCount: TicketCount
  soundOn: boolean
  reducedMotion: boolean
  /** 1 = normal, 2 = 0.5×, 4 = 0.25×. Drives every animation duration. */
  speed: Speed
  skipIntro: boolean
  /** Force the FIRST animation's hole regardless of the plan. `auto` = data. */
  destination: DestinationOverride
  /** Static pose preview for asset inspection; "off" = live gameplay. */
  charPreview: CharPreview
  /* ---- guide overlays (all default off; invisible in normal gameplay) ---- */
  showHoleBounds: boolean
  showHoleCentres: boolean
  showBallOrigin: boolean
  showControlPoints: boolean
  showEndpoint: boolean
  showBoardBounds: boolean
  showState: boolean
}

/** Conceptual sound cues. No external audio files are required. */
export type SoundCue =
  | "select"
  | "launch"
  | "whoosh"
  | "drop"
  | "suspense"
  | "impact"
  | "prize"
  | "credit"
  | "nowin"
  | "another"
  | "streak"
  | "reload"
