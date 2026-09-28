import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/017-marketing-recipient-opportunity-linkage-foundation.sql
//
// These tests treat migration 017 as STATIC TEXT. They never open a database
// connection, never execute SQL, and never mutate anything. They assert the
// Stage 3D0 linkage foundation: a nullable uuid marketing_recipients.opportunity_id
// with a RESTRICT FK to marketing_opportunities(id), a UNIQUE PARTIAL index
// (one recipient per opportunity), and a set-once immutability trigger — with a
// paused-state preflight, a post-DDL verification, atomic transaction, advisory
// lock, and ZERO data materialisation. It must NOT implement the Stage 3D1
// recipient gate and must NOT touch migrations 001-016.
// ---------------------------------------------------------------------------

const MIGRATION_PATH = 'scripts/marketing/017-marketing-recipient-opportunity-linkage-foundation.sql'
const CODE = readFileSync(join(process.cwd(), MIGRATION_PATH), 'utf8')

// Comment-stripped executable view: drop full-line and trailing "-- ..." comments
// so assertions about executable SQL cannot be satisfied by prose/comments.
const EXEC = CODE.split('\n')
  .map((line) => {
    const idx = line.indexOf('--')
    return idx >= 0 ? line.slice(0, idx) : line
  })
  .join('\n')

const FLAT = CODE.replace(/\s+/g, ' ')
const FLAT_EXEC = EXEC.replace(/\s+/g, ' ')

// Executable view with comments AND single-quoted string literals removed, so
// behaviour bans cannot be satisfied by prose inside RAISE / COMMENT strings.
const EXEC_NOSTR = EXEC.replace(/'(?:[^']|'')*'/g, "''")
const FLAT_EXEC_NOSTR = EXEC_NOSTR.replace(/\s+/g, ' ')

