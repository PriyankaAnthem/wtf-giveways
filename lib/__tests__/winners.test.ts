import { describe, it, expect } from "vitest"
import type { WinnerSnapshot } from "@/lib/types"
import {
  decodeWinnersCursor,
  encodeWinnersCursor,
  isWinnerEligible,
  winnerKey,
  winnersEligibilityOrFilter,
} from "@/lib/winners"

/**
 * Regression coverage for the winners eligibility CONTRACT:
 *
 *   Show every genuine awarded prize EXCEPT site credit.
 *
 * Site credit is authoritatively identified by `fulfilment_type =
 * 'wallet_credit'`. Eligibility is deliberately NOT based on prize amount,
 * cash/balloon wording, prize title, prize category, campaign slug, or any
 * fulfilment style — the ONLY thing removed is wallet credit. These tests lock
 * that rule for both the public Winners page and `/api/winners`, and lock the
 * deterministic pagination/dedup helpers.
 */

function winner(overrides: Partial<WinnerSnapshot> = {}): WinnerSnapshot {
  return {
    name: "Verified winner",
    prizeTitle: "Prize",
    giveawayTitle: "Test campaign",
    announcedAt: "2026-09-03T12:47:03.110427+00:00",
    kind: "instant",
    ...overrides,
  }
}

describe("isWinnerEligible — everything except site credit", () => {
  it("EXCLUDES site credit (fulfilment_type = wallet_credit)", () => {
    expect(
      isWinnerEligible(winner({ prizeTitle: "£10 site credit", fulfilmentType: "wallet_credit" })),
    ).toBe(false)
  })

  it("EXCLUDES site credit even when its title looks like a plain cash amount", () => {
    // Real data: some wallet_credit rows are titled "£5"/"£20" with no "credit"
    // word. They are still site credit and must stay hidden — identity is the
    // fulfilment type, never the title text.
    expect(isWinnerEligible(winner({ prizeTitle: "£20", fulfilmentType: "wallet_credit" }))).toBe(false)
  })

  it("INCLUDES native cash instant wins", () => {
    expect(isWinnerEligible(winner({ prizeTitle: "£250 CASH", fulfilmentType: "cash" }))).toBe(true)
  })

  it("INCLUDES manual cash wins (DG shape: £100 CASH, manual, NULL value)", () => {
    expect(
      isWinnerEligible(winner({ prizeTitle: "£100 CASH", fulfilmentType: "manual", prizeValuePence: null })),
    ).toBe(true)
  })

  it("INCLUDES amount-only manual cash titles with no 'cash' word (previously dropped)", () => {
    // £20 / £50 amount-only titles were lost by the old allow-list rule.
    expect(isWinnerEligible(winner({ prizeTitle: "£20", fulfilmentType: "manual" }))).toBe(true)
    expect(isWinnerEligible(winner({ prizeTitle: "£50", fulfilmentType: "manual" }))).toBe(true)
  })

  it("INCLUDES physical / non-cash manual prizes (previously dropped)", () => {
    // Cream pie, WINNING BOX, Jellycat toys — all genuine, none are site credit.
    expect(isWinnerEligible(winner({ prizeTitle: "Cream pie", fulfilmentType: "manual" }))).toBe(true)
    expect(isWinnerEligible(winner({ prizeTitle: "WINNING BOX", fulfilmentType: "manual" }))).toBe(true)
    expect(
      isWinnerEligible(winner({ prizeTitle: "Bartholomew Bear 'Bathrobe' worth £40", fulfilmentType: "manual" })),
    ).toBe(true)
  })

  it("INCLUDES balloon instant wins", () => {
    expect(isWinnerEligible(winner({ prizeTitle: "Balloon", fulfilmentType: "manual" }))).toBe(true)
  })

  it("INCLUDES instant wins with a NULL fulfilment type (a NULL type is not credit)", () => {
    expect(isWinnerEligible(winner({ prizeTitle: "Mystery prize", fulfilmentType: null }))).toBe(true)
  })

  it("INCLUDES a brand-new future prize type automatically (no rule change needed)", () => {
    // The whole point of the contract: any new, non-credit prize just appears.
    expect(
      isWinnerEligible(winner({ prizeTitle: "Holiday to Japan", fulfilmentType: null, giveawaySlug: "future-comp" })),
    ).toBe(true)
  })

  it("ALWAYS includes main-draw winners", () => {
    expect(isWinnerEligible(winner({ kind: "main", prizeTitle: "Range Rover" }))).toBe(true)
  })

  it("EXCLUDES rows of an unknown kind (fail closed)", () => {
    expect(isWinnerEligible(winner({ kind: undefined }))).toBe(false)
  })
})

