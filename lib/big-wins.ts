/**
 * Shared Big Wins types, serialisation, and input validation.
 *
 * Big Wins are hand-curated marketing/social-proof cards shown at the top of
 * the public /winners page. They are DELIBERATELY separate from the automatic
 * `winners_feed`: nothing here reads or derives from the live award pipeline.
 *
 * This module is client-safe (no server-only imports) so both the admin UI and
 * the API route share one shape and one validator.
 */

/** Supabase Storage bucket for curated Big Win winner photos. */
export const BIG_WINS_BUCKET = "big-wins"

/** Public column allow-list selected from `big_wins`. `created_by` is admin-only. */
export const BIG_WIN_PUBLIC_COLUMNS =
  "id, winner_name, prize_text, image_url, image_pos_x, image_pos_y, competition, won_on, ticket_number, display_order, is_active"

/** Serialised Big Win card (camelCase) sent to the client. */
export interface BigWinDTO {
  id: string
  winnerName: string
  prizeText: string
  imageUrl: string
  imagePosX: number
  imagePosY: number
  competition: string
  wonOn: string
  ticketNumber: number | null
  displayOrder: number
  isActive: boolean
}

/**
 * CamelCase form values held by the admin dialog. `ticketNumber` and `wonOn`
 * are free-text inputs; the validator coerces and bounds them. This is the
 * shape the UI edits; the DB-shaped payload below is what gets persisted.
 */
export interface BigWinInput {
  winnerName: string
  prizeText: string
  competition: string
  wonOn: string
  ticketNumber: string
  imageUrl: string
  imagePosX: number
  imagePosY: number
  isActive: boolean
}

/** Validated, DB-column-shaped payload for insert/update. */
export interface BigWinDbInput {
  winner_name: string
  prize_text: string
  image_url: string
  image_pos_x: number
  image_pos_y: number
  competition: string
  won_on: string
  ticket_number: number | null
  display_order: number
  is_active: boolean
}

export type ValidationResult =
  | { ok: true; value: BigWinDbInput }
  // `error` is a stable machine code (used by the API); `errors` are
  // human-readable messages surfaced by the admin form.
  | { ok: false; error: string; errors: string[] }

/** Canonical 8-4-4-4-12 hexadecimal UUID. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim())
}

/** YYYY-MM-DD calendar date (matches the `date` column). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MAX_TEXT = 120

function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : ""
}

/** Clamp an image-position percentage to an integer in [0, 100] (default 50). */
export function clampPercent(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10)
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** Map a machine validation code to a human-readable message for the form. */
const VALIDATION_MESSAGES: Record<string, string> = {
  winner_name_required: "Winner name is required.",
  winner_name_too_long: "Winner name is too long.",
  prize_text_required: "Prize is required.",
  prize_text_too_long: "Prize text is too long.",
  image_url_required: "A winner photo is required.",
  image_url_invalid: "The winner photo could not be read. Please re-upload.",
  competition_required: "Competition is required.",
  competition_too_long: "Competition name is too long.",
  won_on_invalid: "Please provide a valid won-on date.",
  ticket_number_invalid: "Ticket number must be a positive whole number.",
  display_order_invalid: "Display order is invalid.",
  is_active_invalid: "Visibility flag is invalid.",
}

function fail(code: string): ValidationResult {
  return { ok: false, error: code, errors: [VALIDATION_MESSAGES[code] ?? "Invalid input."] }
}

/**
 * Validate a Big Win create/edit payload. Every field is normalised and
 * bounded server-side; the client value is never trusted. Returns a
 * DB-column-shaped object on success.
 */
