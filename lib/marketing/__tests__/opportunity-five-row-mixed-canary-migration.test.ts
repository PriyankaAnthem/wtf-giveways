import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/016-marketing-opportunity-five-row-mixed-canary.sql
//
// These tests treat the canary migration as STATIC TEXT. They never open a
// database connection, never execute SQL, and never mutate anything. They
// assert the Stage 3C2I five-row mixed persistence canary: three tightly
// controlled single-definition discovery invocations (limit 2/2/1, inserted
// 2/2/1) inside ONE atomic transaction, never enabling sending, never enabling
// more than one definition at a time, restoring the fully-paused state before
// COMMIT, leaving the existing canary untouched, touching no recipients/runs,
// changing no schema, and returning no PII.
// ---------------------------------------------------------------------------

const CODE = readFileSync(
  join(process.cwd(), 'scripts/marketing/016-marketing-opportunity-five-row-mixed-canary.sql'),
  'utf8',
)

// Comment-stripped executable view: drop full-line and trailing "-- ..."
// comments so assertions about executable SQL cannot be satisfied by prose.
const EXEC = CODE.split('\n')
  .map((line) => {
    const idx = line.indexOf('--')
    return idx >= 0 ? line.slice(0, idx) : line
  })
  .join('\n')

const FLAT = CODE.replace(/\s+/g, ' ')
const FLAT_EXEC = EXEC.replace(/\s+/g, ' ')

// Executable view with comments AND single-quoted string literals removed, so
// behaviour bans cannot be satisfied by prose inside RAISE / string messages.
const EXEC_NOSTR = EXEC.replace(/'(?:[^']|'')*'/g, "''")
const FLAT_EXEC_NOSTR = EXEC_NOSTR.replace(/\s+/g, ' ')

// The canary DO block body, isolated between DO $canary$ ... $canary$;.
const _bodyStart = FLAT_EXEC.indexOf('DO $canary$')
const _bodyEnd = FLAT_EXEC.indexOf('$canary$;', _bodyStart)
const DO_BODY = _bodyStart >= 0 && _bodyEnd >= 0 ? FLAT_EXEC.slice(_bodyStart, _bodyEnd) : ''

describe('016 mixed canary — transaction & atomicity', () => {
  it('runs inside a single BEGIN/COMMIT transaction (30)', () => {
    expect(FLAT_EXEC).toMatch(/^\s*BEGIN;/)
    expect(FLAT_EXEC).toMatch(/COMMIT;\s*$/)
  })

  it('has exactly one BEGIN and one COMMIT at the statement level (30)', () => {
    const begins = FLAT_EXEC.match(/(?:^|\s)BEGIN;/g) || []
    const commits = FLAT_EXEC.match(/COMMIT;/g) || []
    expect(begins.length).toBe(1)
    expect(commits.length).toBe(1)
  })

  it('sets a 5s lock_timeout and a >=120s statement_timeout', () => {
    expect(FLAT_EXEC).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT_EXEC).toMatch(/SET LOCAL statement_timeout = '120s'/i)
  })

  it('has NO exception-swallowing handler (29)', () => {
    // No EXCEPTION handler may exist anywhere in the canary body.
    expect(/\bEXCEPTION\s+WHEN\b/i.test(EXEC)).toBe(false)
  })

  it('acquires a canary-specific advisory lock distinct from 013/015 locks', () => {
    expect(FLAT_EXEC).toMatch(/pg_try_advisory_xact_lock\(\s*hashtext\('wtf_marketing_stage_3c2i_five_row_mixed_canary'\)\s*\)/i)
    // Must NOT reuse the discovery-run or lifecycle-maintenance keys.
    expect(FLAT.includes('wtf_marketing_stage_3c2f_discovery_run')).toBe(false)
    expect(FLAT.includes('wtf_marketing_stage_3c2h_lifecycle_maintenance')).toBe(false)
  })
})

