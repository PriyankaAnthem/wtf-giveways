import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/013-marketing-opportunity-discovery-foundation.sql
//
// These tests treat the migration as STATIC TEXT. They never open a database
// connection, never execute SQL, and never mutate anything. They assert that
// the Stage 3C2F persistence engine installs INERTLY, persists only inside the
// explicitly invoked discovery RPC, is correctly gated, bounded, set-based,
// idempotent against the EXISTING schema, service_role-only, and changes no
// control/definition/send state.
// ---------------------------------------------------------------------------

const CODE = readFileSync(
  join(process.cwd(), 'scripts/marketing/013-marketing-opportunity-discovery-foundation.sql'),
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
// behaviour bans cannot be satisfied by prose inside COMMENT ON / RAISE strings.
const EXEC_NOSTR = EXEC.replace(/'(?:[^']|'')*'/g, "''")

// The discovery function body, isolated between the AS $$ ... $$ delimiters of
// the executable text. Persistence must live ENTIRELY inside this body.
const _bodyStart = FLAT_EXEC.indexOf('AS $$')
const _bodyEnd = FLAT_EXEC.indexOf('$$;', _bodyStart)
const FN_BODY = _bodyStart >= 0 && _bodyEnd >= 0 ? FLAT_EXEC.slice(_bodyStart, _bodyEnd) : ''

// The migration text OUTSIDE any function body (install-time statements): the
// executable text with the function body removed.
const OUTSIDE_FN =
  _bodyStart >= 0 && _bodyEnd >= 0
    ? FLAT_EXEC.slice(0, _bodyStart) + FLAT_EXEC.slice(_bodyEnd)
    : FLAT_EXEC

describe('013 discovery — transaction & inert install', () => {
  it('runs inside a single BEGIN/COMMIT transaction', () => {
    expect(FLAT_EXEC).toMatch(/^\s*BEGIN;/)
    expect(FLAT_EXEC).toMatch(/COMMIT;\s*$/)
  })

  it('sets LOCAL lock_timeout and statement_timeout for a busy production DB', () => {
    expect(FLAT_EXEC).toMatch(/SET LOCAL lock_timeout/i)
    expect(FLAT_EXEC).toMatch(/SET LOCAL statement_timeout/i)
  })

  it('creates exactly one function and only a TEMP working table (no persistent table)', () => {
    const creates = FLAT_EXEC.match(/CREATE (OR REPLACE )?FUNCTION/gi) || []
    expect(creates.length).toBe(1)
    // The only CREATE TABLE is the ON COMMIT DROP temp table in the body. Per
    // valid PostgreSQL syntax, CREATE TEMP TABLE is UNQUALIFIED (the temp schema
    // is chosen automatically); it must NOT be schema-qualified.
    const tableCreates = FLAT_EXEC.match(/CREATE\s+(TEMP\s+)?TABLE/gi) || []
    expect(tableCreates.length).toBe(1)
    expect(FN_BODY).toMatch(/CREATE TEMP TABLE tmp_disc_winners ON COMMIT DROP/i)
  })
})

