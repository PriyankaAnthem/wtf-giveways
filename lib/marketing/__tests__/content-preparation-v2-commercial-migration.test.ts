import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static, offline verification of migration 025 (Stage 043B commercial content
// preparation, V2). NO SQL is executed and NO database connection is opened;
// this parses the migration text and asserts the corrected contract that the
// production review required:
//   * ONE executor keeping the existing public name/signature (no _v2 executor).
//   * The Stage 022 readiness gate is made VERSION-AWARE (V1 inline OR V2 via the
//     new validator) inside the preview function — the queue executor is NOT
//     redefined.
//   * Ticket counts come ONLY from giveaway_ticket_counters (no
//     campaign_ticket_counters, no fallback).
//   * Instant wins come from instant_win_slots joined to instant_win_prizes
//     (no instant_win_awards), all-or-nothing value aggregates.
//   * £0 WTF credit is excluded at SELECTION and re-checked before write.
//   * No operational table is written; only the two snapshot columns are.
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = join(process.cwd(), 'scripts', 'marketing')
const MIG_025 = '025-marketing-content-preparation-v2-commercial.sql'
const RAW = readFileSync(join(SCRIPTS_DIR, MIG_025), 'utf8')

// Code-only view: strip "--" line comments so header prose can never trigger a
// forbidden-token false positive. Only executable SQL remains.
const CODE = RAW.replace(/--[^\n]*/g, '')
const CODE_FLAT = CODE.replace(/\s+/g, ' ')

// Slice ONLY the executable dollar-quoted body of a block ($tag$ ... $tag$).
function fnBody(flat: string, tag: string): string {
  const open = flat.indexOf(`$${tag}$`)
  if (open < 0) return ''
  const bodyStart = open + tag.length + 2
  const close = flat.indexOf(`$${tag}$`, bodyStart)
  return close < 0 ? flat.slice(bodyStart) : flat.slice(bodyStart, close)
}
const VALIDATOR = fnBody(CODE_FLAT, 'v2')
const PREVIEW = fnBody(CODE_FLAT, 'prep')
const EXECUTOR = fnBody(CODE_FLAT, 'prepare')

describe('025 — file structure and the three intended objects', () => {
  it('S1. defines exactly the three intended functions', () => {
    expect(CODE_FLAT).toContain(
      'CREATE OR REPLACE FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(',
    )
    expect(CODE_FLAT).toContain('CREATE OR REPLACE FUNCTION public.wtf_marketing_recipient_preparation_preview()')
    expect(CODE_FLAT).toContain('CREATE OR REPLACE FUNCTION public.prepare_marketing_recipient_content(')
  })

  it('S2. there is NO second executor (no prepare_marketing_recipient_content_v2 in code)', () => {
    expect(CODE_FLAT).not.toContain('FUNCTION public.prepare_marketing_recipient_content_v2')
  })

  it('S3. the queue executor is intentionally NOT redefined', () => {
    expect(CODE_FLAT).not.toContain('CREATE OR REPLACE FUNCTION public.queue_prepared_marketing_runs')
  })

  it('S4. all three dollar-quoted bodies parsed non-empty', () => {
    expect(VALIDATOR.length).toBeGreaterThan(100)
    expect(PREVIEW.length).toBeGreaterThan(100)
    expect(EXECUTOR.length).toBeGreaterThan(100)
  })
})

describe('025 — V2 validator (strict, closed, fail-closed)', () => {
  it('V1. is IMMUTABLE with a hardened search_path', () => {
    const head = CODE_FLAT.slice(
      CODE_FLAT.indexOf('wtf_marketing_content_snapshots_are_prepared_v2('),
      CODE_FLAT.indexOf('$v2$'),
    )
    expect(head).toContain('IMMUTABLE')
    expect(head).toContain('SET search_path = public, pg_temp')
  })

  it('V2. requires template schemaVersion NUMBER=1 and context schemaVersion NUMBER=2', () => {
    expect(VALIDATOR).toContain("jsonb_typeof(p_template->'schemaVersion') <> 'number'")
    expect(VALIDATOR).toContain("(p_template->>'schemaVersion') <> '1'")
    expect(VALIDATOR).toContain("jsonb_typeof(p_context->'schemaVersion') <> 'number'")
    expect(VALIDATOR).toContain("(p_context->>'schemaVersion') <> '2'")
  })

  it('V3. enforces the opportunityType matches the passed type', () => {
    expect(VALIDATOR).toContain("'opportunityType') IS DISTINCT FROM p_opportunity_type")
  })

  it('V4. numeric commercial fields must be non-negative integers or null', () => {
    // Every numeric field is validated by a shared integer regex path.
    expect(VALIDATOR).toContain("~ '^[0-9]+$'")
    for (const key of [
      'ticketPricePence',
      'ticketsTotal',
      'ticketsSold',
      'ticketsRemaining',
      'instantWinsRemaining',
      'remainingInstantPrizeValuePence',
      'highestRemainingInstantPrizePence',
    ]) {
      expect(VALIDATOR).toContain(key)
    }
  })

  it('V5. artwork, when present and non-null, must be http(s)', () => {
    expect(VALIDATOR).toContain("!~ '^https?://'")
  })

  it('V6. wtf_credit_waiting REQUIRES walletCreditPence > 0 (snapshot fail-closed)', () => {
    expect(VALIDATOR).toContain('walletCreditPence')
    expect(VALIDATOR).toContain("p_opportunity_type = 'wtf_credit_waiting'")
  })

  it('V7. is a CLOSED schema — rejects unknown keys', () => {
    // Uses jsonb_object_keys membership checks to reject unexpected keys.
    expect(VALIDATOR).toContain('jsonb_object_keys')
  })

  it('V8. campaign presence is enforced both ways', () => {
    expect(VALIDATOR).toContain('p_campaign_specific')
  })

  it('V9. validator EXECUTE is service_role-only', () => {
    expect(CODE_FLAT).toContain(
      'GRANT EXECUTE ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) TO service_role',
    )
    expect(CODE_FLAT).toContain(
      'REVOKE ALL ON FUNCTION public.wtf_marketing_content_snapshots_are_prepared_v2(jsonb, jsonb, text, boolean) FROM PUBLIC',
    )
  })
})

describe('025 — version-aware readiness gate (preview)', () => {
  it('R1. content_prepared accepts a valid V1 snapshot (inline contract preserved)', () => {
    expect(PREVIEW).toContain("(b.template_snapshot ->> 'schemaVersion') = '1'")
    expect(PREVIEW).toContain("(b.context_snapshot ->> 'schemaVersion') = '1'")
  })

  it('R2. content_prepared ALSO accepts a valid V2 snapshot via the new validator', () => {
    expect(PREVIEW).toContain("(b.context_snapshot ->> 'schemaVersion') = '2'")
    expect(PREVIEW).toContain('public.wtf_marketing_content_snapshots_are_prepared_v2(')
  })

  it('R3. the two branches are OR-combined (either version is ready)', () => {
    // A single OR sits between the v1 and v2 readiness sub-expressions.
    const idxV1 = PREVIEW.indexOf("(b.context_snapshot ->> 'schemaVersion') = '1'")
    const idxV2 = PREVIEW.indexOf("(b.context_snapshot ->> 'schemaVersion') = '2'")
    expect(idxV1).toBeGreaterThan(-1)
    expect(idxV2).toBeGreaterThan(idxV1)
    expect(PREVIEW.slice(idxV1, idxV2)).toContain(' OR ')
  })

  it('R4. empty {}/{} snapshots are NOT prepared (canary stays unready)', () => {
    // Requires object typeof AND schemaVersion equality, so {} fails both branches.
    expect(PREVIEW).toContain("jsonb_typeof(b.template_snapshot) = 'object'")
    expect(PREVIEW).toContain("jsonb_typeof(b.context_snapshot) = 'object'")
  })
})

describe('025 — single executor: Stage 037 safety preserved', () => {
  it('E1. keeps the exact public name and integer signature', () => {
    expect(CODE_FLAT).toContain('CREATE OR REPLACE FUNCTION public.prepare_marketing_recipient_content( p_limit integer')
  })

  it('E2. SECURITY DEFINER + hardened search_path', () => {
    const head = CODE_FLAT.slice(
      CODE_FLAT.indexOf('CREATE OR REPLACE FUNCTION public.prepare_marketing_recipient_content('),
      CODE_FLAT.indexOf('$prepare$'),
    )
    expect(head).toContain('SECURITY DEFINER')
    expect(head).toContain('SET search_path = public, pg_temp')
  })

  it('E3. same preparation advisory-lock key', () => {
    expect(EXECUTOR).toContain("pg_try_advisory_xact_lock(hashtext('wtf_marketing_prepare_recipient_content'))")
  })

  it('E4. control-state fail-closed statuses present', () => {
    for (const s of ['control_missing', 'invalid_control', 'rollout_disabled', 'busy']) {
      expect(EXECUTOR).toContain(s)
    }
  })

  it('E5. rollout bounds = LEAST(requested, maximum_batch_size, rollout_limit)', () => {
    expect(EXECUTOR).toContain('LEAST(v_requested, v_batch, v_rollout)')
  })

  it('E6. selection authority is the preparation preview + preparation_eligible', () => {
    expect(EXECUTOR).toContain('public.wtf_marketing_recipient_preparation_preview() g')
    expect(EXECUTOR).toContain('g.preparation_eligible')
  })

  it('E7. write guard is pristine/unsent/unlocked/attempts=0/empty-snapshot', () => {
    expect(EXECUTOR).toContain("status = 'queued'")
    expect(EXECUTOR).toContain('sent_at IS NULL')
    expect(EXECUTOR).toContain('provider_email_id IS NULL')
    expect(EXECUTOR).toContain('locked_at IS NULL')
    expect(EXECUTOR).toContain('COALESCE(attempts, 0) = 0')
    expect(EXECUTOR).toContain("template_snapshot = '{}'::jsonb")
    expect(EXECUTOR).toContain("context_snapshot = '{}'::jsonb")
  })

  it('E8. executor EXECUTE is service_role-only', () => {
    expect(CODE_FLAT).toContain(
      'GRANT EXECUTE ON FUNCTION public.prepare_marketing_recipient_content(integer) TO service_role',
    )
  })
})

describe('025 — corrected commercial sourcing', () => {
  it('C1. tickets come ONLY from giveaway_ticket_counters (no campaign_ticket_counters)', () => {
    expect(EXECUTOR).toContain('FROM public.giveaway_ticket_counters gc')
    expect(CODE_FLAT).not.toContain('campaign_ticket_counters')
  })

  it('C2. no counter fallback: giveaway_ticket_counters is the only ticket source', () => {
    const occurrences = EXECUTOR.split('giveaway_ticket_counters').length - 1
    expect(occurrences).toBe(1)
  })

  it('C3. instant wins use instant_win_slots joined to instant_win_prizes (no instant_win_awards)', () => {
    expect(EXECUTOR).toContain('FROM public.instant_win_slots s')
    expect(EXECUTOR).toContain('JOIN public.instant_win_prizes p ON p.id = s.prize_id')
    expect(CODE_FLAT).not.toContain('instant_win_awards')
  })

  it('C4. genuinely-remaining slot definition: unclaimed, has winning_ticket, still ahead', () => {
    expect(EXECUTOR).toContain('s.claimed_at IS NULL')
    expect(EXECUTOR).toContain('s.winning_ticket IS NOT NULL')
    expect(EXECUTOR).toContain('s.winning_ticket >= v_next_ticket')
  })

  it('C5. all-or-nothing instant value: any unknown value nulls BOTH aggregates', () => {
    expect(EXECUTOR).toContain('bool_or(p.prize_value_pence IS NULL)')
    expect(EXECUTOR).toContain('v_iw_value := NULL')
    expect(EXECUTOR).toContain('v_iw_top := NULL')
  })
})

describe('025 — £0 WTF credit handling', () => {
  it('W1. wtf_credit_waiting is gated at SELECTION on strictly positive credit', () => {
    // The FOR-loop WHERE clause excludes wtf_credit_waiting without positive credit.
    expect(EXECUTOR).toContain("g.opportunity_type <> 'wtf_credit_waiting'")
    expect(EXECUTOR).toContain('GREATEST(COALESCE(w.balance_pence, 0) - COALESCE(w.reserved_pence, 0), 0) > 0')
  })

  it('W2. credit is RE-CHECKED before write; <= 0 => CONTINUE (no write/send)', () => {
    expect(EXECUTOR).toContain('IF v_wallet_pence IS NULL OR v_wallet_pence <= 0 THEN')
  })

  it('W3. wallet is only ever READ, never mutated', () => {
    expect(CODE_FLAT).not.toMatch(/UPDATE\s+public\.wallet_accounts/i)
    expect(CODE_FLAT).not.toMatch(/INSERT\s+INTO\s+public\.wallet_accounts/i)
  })
})

describe('025 — writes are confined to the snapshot boundary', () => {
  it('X1. the ONLY write is UPDATE marketing_recipients SET the two snapshot columns', () => {
    const updates = CODE_FLAT.match(/UPDATE\s+public\.\w+/gi) ?? []
    expect(updates).toEqual(['UPDATE public.marketing_recipients'])
    expect(EXECUTOR).toContain('SET template_snapshot = v_template, context_snapshot = v_context')
  })

  it('X2. no operational table is written (campaigns/counters/slots/prizes/wallet read-only)', () => {
    for (const t of [
      'campaigns',
      'giveaway_ticket_counters',
      'instant_win_slots',
      'instant_win_prizes',
      'wallet_accounts',
    ]) {
      expect(CODE_FLAT).not.toMatch(new RegExp(`UPDATE\\s+public\\.${t}\\b`, 'i'))
      expect(CODE_FLAT).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+public\\.${t}\\b`, 'i'))
      expect(CODE_FLAT).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+public\\.${t}\\b`, 'i'))
    }
  })

  it('X3. no run/opportunity status transition and no provider/send', () => {
    expect(CODE_FLAT).not.toMatch(/UPDATE\s+public\.marketing_runs/i)
    expect(CODE_FLAT).not.toMatch(/UPDATE\s+public\.marketing_opportunities\b/i)
    expect(EXECUTOR).not.toContain('provider_email_id =')
  })
})

describe('025 — snapshot contract shape', () => {
  it('Y1. template snapshot stays schemaVersion 1', () => {
    expect(EXECUTOR).toContain("'schemaVersion', 1")
  })

  it('Y2. context snapshot is schemaVersion 2', () => {
    expect(EXECUTOR).toContain("'schemaVersion', 2")
  })

  it('Y3. commercial fields are frozen via to_jsonb (null => JSON null => omit)', () => {
    for (const key of [
      'imageUrl',
      'ticketPricePence',
      'ticketsTotal',
      'ticketsSold',
      'ticketsRemaining',
      'instantWinsRemaining',
      'remainingInstantPrizeValuePence',
      'highestRemainingInstantPrizePence',
      'walletCreditPence',
    ]) {
      expect(EXECUTOR).toContain(key)
    }
    expect(EXECUTOR).toContain('to_jsonb(')
  })

  it('Y4. the V2 validator authorises the snapshot before the write', () => {
    expect(EXECUTOR).toContain('public.wtf_marketing_content_snapshots_are_prepared_v2(')
  })
})
