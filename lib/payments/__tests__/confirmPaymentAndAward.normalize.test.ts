import { describe, it, expect, vi } from 'vitest'

// `confirmPaymentAndAward` is a server-only module; stub the guard so the pure
// `normalizeAwardPayload` export can be imported and unit-tested in node.
vi.mock('server-only', () => ({}))

import { normalizeAwardPayload } from '@/lib/payments/confirmPaymentAndAward'
import { awardToRevealPlan } from '@/components/checkout/reveal/dgFootballAdapter'

/**
 * These tests lock the frontend normalisation boundary that previously dropped
 * the canonical fulfilment metadata returned by the live
 * confirm_payment_and_award RPC. They feed RPC-shaped payloads through
 * normalizeAwardPayload (which routes every prize through coercePrize) and then
 * through the REAL DG adapter, proving the canonical fields survive end to end.
 *
 * The RPC returns Postgres jsonb; prize_value_pence is a bigint that Supabase
 * may surface as a number OR a numeric string, so both are covered.
 */

// A single confirmed-win RPC payload with one prize.
function rpcPayload(prize: Record<string, unknown>) {
  return {
    confirmed: true,
    checkout_ref: 'ref_123',
    qty: 3,
    ticket_start: 1201,
    ticket_end: 1203,
    won: true,
    prizes: [prize],
    campaign_slug: 'summer-raffle',
  }
}

describe('coercePrize (via normalizeAwardPayload) — canonical metadata survives', () => {
  it('§10: preserves fulfilment_type and prize_value_pence for a manual prize', () => {
    const payload = normalizeAwardPayload(
      rpcPayload({
        award_id: 'a1',
        title: '£500 TV Bundle',
        value_text: '£500',
        image_url: 'https://cdn/tv.png',
        fulfilment_type: 'manual',
        prize_value_pence: 50000,
      }),
    )
    expect(payload.prizes).toHaveLength(1)
    expect(payload.prizes[0].fulfilment_type).toBe('manual')
    expect(payload.prizes[0].prize_value_pence).toBe(50000)
  })

  it('accepts prize_value_pence as a numeric STRING (bigint json representation)', () => {
    const payload = normalizeAwardPayload(
      rpcPayload({ title: '£100 CASH', fulfilment_type: 'cash', prize_value_pence: '10000' }),
    )
    expect(payload.prizes[0].prize_value_pence).toBe(10000)
  })

  it('rejects an unknown fulfilment_type and a malformed pence value → null', () => {
    const payload = normalizeAwardPayload(
      rpcPayload({ title: 'Weird', fulfilment_type: 'bitcoin', prize_value_pence: 'not-a-number' }),
    )
    expect(payload.prizes[0].fulfilment_type).toBeNull()
    expect(payload.prizes[0].prize_value_pence).toBeNull()
  })

  it('rejects a negative / non-integer pence value → null', () => {
    expect(
      normalizeAwardPayload(rpcPayload({ title: 'x', prize_value_pence: -5 })).prizes[0]
        .prize_value_pence,
    ).toBeNull()
    expect(
      normalizeAwardPayload(rpcPayload({ title: 'y', prize_value_pence: 12.5 })).prizes[0]
        .prize_value_pence,
    ).toBeNull()
  })
})

describe('§11: end-to-end normalisation + DG adapter mapping', () => {
  // Map a single normalised award through the adapter and return the single
  // resulting outcome for concise assertions.
  function outcomeFor(prize: Record<string, unknown>) {
    const award = normalizeAwardPayload(rpcPayload(prize))
    const plan = awardToRevealPlan(award)
    expect(plan.awards).toHaveLength(1)
    return plan.awards[0].outcome
  }

  it('A: cash / 10000 → £100 cash', () => {
    expect(outcomeFor({ title: '£100 CASH', fulfilment_type: 'cash', prize_value_pence: 10000 })).toMatchObject(
      { kind: 'cash', amountPence: 10000 },
    )
  })

  it('B: wallet_credit / 500 → £5 site credit', () => {
    expect(
      outcomeFor({ title: '£5 SITE CREDIT', fulfilment_type: 'wallet_credit', prize_value_pence: 500 }),
    ).toMatchObject({ kind: 'credit', amountPence: 500 })
  })

  it('C: manual `55" TV` → manual', () => {
    const o = outcomeFor({ title: '55" TV', fulfilment_type: 'manual', prize_value_pence: 50000, image_url: 'x' })
    expect(o.kind).toBe('manual')
    expect(o.amountPence).toBe(0)
  })

  it('D: manual "£500 TV Bundle" → manual, NOT cash', () => {
    const o = outcomeFor({ title: '£500 TV Bundle', value_text: '£500', fulfilment_type: 'manual', prize_value_pence: 50000 })
    expect(o.kind).toBe('manual')
    expect(o.amountPence).toBe(0)
  })

  it('E: manual "£1,000 Holiday Voucher" → manual, NOT cash', () => {
    const o = outcomeFor({ title: '£1,000 Holiday Voucher', fulfilment_type: 'manual' })
    expect(o.kind).toBe('manual')
  })

  it('F: legacy payload without canonical fields → title/value fallback still works', () => {
    const o = outcomeFor({ title: '£100 CASH', value_text: '£100 CASH' })
    expect(o).toMatchObject({ kind: 'cash', amountPence: 10000 })
  })
})

describe('§14: 7-win canonical data carries through with no prize dropped', () => {
  it('maps all seven prizes with authoritative classification', () => {
    const prizes = [
      { title: '£5,000 CASH', fulfilment_type: 'cash', prize_value_pence: 500000 },
      { title: '£500 TV Bundle', value_text: '£500', fulfilment_type: 'manual', prize_value_pence: 50000 },
      { title: '£250 CASH', fulfilment_type: 'cash', prize_value_pence: 25000 },
      { title: '£100 SITE CREDIT', fulfilment_type: 'wallet_credit', prize_value_pence: 10000 },
      { title: '55" TV', fulfilment_type: 'manual', prize_value_pence: 50000, image_url: 'x' },
      { title: '£25 CASH', fulfilment_type: 'cash', prize_value_pence: 2500 },
      { title: '£10 SITE CREDIT', fulfilment_type: 'wallet_credit', prize_value_pence: 1000 },
    ]
    const award = normalizeAwardPayload({
      confirmed: true,
      checkout_ref: 'ref_7',
      qty: 125,
      ticket_start: 1,
      ticket_end: 125,
      won: true,
      prizes,
    })

    // All seven survive normalisation with canonical metadata intact.
    expect(award.prizes).toHaveLength(7)
    expect(award.prizes.every((p) => p.fulfilment_type !== null)).toBe(true)

    // All seven reach the adapter → seven animations, none dropped.
    const plan = awardToRevealPlan(award)
    expect(plan.awards).toHaveLength(7)

    const kinds = plan.awards.map((a) => a.outcome.kind)
    expect(kinds.filter((k) => k === 'cash')).toHaveLength(3)
    expect(kinds.filter((k) => k === 'credit')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'manual')).toHaveLength(2)

    // The two money-titled manual prizes must NOT be counted as cash.
    const cashTotal = plan.awards
      .filter((a) => a.outcome.kind === 'cash')
      .reduce((sum, a) => sum + a.outcome.amountPence, 0)
    expect(cashTotal).toBe(500000 + 25000 + 2500)
  })
})
