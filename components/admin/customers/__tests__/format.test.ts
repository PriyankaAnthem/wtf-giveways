import { describe, it, expect } from "vitest"
import {
  resolveCustomerName,
  resolveSecondaryHandle,
  isLikelyHandleNoise,
  formatUkMobile,
  formatCount,
  getInitials,
  buildListWinningsSummary,
  resolveWinStatus,
  resolveWinPrizeLabel,
  formatDayTime,
  formatRelativeTime,
  type WinRecord,
} from "../format"

describe("resolveCustomerName", () => {
  it("prefers first + last name above everything", () => {
    expect(
      resolveCustomerName({
        first_name: "Ada",
        last_name: "Lovelace",
        display_name: "ada_l",
        real_name: "adalove88",
        email: "ada@x.io",
      }),
    ).toBe("Ada Lovelace")
  })

  it("falls back to first name only, then last name only", () => {
    expect(resolveCustomerName({ first_name: "Ada" })).toBe("Ada")
    expect(resolveCustomerName({ last_name: "Lovelace" })).toBe("Lovelace")
  })

  it("uses display_name before real_name", () => {
    expect(resolveCustomerName({ display_name: "Ada L", real_name: "adalove88" })).toBe("Ada L")
  })

  it("uses real_name before the email local-part", () => {
    expect(resolveCustomerName({ real_name: "adalove88", email: "ada@x.io" })).toBe("adalove88")
  })

  it("uses the email local-part when no name exists", () => {
    expect(resolveCustomerName({ email: "ada@x.io" })).toBe("ada")
  })

  it("returns 'Unknown customer' when nothing is available", () => {
    expect(resolveCustomerName({})).toBe("Unknown customer")
    expect(resolveCustomerName({ first_name: "  ", email: "  " })).toBe("Unknown customer")
  })

  it("trims whitespace on supplied names", () => {
    expect(resolveCustomerName({ first_name: "  Ada  ", last_name: " Lovelace " })).toBe("Ada Lovelace")
  })
})

describe("isLikelyHandleNoise", () => {
  it("flags username-style handles with digits", () => {
    expect(isLikelyHandleNoise("elliemaythom2709")).toBe(true)
    expect(isLikelyHandleNoise("kyemakd9")).toBe(true)
  })

  it("flags long single lowercase tokens", () => {
    expect(isLikelyHandleNoise("absfactor")).toBe(true)
  })

  it("flags emails and empties", () => {
    expect(isLikelyHandleNoise("ada@x.io")).toBe(true)
    expect(isLikelyHandleNoise("")).toBe(true)
    expect(isLikelyHandleNoise(null)).toBe(true)
  })

  it("does NOT flag real multi-word names", () => {
    expect(isLikelyHandleNoise("Ada Lovelace")).toBe(false)
    expect(isLikelyHandleNoise("Jane")).toBe(false)
  })
})

describe("resolveSecondaryHandle", () => {
  it("returns a non-noise handle that differs from the primary", () => {
    expect(resolveSecondaryHandle({ display_name: "The Ace" }, "Ada Lovelace")).toBe("The Ace")
  })

  it("omits the handle when it is noise", () => {
    expect(resolveSecondaryHandle({ real_name: "adalove88" }, "Ada Lovelace")).toBeNull()
  })

  it("omits the handle when it equals the primary name", () => {
    expect(resolveSecondaryHandle({ display_name: "Ada Lovelace" }, "Ada Lovelace")).toBeNull()
  })

  it("returns null when there is no candidate", () => {
    expect(resolveSecondaryHandle({}, "Ada")).toBeNull()
  })
})

describe("formatUkMobile", () => {
  it("groups a standard 11-digit UK mobile", () => {
    expect(formatUkMobile("07786144708")).toBe("07786 144708")
  })

  it("strips embedded spaces before grouping", () => {
    expect(formatUkMobile("07786 144 708")).toBe("07786 144708")
  })

  it("leaves non-UK / unusual numbers unchanged", () => {
    expect(formatUkMobile("+447786144708")).toBe("+447786144708")
    expect(formatUkMobile("1234")).toBe("1234")
  })

  it("returns an empty string for empty input", () => {
    expect(formatUkMobile(null)).toBe("")
    expect(formatUkMobile("   ")).toBe("")
  })
})

describe("formatCount", () => {
  it("locale-formats large counts (2000 -> '2,000')", () => {
    expect(formatCount(2000)).toBe("2,000")
    expect(formatCount(1234567)).toBe("1,234,567")
  })

  it("coerces invalid / negative values to 0", () => {
    expect(formatCount(-5)).toBe("0")
    expect(formatCount(Number.NaN)).toBe("0")
  })
})

describe("getInitials", () => {
  it("takes first + last initial of a two-part name", () => {
    expect(getInitials("Ellie Thomas")).toBe("ET")
    expect(getInitials("Michelle Hurley")).toBe("MH")
  })

  it("takes the first two letters of a single name", () => {
    expect(getInitials("Taiba")).toBe("TA")
  })

  it("falls back to '?' for unknown", () => {
    expect(getInitials("Unknown customer")).toBe("?")
    expect(getInitials("")).toBe("?")
  })
})

