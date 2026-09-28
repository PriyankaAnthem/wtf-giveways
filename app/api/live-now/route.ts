import { NextResponse } from 'next/server'
import { getLiveNow } from '@/lib/live-now'

// Always resolved fresh (a takeover can be toggled at any moment), but this is a
// single lightweight read — no polling, no realtime.
export const dynamic = 'force-dynamic'

/**
 * GET /api/live-now
 *
 * Public, lightweight. Returns `{ live: null }` when no site takeover is
 * enabled, otherwise `{ live: { ...public fields } }`. Never fails the caller:
 * getLiveNow() swallows errors and returns null.
 */
export async function GET() {
  const live = await getLiveNow()
  return NextResponse.json({ live }, { headers: { 'Cache-Control': 'no-store' } })
}