describe('013 discovery — SECURITY DEFINER temp working table is explicitly pg_temp', () => {
  it('CREATE TEMP TABLE is UNQUALIFIED (valid PostgreSQL syntax)', () => {
    // A schema qualification on CREATE TEMP TABLE is a syntax error in Postgres.
    expect(FN_BODY).toMatch(/CREATE TEMP TABLE tmp_disc_winners ON COMMIT DROP AS/i)
    expect(/CREATE TEMP TABLE pg_temp\.tmp_disc_winners/i.test(FN_BODY)).toBe(false)
  })

  it('drops the temp working table with an explicit pg_temp qualification', () => {
    expect(FN_BODY).toMatch(/DROP TABLE IF EXISTS pg_temp\.tmp_disc_winners;/i)
    // No unqualified DROP of the working relation may remain.
    expect(/DROP TABLE IF EXISTS tmp_disc_winners\b/i.test(FN_BODY)).toBe(false)
  })

  it('creates it as a TEMP table (still supporting repeated same-transaction calls)', () => {
    expect(FN_BODY).toMatch(/CREATE TEMP TABLE tmp_disc_winners ON COMMIT DROP AS/i)
    // DROP IF EXISTS before CREATE keeps the function re-callable in one txn.
    const dropIdx = FN_BODY.indexOf('DROP TABLE IF EXISTS pg_temp.tmp_disc_winners')
    const createIdx = FN_BODY.indexOf('CREATE TEMP TABLE tmp_disc_winners')
    expect(dropIdx).toBeGreaterThan(0)
    expect(createIdx).toBeGreaterThan(dropIdx)
  })

  it('every reference AFTER creation is pg_temp-qualified (only the CREATE is unqualified)', () => {
    // Exactly ONE unqualified occurrence is allowed — the CREATE TEMP TABLE
    // statement itself. Every other reference (DROP, FROM, INTO) must be
    // immediately preceded by "pg_temp.".
    const re = /(pg_temp\.)?tmp_disc_winners/gi
    let m: RegExpExecArray | null
    const unqualified: string[] = []
    while ((m = re.exec(FN_BODY)) !== null) {
      if (!m[1]) {
        const preceding = FN_BODY.slice(Math.max(0, m.index - 24), m.index)
        // Allow the single unqualified CREATE TEMP TABLE reference.
        if (!/CREATE TEMP TABLE\s*$/i.test(preceding)) {
          unqualified.push(FN_BODY.slice(Math.max(0, m.index - 20), m.index + 20))
        }
      }
    }
    expect(unqualified).toEqual([])
  })

  it('creates NO persistent public.tmp_disc_winners (executable SQL only)', () => {
    // Check executable SQL, not comments: no CREATE/DROP/FROM/INTO of a
    // public-schema tmp_disc_winners relation may exist anywhere.
    expect(/public\.tmp_disc_winners/i.test(FLAT_EXEC)).toBe(false)
  })
})

describe('013 discovery — installation performs NO opportunity INSERT itself', () => {
  it('the only INSERT INTO marketing_opportunities lives inside the function body', () => {
    const allInserts = FLAT_EXEC.match(/INSERT INTO public\.marketing_opportunities/gi) || []
    expect(allInserts.length).toBe(1)
    // ...and it is inside the function body, not at migration top level.
    expect(FN_BODY).toMatch(/INSERT INTO public\.marketing_opportunities/i)
    expect(OUTSIDE_FN).not.toMatch(/INSERT INTO public\.marketing_opportunities/i)
  })

  it('performs no INSERT/UPDATE into control-state or definitions at install time', () => {
    expect(OUTSIDE_FN).not.toMatch(/INSERT INTO public\.marketing_control_state/i)
    expect(OUTSIDE_FN).not.toMatch(/UPDATE public\.marketing_control_state/i)
    expect(OUTSIDE_FN).not.toMatch(/INSERT INTO public\.marketing_opportunity_definitions/i)
    expect(OUTSIDE_FN).not.toMatch(/UPDATE public\.marketing_opportunity_definitions/i)
  })
})

describe('013 discovery — persistence occurs ONLY inside the invoked RPC', () => {
  it('defines the bounded discovery RPC discover_marketing_opportunities(p_limit)', () => {
    expect(FLAT_EXEC).toMatch(
      /CREATE OR REPLACE FUNCTION public\.discover_marketing_opportunities\(p_limit integer DEFAULT 100\)/i,
    )
  })

  it('the INSERT is inside discover_marketing_opportunities, not a free-standing statement', () => {
    // Function body contains the persistence; there is no top-level INSERT.
    expect(FN_BODY).toMatch(/INSERT INTO public\.marketing_opportunities/i)
  })
})

describe('013 discovery — discovery_enabled gate required before writes', () => {
  it('reads discovery_enabled, rollout_limit and maximum_batch_size in ONE query from the singleton', () => {
    expect(FN_BODY).toMatch(
      /SELECT discovery_enabled, rollout_limit, maximum_batch_size\s+INTO v_discovery, v_rollout, v_max_batch\s+FROM public\.marketing_control_state\s+WHERE key = 'default'/i,
    )
  })

  it('short-circuits to discovery_disabled with zero inserts when not enabled', () => {
    expect(FLAT).toMatch(/'status', 'discovery_disabled'/)
    expect(FN_BODY).toMatch(/v_discovery IS DISTINCT FROM true/i)
  })

  it('does NOT require sending_enabled for discovery', () => {
    // The gate checks discovery only; sending_enabled is never read in the body.
    expect(FN_BODY).not.toMatch(/sending_enabled/i)
  })
})