export function validateBigWinInput(body: Record<string, unknown>): ValidationResult {
  const winner_name = cleanText(body.winnerName ?? body.winner_name)
  if (winner_name.length === 0) return fail("winner_name_required")
  if (winner_name.length > MAX_TEXT) return fail("winner_name_too_long")

  const prize_text = cleanText(body.prizeText ?? body.prize_text)
  if (prize_text.length === 0) return fail("prize_text_required")
  if (prize_text.length > MAX_TEXT) return fail("prize_text_too_long")

  const image_url = cleanText(body.imageUrl ?? body.image_url)
  if (image_url.length === 0) return fail("image_url_required")
  // Only accept an http(s) URL (the Supabase public URL). Never a data:/blob: URI.
  if (!/^https?:\/\//i.test(image_url)) return fail("image_url_invalid")

  const competition = cleanText(body.competition)
  if (competition.length === 0) return fail("competition_required")
  if (competition.length > MAX_TEXT) return fail("competition_too_long")

  const won_on = cleanText(body.wonOn ?? body.won_on)
  if (!DATE_RE.test(won_on) || Number.isNaN(Date.parse(won_on))) {
    return fail("won_on_invalid")
  }

  // Ticket number is optional. Empty/absent -> null. Otherwise a positive int.
  // `Number(...)` (not parseInt) so "12.5" / "1e3" / "12abc" fail instead of
  // being silently truncated to 12.
  const rawTicket = body.ticketNumber ?? body.ticket_number
  let ticket_number: number | null = null
  if (rawTicket !== null && rawTicket !== undefined && String(rawTicket).trim() !== "") {
    const n = typeof rawTicket === "number" ? rawTicket : Number(String(rawTicket).trim())
    if (!Number.isInteger(n) || n <= 0) return fail("ticket_number_invalid")
    ticket_number = n
  }

  const rawOrder = body.displayOrder ?? body.display_order
  let display_order = 0
  if (rawOrder !== null && rawOrder !== undefined && String(rawOrder).trim() !== "") {
    const n = typeof rawOrder === "number" ? rawOrder : Number.parseInt(String(rawOrder), 10)
    if (!Number.isInteger(n) || n < 0 || n > 100000) return fail("display_order_invalid")
    display_order = n
  }

  // Visibility defaults to true when absent (a fresh card is shown by default).
  const rawActive = body.isActive ?? body.is_active
  const is_active = rawActive === undefined ? true : rawActive
  if (typeof is_active !== "boolean") return fail("is_active_invalid")

  return {
    ok: true,
    value: {
      winner_name,
      prize_text,
      image_url,
      image_pos_x: clampPercent(body.imagePosX ?? body.image_pos_x),
      image_pos_y: clampPercent(body.imagePosY ?? body.image_pos_y),
      competition,
      won_on,
      ticket_number,
      display_order,
      is_active,
    },
  }
}

/** Map a raw `big_wins` row to the camelCase DTO. */
export function mapBigWinRow(row: Record<string, unknown>): BigWinDTO {
  return {
    id: String(row.id),
    winnerName: String(row.winner_name ?? ""),
    prizeText: String(row.prize_text ?? ""),
    imageUrl: String(row.image_url ?? ""),
    imagePosX: typeof row.image_pos_x === "number" ? row.image_pos_x : 50,
    imagePosY: typeof row.image_pos_y === "number" ? row.image_pos_y : 50,
    competition: String(row.competition ?? ""),
    wonOn: String(row.won_on ?? ""),
    ticketNumber:
      typeof row.ticket_number === "number" && Number.isFinite(row.ticket_number)
        ? row.ticket_number
        : null,
    displayOrder: typeof row.display_order === "number" ? row.display_order : 0,
    isActive: row.is_active === true,
  }
}

/**
 * Format a Big Win date as "Won 2 Sep" (day + short month, no leading zero).
 * Used by the public card. Falls back to the raw string if unparseable.
 */
export function formatWonOn(wonOn: string): string {
  const t = Date.parse(wonOn)
  if (Number.isNaN(t)) return wonOn
  const d = new Date(t)
  const day = d.getUTCDate()
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })
  return `Won ${day} ${month}`
}

/** Format a ticket number with thousands grouping, e.g. "Ticket #12,845". */
export function formatTicket(ticketNumber: number | null): string | null {
  if (typeof ticketNumber !== "number" || !Number.isFinite(ticketNumber)) return null
  return `Ticket #${ticketNumber.toLocaleString("en-GB")}`
}
