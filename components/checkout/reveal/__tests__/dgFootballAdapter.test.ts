import { describe, expect, it } from 'vitest'
import {
  awardToRevealPlan,
  classifyPrize,
  ticketRangeText,
  type DgFootballAward,
  type DgFootballPrize,
} from '../dgFootballAdapter'
import { summarisePlan } from '@/components/reveal/dg-football/config'

// The adapter is the ONLY bridge from the already-decided AwardPayload to the
// DG Football presentation model. These tests pin the safety contract:
//   * prizes[] is the source of truth (award count == prizes.length, no cap)
//   * qty (not the 5 balls / 5 holes) drives the ticket count
//   * cash / credit / manual classification never fabricates a value
//   * the itemised summary always reconciles to prizes.length

const cash = (value: string, title = 'Cash Prize'): DgFootballPrize => ({
  title,
  value_text: value,
})
const credit = (value: string): DgFootballPrize => ({ title: 'Site Credit', value_text: value })
const manual = (title: string, image?: string): DgFootballPrize => ({
  title,
  value_text: null,
  image_url: image ?? null,
})

function baseAward(overrides: Partial<DgFootballAward>): DgFootballAward {
  return {
    qty: 1,
    won: true,
    prize: null,
    prizes: [],
    ticket_start: null,
    ticket_end: null,
    ...overrides,
  }
}

describe('classifyPrize — presentation category (never fabricates value)', () => {
  it('classifies explicit £ money as cash in pence', () => {
    expect(classifyPrize(cash('£100'))).toMatchObject({ kind: 'cash', amountPence: 10000 })
    expect(classifyPrize(cash('£5,000'))).toMatchObject({ kind: 'cash', amountPence: 500000 })
    expect(classifyPrize(cash('£12.50'))).toMatchObject({ kind: 'cash', amountPence: 1250 })
  })

  it('classifies "credit" keyword with a value as site credit', () => {
    expect(classifyPrize(credit('£10 Site Credit'))).toMatchObject({ kind: 'credit', amountPence: 1000 })
  })

  it('treats a physical prize as manual with NO money value', () => {
    const out = classifyPrize(manual('PlayStation 5', 'https://cdn/ps5.png'))
    expect(out.kind).toBe('manual')
    expect(out.amountPence).toBe(0)
    expect(out.title).toBe('PlayStation 5')
    expect(out.imageUrl).toBe('https://cdn/ps5.png')
  })

  it('does NOT misread a titled physical prize as a tiny cash win', () => {
    // "PlayStation 5" contains a 5 but no "£", so it must NOT become £5 cash.
    const out = classifyPrize(manual('PlayStation 5'))
    expect(out.kind).toBe('manual')
    expect(out.amountPence).toBe(0)
  })

  it('treats "credit" with no parseable amount as a manual/named award', () => {
    expect(classifyPrize({ title: 'Store Credit Voucher', value_text: 'credit' }).kind).toBe('manual')
  })

  // Spec §3 — the required, named classification cases.
  it('§3: "£100 CASH" → cash', () => {
    expect(classifyPrize({ title: 'CASH', value_text: '£100 CASH' })).toMatchObject({
      kind: 'cash',
      amountPence: 10000,
    })
  })

  it('§3: "£5 SITE CREDIT" → credit', () => {
    expect(classifyPrize({ title: 'SITE CREDIT', value_text: '£5 SITE CREDIT' })).toMatchObject({
      kind: 'credit',
      amountPence: 500,
    })
  })

  it('§3: `55" TV` → manual', () => {
    expect(classifyPrize({ title: '55" TV', value_text: null }).kind).toBe('manual')
  })

  it('§3: manual prize with image_url retains title + image', () => {
    const out = classifyPrize({ title: 'Nintendo Switch', value_text: null, image_url: 'https://cdn/switch.png' })
    expect(out.kind).toBe('manual')
    expect(out.title).toBe('Nintendo Switch')
    expect(out.imageUrl).toBe('https://cdn/switch.png')
    expect(out.amountPence).toBe(0)
  })
})

