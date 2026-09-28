/**
 * Shared definition of the three Customers workspace views. Kept free of any
 * client/server-only imports so it can be used by the server page (to validate
 * the initial `?view=` param) and the client workspace alike.
 */

export const CUSTOMER_VIEWS = ["newest", "top-spenders", "recent-winners"] as const

export type CustomerView = (typeof CUSTOMER_VIEWS)[number]

export const DEFAULT_VIEW: CustomerView = "newest"

/** Validates an unknown value against the allowed views, falling back safely to
 *  `newest` for anything unrecognised (§2). */
export function normalizeView(value: unknown): CustomerView {
  return typeof value === "string" && (CUSTOMER_VIEWS as readonly string[]).includes(value)
    ? (value as CustomerView)
    : DEFAULT_VIEW
}
