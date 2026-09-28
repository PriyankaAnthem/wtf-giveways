/**
 * Money + number formatting for the admin reporting surfaces.
 *
 * All monetary values in the reporting layer are integer PENCE (GBP). Never do
 * floating-point maths on pence before formatting — divide only at the display
 * boundary here.
 */

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const GBP_COMPACT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
})

const INT = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 })

/** Format integer pence as e.g. "£1,234.50". Null/undefined -> "£0.00". */
export function formatPence(pence: number | null | undefined): string {
  const n = typeof pence === "number" && Number.isFinite(pence) ? pence : 0
  return GBP.format(n / 100)
}

/** Compact GBP for tight mobile chart axes/labels, e.g. "£1.2K". */
export function formatPenceCompact(pence: number | null | undefined): string {
  const n = typeof pence === "number" && Number.isFinite(pence) ? pence : 0
  return GBP_COMPACT.format(n / 100)
}

/** Whole-number formatter with thousands separators. */
export function formatCount(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0
  return INT.format(v)
}

/**
 * Percentage change from `previous` to `current`, expressed as a signed number
 * (e.g. 12.5 for +12.5%). Returns null when there is no meaningful baseline so
 * the UI can render "—" instead of a misleading "+100%"/"∞".
 */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

/** Human label for a signed percentage, e.g. "+12.5%", "-3.0%", or "—". */
export function formatPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—"
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

/** Direction of a signed pct for colour/aria decisions. */
export function pctDirection(pct: number | null): "up" | "down" | "flat" {
  if (pct === null || pct === 0 || !Number.isFinite(pct)) return "flat"
  return pct > 0 ? "up" : "down"
}
