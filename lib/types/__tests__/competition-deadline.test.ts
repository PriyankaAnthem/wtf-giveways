import { describe, it, expect } from 'vitest'
import {
  londonParts,
  londonTodayKey,
  deadlineUrgency,
  deadlinePillLabel,
  formatDeadlineClock,
  weekStartKey,
  weekDayKeys,
  addDaysKey,
  dayDiff,
  weekdayShort,
  formatPounds,
  compareDeadlines,
  deriveDeadlineMetrics,
  type CompetitionDeadline,
} from '../competition-deadline'

/** Minimal deadline factory for label/urgency assertions. */
function makeDeadline(overrides: Partial<CompetitionDeadline> = {}): CompetitionDeadline {
  return {
    source: 'campaign',
    campaignId: 'c1',
    slug: 'demo',
    title: 'Demo competition',
    classification: 'other',
    endDate: '2026-09-15',
    endTime: '20:00',
    endAt: '2026-09-15T19:00:00Z',
    ticketPricePence: null,
    maxTickets: null,
    ticketsSold: null,
    ticketsRemaining: null,
    percentSold: null,
    potentialRemainingPence: null,
    adminUrl: '/admin/campaigns/c1',
    ...overrides,
  }
}

describe('londonParts - BST/GMT conversion via Europe/London (no fixed offsets)', () => {
  it('keeps a late BST evening close on the same UK calendar day', () => {
    // 22:30Z in summer is 23:30 BST on the SAME UK day.
    expect(londonParts('2026-09-15T22:30:00Z')).toEqual({ date: '2026-09-15', time: '23:30' })
  })

  it('rolls a BST close after 23:00 UK into the next UK day', () => {
    // 23:30Z in summer is 00:30 BST the NEXT UK day.
    expect(londonParts('2026-09-15T23:30:00Z')).toEqual({ date: '2026-09-16', time: '00:30' })
  })

  it('applies no offset in GMT winter', () => {
    expect(londonParts('2026-01-15T23:59:00Z')).toEqual({ date: '2026-01-15', time: '23:59' })
  })

  it('represents midnight as 00:00, never 24:00', () => {
    expect(londonParts('2026-01-15T00:00:00Z')).toEqual({ date: '2026-01-15', time: '00:00' })
  })

  it('handles the spring-forward transition instant', () => {
    // BST begins 2026-03-29 01:00 UTC (clocks jump 01:00->02:00 local).
    expect(londonParts('2026-03-29T00:30:00Z')).toEqual({ date: '2026-03-29', time: '00:30' })
    expect(londonParts('2026-03-29T01:30:00Z')).toEqual({ date: '2026-03-29', time: '02:30' })
  })

  it('returns null for empty/invalid input', () => {
    expect(londonParts(null)).toBeNull()
    expect(londonParts('')).toBeNull()
    expect(londonParts('not-a-date')).toBeNull()
  })
})