describe('013 discovery — global control ceilings (rollout_limit + maximum_batch_size)', () => {
  it('fails CLOSED when the control-state singleton is missing', () => {
    expect(FN_BODY).toMatch(/IF NOT FOUND THEN/i)
    expect(FLAT).toMatch(/'status', 'control_state_missing'/)
    // The fail-closed branch must be marked ok:false (a refusal, not a success).
    expect(FN_BODY).toMatch(/'ok', false,\s*'status', 'control_state_missing'/i)
  })

  it('rollout_limit <= 0 is an INDEPENDENT hard stop even if discovery could run', () => {
    expect(FN_BODY).toMatch(/COALESCE\(v_rollout, 0\) <= 0/i)
    expect(FLAT).toMatch(/'status', 'rollout_disabled'/)
    // The rollout gate is evaluated AFTER the discovery gate but is its own IF,
    // so rollout_limit=0 blocks writes regardless of discovery_enabled.
    const rolloutIdx = FN_BODY.indexOf('rollout_disabled')
    const insertIdx = FN_BODY.indexOf('INSERT INTO public.marketing_opportunities')
    expect(rolloutIdx).toBeGreaterThan(0)
    expect(rolloutIdx).toBeLessThan(insertIdx)
  })

  it('reads maximum_batch_size and rollout_limit from control state', () => {
    expect(FN_BODY).toMatch(/INTO v_discovery, v_rollout, v_max_batch/i)
  })

  it('effective INSERT limit is LEAST(requested, maximum_batch_size, rollout_limit)', () => {
    expect(FN_BODY).toMatch(
      /v_effective_limit := LEAST\(v_requested_limit, v_max_batch, v_rollout\)/i,
    )
  })

  it('requested limit remains hard-capped at [1,500] before the ceilings apply', () => {
    expect(FN_BODY).toMatch(
      /v_requested_limit\s+integer := LEAST\(GREATEST\(COALESCE\(p_limit, 100\), 1\), 500\)/i,
    )
  })

  it('no code path can bypass rollout_limit or maximum_batch_size', () => {
    // The ONLY LIMIT feeding the INSERT is the effective (LEAST) limit.
    const limits = FN_BODY.match(/LIMIT v_\w+/gi) || []
    expect(limits.length).toBe(1)
    expect(limits[0]).toMatch(/LIMIT v_effective_limit/i)
  })

  it('returns the config-only ceiling fields (no identity)', () => {
    for (const key of ["'requestedLimit'", "'effectiveLimit'", "'rolloutLimit'", "'maximumBatchSize'"]) {
      expect(FLAT.includes(key)).toBe(true)
    }
  })
})

describe('013 discovery — per-definition enabled=true required before writes', () => {
  it('joins definitions and requires enabled = true for eligibility', () => {
    expect(FLAT_EXEC).toMatch(/JOIN public\.marketing_opportunity_definitions/i)
    expect(FN_BODY).toMatch(/d\.enabled, false\) = true/i)
  })
})

describe('013 discovery — only rn = 1 winners are persisted', () => {
  it('filters the detector output to rn = 1', () => {
    expect(FN_BODY).toMatch(/WHERE c\.rn = 1/i)
  })
})

describe('013 discovery — permission / sendability does NOT filter discovery', () => {
  it('never filters candidates on permission or sendability signals', () => {
    for (const banned of [
      'perm_backed',
      'perm_suppressed',
      'perm_not_backed',
      'sendable_now',
      'marketing_enabled',
      'marketing_eligible_snapshot',
    ]) {
      expect(FN_BODY.includes(banned)).toBe(false)
    }
  })
})