/**
 * Spec §2/§3 — CANONICAL fulfilment_type is authoritative and overrides the
 * money text. A physical prize whose name/value contains "£" MUST NOT be shown
 * as cash when production explicitly marks it manual.
 */
describe('classifyPrize — canonical fulfilment_type overrides title parsing', () => {
  it('§3: "£500 TV Bundle" marked manual → manual (NOT cash)', () => {
    const out = classifyPrize({
      title: '£500 TV Bundle',
      value_text: '£500',
      image_url: 'https://cdn/tv.png',
      fulfilment_type: 'manual',
    })
    expect(out.kind).toBe('manual')
    expect(out.amountPence).toBe(0)
    expect(out.title).toBe('£500 TV Bundle')
    expect(out.imageUrl).toBe('https://cdn/tv.png')
  })

  it('§3: "£1,000 Holiday Voucher" marked manual → manual (NOT cash)', () => {
    const out = classifyPrize({
      title: '£1,000 Holiday Voucher',
      value_text: '£1,000',
      fulfilment_type: 'manual',
    })
    expect(out.kind).toBe('manual')
    expect(out.amountPence).toBe(0)
  })

  it('uses authoritative prize_value_pence for cash, never the title amount', () => {
    // Title says "£5" but the canonical pence value is £100 → trust the pence.
    const out = classifyPrize({
      title: 'Cash £5',
      value_text: '£5',
      fulfilment_type: 'cash',
      prize_value_pence: 10000,
    })
    expect(out).toMatchObject({ kind: 'cash', amountPence: 10000 })
  })

  it('maps wallet_credit → credit using the authoritative pence value', () => {
    const out = classifyPrize({
      title: 'Site Credit',
      value_text: '£10',
      fulfilment_type: 'wallet_credit',
      prize_value_pence: 1000,
    })
    expect(out).toMatchObject({ kind: 'credit', amountPence: 1000 })
  })

  it('cash/credit declared with no positive amount anywhere → manual (never £0)', () => {
    const out = classifyPrize({ title: 'Mystery', value_text: null, fulfilment_type: 'cash' })
    expect(out.kind).toBe('manual')
    expect(out.amountPence).toBe(0)
  })

  it('DOCUMENTS the fallback risk: money-titled manual WITHOUT canonical type → cash', () => {
    // With no fulfilment_type present (today's AwardPayload) the adapter cannot
    // distinguish this from a cash prize by text alone. This test pins the
    // known limitation so a future backend change (exposing fulfilment_type)
    // that fixes it will visibly flip this expectation.
    const out = classifyPrize({ title: '£500 TV Bundle', value_text: '£500' })
    expect(out.kind).toBe('cash')
  })
})