describe('londonTodayKey', () => {
  it('derives the London date for a given instant', () => {
    // 23:30Z on 15 Sep (BST) is already 16 Sep locally.
    expect(londonTodayKey(new Date('2026-09-15T23:30:00Z'))).toBe('2026-09-16')
    // Winter: no shift.
    expect(londonTodayKey(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15')
  })
})

describe('deadlineUrgency - relative to a London today key', () => {
  it('flags same-day (or past) as today', () => {
    expect(deadlineUrgency('2026-09-15', '2026-09-15')).toBe('today')
    expect(deadlineUrgency('2026-09-14', '2026-09-15')).toBe('today')
  })

  it('flags the next day as tomorrow', () => {
    expect(deadlineUrgency('2026-09-16', '2026-09-15')).toBe('tomorrow')
  })

  it('flags 2-3 days out as soon, and beyond as later', () => {
    expect(deadlineUrgency('2026-09-17', '2026-09-15')).toBe('soon')
    expect(deadlineUrgency('2026-09-18', '2026-09-15')).toBe('soon')
    expect(deadlineUrgency('2026-09-19', '2026-09-15')).toBe('later')
  })

  it('crosses month boundaries correctly', () => {
    expect(deadlineUrgency('2026-10-01', '2026-09-30')).toBe('tomorrow')
  })
})

describe('deadlinePillLabel', () => {
  it('shows ENDS TODAY / ENDS TOMORROW then weekday + clock', () => {
    expect(deadlinePillLabel(makeDeadline({ endDate: '2026-09-15' }), '2026-09-15')).toBe(
      'ENDS TODAY',
    )
    expect(deadlinePillLabel(makeDeadline({ endDate: '2026-09-16' }), '2026-09-15')).toBe(
      'ENDS TOMORROW',
    )
    // 2026-09-17 is a Thursday; 20:00 -> 8:00 PM.
    expect(
      deadlinePillLabel(makeDeadline({ endDate: '2026-09-17', endTime: '20:00' }), '2026-09-15'),
    ).toBe('THU 8:00 PM')
  })
})

describe('formatDeadlineClock - 12h', () => {
  it('formats midnight, noon and evening', () => {
    expect(formatDeadlineClock('00:00')).toBe('12:00 AM')
    expect(formatDeadlineClock('12:00')).toBe('12:00 PM')
    expect(formatDeadlineClock('23:30')).toBe('11:30 PM')
    expect(formatDeadlineClock('09:05')).toBe('9:05 AM')
  })
})

describe('week helpers - Monday-first', () => {
  it('weekStartKey resolves the Monday of the containing week', () => {
    // 2026-09-15 is a Tuesday -> Monday is 2026-09-14.
    expect(weekStartKey('2026-09-15')).toBe('2026-09-14')
    // A Monday maps to itself.
    expect(weekStartKey('2026-09-14')).toBe('2026-09-14')
    // A Sunday maps back to the previous Monday.
    expect(weekStartKey('2026-09-20')).toBe('2026-09-14')
  })

  it('weekDayKeys returns 7 consecutive days from the Monday', () => {
    expect(weekDayKeys('2026-09-14')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ])
  })

  it('addDaysKey and dayDiff handle month/year rollover', () => {
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(dayDiff('2026-09-15', '2026-09-20')).toBe(5)
    expect(dayDiff('2026-09-20', '2026-09-15')).toBe(-5)
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('weekdayShort labels correctly (Mon-first)', () => {
    expect(weekdayShort('2026-09-14')).toBe('MON')
    expect(weekdayShort('2026-09-17')).toBe('THU')
    expect(weekdayShort('2026-09-20')).toBe('SUN')
  })
})

describe('formatPounds', () => {
  it('omits fraction for whole pounds and thousands-separates', () => {
    expect(formatPounds(425000)).toBe('£4,250')
    expect(formatPounds(1250)).toBe('£12.50')
    expect(formatPounds(0)).toBe('£0')
  })
})

describe('compareDeadlines - soonest first', () => {
  it('orders by date, then time, then title', () => {
    const later = makeDeadline({ campaignId: 'a', endDate: '2026-09-17', endTime: '20:00' })
    const earlyDay = makeDeadline({ campaignId: 'b', endDate: '2026-09-15', endTime: '21:00' })
    const sameDayEarlier = makeDeadline({ campaignId: 'c', endDate: '2026-09-15', endTime: '09:00' })
    const sorted = [later, earlyDay, sameDayEarlier].slice().sort(compareDeadlines)
    expect(sorted.map((d) => d.campaignId)).toEqual(['c', 'b', 'a'])
  })
})

describe('deriveDeadlineMetrics - snapshot fallback & potential remaining', () => {
  it('omits everything (no misleading zeros) when sold count is absent', () => {
    expect(
      deriveDeadlineMetrics({ ticketsSold: null, maxTickets: 1000, ticketPricePence: 500 }),
    ).toEqual({
      ticketsSold: null,
      ticketsRemaining: null,
      percentSold: null,
      potentialRemainingPence: null,
    })
  })

  it('shows only sold when the campaign is uncapped', () => {
    expect(
      deriveDeadlineMetrics({ ticketsSold: 250, maxTickets: null, ticketPricePence: 500 }),
    ).toEqual({
      ticketsSold: 250,
      ticketsRemaining: null,
      percentSold: null,
      potentialRemainingPence: null,
    })
  })

  it('treats a non-positive cap as uncapped', () => {
    expect(
      deriveDeadlineMetrics({ ticketsSold: 10, maxTickets: 0, ticketPricePence: 500 }),
    ).toEqual({
      ticketsSold: 10,
      ticketsRemaining: null,
      percentSold: null,
      potentialRemainingPence: null,
    })
  })

  it('computes remaining and percent but omits potential when price is missing', () => {
    expect(
      deriveDeadlineMetrics({ ticketsSold: 400, maxTickets: 1000, ticketPricePence: null }),
    ).toEqual({
      ticketsSold: 400,
      ticketsRemaining: 600,
      percentSold: 40,
      potentialRemainingPence: null,
    })
  })

  it('computes potential remaining = remaining * price (face value)', () => {
    // 1000 cap, 150 sold, £5.00 price -> 850 remaining -> £4,250.
    expect(
      deriveDeadlineMetrics({ ticketsSold: 150, maxTickets: 1000, ticketPricePence: 500 }),
    ).toEqual({
      ticketsSold: 150,
      ticketsRemaining: 850,
      percentSold: 15,
      potentialRemainingPence: 425000,
    })
  })

  it('clamps remaining at 0 and percent at 100 when oversold', () => {
    expect(
      deriveDeadlineMetrics({ ticketsSold: 1200, maxTickets: 1000, ticketPricePence: 500 }),
    ).toEqual({
      ticketsSold: 1200,
      ticketsRemaining: 0,
      percentSold: 100,
      potentialRemainingPence: 0,
    })
  })
})