describe("winnersEligibilityOrFilter() structure", () => {
  const filter = winnersEligibilityOrFilter()

  it("is exactly: main OR (instant AND not wallet_credit)", () => {
    expect(filter).toBe(
      "kind.eq.main,and(kind.eq.instant,or(fulfilment_type.is.null,fulfilment_type.neq.wallet_credit))",
    )
  })

  it("keeps the NULL-safe wallet_credit exclusion", () => {
    expect(filter).toContain("or(fulfilment_type.is.null,fulfilment_type.neq.wallet_credit)")
  })

  it("has NO allow-lists, wording predicates, or value thresholds", () => {
    // The contract forbids re-introducing amount / cash / balloon / slug gates.
    expect(filter).not.toContain("prize_value_pence")
    expect(filter).not.toContain("prize_title")
    expect(filter).not.toContain("prize_value_text")
    expect(filter).not.toContain("campaign_slug")
    expect(filter).not.toContain("balloon")
    expect(filter).not.toContain(">= 2000")
  })
})

describe("winnerKey — stable identity for dedup", () => {
  it("prefers the stable feedId when present", () => {
    expect(winnerKey(winner({ feedId: "instant:abc-123" }))).toBe("instant:abc-123")
  })

  it("does NOT collapse two distinct awards sharing timestamp+name+title", () => {
    // The old composite key merged these into one; feedId keeps them separate.
    const a = winner({ feedId: "instant:aaa", name: "Sam", prizeTitle: "Cream pie" })
    const b = winner({ feedId: "instant:bbb", name: "Sam", prizeTitle: "Cream pie" })
    expect(winnerKey(a)).not.toBe(winnerKey(b))
  })

  it("falls back to the composite key only when no feedId (mock rows)", () => {
    expect(winnerKey(winner({ feedId: null }))).toBe(
      "2026-09-03T12:47:03.110427+00:00|Verified winner|Prize",
    )
  })
})

describe("winners cursor — deterministic keyset", () => {
  it("encodes happened_at and feed_id, and round-trips via decode", () => {
    const w = winner({ feedId: "instant:xyz", announcedAt: "2026-09-03T12:47:03.110427+00:00" })
    const cursor = encodeWinnersCursor(w)
    expect(cursor).toBe("2026-09-03T12:47:03.110427+00:00~instant:xyz")
    expect(decodeWinnersCursor(cursor)).toEqual({
      happenedAt: "2026-09-03T12:47:03.110427+00:00",
      feedId: "instant:xyz",
    })
  })

  it("returns null when the row has no feedId (stops pagination for mock data)", () => {
    expect(encodeWinnersCursor(winner({ feedId: null }))).toBeNull()
  })

  it("decodes null / empty / malformed cursors as null", () => {
    expect(decodeWinnersCursor(null)).toBeNull()
    expect(decodeWinnersCursor("")).toBeNull()
    expect(decodeWinnersCursor("no-separator")).toBeNull()
    expect(decodeWinnersCursor("~instant:xyz")).toBeNull() // empty timestamp
    expect(decodeWinnersCursor("2026-09-03T12:47:03Z~")).toBeNull() // empty feedId
    expect(decodeWinnersCursor("not-a-date~instant:xyz")).toBeNull()
  })
})
