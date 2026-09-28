import { describe, it, expect } from 'vitest'
import { formatMarketingPence, formatMarketingCount } from '../money'

describe('Stage 043 — formatMarketingPence (compact GBP house style)', () => {
  it('renders sub-pound amounts as "Np"', () => {
    expect(formatMarketingPence(0)).toBe('0p')
    expect(formatMarketingPence(1)).toBe('1p')
    expect(formatMarketingPence(29)).toBe('29p')
    expect(formatMarketingPence(50)).toBe('50p')
    expect(formatMarketingPence(99)).toBe('99p')
  })

  it('drops ".00" on whole pounds and groups thousands', () => {
    expect(formatMarketingPence(100)).toBe('£1')
    expect(formatMarketingPence(2500)).toBe('£25')
    expect(formatMarketingPence(150000)).toBe('£1,500')
    expect(formatMarketingPence(148000)).toBe('£1,480')
  })

  it('renders a pence remainder as "£P.pp"', () => {
    expect(formatMarketingPence(129)).toBe('£1.29')
    expect(formatMarketingPence(1850)).toBe('£18.50')
    expect(formatMarketingPence(100005)).toBe('£1,000.05')
  })

  it('is defensive: never throws and never emits NaN/undefined', () => {
    expect(formatMarketingPence(null)).toBe('0p')
    expect(formatMarketingPence(undefined)).toBe('0p')
    expect(formatMarketingPence(-500)).toBe('0p')
    expect(formatMarketingPence(Number.NaN)).toBe('0p')
    expect(formatMarketingPence(12.9)).toBe('12p') // truncates, no float maths
  })
})

describe('Stage 043 — formatMarketingCount', () => {
  it('groups thousands and floors untrusted input', () => {
    expect(formatMarketingCount(0)).toBe('0')
    expect(formatMarketingCount(116)).toBe('116')
    expect(formatMarketingCount(31596)).toBe('31,596')
    expect(formatMarketingCount(null)).toBe('0')
    expect(formatMarketingCount(-4)).toBe('0')
  })
})
