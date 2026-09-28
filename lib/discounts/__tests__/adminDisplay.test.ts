import { describe, it, expect } from 'vitest'
import {
  type DiscountCode,
  deriveStatus,
  formatDiscount,
  formatScope,
  formatGbpFromPence,
  isoToLocalInput,
  localInputToIso,
} from '@/lib/discounts/adminDisplay'

function makeCode(overrides: Partial<DiscountCode> = {}): DiscountCode {
  return {
    id: 'id-1',
    code: 'SAVE10',
    description: null,
    discountType: 'fixed',
    discountValue: 500,
    scope: 'site_wide',
    campaignId: null,
    campaignTitle: null,
    campaignSlug: null,
    isActive: true,
    startsAt: null,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: null,
    uses: 0,
    netRevenuePence: 0,
    ...overrides,
  }
}

const NOW = Date.parse('2026-06-01T12:00:00.000Z')

describe('deriveStatus (display only — never mutates is_active)', () => {
  it('active when enabled and within window', () => {
    expect(deriveStatus(makeCode(), NOW)).toBe('active')
  })
  it('disabled always wins over schedule', () => {
    const c = makeCode({ isActive: false, startsAt: '2020-01-01T00:00:00Z', expiresAt: '2999-01-01T00:00:00Z' })
    expect(deriveStatus(c, NOW)).toBe('disabled')
  })
  it('scheduled when active but not started yet', () => {
    const c = makeCode({ startsAt: '2026-12-01T00:00:00.000Z' })
    expect(deriveStatus(c, NOW)).toBe('scheduled')
  })
  it('expired when active but past expiry', () => {
    const c = makeCode({ expiresAt: '2026-01-01T00:00:00.000Z' })
    expect(deriveStatus(c, NOW)).toBe('expired')
  })
})

describe('formatDiscount', () => {
  it('formats fixed pence as GBP off', () => {
    expect(formatDiscount({ discountType: 'fixed', discountValue: 500 })).toBe('£5.00 off')
    expect(formatDiscount({ discountType: 'fixed', discountValue: 99 })).toBe('£0.99 off')
  })
  it('formats percentage', () => {
    expect(formatDiscount({ discountType: 'percentage', discountValue: 10 })).toBe('10% off')
  })
})

describe('formatScope', () => {
  it('shows Site-wide for site_wide', () => {
    expect(formatScope({ scope: 'site_wide', campaignTitle: null })).toBe('Site-wide')
  })
  it('shows the campaign title for campaign scope', () => {
    expect(formatScope({ scope: 'campaign', campaignTitle: 'Summer Draw' })).toBe('Summer Draw')
  })
})

describe('formatGbpFromPence (Net Revenue formatting)', () => {
  it('formats the WED50 example exactly', () => {
    expect(formatGbpFromPence(250106)).toBe('£2,501.06')
  })
  it('formats the FIND5K25 example exactly', () => {
    expect(formatGbpFromPence(32902)).toBe('£329.02')
  })
  it('formats zero as £0.00 (codes with no confirmed usage)', () => {
    expect(formatGbpFromPence(0)).toBe('£0.00')
  })
  it('adds thousands separators', () => {
    expect(formatGbpFromPence(123456789)).toBe('£1,234,567.89')
  })
  it('is defensive against non-finite input', () => {
    expect(formatGbpFromPence(Number.NaN)).toBe('£0.00')
  })
})

describe('datetime-local round trip', () => {
  it('produces empty string for null', () => {
    expect(isoToLocalInput(null)).toBe('')
    expect(localInputToIso('')).toBeNull()
  })
  it('round-trips a value back to the same instant', () => {
    const iso = '2026-06-01T12:00:00.000Z'
    const local = isoToLocalInput(iso)
    const back = localInputToIso(local)
    expect(back).not.toBeNull()
    expect(new Date(back as string).getTime()).toBe(Date.parse(iso))
  })
})
