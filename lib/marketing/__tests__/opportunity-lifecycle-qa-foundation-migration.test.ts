import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/015-marketing-opportunity-lifecycle-qa-foundation.sql
//
// These tests treat the migration as STATIC TEXT: they never open a database
// connection, never execute SQL, and never mutate anything. They prove Stage
// 3C2H installs three service-role-only RPCs (read-only overview, anonymised QA
// sample, bounded lifecycle maintenance), that installation itself performs no
// opportunity INSERT/UPDATE/DELETE, that the ONLY opportunity UPDATE lives
// inside the maintenance function body, that maintenance only ever transitions
// open/deferred -> expired under an expires_at<=now() + sending-off gate, and
// that no PII is exposed.
// ---------------------------------------------------------------------------

const CODE = readFileSync(
  join(process.cwd(), 'scripts/marketing/015-marketing-opportunity-lifecycle-qa-foundation.sql'),
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

// Install-level executable text = executable SQL with EVERY dollar-quoted block
// ($preflight$...$preflight$ and every $$...$$ function body) removed. What
// remains is exactly the statements the migration runs at install time:
// BEGIN, SET, the DO/CREATE FUNCTION headers, COMMENT, REVOKE, GRANT, COMMIT.
const INSTALL_EXEC = EXEC.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' <<DOLLAR_BLOCK>> ')
const FLAT_INSTALL_EXEC = INSTALL_EXEC.replace(/\s+/g, ' ')

// Extract a single CREATE OR REPLACE FUNCTION body (between its AS $$ and $$;).
function fnBody(name: string): string {
  const headIdx = EXEC.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  if (headIdx < 0) return ''
  const asIdx = EXEC.indexOf('AS $$', headIdx)
  if (asIdx < 0) return ''
  const endIdx = EXEC.indexOf('$$;', asIdx)
  if (endIdx < 0) return ''
  return EXEC.slice(asIdx + 'AS $$'.length, endIdx)
}

const OVERVIEW_BODY = fnBody('get_admin_marketing_opportunity_ledger_overview()')
const SAMPLE_BODY = fnBody('get_admin_marketing_opportunity_qa_sample(p_limit integer DEFAULT 25)')
const LIFECYCLE_BODY = fnBody('maintain_marketing_opportunity_lifecycle(p_limit integer DEFAULT 100)')
const FLAT_LIFECYCLE = LIFECYCLE_BODY.replace(/\s+/g, ' ')

// The install preflight DO block.
const _pfStart = EXEC.indexOf('DO $preflight$')
const _pfEnd = EXEC.indexOf('$preflight$;', _pfStart)
const PREFLIGHT_BODY = _pfStart >= 0 && _pfEnd >= 0 ? EXEC.slice(_pfStart, _pfEnd) : ''

describe('015 — file & transaction shape', () => {
  it('all three function bodies and the preflight are located', () => {
    expect(OVERVIEW_BODY.length).toBeGreaterThan(0)
    expect(SAMPLE_BODY.length).toBeGreaterThan(0)
    expect(LIFECYCLE_BODY.length).toBeGreaterThan(0)
    expect(PREFLIGHT_BODY.length).toBeGreaterThan(0)
  })

  it('runs inside a single BEGIN/COMMIT transaction with fail-fast timeouts', () => {
    expect(FLAT_EXEC).toMatch(/^\s*BEGIN;/)
    expect(FLAT_EXEC).toMatch(/COMMIT;\s*$/)
    expect((FLAT_EXEC.match(/(?:^|\s)BEGIN;/g) || []).length).toBe(1)
    expect((FLAT_EXEC.match(/COMMIT;/g) || []).length).toBe(1)
    expect(FLAT_EXEC).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT_EXEC).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })
})

