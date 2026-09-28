import { describe, it, expect } from 'vitest'
import {
  isEligibleForBulkMarkReplied,
  bulkMarkRepliedCutoffIso,
  BULK_MARK_REPLIED_MIN_AGE_MS,
} from '@/lib/admin/inbox/types'

// Fixed "now" so the age maths are deterministic.
const NOW = Date.parse('2026-08-28T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function ageIso(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

describe('isEligibleForBulkMarkReplied (single source of truth for the cleanup)', () => {
  it('open + 3 days old -> eligible (becomes Waiting)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'open', created_at: ageIso(3 * DAY), enquiry_type: 'general' },
        NOW,
      ),
    ).toBe(true)
  })

  it('open + 47 hours old -> NOT eligible (younger than 48h)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'open', created_at: ageIso(47 * HOUR), enquiry_type: 'general' },
        NOW,
      ),
    ).toBe(false)
  })

  it('waiting + 5 days old -> NOT eligible (only open is touched)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'waiting', created_at: ageIso(5 * DAY), enquiry_type: 'general' },
        NOW,
      ),
    ).toBe(false)
  })

  it('resolved + 5 days old -> NOT eligible (only open is touched)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'resolved', created_at: ageIso(5 * DAY), enquiry_type: 'general' },
        NOW,
      ),
    ).toBe(false)
  })

  it('winner_payout + 5 days old -> NOT eligible (payouts never touched)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'open', created_at: ageIso(5 * DAY), enquiry_type: 'winner_payout' },
        NOW,
      ),
    ).toBe(false)
  })

  it('null / legacy enquiry_type + 5 days old -> eligible (support row, included)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'open', created_at: ageIso(5 * DAY), enquiry_type: null },
        NOW,
      ),
    ).toBe(true)
  })

  it('boundary: exactly 48h old is NOT eligible (strictly older than required)', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'open', created_at: ageIso(BULK_MARK_REPLIED_MIN_AGE_MS), enquiry_type: 'other' },
        NOW,
      ),
    ).toBe(false)
  })

  it('boundary: a millisecond past 48h IS eligible', () => {
    expect(
      isEligibleForBulkMarkReplied(
        { inbox_status: 'open', created_at: ageIso(BULK_MARK_REPLIED_MIN_AGE_MS + 1), enquiry_type: 'other' },
        NOW,
      ),
    ).toBe(true)
  })

  it('missing or unparseable created_at -> NOT eligible', () => {
    expect(
      isEligibleForBulkMarkReplied({ inbox_status: 'open', created_at: null, enquiry_type: 'general' }, NOW),
    ).toBe(false)
    expect(
      isEligibleForBulkMarkReplied({ inbox_status: 'open', created_at: 'not-a-date', enquiry_type: 'general' }, NOW),
    ).toBe(false)
  })
})

describe('bulkMarkRepliedCutoffIso', () => {
  it('is exactly now minus 48 hours as an ISO string', () => {
    expect(bulkMarkRepliedCutoffIso(NOW)).toBe(new Date(NOW - 2 * DAY).toISOString())
  })
})