describe('016 mixed canary — preflight ledger & definition expectations', () => {
  it('expects starting ledger of exactly 1 (1)', () => {
    expect(DO_BODY).toMatch(/marketing_opportunities holds % row\(s\); expected exactly 1/i)
    expect(FLAT_EXEC).toMatch(/IF v_opp_count <> 1 THEN/i)
  })

  it('asserts the required tables incl. recipients & automation runs exist', () => {
    for (const t of [
      'public.marketing_opportunities',
      'public.marketing_opportunity_definitions',
      'public.marketing_control_state',
      'public.marketing_recipients',
      'public.marketing_automation_runs',
    ]) {
      expect(FLAT.includes(`'${t}'`)).toBe(true)
    }
  })

  it('asserts the discovery RPC exists', () => {
    expect(FLAT_EXEC).toMatch(/to_regprocedure\('public\.discover_marketing_opportunities\(integer\)'\)/i)
  })

  it('asserts control state paused (sending/discovery false, rollout 0) at preflight', () => {
    expect(FLAT_EXEC).toMatch(/v_sending IS DISTINCT FROM false\s+OR v_discovery IS DISTINCT FROM false\s+OR v_rollout\s+IS DISTINCT FROM 0/i)
  })

  it('requires maximum_batch_size >= 2 and never changes it', () => {
    expect(FLAT_EXEC).toMatch(/COALESCE\(v_max_batch_before, 0\) < 2/i)
    // maximum_batch_size only ever appears in reads/guards, never in a SET.
    expect(/SET[^;]*maximum_batch_size/i.test(FLAT_EXEC)).toBe(false)
  })

  it('exactly THREE definition keys are used across the canary (3)', () => {
    const keys = [
      'recent_winner_credit_available',
      'high_value_customer_at_risk',
      'abandoned_checkout',
    ]
    for (const k of keys) expect(FLAT.includes(k)).toBe(true)
    // No other opportunity-definition key is enabled anywhere.
    const enableMatches = FLAT_EXEC.match(/SET enabled = true[^;]*opportunity_key = '([a-z_]+)'/gi) || []
    // Every enable statement targets one of the three canary keys.
    for (const m of enableMatches) {
      const key = (m.match(/opportunity_key = '([a-z_]+)'/i) || [])[1]
      expect(keys).toContain(key)
    }
    expect(enableMatches.length).toBe(3)
  })

  it('asserts exact campaign_specific invariants true/false/true (11)', () => {
    expect(FLAT_EXEC).toMatch(/recent_winner_credit_available.*campaign_specific=% \(expected true\)|v_rw_campaign IS DISTINCT FROM true/i)
    expect(FLAT_EXEC).toMatch(/v_hv_campaign IS DISTINCT FROM false/i)
    expect(FLAT_EXEC).toMatch(/v_ac_campaign IS DISTINCT FROM true/i)
  })

  it('reads and asserts exact priority/expiry values 1/168, 1/336, 2/24 (14,15)', () => {
    expect(FLAT_EXEC).toMatch(/c_rw_priority constant integer := 1;/i)
    expect(FLAT_EXEC).toMatch(/c_rw_expiry\s+constant integer := 168;/i)
    expect(FLAT_EXEC).toMatch(/c_hv_priority constant integer := 1;/i)
    expect(FLAT_EXEC).toMatch(/c_hv_expiry\s+constant integer := 336;/i)
    expect(FLAT_EXEC).toMatch(/c_ac_priority constant integer := 2;/i)
    expect(FLAT_EXEC).toMatch(/c_ac_expiry\s+constant integer := 24;/i)
    // And it reads them from the definitions (not only literals).
    expect(FLAT_EXEC).toMatch(/default_priority, default_expiry_hours/i)
  })

  it('requires detector pools of >=2 / >=2 / >=1 and campaign_id present for campaign types (12)', () => {
    expect(FLAT_EXEC).toMatch(/v_pool_rw < 2/i)
    expect(FLAT_EXEC).toMatch(/v_pool_hv < 2/i)
    expect(FLAT_EXEC).toMatch(/v_pool_ac < 1/i)
    expect(FLAT_EXEC).toMatch(/opportunity_key IN \('recent_winner_credit_available', 'abandoned_checkout'\)\s+AND c\.campaign_id IS NULL/i)
  })

  it('records preflight recipients & automation-run counts (21,22)', () => {
    expect(FLAT_EXEC).toMatch(/v_recipients_before FROM public\.marketing_recipients/i)
    expect(FLAT_EXEC).toMatch(/v_runs_before FROM public\.marketing_automation_runs/i)
  })

  it('only user identity is accepted for the existing canary snapshot (12)', () => {
    expect(FLAT_EXEC).toMatch(/opportunity_type = 'new_account_no_purchase'\s+AND campaign_id IS NULL\s+AND user_id IS NOT NULL\s+AND external_contact_id IS NULL/i)
  })
})

