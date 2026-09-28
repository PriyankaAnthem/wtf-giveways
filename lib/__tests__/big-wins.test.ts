import { describe, it, expect } from "vitest"
import { clampPercent, mapBigWinRow, validateBigWinInput } from "@/lib/big-wins"

/**
 * Regression coverage for the Big Wins admin module's validation + mapping.
 * These lock the server-side contract used by /api/admin/big-wins so the
 * curated carousel never receives malformed or unsafe rows.
 */

const valid = {
  winnerName: "  Jodie  ",
  prizeText: "£10,000 Cash",
  competition: "December Mega Draw",
  wonOn: "2026-08-01",
  ticketNumber: "1423",
  imageUrl: "https://example.supabase.co/storage/v1/object/public/big-wins/a.jpg",
  imagePosX: 50,
  imagePosY: 30,
  isActive: true,
}

describe("validateBigWinInput", () => {
  it("accepts a well-formed payload and trims text", () => {
    const r = validateBigWinInput(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.winner_name).toBe("Jodie")
      expect(r.value.ticket_number).toBe(1423)
      expect(r.value.image_pos_y).toBe(30)
      expect(r.value.is_active).toBe(true)
    }
  })

  it("requires a winner name", () => {
    const r = validateBigWinInput({ ...valid, winnerName: "   " })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe("winner_name_required")
      expect(r.errors[0]).toMatch(/winner name/i)
    }
  })

  it("rejects a non-http(s) image URL (no data:/blob:)", () => {
    const r = validateBigWinInput({ ...valid, imageUrl: "data:image/png;base64,AAAA" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("image_url_invalid")
  })

  it("treats an empty ticket number as null (optional)", () => {
    const r = validateBigWinInput({ ...valid, ticketNumber: "" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.ticket_number).toBeNull()
  })

  it("rejects a non-positive or non-integer ticket number", () => {
    expect(validateBigWinInput({ ...valid, ticketNumber: "0" }).ok).toBe(false)
    expect(validateBigWinInput({ ...valid, ticketNumber: "-4" }).ok).toBe(false)
    expect(validateBigWinInput({ ...valid, ticketNumber: "12.5" }).ok).toBe(false)
  })

  it("rejects an invalid won-on date", () => {
    const r = validateBigWinInput({ ...valid, wonOn: "not-a-date" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("won_on_invalid")
  })

  it("defaults is_active to true when absent", () => {
    const { isActive, ...rest } = valid
    void isActive
    const r = validateBigWinInput(rest)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.is_active).toBe(true)
  })
})

describe("clampPercent", () => {
  it("clamps to [0,100] and rounds, defaulting non-numbers to 50", () => {
    expect(clampPercent(-10)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(42.6)).toBe(43)
    expect(clampPercent("nope")).toBe(50)
  })
})

describe("mapBigWinRow", () => {
  it("maps snake_case DB columns to the camelCase DTO", () => {
    const dto = mapBigWinRow({
      id: "id-1",
      winner_name: "Jodie",
      prize_text: "£10,000 Cash",
      image_url: "https://x/y.jpg",
      image_pos_x: 50,
      image_pos_y: 25,
      competition: "December Mega Draw",
      won_on: "2026-08-01",
      ticket_number: 1423,
      display_order: 2,
      is_active: true,
    })
    expect(dto).toMatchObject({
      id: "id-1",
      winnerName: "Jodie",
      prizeText: "£10,000 Cash",
      imagePosX: 50,
      imagePosY: 25,
      ticketNumber: 1423,
      isActive: true,
    })
  })
})