// -----------------------------------------------------------------------------
// (1) Migrations 001-016 untouched + 017 scope confined to marketing_recipients
// -----------------------------------------------------------------------------
describe('017 linkage — leaves migrations 001-016 untouched (1)', () => {
  it('the 001-016 migration files still exist on disk', () => {
    const expected = [
      '001-marketing-consent-foundation.sql',
      '003-customer-marketing-profile.sql',
      '005-marketing-automation-foundation.sql',
      '007-marketing-opportunity-foundation.sql',
      '016-marketing-opportunity-five-row-mixed-canary.sql',
    ]
    for (const f of expected) {
      const p = join(process.cwd(), 'scripts/marketing', f)
      expect(() => readFileSync(p, 'utf8')).not.toThrow()
    }
  })

  it('017 only ALTERs marketing_recipients (never opportunities/control/definitions)', () => {
    const alters = FLAT_EXEC.match(/ALTER TABLE\s+public\.(\w+)/gi) || []
    expect(alters.length).toBeGreaterThan(0)
    for (const a of alters) {
      expect(a).toMatch(/public\.marketing_recipients/i)
    }
    expect(/ALTER TABLE\s+public\.marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_control_state/i.test(FLAT_EXEC)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_opportunity_definitions/i.test(FLAT_EXEC)).toBe(false)
  })

  it('contains no DROP of any existing object', () => {
    expect(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TRIGGER|FUNCTION)\b/i.test(FLAT_EXEC)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// (2-4) The opportunity_id column: exactly one, uuid, nullable, no default
// -----------------------------------------------------------------------------
describe('017 linkage — opportunity_id column shape (2,3,4)', () => {
  it('adds exactly one column to marketing_recipients: opportunity_id uuid', () => {
    const adds = FLAT_EXEC.match(/ADD COLUMN\s+\w+/gi) || []
    expect(adds.length).toBe(1)
    expect(FLAT_EXEC).toMatch(/ADD COLUMN\s+opportunity_id\s+uuid/i)
  })

  it('is nullable — no NOT NULL and no default on the added column', () => {
    // The ADD COLUMN statement must not carry NOT NULL or DEFAULT.
    const m = FLAT_EXEC.match(/ADD COLUMN\s+opportunity_id\s+uuid([^;]*);/i)
    expect(m).not.toBeNull()
    const tail = (m?.[1] ?? '').toUpperCase()
    expect(tail).not.toMatch(/NOT NULL/)
    expect(tail).not.toMatch(/DEFAULT/)
  })

  it('the whole migration never sets a DEFAULT on opportunity_id', () => {
    expect(/opportunity_id[^;]*SET DEFAULT/i.test(FLAT_EXEC)).toBe(false)
    expect(/ADD COLUMN\s+opportunity_id[^;]*DEFAULT/i.test(FLAT_EXEC)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// (5-7) No materialisation / backfill
// -----------------------------------------------------------------------------
describe('017 linkage — zero data materialisation (5,6,7,25,29,30)', () => {
  it('performs no backfill UPDATE of opportunity_id', () => {
    expect(/UPDATE\s+public\.marketing_recipients\s+SET\s+opportunity_id/i.test(FLAT_EXEC)).toBe(false)
    // No UPDATE ... SET opportunity_id anywhere.
    expect(/SET\s+opportunity_id\s*=/i.test(FLAT_EXEC)).toBe(false)
  })

  it('contains no INSERT INTO marketing_recipients', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_recipients/i.test(FLAT_EXEC)).toBe(false)
  })

  it('contains no DELETE FROM marketing_recipients', () => {
    expect(/DELETE\s+FROM\s+public\.marketing_recipients/i.test(FLAT_EXEC)).toBe(false)
  })

  it('contains no INSERT/UPDATE/DELETE of marketing_opportunities (25)', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/UPDATE\s+public\.marketing_opportunities\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/DELETE\s+FROM\s+public\.marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
  })

  it('never calls discovery / lifecycle / materialisation / sending (28,29,30)', () => {
    expect(/discover_marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/lifecycle_maintenance|run_marketing_lifecycle|maintain/i.test(FLAT_EXEC)).toBe(false)
    expect(/materiali[sz]e/i.test(FLAT_EXEC)).toBe(false)
    expect(/resend|send_email|\bemail\b/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// (8-9) Foreign key -> marketing_opportunities(id), non-cascading (RESTRICT)
// -----------------------------------------------------------------------------
describe('017 linkage — foreign key integrity (8,9)', () => {
  it('adds an FK on opportunity_id referencing marketing_opportunities(id)', () => {
    expect(FLAT_EXEC).toMatch(
      /ADD CONSTRAINT\s+marketing_recipients_opportunity_fk\s+FOREIGN KEY\s*\(\s*opportunity_id\s*\)\s+REFERENCES\s+public\.marketing_opportunities\s*\(\s*id\s*\)/i,
    )
  })

  it('uses ON DELETE RESTRICT and never CASCADE for this FK', () => {
    expect(FLAT_EXEC).toMatch(/REFERENCES\s+public\.marketing_opportunities\s*\(\s*id\s*\)\s+ON DELETE RESTRICT/i)
    // The FK block must not use ON DELETE CASCADE / SET NULL.
    const fk = FLAT_EXEC.match(/ADD CONSTRAINT\s+marketing_recipients_opportunity_fk[^;]*;/i)?.[0] ?? ''
    expect(/ON DELETE CASCADE/i.test(fk)).toBe(false)
    expect(/ON DELETE SET NULL/i.test(fk)).toBe(false)
  })

  it('installs the FK NOT VALID then VALIDATE (safe production profile)', () => {
    expect(FLAT_EXEC).toMatch(/ADD CONSTRAINT\s+marketing_recipients_opportunity_fk[^;]*NOT VALID\s*;/i)
    expect(FLAT_EXEC).toMatch(/VALIDATE CONSTRAINT\s+marketing_recipients_opportunity_fk\s*;/i)
  })

  it('post-DDL verifies the FK target and RESTRICT delete action', () => {
    expect(/confdeltype/i.test(FLAT_EXEC)).toBe(true)
    expect(FLAT_EXEC).toMatch(/v_fk_deltype\s*<>\s*'r'/i)
    expect(/confrelid::regclass::text/i.test(FLAT_EXEC)).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// (10-12) Unique partial index, correct predicate, no redundant index
// -----------------------------------------------------------------------------
describe('017 linkage — unique partial index (10,11,12)', () => {
  it('creates a UNIQUE index named marketing_recipients_opportunity_unique_idx', () => {
    expect(FLAT_EXEC).toMatch(
      /CREATE UNIQUE INDEX\s+marketing_recipients_opportunity_unique_idx\s+ON\s+public\.marketing_recipients\s*\(\s*opportunity_id\s*\)/i,
    )
  })

  it('the unique index predicate is WHERE opportunity_id IS NOT NULL', () => {
    expect(FLAT_EXEC).toMatch(
      /CREATE UNIQUE INDEX\s+marketing_recipients_opportunity_unique_idx[^;]*WHERE\s+opportunity_id IS NOT NULL\s*;/i,
    )
  })

  it('creates no redundant ordinary index on opportunity_id', () => {
    // Only ONE CREATE INDEX touches opportunity_id, and it is the UNIQUE one.
    const idxStmts = FLAT_EXEC.match(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*opportunity_id[^;]*;/gi) || []
    expect(idxStmts.length).toBe(1)
    expect(idxStmts[0]).toMatch(/CREATE UNIQUE INDEX/i)
    // Post-DDL guard asserts exactly one index references opportunity_id.
    expect(FLAT_EXEC).toMatch(/v_extra_idx\s*<>\s*1/i)
  })
})

// -----------------------------------------------------------------------------
// (13-17) Immutability trigger semantics
// -----------------------------------------------------------------------------
describe('017 linkage — set-once immutability trigger (13,14,15,16,17)', () => {
  it('defines a BEFORE UPDATE trigger bound to marketing_recipients', () => {
    expect(FLAT_EXEC).toMatch(
      /CREATE TRIGGER\s+marketing_recipients_opportunity_link_immutable_trg\s+BEFORE UPDATE ON\s+public\.marketing_recipients\s+FOR EACH ROW\s+EXECUTE FUNCTION\s+public\.marketing_recipients_guard_opportunity_link\(\)/i,
    )
  })

  it('defines the guard trigger function in plpgsql', () => {
    expect(FLAT_EXEC).toMatch(
      /CREATE OR REPLACE FUNCTION\s+public\.marketing_recipients_guard_opportunity_link\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql/i,
    )
  })

  it('rejects change/clear once set: OLD non-NULL AND NEW IS DISTINCT FROM OLD raises', () => {
    // The single guard covers UUID->different-UUID (14/15/16) and NULL->UUID
    // stays allowed (17 by omission): only OLD non-NULL + changed value raises.
    expect(FLAT_EXEC).toMatch(
      /OLD\.opportunity_id IS NOT NULL\s+AND\s+NEW\.opportunity_id IS DISTINCT FROM OLD\.opportunity_id/i,
    )
    expect(/RAISE\s+EXCEPTION/i.test(FLAT_EXEC)).toBe(true)
  })

  it('does not make any other recipient field immutable (only opportunity_id checked)', () => {
    // The trigger body references opportunity_id but no other recipient column
    // in an immutability comparison.
    const fnBody = FLAT_EXEC.match(/\$fn\$(.*?)\$fn\$/i)?.[1] ?? ''
    expect(fnBody.length).toBeGreaterThan(0)
    expect(/OLD\.(status|user_id|email_lc|run_id|sent_at)/i.test(fnBody)).toBe(false)
  })

  it('post-DDL verifies the trigger exists and is not disabled', () => {
    expect(/pg_trigger/i.test(FLAT_EXEC)).toBe(true)
    expect(FLAT_EXEC).toMatch(/tgname\s*=\s*'marketing_recipients_opportunity_link_immutable_trg'/i)
    expect(FLAT_EXEC).toMatch(/v_trg_enabled\s*=\s*'D'/i)
  })
})

// -----------------------------------------------------------------------------
// (18-21) Install-time preflight assertions
// -----------------------------------------------------------------------------
describe('017 linkage — install-time preflight (18,19,20,21)', () => {
  it('checks paused control state (sending/discovery/rollout)', () => {
    // Reads the three control columns, then asserts each is at its paused value.
    expect(FLAT_EXEC).toMatch(/SELECT sending_enabled, discovery_enabled, rollout_limit\s+INTO v_sending, v_discovery, v_rollout/i)
    expect(FLAT_EXEC).toMatch(/v_sending\s+IS DISTINCT FROM false/i)
    expect(FLAT_EXEC).toMatch(/v_discovery\s+IS DISTINCT FROM false/i)
    expect(FLAT_EXEC).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
  })

  it('checks zero enabled definitions', () => {
    expect(FLAT_EXEC).toMatch(/FROM public\.marketing_opportunity_definitions\s+WHERE enabled = true/i)
    expect(FLAT_EXEC).toMatch(/v_enabled_defs\s*<>\s*0/i)
  })

  it('checks the exact six-row opportunity ledger', () => {
    expect(FLAT_EXEC).toMatch(/v_opp_count\s*<>\s*6/i)
  })

  it('checks the exact four-type distribution and rejects other types', () => {
    expect(FLAT_EXEC).toMatch(/'new_account_no_purchase'/)
    expect(FLAT_EXEC).toMatch(/'recent_winner_credit_available'/)
    expect(FLAT_EXEC).toMatch(/'high_value_customer_at_risk'/)
    expect(FLAT_EXEC).toMatch(/'abandoned_checkout'/)
    expect(FLAT_EXEC).toMatch(/v_c_new <> 1 OR v_c_winner <> 2 OR v_c_highvalue <> 2 OR v_c_checkout <> 1/i)
    expect(FLAT_EXEC).toMatch(/v_bad_types\s*<>\s*0/i)
  })

  it('asserts marketing_recipients does NOT already have opportunity_id', () => {
    expect(FLAT_EXEC).toMatch(/attname = 'opportunity_id'/i)
    expect(/already exists.*unexpected schema conflict/i.test(FLAT)).toBe(true)
  })

  it('asserts marketing_opportunities.id is uuid before adding the FK', () => {
    expect(FLAT_EXEC).toMatch(/v_id_type\s+IS DISTINCT FROM 'uuid'/i)
  })
})

// -----------------------------------------------------------------------------
// (22-24) Count capture + post-DDL invariance
// -----------------------------------------------------------------------------
describe('017 linkage — counts captured and unchanged (22,23,24)', () => {
  it('captures baseline recipient / run / opportunity counts in a temp table', () => {
    expect(FLAT_EXEC).toMatch(/CREATE TEMP TABLE\s+tmp_marketing_3d0_baseline\s+ON COMMIT DROP/i)
    expect(FLAT_EXEC).toMatch(/recipients_before/i)
    expect(FLAT_EXEC).toMatch(/runs_before/i)
    expect(FLAT_EXEC).toMatch(/opportunities_before/i)
  })

  it('post-DDL asserts recipient count unchanged', () => {
    expect(FLAT_EXEC).toMatch(/v_recip_now\s*<>\s*v_recip_before/i)
  })

  it('post-DDL asserts automation-run count unchanged', () => {
    expect(FLAT_EXEC).toMatch(/v_runs_now\s*<>\s*v_runs_before/i)
  })

  it('post-DDL asserts opportunity count remains six and unchanged', () => {
    expect(FLAT_EXEC).toMatch(/v_opp_now\s*<>\s*6\s*OR\s*v_opp_now\s*<>\s*v_opp_before/i)
  })

  it('post-DDL asserts every existing recipient opportunity_id is NULL (no backfill)', () => {
    expect(FLAT_EXEC).toMatch(/WHERE opportunity_id IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_non_null_rows\s*<>\s*0/i)
  })
})

// -----------------------------------------------------------------------------
// (26,27,31,32,33) Behaviour bans
// -----------------------------------------------------------------------------
describe('017 linkage — behaviour bans (26,27,31,32,33)', () => {
  it('performs no control-state mutation', () => {
    expect(/UPDATE\s+public\.marketing_control_state/i.test(FLAT_EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(FLAT_EXEC)).toBe(false)
  })

  it('performs no definition mutation', () => {
    expect(/UPDATE\s+public\.marketing_opportunity_definitions/i.test(FLAT_EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_opportunity_definitions/i.test(FLAT_EXEC)).toBe(false)
  })

  it('creates no cron / schedule', () => {
    expect(/cron\.|pg_cron|schedule/i.test(FLAT_EXEC)).toBe(false)
  })

  it('adds no AI / external call', () => {
    expect(/openai|anthropic|gateway|http|net\.http|pg_net/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('exposes no new RPC (only the trigger function, which is not directly callable)', () => {
    const fns = FLAT_EXEC.match(/CREATE (OR REPLACE )?FUNCTION\s+public\.(\w+)/gi) || []
    expect(fns.length).toBe(1)
    expect(fns[0]).toMatch(/marketing_recipients_guard_opportunity_link/i)
    // Returns trigger (not a data RPC) and execute is revoked from PUBLIC.
    expect(FLAT_EXEC).toMatch(/RETURNS trigger/i)
    expect(FLAT_EXEC).toMatch(/REVOKE ALL ON FUNCTION\s+public\.marketing_recipients_guard_opportunity_link\(\)\s+FROM PUBLIC/i)
  })

  it('does not change RLS or table grants on recipients/opportunities', () => {
    expect(/ROW LEVEL SECURITY/i.test(FLAT_EXEC)).toBe(false)
    // Statement-bounded ([^;]*) so the trigger's "ON public.marketing_recipients"
    // and the REVOKE on the trigger FUNCTION are not misread as TABLE grants.
    expect(/GRANT[^;]*\bON\s+public\.marketing_recipients\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/REVOKE[^;]*\bON\s+public\.marketing_recipients\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/GRANT[^;]*\bON\s+public\.marketing_opportunities\b/i.test(FLAT_EXEC)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// (34,35,36) Transaction atomicity, advisory lock, lock_timeout
// -----------------------------------------------------------------------------
describe('017 linkage — transaction, advisory lock, timeouts (34,35,36)', () => {
  it('runs inside a single BEGIN/COMMIT transaction', () => {
    expect(FLAT_EXEC).toMatch(/^\s*BEGIN;/)
    expect(FLAT_EXEC).toMatch(/COMMIT;\s*$/)
    const begins = FLAT_EXEC.match(/(?:^|\s)BEGIN;/g) || []
    const commits = FLAT_EXEC.match(/COMMIT;/g) || []
    expect(begins.length).toBe(1)
    expect(commits.length).toBe(1)
  })

  it('acquires a migration-specific advisory transaction lock', () => {
    expect(FLAT_EXEC).toMatch(
      /pg_try_advisory_xact_lock\(\s*hashtext\('wtf_marketing_stage_3d0_recipient_opportunity_linkage'\)\s*\)/i,
    )
  })

  it('sets a lock_timeout and a statement_timeout', () => {
    expect(FLAT_EXEC).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT_EXEC).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('has NO exception-swallowing handler', () => {
    expect(/\bEXCEPTION\s+WHEN\b/i.test(EXEC)).toBe(false)
  })
})
