import { NextResponse } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"
import {
  GRID_PAGE_SIZE,
  PUBLIC_WINNER_COLUMNS,
  applyWinnersKeyset,
  decodeWinnersCursor,
  encodeWinnersCursor,
  mapWinnerRow,
  winnersEligibilityOrFilter,
} from "@/lib/winners"

export const dynamic = "force-dynamic"

const NO_STORE = {
  headers: { "Cache-Control": "private, no-store" },
}

/**
 * Cursor-paginated winners feed for the "Load more" control.
 *
 * Reads the SAME `winners_feed` source and eligibility filter as the initial
 * server load, and uses the SAME deterministic keyset ordering
 * (`happened_at DESC, feed_id DESC`) via `applyWinnersKeyset`. The cursor
 * carries BOTH `happened_at` and the stable `feed_id`, so a run of winners
 * sharing a timestamp is never skipped or duplicated across the page boundary.
 * One extra row is peeked to compute `hasMore` without a wasted empty request.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawCursor = searchParams.get("cursor")

  // Bounded, non-negotiable page size — never fetch unbounded history.
  const limit = GRID_PAGE_SIZE

  // Decode "<happened_at>~<feed_id>". A present-but-malformed cursor is a 400;
  // an absent cursor (first page) is fine.
  const cursor = decodeWinnersCursor(rawCursor)
  if (rawCursor && !cursor) {
    return NextResponse.json({ ok: false, error: "invalid_cursor" }, { status: 400, ...NO_STORE })
  }

  try {
    // Cookie-FREE anon client: this is a public, column-allow-listed feed with
    // no per-user filtering, so the caller's session was never used. The
    // cookie-bound client would resolve a token via `auth.getSession()` on this
    // query and attempt a network token refresh it cannot persist, adding a
    // Supabase Auth call to every "Load more" click.
    const supabase = createPublicClient()

    const query = applyWinnersKeyset(
      supabase
        .from("winners_feed")
        // Explicit public allow-list: `winning_ticket` / `user_id` are never
        // fetched, so they can never appear in this JSON response.
        .select(PUBLIC_WINNER_COLUMNS)
        // Same shared rule as the initial load: every genuine awarded prize
        // EXCEPT site credit (fulfilment_type = 'wallet_credit').
        .or(winnersEligibilityOrFilter()),
      cursor,
    ).limit(limit + 1) // peek one extra to compute hasMore

    const { data, error } = await query

    if (error) {
      console.error("[api/winners] query error:", error.message)
      return NextResponse.json({ ok: false, error: "load_failed" }, { status: 500, ...NO_STORE })
    }

    const rows = data ?? []
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const winners = pageRows.map(mapWinnerRow)
    const nextCursor = winners.length > 0 ? encodeWinnersCursor(winners[winners.length - 1]) : null

    return NextResponse.json({ ok: true, winners, nextCursor, hasMore }, NO_STORE)
  } catch (err) {
    console.error("[api/winners] unexpected error:", err)
    return NextResponse.json({ ok: false, error: "load_failed" }, { status: 500, ...NO_STORE })
  }
}