describe('016 mixed canary — three controlled invocations', () => {
  it('calls discover_marketing_opportunities EXACTLY three times (8)', () => {
    const calls = FLAT_EXEC_NOSTR.match(/discover_marketing_opportunities\s*\(/gi) || []
    expect(calls.length).toBe(3)
  })

  it('invocation limits are exactly 2, 2, 1 (5,6,7)', () => {
    expect((FLAT_EXEC_NOSTR.match(/discover_marketing_opportunities\s*\(\s*2\s*\)/gi) || []).length).toBe(2)
    expect((FLAT_EXEC_NOSTR.match(/discover_marketing_opportunities\s*\(\s*1\s*\)/gi) || []).length).toBe(1)
  })

  it('requires inserted 2, 2, 1 for A, B, C (9)', () => {
    const inserted2 = FLAT_EXEC.match(/\(v_rpc->>'inserted'\)::bigint\s+IS DISTINCT FROM 2/gi) || []
    const inserted1 = FLAT_EXEC.match(/\(v_rpc->>'inserted'\)::bigint\s+IS DISTINCT FROM 1/gi) || []
    expect(inserted2.length).toBe(2)
    expect(inserted1.length).toBe(1)
  })

  it('total inserted requirement is exactly 5 (10)', () => {
    expect(FLAT_EXEC).toMatch(/'insertedThisCanary', 5/i)
    // Ledger progression 3 -> 5 -> 6 proves 5 net inserts over a starting 1.
    expect(FLAT_EXEC).toMatch(/IF v_opp_count <> 3 THEN/i)
    expect(FLAT_EXEC).toMatch(/IF v_opp_count <> 5 THEN/i)
    expect(FLAT_EXEC).toMatch(/IF v_opp_count <> 6 THEN/i)
  })

  it('final ledger expected exactly 6 (2)', () => {
    expect(FLAT_EXEC).toMatch(/final ledger count is %, expected 6/i)
    expect(FLAT_EXEC).toMatch(/'finalOpportunityCount', v_opp_count/i)
  })

  it('enforces exactly one enabled definition per invocation and 0 between (4)', () => {
    // "exactly 1 enabled definition" guard appears three times (A, B, C).
    const one = FLAT_EXEC.match(/expected exactly 1 enabled definition, found/gi) || []
    expect(one.length).toBe(3)
    // "sole enabled" cross-checks that no OTHER definition is enabled.
    const soleGuards = FLAT_EXEC.match(/a definition other than [a-z_]+ is enabled/gi) || []
    expect(soleGuards.length).toBe(3)
    // Enabled count returns to 0 after each disable.
    const zeroGuards = FLAT_EXEC.match(/enabled-definition count is % after disable, expected 0/gi) || []
    expect(zeroGuards.length).toBe(3)
  })

  it('requires status/requestedLimit/effectiveLimit/rolloutLimit on every call', () => {
    for (const field of ['status', 'requestedLimit', 'effectiveLimit', 'rolloutLimit']) {
      const hits = FLAT_EXEC.match(new RegExp(`>>'${field}'`, 'gi')) || []
      // At least once per invocation (3), plus safe-summary references allowed.
      expect(hits.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('016 mixed canary — five-row distribution verification', () => {
  it('verifies per-type exact counts 1/2/2/1', () => {
    expect(FLAT_EXEC).toMatch(/new_account_no_purchase count is %, expected 1/i)
    expect(FLAT_EXEC).toMatch(/recent_winner_credit_available count is %, expected 2/i)
    expect(FLAT_EXEC).toMatch(/high_value_customer_at_risk count is %, expected 2/i)
    expect(FLAT_EXEC).toMatch(/abandoned_checkout count is %, expected 1/i)
  })

  it('rejects any unexpected opportunity type', () => {
    expect(FLAT_EXEC).toMatch(/opportunity_type NOT IN \(\s*'new_account_no_purchase', 'recent_winner_credit_available',\s*'high_value_customer_at_risk', 'abandoned_checkout'\s*\)/i)
  })

  it('all persisted new rows require state = open (13)', () => {
    // Each verification block asserts state = 'open'.
    const stateOpen = FLAT_EXEC.match(/AND state = 'open'/gi) || []
    expect(stateOpen.length).toBeGreaterThanOrEqual(3)
  })

  it('campaign invariants: winner+checkout campaign NOT NULL, lifecycle NULL (11)', () => {
    // recent_winner + abandoned_checkout verification requires campaign_id NOT NULL.
    const campaignNotNull = FLAT_EXEC.match(/AND campaign_id IS NOT NULL/gi) || []
    expect(campaignNotNull.length).toBeGreaterThanOrEqual(2)
    // high_value verification requires campaign_id IS NULL, inside the
    // NULL-SAFE "AND ( ... ) IS NOT TRUE" wrapper (never "AND NOT (").
    expect(FLAT_EXEC).toMatch(/high_value_customer_at_risk'\s+AND \([^;]*campaign_id IS NULL/i)
  })

  it('checks base priorities 1,1,2 in verification (14)', () => {
    expect(FLAT_EXEC).toMatch(/base_priority = c_rw_priority/i)
    expect(FLAT_EXEC).toMatch(/base_priority = c_hv_priority/i)
    expect(FLAT_EXEC).toMatch(/base_priority = c_ac_priority/i)
  })

  it('checks expiry intervals 168/336/24 in verification (15)', () => {
    expect(FLAT_EXEC).toMatch(/= c_rw_expiry/i)
    expect(FLAT_EXEC).toMatch(/= c_hv_expiry/i)
    expect(FLAT_EXEC).toMatch(/= c_ac_expiry/i)
  })

  it('checks score bounds, JSON shapes, selectedAsNextBestAction, rn=1, dedupe', () => {
    const scoreBounds = FLAT_EXEC.match(/score >= 0 AND score <= 1000/gi) || []
    expect(scoreBounds.length).toBeGreaterThanOrEqual(3)
    const sel = FLAT_EXEC.match(/selectedAsNextBestAction'\)::boolean = true/gi) || []
    expect(sel.length).toBeGreaterThanOrEqual(3)
    const rn = FLAT_EXEC.match(/'rn'\)::int = 1/gi) || []
    expect(rn.length).toBeGreaterThanOrEqual(3)
    const dedupe = FLAT_EXEC.match(/dedupe_key IS NOT NULL AND length\(dedupe_key\) > 0/gi) || []
    expect(dedupe.length).toBeGreaterThanOrEqual(3)
  })

  it('only user identity accepted (external_contact_id NULL) for all new rows (12)', () => {
    const userId = FLAT_EXEC.match(/user_id IS NOT NULL\s+AND external_contact_id IS NULL/gi) || []
    expect(userId.length).toBeGreaterThanOrEqual(3)
  })
})

describe('016 mixed canary — NULL-SAFE (fail-closed) invariant verification', () => {
  // Isolate each type-specific verification region: from the WHERE type filter
  // up to (and including) the null-safe "( ... ) IS NOT TRUE;" terminator.
  // FLAT_EXEC has comments stripped and whitespace collapsed.
  function invariantRegion(type: string): string {
    const m = FLAT_EXEC.match(
      new RegExp(`opportunity_type = '${type}'\\s+AND \\((.*?)\\) IS NOT TRUE;`, 'i'),
    )
    return m ? m[1] : ''
  }

  const RW = invariantRegion('recent_winner_credit_available')
  const HV = invariantRegion('high_value_customer_at_risk')
  const AC = invariantRegion('abandoned_checkout')

  it('all THREE persisted-row invariant blocks use "( ... ) IS NOT TRUE"', () => {
    const isNotTrue = FLAT_EXEC.match(/\) IS NOT TRUE;/gi) || []
    expect(isNotTrue.length).toBe(3)
    expect(RW.length).toBeGreaterThan(0)
    expect(HV.length).toBeGreaterThan(0)
    expect(AC.length).toBeGreaterThan(0)
  })

  it('does NOT use the null-unsafe "AND NOT (...)" pattern anywhere in executable SQL', () => {
    // FLAT_EXEC_NOSTR strips comments AND string literals, so the explanatory
    // comment and RAISE prose cannot mask a real occurrence.
    expect(/AND NOT \(/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    // And specifically not attached to any of the three type filters.
    expect(/recent_winner_credit_available'\s+AND NOT \(/i.test(FLAT_EXEC)).toBe(false)
    expect(/high_value_customer_at_risk'\s+AND NOT \(/i.test(FLAT_EXEC)).toBe(false)
    expect(/abandoned_checkout'\s+AND NOT \(/i.test(FLAT_EXEC)).toBe(false)
  })

  it('score NULL would logically fail each invariant (bounds live inside the IS NOT TRUE wrapper)', () => {
    // Because the whole conjunction is evaluated as "... IS NOT TRUE", a NULL
    // score makes "score >= 0 AND score <= 1000" NULL -> the conjunction is NULL
    // -> IS NOT TRUE is TRUE -> the row is counted as bad. Prove the bounds are
    // inside each wrapper region (not merely somewhere in the file).
    for (const region of [RW, HV, AC]) {
      expect(/score >= 0 AND score <= 1000/i.test(region)).toBe(true)
    }
  })

  it('missing/NULL context values cannot silently pass (rn + selectedAsNextBestAction inside each wrapper)', () => {
    for (const region of [RW, HV, AC]) {
      expect(/\(context_snapshot ->> 'rn'\)::int = 1/i.test(region)).toBe(true)
      expect(/\(context_snapshot ->> 'selectedAsNextBestAction'\)::boolean = true/i.test(region)).toBe(true)
      // JSON shape guards and dedupe presence are also inside the wrapper.
      expect(/jsonb_typeof\(context_snapshot\) = 'object'/i.test(region)).toBe(true)
      expect(/dedupe_key IS NOT NULL AND length\(dedupe_key\) > 0/i.test(region)).toBe(true)
    }
  })

  it('preserves every required invariant inside each null-safe wrapper (no weakening)', () => {
    // RW + AC are campaign-specific; HV is not.
    expect(/campaign_id IS NOT NULL/i.test(RW)).toBe(true)
    expect(/campaign_id IS NULL/i.test(HV)).toBe(true)
    expect(/campaign_id IS NOT NULL/i.test(AC)).toBe(true)
    // Shared invariants present in all three regions.
    for (const region of [RW, HV, AC]) {
      expect(/user_id IS NOT NULL/i.test(region)).toBe(true)
      expect(/external_contact_id IS NULL/i.test(region)).toBe(true)
      expect(/state = 'open'/i.test(region)).toBe(true)
      expect(/base_priority = c_[a-z]{2}_priority/i.test(region)).toBe(true)
      expect(/= c_[a-z]{2}_expiry/i.test(region)).toBe(true)
      expect(/expires_at > detected_at/i.test(region)).toBe(true)
      expect(/jsonb_typeof\(reason\) = 'object'/i.test(region)).toBe(true)
    }
  })
})

describe('016 mixed canary — existing canary unchanged (16)', () => {
  it('verifies the original canary is byte-for-byte unchanged vs preflight snapshot', () => {
    expect(FLAT_EXEC).toMatch(/state = v_canary_state\s+AND detected_at = v_canary_detected\s+AND expires_at = v_canary_expires\s+AND base_priority = v_canary_priority\s+AND score IS NOT DISTINCT FROM v_canary_score/i)
    expect(FLAT_EXEC).toMatch(/existing new_account_no_purchase canary changed/i)
  })
})

describe('016 mixed canary — restore before COMMIT', () => {
  it('restores discovery_enabled=false and rollout_limit=0 before COMMIT (18,19)', () => {
    const restoreIdx = FLAT_EXEC.search(/SET discovery_enabled = false, rollout_limit = 0/i)
    const commitIdx = FLAT_EXEC.indexOf('COMMIT;')
    expect(restoreIdx).toBeGreaterThan(-1)
    expect(restoreIdx).toBeLessThan(commitIdx)
  })

  it('disables all three definitions before COMMIT (20)', () => {
    expect(FLAT_EXEC).toMatch(/SET enabled = false[^;]*opportunity_key IN \(\s*'recent_winner_credit_available', 'high_value_customer_at_risk', 'abandoned_checkout'\s*\)/i)
  })

  it('re-verifies fully-paused end state and 0 enabled definitions (17)', () => {
    expect(FLAT_EXEC).toMatch(/sending_enabled is % \(MUST be false\)/i)
    expect(FLAT_EXEC).toMatch(/discovery_enabled not restored to false/i)
    expect(FLAT_EXEC).toMatch(/rollout_limit not restored to 0/i)
    expect(FLAT_EXEC).toMatch(/definition\(s\) still enabled \(MUST be 0\)/i)
  })

  it('verifies recipient and automation-run counts unchanged (21,22)', () => {
    expect(FLAT_EXEC).toMatch(/v_recipients_after <> v_recipients_before/i)
    expect(FLAT_EXEC).toMatch(/v_runs_after <> v_runs_before/i)
  })

  it('never sets sending_enabled = true anywhere (17)', () => {
    expect(/sending_enabled\s*=\s*true/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })
})

describe('016 mixed canary — forbidden operations', () => {
  it('creates no recipients and no automation runs (23)', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_recipients/i.test(FLAT_EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_automation_runs/i.test(FLAT_EXEC)).toBe(false)
  })

  it('never calls lifecycle maintenance (25)', () => {
    expect(/maintain_marketing_opportunity_lifecycle/i.test(FLAT_EXEC)).toBe(false)
  })

  it('performs no schema alteration (26)', () => {
    expect(/\bALTER\s+TABLE\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bDROP\s+TABLE\s+(?!IF EXISTS pg_temp\.)/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bCREATE\s+TABLE\b(?!\s+tmp_)/i.test(FLAT_EXEC)).toBe(false)
    // The only CREATE is the pg_temp result table.
    expect(FLAT_EXEC).toMatch(/CREATE TEMP TABLE tmp_mixed_canary_result ON COMMIT DROP/i)
  })

  it('does not alter the discovery RPC, priorities, scores, expiry, or dedupe', () => {
    expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(FLAT_EXEC)).toBe(false)
    // No UPDATE touches default_priority / default_expiry_hours / score / dedupe_key.
    expect(/SET[^;]*default_priority/i.test(FLAT_EXEC)).toBe(false)
    expect(/SET[^;]*default_expiry_hours/i.test(FLAT_EXEC)).toBe(false)
    expect(/UPDATE[^;]*marketing_opportunities[^;]*SET/i.test(FLAT_EXEC)).toBe(false)
  })

  it('adds no cron and no AI (24)', () => {
    expect(/cron\.schedule|pg_cron/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bai\b|openai|embedding/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('touches no checkout/payments/tickets/wallet/customer-facing tables', () => {
    for (const t of ['checkout_intents', 'instant_win_awards', 'wallet_transactions', 'auth.users']) {
      expect(FLAT.includes(t)).toBe(false)
    }
  })
})

describe('016 mixed canary — safe result payload (27)', () => {
  it('returns the mixed_canary_complete status with the required safe fields', () => {
    expect(FLAT_EXEC).toMatch(/'status', 'mixed_canary_complete'/i)
    for (const f of [
      'startingOpportunityCount',
      'insertedThisCanary',
      'finalOpportunityCount',
      'insertedByType',
      'campaignSpecificInserted',
      'nonCampaignInserted',
      'familiesTested',
      'prioritiesTested',
      'rpcResults',
      'controlState',
      'enabledDefinitions',
      'recipientCountChanged',
      'automationRunCountChanged',
      'existingCanaryUnchanged',
      'generatedAt',
    ]) {
      expect(FLAT.includes(`'${f}'`)).toBe(true)
    }
    expect(FLAT_EXEC).toMatch(/jsonb_build_array\('winner', 'lifecycle', 'checkout'\)/i)
    expect(FLAT_EXEC).toMatch(/jsonb_build_array\(1, 2\)/i)
    expect(FLAT_EXEC).toMatch(/'campaignSpecificInserted', 3/i)
    expect(FLAT_EXEC).toMatch(/'nonCampaignInserted', 2/i)
  })

  it('the safe result contains NO PII / raw identifiers (27)', () => {
    // Isolate the result-payload build (the pg_temp CREATE ... AS SELECT).
    const rIdx = FLAT_EXEC.indexOf('tmp_mixed_canary_result ON COMMIT DROP AS')
    const rEnd = FLAT_EXEC.indexOf('AS mixed_canary_result', rIdx)
    const RESULT_SQL = rIdx >= 0 && rEnd >= 0 ? FLAT_EXEC.slice(rIdx, rEnd) : ''
    expect(RESULT_SQL.length).toBeGreaterThan(0)
    for (const banned of [
      'user_id',
      'email_lc',
      'external_contact_id',
      'campaign_id',
      'dedupe_key',
      'customerHash',
      'md5',
    ]) {
      expect(RESULT_SQL.includes(banned)).toBe(false)
    }
    // No raw reason/context value extraction in the payload.
    expect(/reason\s*->/i.test(RESULT_SQL)).toBe(false)
    expect(/context_snapshot\s*->/i.test(RESULT_SQL)).toBe(false)
  })
})

describe('016 mixed canary — migrations 001-015 untouched (28)', () => {
  it('modifies only this migration file (no reference to editing other migrations)', () => {
    // This canary file must not DROP/ALTER/CREATE OR REPLACE objects owned by
    // earlier migrations. Verified indirectly: no DDL against functions/tables.
    expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(FLAT_EXEC)).toBe(false)
    expect(/DROP\s+FUNCTION/i.test(FLAT_EXEC)).toBe(false)
    expect(/ALTER\s+TABLE/i.test(FLAT_EXEC)).toBe(false)
  })
})