describe('015 — installation is INERT (no opportunity DML at install level)', () => {
  // Requirements 1, 2, 3.
  it('contains NO executable opportunity INSERT at install level', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_opportunities/i.test(FLAT_INSTALL_EXEC)).toBe(false)
  })

  it('contains NO executable opportunity UPDATE OUTSIDE the lifecycle function body', () => {
    expect(/UPDATE\s+public\.marketing_opportunities/i.test(FLAT_INSTALL_EXEC)).toBe(false)
    // Nor in the two read-only function bodies or the preflight.
    expect(/UPDATE\s+public\.marketing_opportunities/i.test(OVERVIEW_BODY)).toBe(false)
    expect(/UPDATE\s+public\.marketing_opportunities/i.test(SAMPLE_BODY)).toBe(false)
    expect(/UPDATE\s+public\.marketing_opportunities/i.test(PREFLIGHT_BODY)).toBe(false)
  })

  it('contains NO DELETE against marketing_opportunities anywhere', () => {
    expect(/DELETE\s+FROM\s+public\.marketing_opportunities/i.test(EXEC)).toBe(false)
  })

  it('performs NO control-state or definition mutation anywhere', () => {
    expect(/UPDATE\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
    expect(/UPDATE\s+public\.marketing_opportunity_definitions/i.test(EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_opportunity_definitions/i.test(EXEC)).toBe(false)
  })

  it('does NOT invoke the maintenance RPC at install (no executable call)', () => {
    // The only textual occurrences are the CREATE header, the COMMENT, and the
    // REVOKE/GRANT — never a SELECT/PERFORM invocation.
    expect(/(SELECT|PERFORM)\s+[^;]*maintain_marketing_opportunity_lifecycle\s*\(/i.test(EXEC_NOSTR)).toBe(
      false,
    )
  })

  it('the ONLY UPDATE marketing_opportunities in the whole file is inside the lifecycle body', () => {
    const all = (EXEC.match(/UPDATE\s+public\.marketing_opportunities/gi) || []).length
    const inLifecycle = (LIFECYCLE_BODY.match(/UPDATE\s+public\.marketing_opportunities/gi) || []).length
    expect(all).toBe(1)
    expect(inLifecycle).toBe(1)
  })
})

describe('015 — install-time preflight (canary + safety)', () => {
  // Requirement 24.
  it('asserts required dependencies exist (via a to_regclass check over the dependency list)', () => {
    expect(PREFLIGHT_BODY).toMatch(/to_regclass\(v_dep\)\s+IS NULL/i)
    expect(PREFLIGHT_BODY).toMatch(/'public\.marketing_opportunities'/i)
    expect(PREFLIGHT_BODY).toMatch(/'public\.marketing_control_state'/i)
    expect(PREFLIGHT_BODY).toMatch(/'public\.marketing_opportunity_definitions'/i)
  })

  it('asserts the paused production safety state', () => {
    expect(PREFLIGHT_BODY).toMatch(/sending_enabled/i)
    expect(PREFLIGHT_BODY).toMatch(/discovery_enabled/i)
    expect(PREFLIGHT_BODY).toMatch(/rollout_limit/i)
    expect(PREFLIGHT_BODY).toMatch(/enabled\s*=\s*true/i)
  })

  it('asserts EXACTLY one ledger row (the canary) and confirms it structurally', () => {
    expect(PREFLIGHT_BODY).toMatch(/count\(\*\)\s+INTO\s+v_opp_count\s+FROM\s+public\.marketing_opportunities/i)
    expect(PREFLIGHT_BODY).toMatch(/v_opp_count\s*<>\s*1/i)
    expect(PREFLIGHT_BODY).toMatch(/opportunity_type = 'new_account_no_purchase'/i)
    expect(PREFLIGHT_BODY).toMatch(/state = 'open'/i)
    expect(PREFLIGHT_BODY).toMatch(/campaign_id IS NULL/i)
    expect(PREFLIGHT_BODY).toMatch(/user_id IS NOT NULL/i)
    expect(PREFLIGHT_BODY).toMatch(/external_contact_id IS NULL/i)
  })

  it('does NOT couple the preflight to a specific score value', () => {
    expect(/score\s*=\s*350/i.test(PREFLIGHT_BODY)).toBe(false)
  })

  it('aborts via RAISE EXCEPTION on unexpected state', () => {
    expect(PREFLIGHT_BODY).toMatch(/RAISE EXCEPTION/i)
  })

  it('acquires an install-specific advisory lock', () => {
    expect(PREFLIGHT_BODY).toMatch(
      /pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2h_lifecycle_qa_foundation'\)\)/i,
    )
  })
})

describe('015 — Part A: ledger overview RPC', () => {
  // Requirements 4, 8, 22.
  it('is STABLE, SECURITY DEFINER, fixed search_path', () => {
    const head = EXEC.slice(
      EXEC.indexOf('CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_ledger_overview'),
      EXEC.indexOf('AS $$', EXEC.indexOf('get_admin_marketing_opportunity_ledger_overview')),
    )
    expect(head).toMatch(/\bSTABLE\b/)
    expect(head).toMatch(/SECURITY DEFINER/)
    expect(head).toMatch(/SET search_path = public, pg_temp/)
  })

  it('is READ-ONLY (no INSERT/UPDATE/DELETE in its body)', () => {
    expect(/\b(INSERT|UPDATE|DELETE)\b/i.test(OVERVIEW_BODY)).toBe(false)
  })

  it('exposes control state, definition and ledger aggregates', () => {
    expect(OVERVIEW_BODY).toMatch(/'sendingEnabled'/)
    expect(OVERVIEW_BODY).toMatch(/'discoveryEnabled'/)
    expect(OVERVIEW_BODY).toMatch(/'rolloutLimit'/)
    expect(OVERVIEW_BODY).toMatch(/'maximumBatchSize'/)
    expect(OVERVIEW_BODY).toMatch(/'enabledDefinitions'/)
    expect(OVERVIEW_BODY).toMatch(/'totalDefinitions'/)
    expect(OVERVIEW_BODY).toMatch(/'activeNow'/)
    expect(OVERVIEW_BODY).toMatch(/'expiredButStateNotExpired'/)
    expect(OVERVIEW_BODY).toMatch(/'byOpportunityType'/)
    expect(OVERVIEW_BODY).toMatch(/'byState'/)
    expect(OVERVIEW_BODY).toMatch(/'priorityDistribution'/)
    expect(OVERVIEW_BODY).toMatch(/'nextExpiryAt'/)
    expect(OVERVIEW_BODY).toMatch(/'expiringWithin24h'/)
    expect(OVERVIEW_BODY).toMatch(/'expiringWithin7d'/)
  })

  it('activeNow / expiry windows require expires_at > now()', () => {
    expect(OVERVIEW_BODY).toMatch(/expires_at > v_now/i)
  })

  it('expiredButStateNotExpired counts only open/deferred past expiry', () => {
    expect(OVERVIEW_BODY).toMatch(
      /expires_at <= v_now AND state IN \('open', 'deferred'\)/i,
    )
  })

  it('exposes NO identities or raw payloads', () => {
    // Requirement 8: no raw identity/PII columns surfaced by the overview.
    // user_id / external_contact_id may appear ONLY inside aggregate NULL
    // predicates (…IS NOT NULL / …IS NULL), never as a selected/output value.
    expect(/email_lc/i.test(OVERVIEW_BODY)).toBe(false)
    expect(/dedupe_key/i.test(OVERVIEW_BODY)).toBe(false)
    // Every user_id occurrence must be immediately followed by IS [NOT] NULL.
    for (const m of OVERVIEW_BODY.match(/user_id\b[^\n]*/gi) || []) {
      expect(/^user_id\s+IS (NOT )?NULL/i.test(m.trim())).toBe(true)
    }
    for (const m of OVERVIEW_BODY.match(/external_contact_id\b[^\n]*/gi) || []) {
      expect(/^external_contact_id\s+IS (NOT )?NULL/i.test(m.trim())).toBe(true)
    }
    // No raw reason/context VALUE extraction in the aggregate overview.
    expect(/reason\s*->/i.test(OVERVIEW_BODY)).toBe(false)
    expect(/context_snapshot\s*->/i.test(OVERVIEW_BODY)).toBe(false)
  })
})

describe('015 overview — byOpportunityType is sourced DYNAMICALLY from the definition catalogue', () => {
  // Isolate the v_by_type assignment (from "INTO v_by_type" back to the SELECT
  // that feeds it) so these checks concern only the byOpportunityType build.
  const byTypeIdx = OVERVIEW_BODY.indexOf('INTO v_by_type')
  const beforeIdx = OVERVIEW_BODY.lastIndexOf('SELECT', byTypeIdx)
  // Extend to the terminating semicolon of that statement.
  const semiIdx = OVERVIEW_BODY.indexOf(';', byTypeIdx)
  const BY_TYPE_SQL = OVERVIEW_BODY.slice(beforeIdx, semiIdx + 1)

  it('reads the type list from public.marketing_opportunity_definitions (not a hardcoded catalogue)', () => {
    expect(byTypeIdx).toBeGreaterThan(-1)
    expect(/FROM\s+public\.marketing_opportunity_definitions\s+d/i.test(BY_TYPE_SQL)).toBe(true)
    // Aggregates each definition's opportunity_key.
    expect(/jsonb_object_agg\(\s*d\.opportunity_key/i.test(BY_TYPE_SQL)).toBe(true)
  })

  it('joins persisted counts by opportunity_type = opportunity_key', () => {
    expect(/opportunity_type,\s*count\(\*\)::bigint\s+AS\s+cnt/i.test(BY_TYPE_SQL)).toBe(true)
    expect(/FROM\s+public\.marketing_opportunities/i.test(BY_TYPE_SQL)).toBe(true)
    expect(/ON\s+c\.opportunity_type\s*=\s*d\.opportunity_key/i.test(BY_TYPE_SQL)).toBe(true)
  })

  it('retains zero-count definitions via LEFT JOIN + COALESCE', () => {
    expect(/LEFT JOIN/i.test(BY_TYPE_SQL)).toBe(true)
    expect(/COALESCE\(\s*c\.cnt,\s*0\s*\)/i.test(BY_TYPE_SQL)).toBe(true)
  })

  it('orders deterministically by opportunity_key', () => {
    expect(/ORDER BY\s+d\.opportunity_key/i.test(BY_TYPE_SQL)).toBe(true)
  })

  it('has NO hardcoded six-type VALUES catalogue anywhere in the overview', () => {
    // The obsolete VALUES(...) AS t(type) catalogue must be gone entirely.
    expect(/AS\s+t\(type\)/i.test(OVERVIEW_BODY)).toBe(false)
    expect(/VALUES\s*\(\s*'vip_early_access'/i.test(OVERVIEW_BODY)).toBe(false)
  })

  it('does NOT hardcode any of the obsolete opportunity keys in the byOpportunityType build', () => {
    for (const key of [
      'vip_early_access',
      'abandoned_checkout',
      'wtf_credit_waiting',
      'regular_buyer_campaign_alert',
      'new_account_no_purchase',
      'lapsed_14_days',
    ]) {
      expect(BY_TYPE_SQL.includes(`'${key}'`)).toBe(false)
    }
  })
})

describe('015 — Part B: QA sample RPC', () => {
  // Requirements 5, 6, 7, 22.
  it('is STABLE, SECURITY DEFINER, fixed search_path, defaults to 25', () => {
    const head = EXEC.slice(
      EXEC.indexOf('CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_qa_sample'),
      EXEC.indexOf('AS $$', EXEC.indexOf('get_admin_marketing_opportunity_qa_sample')),
    )
    expect(head).toMatch(/p_limit integer DEFAULT 25/)
    expect(head).toMatch(/\bSTABLE\b/)
    expect(head).toMatch(/SECURITY DEFINER/)
    expect(head).toMatch(/SET search_path = public, pg_temp/)
  })

  it('is READ-ONLY (no INSERT/UPDATE/DELETE in its body)', () => {
    expect(/\b(INSERT|UPDATE|DELETE)\b/i.test(SAMPLE_BODY)).toBe(false)
  })

  it('clamps the limit to 1..100', () => {
    expect(SAMPLE_BODY).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 100\)/)
  })

  it('orders deterministically newest-first with id tie-break', () => {
    expect(SAMPLE_BODY).toMatch(/ORDER BY o\.detected_at DESC, o\.id ASC/i)
  })

  it('exposes an opaque customer hash, never a raw id', () => {
    expect(SAMPLE_BODY).toMatch(/substr\(md5\(COALESCE\(s\.user_id::text, s\.external_contact_id::text\)\), 1, 12\)/i)
    expect(SAMPLE_BODY).toMatch(/'customerHash'/)
  })

  it('exposes reason/context KEY NAMES only, not raw values', () => {
    expect(SAMPLE_BODY).toMatch(/jsonb_object_keys\(s\.reason\)/i)
    expect(SAMPLE_BODY).toMatch(/jsonb_object_keys\(s\.context_snapshot\)/i)
    expect(SAMPLE_BODY).toMatch(/'reasonKeys'/)
    expect(SAMPLE_BODY).toMatch(/'contextKeys'/)
  })

  it('does NOT return email, dedupe key, or a raw id field', () => {
    expect(/email_lc/i.test(SAMPLE_BODY)).toBe(false)
    expect(/dedupe_key/i.test(SAMPLE_BODY)).toBe(false)
    // No JSON key literally named user_id / external_contact_id (raw id output).
    expect(/'user_id'/i.test(SAMPLE_BODY)).toBe(false)
    expect(/'external_contact_id'/i.test(SAMPLE_BODY)).toBe(false)
    expect(/'raw/i.test(SAMPLE_BODY)).toBe(false)
  })

  it('exposes only SAFE scalar fields and identity-shape booleans', () => {
    expect(SAMPLE_BODY).toMatch(/'opportunityType'/)
    expect(SAMPLE_BODY).toMatch(/'state'/)
    expect(SAMPLE_BODY).toMatch(/'basePriority'/)
    expect(SAMPLE_BODY).toMatch(/'score'/)
    expect(SAMPLE_BODY).toMatch(/'hoursRemaining'/)
    expect(SAMPLE_BODY).toMatch(/'campaignContext'/)
    expect(SAMPLE_BODY).toMatch(/'hasUserIdentity'/)
    expect(SAMPLE_BODY).toMatch(/'hasExternalIdentity'/)
  })
})

describe('015 — Part C: lifecycle maintenance RPC', () => {
  it('is VOLATILE, SECURITY DEFINER, fixed search_path, defaults to 100', () => {
    // Requirements 9, 22.
    const head = EXEC.slice(
      EXEC.indexOf('CREATE OR REPLACE FUNCTION public.maintain_marketing_opportunity_lifecycle'),
      EXEC.indexOf('AS $$', EXEC.indexOf('maintain_marketing_opportunity_lifecycle')),
    )
    expect(head).toMatch(/p_limit integer DEFAULT 100/)
    expect(head).toMatch(/\bVOLATILE\b/)
    expect(head).toMatch(/SECURITY DEFINER/)
    expect(head).toMatch(/SET search_path = public, pg_temp/)
  })

  it('hard-caps the limit at 1..500', () => {
    // Requirement 10.
    expect(LIFECYCLE_BODY).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 100\), 1\), 500\)/)
  })

  it('only expires rows whose expires_at <= now()', () => {
    // Requirement 11.
    expect(FLAT_LIFECYCLE).toMatch(/expires_at <= v_now/i)
  })

  it('only transitions the approved auto-expirable states open/deferred', () => {
    // Requirement 12.
    const stateInMatches = LIFECYCLE_BODY.match(/state IN \([^)]*\)/gi) || []
    expect(stateInMatches.length).toBeGreaterThanOrEqual(2)
    for (const clause of stateInMatches) {
      expect(clause).toMatch(/'open'/)
      expect(clause).toMatch(/'deferred'/)
      // No terminal/reserved states in the eligibility/update predicate.
      expect(/'selected'/i.test(clause)).toBe(false)
      expect(/'suppressed'/i.test(clause)).toBe(false)
      expect(/'superseded'/i.test(clause)).toBe(false)
      expect(/'actioned'/i.test(clause)).toBe(false)
      expect(/'expired'/i.test(clause)).toBe(false)
    }
  })

  it('never changes actioned/superseded/suppressed and leaves selected untouched', () => {
    // Requirements 13, 14. The maintenance body's mutation predicate must not
    // reference these states as expirable.
    expect(/SET\s+state\s*=\s*'(actioned|superseded|suppressed|selected|open|deferred)'/i.test(LIFECYCLE_BODY)).toBe(
      false,
    )
  })

  it('the ONLY state transition is -> expired', () => {
    // Requirement 15.
    const sets = LIFECYCLE_BODY.match(/SET\s+state\s*=\s*'[a-z_]+'/gi) || []
    expect(sets.length).toBe(1)
    expect(sets[0]).toMatch(/SET\s+state\s*=\s*'expired'/i)
  })

  it('uses a bounded, SET-BASED UPDATE (no per-row loop)', () => {
    // Requirement 16.
    expect(FLAT_LIFECYCLE).toMatch(/WITH eligible AS \([\s\S]*LIMIT v_effective_limit[\s\S]*\)\s*UPDATE public\.marketing_opportunities/i)
    expect(/\bLOOP\b/i.test(LIFECYCLE_BODY)).toBe(false)
    expect(/\bFOR\b\s+\w+\s+IN/i.test(LIFECYCLE_BODY)).toBe(false)
  })

  it('uses deterministic expiry ordering', () => {
    // Requirement 17.
    expect(FLAT_LIFECYCLE).toMatch(/ORDER BY expires_at ASC, detected_at ASC, id ASC/i)
  })

  it('acquires a lifecycle-specific advisory lock and returns status=locked on contention', () => {
    // Requirement 18.
    expect(LIFECYCLE_BODY).toMatch(
      /pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2h_lifecycle_maintenance'\)\)/i,
    )
    expect(LIFECYCLE_BODY).toMatch(/'status', 'locked'/)
    // Distinct from the discovery run lock.
    expect(/wtf_marketing_stage_3c2f_discovery_run/i.test(LIFECYCLE_BODY)).toBe(false)
  })

  it('gates on sending_enabled=false (status=sending_active otherwise)', () => {
    // Requirement 19.
    expect(LIFECYCLE_BODY).toMatch(/sending_enabled INTO v_sending/i)
    expect(LIFECYCLE_BODY).toMatch(/v_sending IS DISTINCT FROM false/i)
    expect(LIFECYCLE_BODY).toMatch(/'status', 'sending_active'/)
  })

  it('does NOT require discovery_enabled=false to run maintenance', () => {
    // The maintenance body reads only sending_enabled, never discovery_enabled.
    expect(/discovery_enabled/i.test(LIFECYCLE_BODY)).toBe(false)
  })

  it('does NOT mutate control state or definitions', () => {
    // Requirement 20.
    expect(/UPDATE\s+public\.marketing_control_state/i.test(LIFECYCLE_BODY)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(LIFECYCLE_BODY)).toBe(false)
    expect(/marketing_opportunity_definitions/i.test(LIFECYCLE_BODY)).toBe(false)
  })

  it('returns the required result contract fields', () => {
    for (const key of [
      "'ok'",
      "'status'",
      "'considered'",
      "'updated'",
      "'requestedLimit'",
      "'effectiveLimit'",
      "'generatedAt'",
      "'durationMs'",
    ]) {
      expect(LIFECYCLE_BODY.includes(key)).toBe(true)
    }
  })

  it('never creates opportunities (no INSERT into the ledger in the body)', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_opportunities/i.test(LIFECYCLE_BODY)).toBe(false)
  })
})

