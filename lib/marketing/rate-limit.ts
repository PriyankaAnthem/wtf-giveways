import 'server-only'

/**
 * Tiny in-memory fixed-window rate limiter for marketing preference / unsubscribe
 * endpoints. This is intentionally lightweight: Stage 0 must not add cron jobs,
 * background workers, or new infrastructure. It is best-effort per serverless
 * instance (not a global limiter) — enough to blunt rapid repeated requests and
 * accidental double-submits, layered on top of the idempotent DB functions that
 * are the real correctness guarantee.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Opportunistic cleanup so the map cannot grow unbounded.
function sweep(now: number) {
  if (buckets.size < 5000) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Returns { allowed } for a given key. When not allowed, `retryAfterSeconds`
 * hints how long until the window resets.
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  sweep(now)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (existing.count >= opts.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Best-effort client IP extraction (mirrors app/api/pre-register/route.ts). */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return '0.0.0.0'
}