describe("buildListWinningsSummary", () => {
  const base = {
    total_win_count: 0,
    main_draw_win_count: 0,
    instant_win_count: 0,
    cash_win_count: 0,
    site_credit_win_count: 0,
    cash_won_pence: 0,
    site_credit_won_pence: 0,
  }

  it("returns null when there are no wins", () => {
    expect(buildListWinningsSummary(base)).toBeNull()
  })

  it("keeps cash and site credit separate and never sums them", () => {
    const s = buildListWinningsSummary({
      ...base,
      total_win_count: 3,
      cash_won_pence: 10000,
      site_credit_won_pence: 500,
    })
    expect(s?.headline).toBe("3 wins")
    expect(s?.money).toBe("£100 cash · £5 credit")
    // Never a combined "£105" figure.
    expect(s?.money).not.toContain("105")
  })

  it("shows the main-draw count without inventing a monetary value", () => {
    const s = buildListWinningsSummary({
      ...base,
      total_win_count: 1,
      main_draw_win_count: 1,
    })
    expect(s?.headline).toBe("1 win")
    expect(s?.money).toBeNull()
    expect(s?.draws).toBe("+ 1 draw")
  })

  it("locale-formats very large win counts", () => {
    const s = buildListWinningsSummary({ ...base, total_win_count: 2000, site_credit_won_pence: 200000 })
    expect(s?.headline).toBe("2,000 wins")
  })
})

describe("resolveWinStatus (critical status rules)", () => {
  it("cash + is_paid true => Paid", () => {
    expect(resolveWinStatus({ fulfilment_type: "cash", is_paid: true }).label).toBe("Paid")
  })

  it("cash + is_paid false => Awaiting payout", () => {
    const r = resolveWinStatus({ fulfilment_type: "cash", is_paid: false })
    expect(r.label).toBe("Awaiting payout")
    expect(r.tone).toBe("awaiting")
  })

  it("wallet_credit with fulfilled_at set is CREDITED even when is_paid is false", () => {
    const r = resolveWinStatus({ fulfilment_type: "wallet_credit", is_paid: false, fulfilled_at: "2026-08-07T00:00:00Z" })
    expect(r.label).toBe("Credited")
    // NEVER "unpaid" / "awaiting" just because is_paid is false.
    expect(r.tone).not.toBe("awaiting")
  })

  it("wallet_credit with no fulfilled_at => Pending", () => {
    expect(resolveWinStatus({ fulfilment_type: "wallet_credit", is_paid: false, fulfilled_at: null }).label).toBe(
      "Pending",
    )
  })

  it("manual fulfilment respects fulfilled_at", () => {
    expect(resolveWinStatus({ fulfilment_type: "manual", fulfilled_at: "2026-08-07T00:00:00Z" }).label).toBe(
      "Fulfilled",
    )
    expect(resolveWinStatus({ fulfilment_type: "manual", fulfilled_at: null }).label).toBe("Pending")
  })

  it("main_draw is always Draw win and never infers payout", () => {
    const r = resolveWinStatus({ win_kind: "main_draw", fulfilment_type: "cash", is_paid: false })
    expect(r.label).toBe("Draw win")
    expect(r.tone).toBe("draw")
  })
})

describe("formatDayTime", () => {
  it("returns em dash for missing / invalid input", () => {
    expect(formatDayTime(null)).toBe("—")
    expect(formatDayTime("not-a-date")).toBe("—")
  })

  it("formats a valid timestamp as 'D Mon · HH:MM' with a separator", () => {
    const out = formatDayTime("2026-08-08T18:04:00Z")
    expect(out).toContain("·")
    expect(out).toMatch(/\d{2}:\d{2}/)
  })
})

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-08T18:00:00Z").getTime()

  it("returns em dash for missing / invalid input", () => {
    expect(formatRelativeTime(null, now)).toBe("—")
    expect(formatRelativeTime("nope", now)).toBe("—")
  })

  it("reports recent times relative to now", () => {
    expect(formatRelativeTime("2026-08-08T17:59:40Z", now)).toBe("just now")
    expect(formatRelativeTime("2026-08-08T17:55:00Z", now)).toBe("5 mins ago")
    expect(formatRelativeTime("2026-08-08T17:00:00Z", now)).toBe("1 hour ago")
    expect(formatRelativeTime("2026-08-06T18:00:00Z", now)).toBe("2 days ago")
  })

  it("falls back to an absolute day for anything older than ~6 days", () => {
    const out = formatRelativeTime("2026-07-01T18:00:00Z", now)
    expect(out).not.toContain("ago")
    expect(out).toMatch(/Jul/)
  })
})

describe("resolveWinPrizeLabel", () => {
  const base: WinRecord = {
    win_kind: null,
    record_id: null,
    occurred_at: null,
    campaign_id: null,
    campaign_title: null,
    prize_title: null,
    prize_value_pence: null,
    fulfilment_type: null,
    winning_ticket: null,
    is_paid: false,
    paid_at: null,
    fulfilled_at: null,
    payout_amount_pence: null,
    checkout_intent_id: null,
    placed: null,
  }

  it("labels an instant cash win from its numeric value", () => {
    expect(resolveWinPrizeLabel({ ...base, fulfilment_type: "cash", prize_value_pence: 10000 })).toBe("£100 cash")
  })

  it("labels a site-credit win from its numeric value", () => {
    expect(resolveWinPrizeLabel({ ...base, fulfilment_type: "wallet_credit", prize_value_pence: 100 })).toBe(
      "£1 credit",
    )
  })

  it("uses the title text for a main draw and NEVER fabricates a number when value is null", () => {
    const label = resolveWinPrizeLabel({
      ...base,
      win_kind: "main_draw",
      prize_value_pence: null,
      prize_title: "£500 END PRIZE",
    })
    expect(label).toBe("£500 END PRIZE")
  })

  it("falls back to the prize title when no numeric value exists", () => {
    expect(resolveWinPrizeLabel({ ...base, prize_title: "Mystery box", prize_value_pence: null })).toBe("Mystery box")
  })
})