describe('awardToRevealPlan — prizes[] is the source of truth', () => {
  it('animates EXACTLY prizes.length awards with no cap (7 wins)', () => {
    const prizes = [
      cash('£100'),
      cash('£250'),
      cash('£5,000'),
      cash('£50'),
      cash('£25'),
      credit('£10 credit'),
      credit('£5 credit'),
    ]
    const plan = awardToRevealPlan(baseAward({ qty: 125, prizes }))
    expect(plan.awards).toHaveLength(7)
    expect(plan.ticketCount).toBe(125)
  })

  it('never lets two consecutive awards share a hole', () => {
    const prizes = Array.from({ length: 7 }, () => cash('£25'))
    const plan = awardToRevealPlan(baseAward({ qty: 7, prizes }))
    for (let i = 1; i < plan.awards.length; i++) {
      expect(plan.awards[i].destinationHole).not.toBe(plan.awards[i - 1].destinationHole)
    }
  })

  it('derives ticketCount from qty, NOT from the number of prizes or holes', () => {
    const plan = awardToRevealPlan(baseAward({ qty: 40, prizes: [cash('£100'), cash('£50')] }))
    expect(plan.ticketCount).toBe(40)
    expect(plan.awards).toHaveLength(2)
  })

  it('produces a zero-win plan when there are no prizes', () => {
    const plan = awardToRevealPlan(baseAward({ qty: 10, won: false, prize: null, prizes: [] }))
    expect(plan.awards).toHaveLength(0)
    expect(plan.ticketCount).toBe(10)
  })

  it('falls back to the singular legacy prize when prizes[] is absent', () => {
    const plan = awardToRevealPlan(baseAward({ qty: 3, prize: cash('£100'), prizes: undefined }))
    expect(plan.awards).toHaveLength(1)
    expect(plan.awards[0].outcome).toMatchObject({ kind: 'cash', amountPence: 10000 })
  })

  it('drops malformed prizes with no usable title (never renders blank)', () => {
    const prizes = [cash('£100'), { title: '   ', value_text: '£5' } as DgFootballPrize]
    const plan = awardToRevealPlan(baseAward({ qty: 2, prizes }))
    expect(plan.awards).toHaveLength(1)
  })

  it('coerces a non-positive / non-finite qty to a safe 1', () => {
    expect(awardToRevealPlan(baseAward({ qty: 0, prizes: [cash('£100')] })).ticketCount).toBe(1)
    expect(awardToRevealPlan(baseAward({ qty: Number.NaN, prizes: [cash('£100')] })).ticketCount).toBe(1)
  })
})

describe('summary reconciliation — itemised totals always equal prizes.length', () => {
  it('reconciles a mixed 7-win purchase exactly', () => {
    const prizes = [
      cash('£100'),
      cash('£250'),
      cash('£5,000'),
      cash('£50'),
      cash('£25'),
      credit('£10 credit'),
      credit('£5 credit'),
    ]
    const plan = awardToRevealPlan(baseAward({ qty: 125, prizes }))
    const summary = summarisePlan(plan)

    // Every award is represented; item counts sum to prizes.length.
    const counted = summary.items.reduce((n, it) => n + it.count, 0)
    expect(counted).toBe(prizes.length)
    expect(summary.instantWins).toBe(7)

    // Totals: cash 100+250+5000+50+25 = 5425; credit 10+5 = 15.
    expect(summary.cashPence).toBe(542500)
    expect(summary.creditPence).toBe(1500)
  })

  it('collapses identical awards into an N× line while preserving the count', () => {
    const prizes = [cash('£25'), cash('£25'), cash('£25')]
    const summary = summarisePlan(awardToRevealPlan(baseAward({ qty: 3, prizes })))
    const cashLine = summary.items.find((i) => i.kind === 'cash')
    expect(cashLine?.count).toBe(3)
    expect(summary.cashPence).toBe(7500)
  })

  it('keeps distinct physical prizes as separate lines with no money total', () => {
    const prizes = [manual('PlayStation 5'), manual('Xbox Series X'), manual('PlayStation 5')]
    const summary = summarisePlan(awardToRevealPlan(baseAward({ qty: 3, prizes })))
    const manualItems = summary.items.filter((i) => i.kind === 'manual')
    // PS5 (×2) collapses, Xbox stays separate → 2 lines, 3 awards total.
    expect(manualItems).toHaveLength(2)
    expect(manualItems.reduce((n, i) => n + i.count, 0)).toBe(3)
    expect(summary.cashPence).toBe(0)
    expect(summary.creditPence).toBe(0)
  })
})

describe('ticketRangeText — header parity label', () => {
  it('formats a multi-ticket range with an en-dash and thousands separators', () => {
    expect(ticketRangeText(1201, 1325)).toBe('TICKETS #1,201\u2013#1,325')
  })
  it('formats a single ticket', () => {
    expect(ticketRangeText(42, 42)).toBe('TICKET #42')
  })
  it('returns undefined for missing or nonsensical ranges', () => {
    expect(ticketRangeText(null, null)).toBeUndefined()
    expect(ticketRangeText(10, 5)).toBeUndefined()
    expect(ticketRangeText(undefined, 5)).toBeUndefined()
  })
})