describe('013 discovery — bounded execution', () => {
  it('p_limit defaults to 100', () => {
    expect(FLAT_EXEC).toMatch(/p_limit integer DEFAULT 100/i)
  })

  it('clamps p_limit to a hard maximum of 500 (and minimum of 1)', () => {
    expect(FN_BODY).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 100\), 1\), 500\)/i)
  })

  it('applies the EFFECTIVE limit (not the raw requested limit) to the persisted set', () => {
    expect(FN_BODY).toMatch(/LIMIT v_effective_limit/i)
    // The raw requested-limit variable must NOT be what the INSERT limits by.
    expect(/LIMIT v_requested_limit\b/i.test(FN_BODY)).toBe(false)
    expect(/LIMIT v_limit\b/i.test(FN_BODY)).toBe(false)
  })

  it('orders PRIORITY-FIRST before limiting (default_priority ASC, final_score DESC, user_id ASC)', () => {
    expect(FN_BODY).toMatch(
      /ORDER BY w\.default_priority ASC, w\.final_score DESC, w\.user_id ASC/i,
    )
  })

  it('does NOT use score-first ordering', () => {
    // The pre-patch score-first order must be gone: a Priority 1 winner must be
    // admitted to the bounded batch ahead of Priority 2/3/4 winners.
    expect(/ORDER BY w\.final_score DESC, w\.default_priority ASC/i.test(FN_BODY)).toBe(false)
  })
})

describe('013 discovery — set-based, no per-customer loop, no history scan', () => {
  it('uses a single set-based INSERT ... SELECT (no LOOP)', () => {
    expect(FN_BODY).toMatch(/INSERT INTO public\.marketing_opportunities[\s\S]*SELECT/i)
    expect(/\bLOOP\b/i.test(FN_BODY)).toBe(false)
    expect(/\bFOR\b\s+\w+\s+IN/i.test(FN_BODY)).toBe(false)
  })

  it('reuses the 011 detector and does not re-scan operational history', () => {
    expect(FN_BODY).toMatch(/public\.wtf_marketing_opportunity_candidates_preview\(\)/i)
    for (const banned of [
      'checkout_intents',
      'instant_win_awards',
      'wallet_transactions',
      'auth.users',
    ]) {
      expect(FLAT_EXEC.includes(banned)).toBe(false)
    }
  })
})

describe('013 discovery — campaign_specific invariant preserved', () => {
  it('requires campaign_id when the definition is campaign_specific', () => {
    expect(FN_BODY).toMatch(
      /campaign_specific, false\) = false OR c\.campaign_id IS NOT NULL/i,
    )
  })

  it('persists the candidate real campaign_id (not invented)', () => {
    expect(FN_BODY).toMatch(/tp\.campaign_id/i)
  })
})

