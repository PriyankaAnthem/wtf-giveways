import { describe, expect, it } from "vitest"
import { heroUrgency } from "@/lib/countdown"

// Fixed UTC instants keep these deterministic. London is BST (UTC+1) in summer
// and GMT (UTC+0) in winter, which is exactly what we want to exercise.
const utc = (iso: string) => new Date(iso).getTime()

describe("heroUrgency", () => {
  it("shows a static multi-day label when more than 48h remain", () => {
    const now = utc("2025-06-01T12:00:00Z")
    const end = utc("2025-06-05T12:00:00Z")
    const u = heroUrgency(end, now)
    expect(u.tier).toBe("days")
    expect(u.label).toBe("Ends in 4 days")
    // Not a permanent 1s interval — recomputes at most once a day.
    expect(u.refreshMs).not.toBeNull()
    expect(u.refreshMs!).toBeGreaterThan(60_000)
  })

  it("uses 'tomorrow' wording with a London time-of-day (BST)", () => {
    const now = utc("2025-06-01T12:00:00Z") // London 13:00 BST
    const end = utc("2025-06-02T20:00:00Z") // London 21:00 BST, next day
    const u = heroUrgency(end, now)
    expect(u.tier).toBe("tomorrow")
    expect(u.label).toBe("Ends tomorrow · 9:00pm")
  })

  it("uses 'today' wording with a London time-of-day (BST)", () => {
    const now = utc("2025-06-01T08:00:00Z") // London 09:00 BST
    const end = utc("2025-06-01T22:59:00Z") // London 23:59 BST, same day
    const u = heroUrgency(end, now)
    expect(u.tier).toBe("today")
    expect(u.label).toBe("Ends today · 11:59pm")
  })

  it("uses 'today' wording in winter (GMT)", () => {
    const now = utc("2025-01-01T08:00:00Z") // London 08:00 GMT
    const end = utc("2025-01-01T21:00:00Z") // London 21:00 GMT, same day
    const u = heroUrgency(end, now)
    expect(u.tier).toBe("today")
    expect(u.label).toBe("Ends today · 9:00pm")
  })

  it("ticks in whole minutes under an hour and never reads zero", () => {
    const now = utc("2025-06-01T12:00:00Z")
    expect(heroUrgency(now + 42 * 60_000, now).label).toBe("Ends in 42 minutes")
    expect(heroUrgency(now + 90_000, now).label).toBe("Ends in 2 minutes")
    // A sliver of time left is still "1 minute", never "0 minutes".
    expect(heroUrgency(now + 500, now).label).toBe("Ends in 1 minute")
    const soon = heroUrgency(now + 42 * 60_000, now)
    expect(soon.tier).toBe("soon")
    expect(soon.refreshMs!).toBeLessThanOrEqual(60_000)
  })

  it("treats the passed (or exactly reached) deadline as ended, not all-zero", () => {
    const now = utc("2025-06-01T12:00:00Z")
    expect(heroUrgency(now - 1000, now)).toMatchObject({ tier: "ended", ended: true, refreshMs: null })
    expect(heroUrgency(now, now)).toMatchObject({ tier: "ended", ended: true })
    expect(heroUrgency(Number.NaN, now).ended).toBe(true)
  })

  it("rolls the day tier over at London midnight (not UTC midnight)", () => {
    const end = utc("2025-06-12T10:00:00Z") // London Jun 12, 11:00am
    const beforeMidnight = utc("2025-06-10T22:30:00Z") // London Jun 10, 23:30
    const afterMidnight = utc("2025-06-10T23:30:00Z") // London Jun 11, 00:30
    expect(heroUrgency(end, beforeMidnight).label).toBe("Ends in 2 days")
    expect(heroUrgency(end, afterMidnight).label).toBe("Ends tomorrow · 11:00am")
  })

  it("an open tab crossing the deadline lands on 'ended', never all-zero", () => {
    const end = utc("2025-06-01T12:00:00Z")
    // One tick before and one tick after the exact deadline.
    expect(heroUrgency(end, end - 1).ended).toBe(false)
    expect(heroUrgency(end, end + 1).ended).toBe(true)
    expect(heroUrgency(end, end + 1).label).toBe("Ended")
  })
})
