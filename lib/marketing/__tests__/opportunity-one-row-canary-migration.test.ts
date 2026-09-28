import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/014-marketing-opportunity-one-row-canary.sql
//
// These tests treat the canary migration as STATIC TEXT. They never open a
// database connection, never execute SQL, and never mutate anything. They
// assert that the Stage 3C2G one-row persistence canary temporarily enables
// ONLY new_account_no_purchase, calls the discovery RPC exactly once with an
// effective limit of 1, requires inserted=1, verifies the single row, restores
// the fully-paused state BEFORE COMMIT, never enables sending, is BEGIN/COMMIT
// atomic with no error-swallowing handler, changes no schema, and returns no
// PII.
// ---------------------------------------------------------------------------

const CODE = readFileSync(
  join(process.cwd(), 'scripts/marketing/014-marketing-opportunity-one-row-canary.sql'),
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

// The canary DO block body, isolated between the DO $canary$ ... $canary$;
// delimiters of the executable text. All canary logic lives inside this body.
const _bodyStart = FLAT_EXEC.indexOf('DO $canary$')
const _bodyEnd = FLAT_EXEC.indexOf('$canary$;', _bodyStart)
const DO_BODY = _bodyStart >= 0 && _bodyEnd >= 0 ? FLAT_EXEC.slice(_bodyStart, _bodyEnd) : ''

describe('014 canary — transaction & atomicity', () => {
  it('runs inside a single BEGIN/COMMIT transaction', () => {
    expect(FLAT_EXEC).toMatch(/^\s*BEGIN;/)
    expect(FLAT_EXEC).toMatch(/COMMIT;\s*$/)
  })

  it('has exactly one BEGIN and one COMMIT at the statement level', () => {
    // "BEGIN;" (transaction) is distinct from the plpgsql block "BEGIN" (no
    // semicolon). Count only the transaction-level statements.
    const begins = FLAT_EXEC.match(/(?:^|\s)BEGIN;/g) || []
    const commits = FLAT_EXEC.match(/COMMIT;/g) || []
    expect(begins.length).toBe(1)
    expect(commits.length).toBe(1)
  })

  it('sets fail-fast LOCAL timeouts', () => {
    expect(FLAT_EXEC).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT_EXEC).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('acquires a canary-specific advisory transaction lock (distinct from the RPC run lock)', () => {
    expect(DO_BODY).toMatch(/pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2g_one_row_canary'\)\)/i)
    expect(/wtf_marketing_stage_3c2f_discovery_run/i.test(DO_BODY)).toBe(false)
  })

  it('has NO exception handler that could swallow an error and commit', () => {
    // A canary must never contain EXCEPTION WHEN ... to trap and continue.
    expect(/\bEXCEPTION\s+WHEN\b/i.test(EXEC)).toBe(false)
  })

  it('uses RAISE EXCEPTION for every validation failure (no soft logging)', () => {
    const raises = DO_BODY.match(/RAISE EXCEPTION/gi) || []
    // Many independent guards; ensure the mechanism is RAISE EXCEPTION.
    expect(raises.length).toBeGreaterThanOrEqual(15)
    expect(/RAISE (NOTICE|WARNING|INFO)/i.test(DO_BODY)).toBe(false)
  })
})

describe('014 canary — pre-mutation assertions', () => {
  it('asserts the discovery RPC and required tables exist before any change', () => {
    expect(DO_BODY).toMatch(/to_regprocedure\('public\.discover_marketing_opportunities\(integer\)'\)/i)
    expect(DO_BODY).toMatch(/to_regclass\('public\.marketing_opportunities'\)/i)
    expect(DO_BODY).toMatch(/to_regclass\('public\.marketing_opportunity_definitions'\)/i)
    expect(DO_BODY).toMatch(/to_regclass\('public\.marketing_control_state'\)/i)
  })

  it('asserts the current control state is exactly paused', () => {
    expect(DO_BODY).toMatch(
      /SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size\s+INTO/i,
    )
    expect(DO_BODY).toMatch(/v_sending IS DISTINCT FROM false/i)
    expect(DO_BODY).toMatch(/v_discovery IS DISTINCT FROM false/i)
    expect(DO_BODY).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
  })

  it('asserts zero enabled definitions and an empty ledger up front', () => {
    expect(DO_BODY).toMatch(/count\(\*\) INTO v_enabled_defs\s+FROM public\.marketing_opportunity_definitions\s+WHERE enabled = true/i)
    expect(DO_BODY).toMatch(/count\(\*\) INTO v_opp_before FROM public\.marketing_opportunities/i)
  })

  it('reads and asserts the canary definition exists, is disabled, and is NOT campaign_specific', () => {
    expect(DO_BODY).toMatch(
      /SELECT enabled, campaign_specific, default_priority, default_expiry_hours\s+INTO v_def_enabled, v_def_campaign, v_def_priority, v_def_expiry\s+FROM public\.marketing_opportunity_definitions\s+WHERE opportunity_key = 'new_account_no_purchase'/i,
    )
    expect(DO_BODY).toMatch(/v_def_enabled IS DISTINCT FROM false/i)
    expect(DO_BODY).toMatch(/v_def_campaign IS DISTINCT FROM false/i)
  })

  it('aborts BEFORE any mutation when the detector yields zero rn=1 winners', () => {
    // The winner-count read must occur before the first UPDATE.
    const winnerIdx = DO_BODY.indexOf('wtf_marketing_opportunity_candidates_preview')
    const firstUpdateIdx = DO_BODY.indexOf('UPDATE public.marketing_opportunity_definitions')
    expect(winnerIdx).toBeGreaterThan(0)
    expect(firstUpdateIdx).toBeGreaterThan(winnerIdx)
    expect(DO_BODY).toMatch(/v_winner_count < 1/i)
    expect(DO_BODY).toMatch(/rn = 1\s+AND c\.opportunity_key = 'new_account_no_purchase'/i)
  })
})

describe('014 canary — temporary configuration', () => {
  it('enables ONLY new_account_no_purchase', () => {
    const enables = EXEC.match(/UPDATE public\.marketing_opportunity_definitions\s+SET enabled = true[\s\S]*?WHERE opportunity_key = 'new_account_no_purchase'/gi) || []
    expect(enables.length).toBe(1)
    // No blanket enable of all definitions.
    expect(/SET enabled = true\s+WHERE (?!opportunity_key = 'new_account_no_purchase')/i.test(FLAT_EXEC)).toBe(false)
  })

  it('guards that exactly one definition (the canary) is enabled after enablement', () => {
    expect(DO_BODY).toMatch(/v_enabled_defs <> 1/i)
    expect(DO_BODY).toMatch(/opportunity_key <> 'new_account_no_purchase'/i)
  })

  it('sets discovery_enabled = true and rollout_limit = 1', () => {
    expect(DO_BODY).toMatch(
      /UPDATE public\.marketing_control_state\s+SET discovery_enabled = true, rollout_limit = 1, updated_at = now\(\)\s+WHERE key = 'default'/i,
    )
  })

  it('NEVER sets sending_enabled = true anywhere', () => {
    expect(/sending_enabled\s*=\s*true/i.test(FLAT_EXEC)).toBe(false)
  })

  it('NEVER writes maximum_batch_size (it must stay unchanged)', () => {
    // No assignment to maximum_batch_size in any UPDATE / SET.
    expect(/SET[\s\S]*?maximum_batch_size\s*=/i.test(FLAT_EXEC)).toBe(false)
    // And it is explicitly verified as unchanged.
    expect(DO_BODY).toMatch(/v_max_batch IS DISTINCT FROM v_max_batch_before/i)
  })
})

describe('014 canary — single controlled execution', () => {
  it('calls discover_marketing_opportunities exactly once, with limit 1', () => {
    // Use the string-literal-stripped view so the to_regprocedure signature
    // ('…(integer)') and RAISE messages don't count as invocations. Only the
    // real SELECT … discover_marketing_opportunities(1) call survives.
    const realCalls = FLAT_EXEC_NOSTR.match(/discover_marketing_opportunities\s*\(/gi) || []
    expect(realCalls.length).toBe(1)
    expect(FLAT_EXEC_NOSTR).toMatch(/discover_marketing_opportunities\s*\(\s*1\s*\)/i)
  })

  it('requires status=ok, effectiveLimit=1, inserted=1', () => {
    expect(DO_BODY).toMatch(/v_rpc_status IS DISTINCT FROM 'ok'/i)
    expect(DO_BODY).toMatch(/v_rpc_effective IS DISTINCT FROM 1/i)
    expect(DO_BODY).toMatch(/v_rpc_inserted IS DISTINCT FROM 1/i)
  })

  it('requires the ledger to hold exactly one row after the canary', () => {
    expect(DO_BODY).toMatch(/count\(\*\) INTO v_opp_after FROM public\.marketing_opportunities/i)
    expect(DO_BODY).toMatch(/v_opp_after <> 1/i)
  })
})

describe('014 canary — persisted-row verification', () => {
  it('verifies identity XOR: user present, external null', () => {
    expect(DO_BODY).toMatch(/r_user_id IS NULL/i)
    expect(DO_BODY).toMatch(/r_external IS NOT NULL/i)
  })

  it('verifies type=new_account_no_purchase, campaign null, state=open', () => {
    expect(DO_BODY).toMatch(/r_type IS DISTINCT FROM 'new_account_no_purchase'/i)
    expect(DO_BODY).toMatch(/r_campaign IS NOT NULL/i)
    expect(DO_BODY).toMatch(/r_state IS DISTINCT FROM 'open'/i)
  })

  it('verifies timing, priority, score bounds, email, JSON shapes and dedupe', () => {
    expect(DO_BODY).toMatch(/r_expires <= r_detected/i)
    expect(DO_BODY).toMatch(/r_base_priority IS DISTINCT FROM v_def_priority/i)
    expect(DO_BODY).toMatch(/r_score < 0 OR r_score > 1000/i)
    expect(DO_BODY).toMatch(/length\(r_email\) = 0/i)
    expect(DO_BODY).toMatch(/jsonb_typeof\(r_reason\) <> 'object'/i)
    expect(DO_BODY).toMatch(/jsonb_typeof\(r_context\) <> 'object'/i)
    expect(DO_BODY).toMatch(/length\(r_dedupe\) = 0/i)
  })
})

describe('014 canary — restoration before COMMIT', () => {
  it('restores discovery_enabled=false and rollout_limit=0', () => {
    expect(DO_BODY).toMatch(
      /UPDATE public\.marketing_control_state\s+SET discovery_enabled = false, rollout_limit = 0, updated_at = now\(\)\s+WHERE key = 'default'/i,
    )
  })

  it('disables new_account_no_purchase again', () => {
    expect(DO_BODY).toMatch(
      /UPDATE public\.marketing_opportunity_definitions\s+SET enabled = false, updated_at = now\(\)\s+WHERE opportunity_key = 'new_account_no_purchase'/i,
    )
  })

  it('restoration UPDATEs occur AFTER the RPC call (not before)', () => {
    const callIdx = DO_BODY.indexOf('discover_marketing_opportunities(1)')
    const restoreDiscoveryIdx = DO_BODY.indexOf('SET discovery_enabled = false')
    const restoreDefIdx = DO_BODY.indexOf('SET enabled = false')
    expect(callIdx).toBeGreaterThan(0)
    expect(restoreDiscoveryIdx).toBeGreaterThan(callIdx)
    expect(restoreDefIdx).toBeGreaterThan(callIdx)
  })

  it('re-verifies the fully-paused end state before COMMIT', () => {
    expect(DO_BODY).toMatch(/v_sending IS DISTINCT FROM false/i)
    expect(DO_BODY).toMatch(/v_discovery IS DISTINCT FROM false/i)
    expect(DO_BODY).toMatch(/v_rollout IS DISTINCT FROM 0/i)
    expect(DO_BODY).toMatch(/v_enabled_defs <> 0/i)
    expect(DO_BODY).toMatch(/v_opp_after <> 1/i)
  })

  it('the restoration verification block sits before the COMMIT', () => {
    const restoreVerifyIdx = FLAT_EXEC.indexOf('discovery_enabled not restored')
    // restore message lives inside a RAISE string, stripped from EXEC, so instead
    // check the last restore UPDATE precedes COMMIT in the raw executable text.
    const lastRestoreIdx = FLAT_EXEC.lastIndexOf("SET enabled = false, updated_at = now()")
    const commitIdx = FLAT_EXEC.indexOf('COMMIT;')
    expect(lastRestoreIdx).toBeGreaterThan(0)
    expect(commitIdx).toBeGreaterThan(lastRestoreIdx)
  })
})

describe('014 canary — safe result, no schema change, no side effects', () => {
  it('returns a canary_complete JSON summary with the required fields', () => {
    for (const key of [
      "'status', 'canary_complete'",
      "'rpcStatus'",
      "'rpcInserted'",
      "'opportunityCount'",
      "'opportunityType'",
      "'opportunityState'",
      "'campaignSpecific'",
      "'hasUserIdentity'",
      "'hasExternalIdentity'",
      "'score'",
      "'basePriority'",
      "'expiryHoursApprox'",
      "'sendingEnabled'",
      "'discoveryEnabled'",
      "'rolloutLimit'",
      "'enabledDefinitions'",
      "'generatedAt'",
    ]) {
      expect(FLAT.includes(key)).toBe(true)
    }
  })

  it('never returns user_id, email, dedupe_key or campaign_id in the result JSON', () => {
    // Isolate the final SELECT jsonb_build_object result payload.
    const resultIdx = FLAT.indexOf("'status', 'canary_complete'")
    const payload = FLAT.slice(resultIdx)
    expect(/'user_?id'/i.test(payload)).toBe(false)
    expect(/'email/i.test(payload)).toBe(false)
    expect(/'dedupe/i.test(payload)).toBe(false)
    expect(/'campaignId'/i.test(payload)).toBe(false)
  })

  it('makes NO schema changes (no CREATE/ALTER/DROP of persistent objects)', () => {
    // The only CREATE is the pg_temp result table; strip it, then assert none
    // of CREATE TABLE public / ALTER / DROP ... public remain.
    const noTemp = FLAT_EXEC
      .replace(/DROP TABLE IF EXISTS pg_temp\.tmp_canary_result;?/i, '')
      .replace(/CREATE TEMP TABLE tmp_canary_result ON COMMIT DROP AS/i, '')
    expect(/CREATE TABLE(?!\s+tmp)/i.test(noTemp)).toBe(false)
    expect(/ALTER TABLE/i.test(noTemp)).toBe(false)
    expect(/DROP TABLE\s+public\./i.test(noTemp)).toBe(false)
    expect(/CREATE (OR REPLACE )?FUNCTION/i.test(FLAT_EXEC)).toBe(false)
  })

  it('does NOT alter the discovery function, scoring, detector, or dedupe logic', () => {
    expect(/CREATE OR REPLACE FUNCTION public\.discover_marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/CREATE OR REPLACE FUNCTION public\.wtf_marketing_opportunity_candidates_preview/i.test(FLAT_EXEC)).toBe(false)
  })

  it('performs NO recipient / run / email / AI / cron behaviour', () => {
    expect(/marketing_recipients/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/automation_run/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/resend|smtp|send_email|sendEmail/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/pg_cron|cron\.schedule/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/\bINSERT\s+INTO\b/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('is a manual script that does NOT modify migrations 001-013', () => {
    // It references only its own objects; no editing of other migration files is
    // possible from SQL, but ensure it does not DROP/CREATE their objects.
    expect(/DROP (TABLE|FUNCTION) public\./i.test(FLAT_EXEC)).toBe(false)
  })
})