describe('013 discovery — idempotency / dedupe uses the EXISTING schema', () => {
  it('relies on ON CONFLICT (dedupe_key) against the existing unique index', () => {
    expect(FN_BODY).toMatch(/ON CONFLICT \(dedupe_key\) DO NOTHING/i)
  })

  it('guards against duplicate ACTIVE opportunities via NOT EXISTS', () => {
    expect(FN_BODY).toMatch(/NOT EXISTS/i)
    expect(FN_BODY).toMatch(/o\.state IN \('open', 'selected', 'deferred'\)/i)
    expect(FN_BODY).toMatch(/o\.campaign_id IS NOT DISTINCT FROM/i)
  })

  it('builds a deterministic, EXPIRY-WINDOW-bucketed dedupe_key (NOT calendar-day)', () => {
    expect(FN_BODY).toMatch(/'discv1:'/)
    // The calendar-day bucket must be GONE.
    expect(/to_char\([^)]*YYYYMMDD/i.test(FN_BODY)).toBe(false)
    expect(/YYYYMMDD/i.test(CODE)).toBe(false)
    // Bucket = floor(now_epoch / (default_expiry_hours * 3600)), so the window
    // length equals the opportunity's own lifetime.
    expect(FN_BODY).toMatch(
      /floor\(\s*extract\(epoch FROM v_now\)\s*\/\s*\(GREATEST\(tp\.default_expiry_hours, 1\) \* 3600\)\s*\)/i,
    )
  })

  it('the expiry-window bucket is driven by default_expiry_hours and works for a 1-hour definition', () => {
    // default_expiry_hours is the divisor basis (a 1-hour def rebuckets hourly);
    // GREATEST(...,1) guards the divisor so hours as low as 1 are valid.
    expect(FN_BODY).toMatch(/GREATEST\(tp\.default_expiry_hours, 1\) \* 3600/i)
  })

  it('does not create a new unique index or alter the opportunity schema', () => {
    expect(/CREATE\s+UNIQUE\s+INDEX/i.test(FLAT_EXEC)).toBe(false)
    expect(/ALTER\s+TABLE\s+public\.marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
  })
})

describe('013 discovery — advisory / concurrency protection', () => {
  it('serialises runs with a transaction advisory lock and returns locked when busy', () => {
    expect(FN_BODY).toMatch(/pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2f_discovery_run'\)\)/i)
    expect(FLAT).toMatch(/'status', 'locked'/)
  })

  it('sets lock_timeout and statement_timeout on the function', () => {
    expect(FLAT_EXEC).toMatch(/SET lock_timeout = '5s'/i)
    expect(FLAT_EXEC).toMatch(/SET statement_timeout = '30s'/i)
  })
})

describe('013 discovery — security: SECURITY DEFINER, service_role only', () => {
  it('is SECURITY DEFINER with a fixed search_path', () => {
    expect(FLAT_EXEC).toMatch(/SECURITY DEFINER/i)
    expect(FLAT_EXEC).toMatch(/SET search_path = public, pg_temp/i)
  })

  it('revokes execute from public/anon/authenticated and grants only service_role', () => {
    expect(FLAT_EXEC).toMatch(
      /REVOKE ALL ON FUNCTION public\.discover_marketing_opportunities\(integer\) FROM public, anon, authenticated/i,
    )
    expect(FLAT_EXEC).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.discover_marketing_opportunities\(integer\) TO service_role/i,
    )
  })

  it('does not weaken RLS or grants on marketing_opportunities', () => {
    expect(/DISABLE ROW LEVEL SECURITY/i.test(FLAT_EXEC)).toBe(false)
    expect(/NO FORCE ROW LEVEL SECURITY/i.test(FLAT_EXEC)).toBe(false)
    expect(/GRANT[\s\S]*ON public\.marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/CREATE POLICY/i.test(FLAT_EXEC)).toBe(false)
  })
})

describe('013 discovery — control-state / definition enablement untouched', () => {
  it('never enables discovery, sending, definitions, or changes rollout_limit', () => {
    expect(/UPDATE public\.marketing_control_state/i.test(EXEC_NOSTR)).toBe(false)
    expect(/discovery_enabled\s*=\s*true/i.test(EXEC_NOSTR)).toBe(false)
    expect(/sending_enabled\s*=\s*true/i.test(EXEC_NOSTR)).toBe(false)
    expect(/rollout_limit\s*=\s*[1-9]/i.test(EXEC_NOSTR)).toBe(false)
    expect(/SET\s+enabled\s*=\s*true/i.test(EXEC_NOSTR)).toBe(false)
  })
})

describe('013 discovery — no recipient/run/email/cron/AI behaviour', () => {
  it('creates no recipients, runs, email, cron, or AI calls', () => {
    for (const banned of [
      'marketing_recipients',
      'marketing_runs',
      'resend',
      'cron',
      'openai',
      'ai_gateway',
    ]) {
      expect(FLAT_EXEC.toLowerCase().includes(banned)).toBe(false)
    }
  })
})

describe('013 discovery — identity: user-only, no external contact yet', () => {
  it('persists user_id and sets external_contact_id NULL (identity XOR preserved)', () => {
    expect(FN_BODY).toMatch(/tp\.user_id/i)
    // external_contact_id column is inserted as NULL.
    expect(FN_BODY).toMatch(/external_contact_id/i)
    expect(FN_BODY).not.toMatch(/marketing_external_contacts/i)
  })
})

describe('013 discovery — result contract returns no raw identity', () => {
  it('returns the required compact stat keys', () => {
    for (const key of [
      "'ok'",
      "'status'",
      "'evaluated'",
      "'eligible'",
      "'inserted'",
      "'skippedExisting'",
      "'skippedDisabledDefinition'",
      "'durationMs'",
      "'generatedAt'",
    ]) {
      expect(FLAT.includes(key)).toBe(true)
    }
  })

  it('the successful status=ok result exposes requested/effective/rollout/batch limits', () => {
    // Isolate the final successful RETURN payload (status = 'ok').
    const okReturns = (FN_BODY.match(/RETURN jsonb_build_object\([\s\S]*?\);/gi) || []).filter((r) =>
      /'status', 'ok'/.test(r),
    )
    expect(okReturns.length).toBe(1)
    const okReturn = okReturns[0]
    for (const kv of [
      /'requestedLimit', v_requested_limit/,
      /'effectiveLimit', v_effective_limit/,
      /'rolloutLimit', v_rollout/,
      /'maximumBatchSize', v_max_batch/,
    ]) {
      expect(kv.test(okReturn)).toBe(true)
    }
    // Existing stat fields remain present in the same payload.
    for (const kv of [/'inserted', v_inserted/, /'evaluated', v_evaluated/]) {
      expect(kv.test(okReturn)).toBe(true)
    }
  })

  it('EVERY result path exposes the config ceiling fields when available', () => {
    const allReturns = FN_BODY.match(/RETURN jsonb_build_object\([\s\S]*?\);/gi) || []
    expect(allReturns.length).toBeGreaterThanOrEqual(4)
    for (const r of allReturns) {
      expect(/'requestedLimit'/.test(r)).toBe(true)
      expect(/'effectiveLimit'/.test(r)).toBe(true)
      expect(/'rolloutLimit'/.test(r)).toBe(true)
      expect(/'maximumBatchSize'/.test(r)).toBe(true)
    }
  })

  it('never returns user_id or email in the result JSON', () => {
    // The RETURN jsonb_build_object payloads must not surface identities.
    const returns = FN_BODY.match(/RETURN jsonb_build_object\([\s\S]*?\);/gi) || []
    expect(returns.length).toBeGreaterThanOrEqual(3)
    for (const r of returns) {
      expect(/user_id/i.test(r)).toBe(false)
      expect(/email/i.test(r)).toBe(false)
    }
  })
})

describe('013 discovery — install-time preflight proves the hub is still paused/inert', () => {
  it('asserts required dependencies and the 011 detector exist', () => {
    for (const dep of [
      'public.marketing_opportunities',
      'public.marketing_opportunity_definitions',
      'public.marketing_control_state',
      'public.customer_marketing_profiles',
      'public.customer_marketing_intelligence',
      'public.customer_campaign_affinity',
    ]) {
      expect(FLAT.includes(dep)).toBe(true)
    }
    expect(FLAT_EXEC).toMatch(
      /to_regprocedure\('public\.wtf_marketing_opportunity_candidates_preview\(\)'\) IS NULL/i,
    )
  })

  it('requires paused control state (sending=false, discovery=false, rollout=0)', () => {
    expect(FN_PREFLIGHT()).toMatch(/v_sending IS DISTINCT FROM false/i)
    expect(FN_PREFLIGHT()).toMatch(/v_discovery IS DISTINCT FROM false/i)
    expect(FN_PREFLIGHT()).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
  })

  it('requires zero enabled definitions and an empty opportunity ledger', () => {
    expect(FN_PREFLIGHT()).toMatch(/WHERE enabled = true/i)
    expect(FN_PREFLIGHT()).toMatch(/v_enabled_defs <> 0/i)
    expect(FN_PREFLIGHT()).toMatch(/count\(\*\) INTO v_opp_count FROM public\.marketing_opportunities/i)
    expect(FN_PREFLIGHT()).toMatch(/v_opp_count <> 0/i)
  })
})

// The install-time preflight DO block (first $preflight$ ... $preflight$).
function FN_PREFLIGHT(): string {
  const s = FLAT_EXEC.indexOf('$preflight$')
  const e = FLAT_EXEC.indexOf('$preflight$', s + 1)
  return s >= 0 && e >= 0 ? FLAT_EXEC.slice(s, e) : ''
}

describe('013 discovery — migrations 001-012 untouched', () => {
  it('references migrations 001-012 only as a dependency note, never edits them', () => {
    // This file only creates its own function; it does not DROP/ALTER earlier
    // objects. The only DROP is of its own pg_temp working table, which is
    // stripped before checking for any DROP of a permanent public object.
    const execNoTempDrop = EXEC.replace(/DROP TABLE IF EXISTS pg_temp\.tmp_disc_winners;?/i, '')
    expect(/DROP\s+(TABLE|FUNCTION)\s+public\./i.test(execNoTempDrop)).toBe(false)
    expect(/ALTER\s+TABLE\s+public\./i.test(FLAT_EXEC)).toBe(false)
  })
})
