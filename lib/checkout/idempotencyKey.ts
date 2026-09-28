/**
 * Generates a client idempotency key for checkout creation. Isolated from the
 * pure reducer so state logic stays deterministic and testable; the component
 * calls this and feeds the fresh key into rotating reducer actions.
 */
export function createIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID.
  return `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`
}
