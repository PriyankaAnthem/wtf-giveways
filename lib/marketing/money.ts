/**
 * WTF Marketing — Stage 043 DETERMINISTIC INTEGER-PENCE FORMATTING.
 *
 * The marketing snapshot contract carries every monetary value as an INTEGER
 * number of pence (GBP). This module formats those integers for display in the
 * commercial-facts strip and the wallet-credit hero. It performs NO
 * floating-point money maths: pounds and remaining pence are derived with
 * integer division / modulo only, and division happens solely at the display
 * boundary here.
 *
 * The house style deliberately differs from the admin reporting formatter
 * (lib/admin/reporting/format.ts, which always shows "£X.XX"): marketing copy
 * wants the compact, punchy form used across the site:
 *
 *     29     -> "29p"
 *     50     -> "50p"
 *     100    -> "£1"
 *     129    -> "£1.29"
 *     1850   -> "£18.50"
 *     150000 -> "£1,500"
 *
 * Whole-pound amounts drop the ".00"; sub-pound amounts render as "Np"; amounts
 * with a pence remainder render "£P.pp". Thousands separators are applied to the
 * pounds part only.
 *
 * Pure + hermetic: no imports, no I/O. Inputs are already-validated integers,
 * but the formatters are defensive (non-finite / non-integer / negative inputs
 * are floored to a safe non-negative integer) so they can never throw or emit
 * "NaN"/"undefined" into an email.
 */

const GROUPED = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/** Coerce untrusted input to a safe, non-negative integer (never throws). */
function safeInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/**
 * Format integer pence in the compact WTF marketing house style. See the module
 * header for the exact mapping. Never performs floating-point money maths.
 */
export function formatMarketingPence(pence: number | null | undefined): string {
  const n = safeInt(pence)
  if (n < 100) {
    return `${n}p`
  }
  const pounds = Math.trunc(n / 100)
  const remainder = n % 100
  const poundsText = GROUPED.format(pounds)
  if (remainder === 0) {
    return `£${poundsText}`
  }
  return `£${poundsText}.${String(remainder).padStart(2, '0')}`
}

/** Whole-number formatter with thousands separators, e.g. 31596 -> "31,596". */
export function formatMarketingCount(count: number | null | undefined): string {
  return GROUPED.format(safeInt(count))
}