describe('015 — security & grants for all three RPCs', () => {
  // Requirement 22.
  const fns = [
    'get_admin_marketing_opportunity_ledger_overview()',
    'get_admin_marketing_opportunity_qa_sample(integer)',
    'maintain_marketing_opportunity_lifecycle(integer)',
  ]
  for (const fn of fns) {
    it(`${fn} revokes public/anon/authenticated and grants only service_role`, () => {
      const esc = fn.replace(/[()]/g, '\\$&')
      const revoke = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${esc} FROM public, anon, authenticated`,
        'i',
      )
      const grant = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO service_role`, 'i')
      expect(revoke.test(FLAT_EXEC)).toBe(true)
      expect(grant.test(FLAT_EXEC)).toBe(true)
    })
  }

  it('does not alter RLS policies or the opportunities table structure', () => {
    // Requirements 23, 25 (schema).
    expect(/CREATE POLICY/i.test(EXEC)).toBe(false)
    expect(/DROP POLICY/i.test(EXEC)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_opportunities/i.test(EXEC)).toBe(false)
    expect(/ADD COLUMN/i.test(EXEC)).toBe(false)
  })
})

describe('015 — no discovery/sending/recipient/run/email/AI/cron behaviour', () => {
  // Requirements 21, 23.
  it('does not enable discovery/sending or change rollout/definitions', () => {
    expect(/SET\s+discovery_enabled\s*=\s*true/i.test(EXEC_NOSTR)).toBe(false)
    expect(/SET\s+sending_enabled\s*=\s*true/i.test(EXEC_NOSTR)).toBe(false)
    expect(/SET\s+rollout_limit\s*=/i.test(EXEC_NOSTR)).toBe(false)
    expect(/SET\s+enabled\s*=\s*true/i.test(EXEC_NOSTR)).toBe(false)
  })

  it('does not reference recipients/runs/resend/cron/AI or forbidden operational scans', () => {
    expect(/marketing_recipients|marketing_runs|marketing_automation_runs/i.test(EXEC)).toBe(false)
    expect(/resend|cron|pg_cron|openai|anthropic|ai_/i.test(EXEC_NOSTR)).toBe(false)
    expect(/checkout_intents|instant_win_awards|wallet_transactions|auth\.users/i.test(EXEC)).toBe(false)
  })

  it('does not call the discovery RPC or create new state values', () => {
    expect(/discover_marketing_opportunities/i.test(EXEC)).toBe(false)
    // No new CHECK constraint introducing states.
    expect(/CHECK\s*\(\s*state\s+IN/i.test(EXEC)).toBe(false)
  })
})
