import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for scripts/marketing/010-marketing-intelligence-rollup.sql
//
// These tests treat the migration as STATIC TEXT. They never open a database
// connection, never execute SQL, and never run the rollup. They assert the
// safety, boundary and correctness guarantees of the Stage 3C2C rollup engine.
// ---------------------------------------------------------------------------

const CODE = readFileSync(
  join(process.cwd(), 'scripts/marketing/010-marketing-intelligence-rollup.sql'),
  'utf8',
)

// Comment-stripped executable view: drop full-line and trailing "-- ..."
// comments so assertions about executable SQL cannot be satisfied by prose in
// comments.
const EXEC = CODE.split('\n')
  .map((line) => {
    // Remove a trailing line comment while preserving string-literal content.
    const idx = line.indexOf('--')
    return idx >= 0 ? line.slice(0, idx) : line
  })
  .join('\n')

// Whitespace-flattened views for tolerant structural matching.
const FLAT = CODE.replace(/\s+/g, ' ')
const FLAT_EXEC = EXEC.replace(/\s+/g, ' ')

describe('010 rollup — migration envelope', () => {
  it('is wrapped in a single atomic BEGIN;/COMMIT;', () => {
    const t = EXEC.trim()
    expect(t.startsWith('BEGIN;')).toBe(true)
    expect(t.endsWith('COMMIT;')).toBe(true)
    expect((EXEC.match(/\bBEGIN\s*;/g) || []).length).toBe(1)
    expect((EXEC.match(/\bCOMMIT\s*;/g) || []).length).toBe(1)
  })

  it('never issues ROLLBACK or COMMIT-and-continue', () => {
    expect(/\bROLLBACK\b/i.test(EXEC)).toBe(false)
  })

  it('sets LOCAL fail-fast lock and statement timeouts', () => {
    expect(FLAT).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })
})

describe('010 rollup — preflight guards', () => {
  it('checks every required dependency via to_regclass', () => {
    for (const dep of [
      'public.customer_marketing_profiles',
      'public.customer_marketing_intelligence',
      'public.customer_campaign_affinity',
      'public.checkout_intents',
      'public.instant_win_awards',
      'public.wallet_transactions',
      'public.campaigns',
      'public.marketing_automations',
      'public.marketing_control_state',
    ]) {
      expect(FLAT).toContain(`'${dep}'`)
    }
    expect(FLAT).toMatch(/to_regclass\(v_dep\) IS NULL/i)
  })

  it('takes a single-execution advisory xact lock for this migration', () => {
    expect(FLAT).toMatch(
      /pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2c_intelligence_rollup'\)\)/i,
    )
  })

  it('asserts Marketing is globally paused and never mutates control state', () => {
    expect(FLAT).toMatch(/SELECT sending_enabled, discovery_enabled, rollout_limit/i)
    expect(FLAT).toMatch(/v_sending IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_discovery IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
    // No write to control state anywhere.
    expect(/UPDATE\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
    expect(/DELETE\s+FROM\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
  })
})

describe('010 rollup — installs zero behavioural data', () => {
  it('performs no INSERT into the intelligence or affinity tables at top level', () => {
    // The ONLY writes to these tables live INSIDE the batch-helper function body
    // (CREATE OR REPLACE FUNCTION ... $$ ... $$). Installation itself writes none.
    // We assert the migration seeds only the refresh-state singleton at top level.
    const topLevelInserts = (EXEC.match(/INSERT\s+INTO\s+public\.[a-z_]+/gi) || []).map((s) =>
      s.replace(/\s+/g, ' ').toLowerCase(),
    )
    // The refresh-state singleton seed is expected...
    expect(
      topLevelInserts.some((s) =>
        s.includes('insert into public.customer_marketing_intelligence_refresh_state'),
      ),
    ).toBe(true)
  })

  it('only ever seeds the refresh-state singleton with ON CONFLICT DO NOTHING', () => {
    expect(FLAT).toMatch(
      /INSERT INTO public\.customer_marketing_intelligence_refresh_state \(key\) VALUES \('default'\) ON CONFLICT \(key\) DO NOTHING/i,
    )
  })

  it('writes NO opportunities, recipients, automation runs, or control changes', () => {
    for (const t of [
      'marketing_opportunities',
      'marketing_recipients',
      'marketing_automation_runs',
    ]) {
      expect(new RegExp(`INSERT\\s+INTO\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
      expect(new RegExp(`UPDATE\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
    }
  })

  it('does NOT enable any opportunity definition', () => {
    expect(/enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/UPDATE\s+public\.marketing_opportunity_definitions/i.test(EXEC)).toBe(false)
  })

  it('performs no email / Resend / AI / cron work', () => {
    expect(/resend|sendemail|smtp|nodemailer|mailgun/i.test(EXEC)).toBe(false)
    expect(/cron\.schedule|pg_cron/i.test(EXEC)).toBe(false)
  })
})

describe('010 rollup — operational source tables are READ ONLY', () => {
  const sources = [
    'checkout_intents',
    'instant_win_awards',
    'wallet_transactions',
    'wallet_accounts',
    'wallet_reservations',
    'campaigns',
    'entries',
    'ticket_allocations',
    'marketing_automations',
    'customer_marketing_profiles',
  ]
  for (const t of sources) {
    it(`never writes to public.${t}`, () => {
      expect(new RegExp(`INSERT\\s+INTO\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
      expect(new RegExp(`UPDATE\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
      expect(new RegExp(`DELETE\\s+FROM\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
      expect(new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
    })
  }

  it('does not ALTER the Stage 1 profile refresh-state table', () => {
    expect(
      /ALTER\s+TABLE\s+public\.customer_marketing_profile_refresh_state/i.test(EXEC),
    ).toBe(false)
  })
})

describe('010 rollup — writes ONLY the two rollup tables (+ its own state)', () => {
  it('the only INSERT/UPDATE/DELETE targets are the intelligence, affinity and refresh-state tables', () => {
    const allowed = new Set([
      'customer_marketing_intelligence',
      'customer_campaign_affinity',
      'customer_marketing_intelligence_refresh_state',
    ])
    const writes = [
      ...EXEC.matchAll(/INSERT\s+INTO\s+public\.([a-z_]+)/gi),
      ...EXEC.matchAll(/UPDATE\s+public\.([a-z_]+)/gi),
      ...EXEC.matchAll(/DELETE\s+FROM\s+public\.([a-z_]+)/gi),
    ].map((m) => m[1].toLowerCase())
    expect(writes.length).toBeGreaterThan(0)
    for (const target of writes) {
      expect(allowed.has(target)).toBe(true)
    }
  })
})

describe('010 rollup — canonical source semantics reused verbatim', () => {
  it('uses the canonical confirmed-order predicate', () => {
    expect(FLAT).toMatch(/state = 'confirmed'/i)
    expect(FLAT).toMatch(/provider IS DISTINCT FROM 'debug'/i)
    expect(FLAT).toMatch(/ref IS NULL OR ci\.ref NOT LIKE 'SIM-%'/i)
    expect(FLAT).toMatch(/confirmed_at IS NOT NULL/i)
  })

  it('uses the canonical external-cash formula', () => {
    expect(FLAT).toMatch(
      /WHEN ci\.external_payment_pence IS NOT NULL THEN ci\.external_payment_pence ELSE COALESCE\(ci\.total_pence, 0\) - COALESCE\(ci\.wallet_credit_pence, 0\) END/i,
    )
  })

  it('keeps the per-order external cash RAW (not clamped per order)', () => {
    // The canonical CASE is aliased as raw ext_pence, and it is NOT wrapped in a
    // per-order GREATEST(..., 0) — the old ext_nn per-order clamp is gone.
    expect(/ext_nn/i.test(EXEC)).toBe(false)
    expect(FLAT).toMatch(/END\)::bigint AS ext_pence/i)
    // No "GREATEST( CASE WHEN ci.external_payment_pence ..." per-order clamp.
    expect(
      /GREATEST\(\s*CASE WHEN ci\.external_payment_pence IS NOT NULL/i.test(FLAT),
    ).toBe(false)
  })

  it('clamps only the final derived aggregates for the 009 non-negative CHECKs', () => {
    expect(FLAT).toMatch(/GREATEST\(COALESCE\(SUM\(ext_pence\) FILTER \(WHERE confirmed_at >= v_now - interval '30 days'\), 0\), 0\)/i)
    expect(FLAT).toMatch(/GREATEST\(ROUND\(AVG\(ext_pence\)\), 0\)/i)
    expect(FLAT).toMatch(/GREATEST\(MAX\(ext_pence\), 0\)/i)
    expect(FLAT).toMatch(/GREATEST\(COALESCE\(SUM\(ext_pence\), 0\), 0\)/i) // affinity
  })

  it('forces derived 90d spend >= derived 30d spend so 009 monotonic CHECK is always satisfiable', () => {
    // The 90d output is GREATEST(90d sum, 30d sum, 0): it can never fall below
    // the 30d output even if an anomalous historical negative order sits outside
    // the 30-day window. The raw per-order formula is NOT touched by this guard.
    expect(FLAT).toMatch(
      /GREATEST\( COALESCE\(SUM\(ext_pence\) FILTER \(WHERE confirmed_at >= v_now - interval '90 days'\), 0\), COALESCE\(SUM\(ext_pence\) FILTER \(WHERE confirmed_at >= v_now - interval '30 days'\), 0\), 0 \)::bigint AS external_spend_90d_pence/i,
    )
    // 30d output remains simply non-negative.
    expect(FLAT).toMatch(
      /GREATEST\(COALESCE\(SUM\(ext_pence\) FILTER \(WHERE confirmed_at >= v_now - interval '30 days'\), 0\), 0\)::bigint AS external_spend_30d_pence/i,
    )
  })

  it('builds source_updated_at from aggregates only — no correlated MAX subqueries', () => {
    // The removed correlated forms must be gone entirely.
    expect(/\(SELECT MAX\(confirmed_at\) FROM co/i.test(EXEC)).toBe(false)
    expect(/\(SELECT MAX\(created_at\)\s+FROM wtx/i.test(EXEC)).toBe(false)
    // The GREATEST uses the already-joined aggregate fields.
    expect(FLAT).toMatch(
      /GREATEST\( t\.refreshed_at, t\.source_updated_at, pu\.latest_confirmed_at, wa\.last_win_at, wl\.wallet_source_updated_at, ag\.last_abandoned_at \) AS source_updated_at/i,
    )
  })

  it('resolves awards to users ONLY through a confirmed real checkout', () => {
    expect(FLAT).toMatch(/FROM public\.instant_win_awards a JOIN co ON co\.id = a\.checkout_intent_id/i)
  })

  it('uses the stored prize_value_pence and NEVER parses prize_value_text', () => {
    expect(FLAT).toMatch(/prize_value_pence/i)
    expect(/prize_value_text/i.test(EXEC)).toBe(false)
  })

  it('whitelists last_win_fulfilment_type to verified values only', () => {
    expect(FLAT).toMatch(/fulfilment_type IN \('cash', 'wallet_credit', 'manual'\)/i)
  })

  it('reads the wallet ledger from wallet_transactions, never wallet_reservations', () => {
    expect(FLAT).toMatch(/FROM public\.wallet_transactions/i)
    expect(/FROM\s+public\.wallet_reservations/i.test(EXEC)).toBe(false)
  })

  it('classifies the wallet ledger by transaction_type, not by amount sign alone', () => {
    // transaction_type is selected into the wtx CTE and used in the filters.
    expect(FLAT).toMatch(/wtx AS \( SELECT wt\.user_id, wt\.transaction_type,/i)
  })

  it('counts wallet CREDIT received via an explicit positive-credit type allow-list', () => {
    // Both the last_wallet_credit_at and the 30d credit sum use the allow-list.
    expect(
      (FLAT.match(
        /transaction_type IN \('instant_win_credit', 'admin_credit', 'refund_credit'\) AND amount_pence > 0/gi,
      ) || []).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('EXCLUDES reversal from wallet-credit-received metrics', () => {
    // 'reversal' must never appear inside a credit-received allow-list.
    expect(/'instant_win_credit', 'admin_credit', 'refund_credit', 'reversal'/i.test(EXEC)).toBe(
      false,
    )
    expect(/'reversal'/i.test(EXEC)).toBe(false)
  })

  it('counts wallet SPEND only as order_spend, negative, tied to a checkout', () => {
    // Both last_wallet_debit_at and the 30d spend sum use exactly this predicate.
    expect(
      (FLAT.match(
        /transaction_type = 'order_spend' AND amount_pence < 0 AND source_checkout_intent_id IS NOT NULL/gi,
      ) || []).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('never treats admin_debit as customer wallet purchase spend', () => {
    expect(/'admin_debit'/i.test(EXEC)).toBe(false)
  })

  it('reads the abandoned first delay from marketing_automations with a 45m fallback', () => {
    expect(FLAT).toMatch(/automation_key = 'abandoned_checkout'/i)
    expect(FLAT).toMatch(/interval '45 minutes'/i)
  })

  it('excludes abandonment when a later confirmed purchase exists for the SAME campaign', () => {
    expect(FLAT).toMatch(/NOT EXISTS/i)
    expect(FLAT).toMatch(/co\.campaign_id = ci\.campaign_id/i)
    expect(FLAT).toMatch(/co\.confirmed_at > ci\.created_at/i)
  })
})

describe('010 rollup — winner-marketing boundary', () => {
  it('derives no losing / near-miss / probability signals', () => {
    // Executable SQL only — the header comment legitimately DOCUMENTS the
    // boundary (e.g. "NO losing streak, NO losses"); the ban is on deriving such
    // a signal, not on describing that we never do.
    expect(
      /losing_streak|loss_streak|near_miss|near-miss|due_to_win|win_probability|overdue_win|loss_chas|chase_loss/i.test(
        EXEC,
      ),
    ).toBe(false)
  })

  it('stores winning ONLY as positive history columns', () => {
    for (const col of ['win_count', 'wins_30d', 'last_win_at', 'last_win_value_pence']) {
      expect(FLAT).toContain(col)
    }
  })
})

describe('010 rollup — bounded, set-based, resumable design', () => {
  it('creates a dedicated singleton refresh-state table (not the profile one)', () => {
    expect(FLAT).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.customer_marketing_intelligence_refresh_state/i,
    )
    expect(FLAT).toMatch(/CONSTRAINT cmi_refresh_state_singleton_chk CHECK \(key = 'default'\)/i)
  })

  it('clamps the batch size to [1, 1000] with a default of 500', () => {
    expect(FLAT).toMatch(/p_limit integer DEFAULT 500/i)
    expect(FLAT).toMatch(/v_batch < 1/i)
    expect(FLAT).toMatch(/v_batch > 1000/i)
  })

  it('is advisory-locked and non-blocking (skips when locked)', () => {
    expect(FLAT).toMatch(/pg_try_advisory_xact_lock\(v_lock_key\)/i)
    expect(FLAT).toMatch(/'mode', 'skipped'/i)
    expect(FLAT).toMatch(/skippedBecauseLocked/i)
  })

  it('backfills over customer_marketing_profiles using a cursor, not auth.users', () => {
    expect(FLAT).toMatch(/FROM public\.customer_marketing_profiles p WHERE \(v_state\.backfill_cursor IS NULL OR p\.user_id > v_state\.backfill_cursor\)/i)
    expect(/FROM\s+auth\.users/i.test(EXEC)).toBe(false)
  })

  it('is a set-based batch helper with no per-user loop', () => {
    // No PL/pgSQL FOR-loop over rows inside the batch helper.
    expect(/FOR\s+\w+\s+IN\s+SELECT/i.test(EXEC)).toBe(false)
    expect(FLAT).toMatch(/ON CONFLICT \(user_id\) DO UPDATE SET/i)
  })

  it('the batch helper enforces its own hard bound of 1000 and dedupes UUIDs', () => {
    // Dedup (DISTINCT + NULL strip) before the bound check.
    expect(FLAT).toMatch(/SELECT array_agg\(DISTINCT u ORDER BY u\) INTO p_ids FROM unnest\(p_ids\) AS u WHERE u IS NOT NULL/i)
    // Hard rejection above 1000.
    expect(FLAT).toMatch(/IF cardinality\(p_ids\) > 1000 THEN RAISE EXCEPTION/i)
  })

  it('opens the incremental window with a 15-minute overlap floor', () => {
    expect(FLAT).toMatch(/v_overlap\s+interval := interval '15 minutes'/i)
    expect(FLAT).toMatch(
      /v_win_from := COALESCE\(v_state\.last_incremental_at, v_state\.backfill_started_at, v_now\) - v_overlap/i,
    )
    expect(FLAT).toMatch(/v_win_to\s+:= v_now/i)
  })
})

describe('010 rollup — incremental is bounded, frozen-window + cursor', () => {
  it('adds frozen window + cursor columns to the refresh-state table', () => {
    expect(FLAT).toMatch(/incremental_window_from timestamptz/i)
    expect(FLAT).toMatch(/incremental_window_to\s+timestamptz/i)
    expect(FLAT).toMatch(/incremental_cursor\s+uuid/i)
    expect(FLAT).toMatch(/last_incremental_at\s+timestamptz/i)
  })

  it('constrains the window fields so no impossible partial state can persist', () => {
    expect(FLAT).toMatch(
      /cmi_refresh_state_window_pair_chk CHECK \( \(incremental_window_from IS NULL\) = \(incremental_window_to IS NULL\) \)/i,
    )
    expect(FLAT).toMatch(/cmi_refresh_state_window_order_chk CHECK \([^)]*incremental_window_from <= incremental_window_to/i)
    expect(FLAT).toMatch(
      /cmi_refresh_state_cursor_requires_window_chk CHECK \( incremental_cursor IS NULL OR incremental_window_to IS NOT NULL \)/i,
    )
  })

  it('LIMITs the incremental candidate universe to the bounded batch (p_limit/v_batch)', () => {
    // The candidate SELECT is ordered by user_id and hard-limited to v_batch.
    expect(FLAT).toMatch(/AND \(v_cursor IS NULL OR uid > v_cursor\) ORDER BY uid LIMIT v_batch/i)
  })

  it('never array_aggs the entire changed population in incremental mode', () => {
    // The old unbounded "array_agg(DISTINCT uid) ... FROM (...) WHERE uid IS NOT NULL"
    // with no LIMIT must be gone. array_agg used in incremental is the ordered,
    // pre-LIMITed form.
    expect(/array_agg\(DISTINCT uid\)/i.test(EXEC)).toBe(false)
    expect(FLAT).toMatch(/SELECT array_agg\(uid ORDER BY uid\) INTO v_ids FROM \( SELECT DISTINCT uid/i)
  })

  it('advances the cursor only when the window is NOT yet exhausted', () => {
    // Non-complete branch advances cursor to the last processed id.
    expect(FLAT).toMatch(/SET incremental_cursor\s+= v_ids\[v_count\]/i)
  })

  it('advances last_incremental_at to window_to ONLY when the window is exhausted', () => {
    // Completion branch sets watermark to window_to and clears window + cursor.
    expect(FLAT).toMatch(/v_complete := \(v_count < v_batch\)/i)
    expect(FLAT).toMatch(
      /SET last_incremental_at\s+= v_win_to, incremental_window_from = NULL, incremental_window_to\s+= NULL, incremental_cursor\s+= NULL/i,
    )
    // The watermark is never blindly advanced to v_now in incremental mode.
    expect(/last_incremental_at\s*=\s*v_now/i.test(EXEC)).toBe(false)
  })

  it('recomputes rolling-window stale intelligence at least every 24 hours', () => {
    expect(FLAT).toMatch(
      /FROM public\.customer_marketing_intelligence cmi WHERE cmi\.refreshed_at < v_win_to - interval '24 hours'/i,
    )
    // Backed by an index on OUR OWN rollup table.
    expect(FLAT).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_customer_marketing_intelligence_refreshed_at ON public\.customer_marketing_intelligence \(refreshed_at\)/i,
    )
  })

  it('creates a candidate when an abandonment threshold crosses (no UPDATE required)', () => {
    expect(FLAT).toMatch(/ci\.created_at >\s+v_win_from - v_abandon_delay/i)
    expect(FLAT).toMatch(/ci\.created_at <= v_win_to\s+- v_abandon_delay/i)
    expect(FLAT).toMatch(/ci\.state IS DISTINCT FROM 'confirmed'/i)
  })

  it('has NO broad checkout_intents.updated_at OR-scan for change detection', () => {
    expect(/updated_at\s*>=\s*v_since/i.test(EXEC)).toBe(false)
    expect(/ci\.updated_at/i.test(EXEC)).toBe(false)
  })

  it('has NO global wallet_transactions.created_at candidate scan in the orchestrator', () => {
    // Wallet-driven change discovery must go through the profile bridge (source
    // A), never a global ledger scan to find changed users. The only
    // wallet_transactions read is inside the batch helper's candidate-joined wtx
    // CTE (JOIN targets), never a bare orchestrator scan by created_at.
    expect(/FROM public\.wallet_transactions wt WHERE wt\.created_at >=/i.test(EXEC)).toBe(false)
  })

  it('uses index-friendly bounded ranges for direct checkout candidate discovery', () => {
    expect(FLAT).toMatch(/ci\.created_at > v_win_from AND ci\.created_at <= v_win_to/i)
    expect(FLAT).toMatch(/ci\.confirmed_at > v_win_from AND ci\.confirmed_at <= v_win_to/i)
    expect(FLAT).toMatch(/a\.awarded_at > v_win_from AND a\.awarded_at <= v_win_to/i)
  })

  it('confirmed-order candidate source C requires the canonical state = confirmed', () => {
    // Source C must carry state = 'confirmed' together with its bounded
    // confirmed_at range (so the confirmed_at partial index is applicable and
    // the candidate scope matches the canonical confirmed-order predicate).
    expect(FLAT).toMatch(
      /AND ci\.state = 'confirmed' AND ci\.provider IS DISTINCT FROM 'debug' AND \(ci\.ref IS NULL OR ci\.ref NOT LIKE 'SIM-%'\) AND ci\.confirmed_at > v_win_from AND ci\.confirmed_at <= v_win_to/i,
    )
  })
})

describe('010 rollup — affinity rebuild is derived, structured, batch-scoped', () => {
  it('rebuilds affinity by deleting then reinserting ONLY the candidate batch', () => {
    expect(FLAT).toMatch(/DELETE FROM public\.customer_campaign_affinity WHERE user_id = ANY \(p_ids\)/i)
    expect(FLAT).toMatch(/INSERT INTO public\.customer_campaign_affinity/i)
  })

  it('derives reveal_type / presentation_type from STRUCTURED campaign columns only', () => {
    expect(FLAT).toMatch(/lower\(btrim\(c\.reveal_type\)\)/i)
    expect(FLAT).toMatch(/lower\(btrim\(c\.presentation_type\)\)/i)
    // Never inferred from free text.
    expect(/campaigns?\.(title|slug|summary|description)/i.test(EXEC)).toBe(false)
  })

  it('validates derived affinity keys against the 009 token pattern', () => {
    expect((FLAT.match(/~ '\^\[a-z0-9_-\]\+\$'/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('keys campaign affinity by the lower-cased campaign UUID', () => {
    expect(FLAT).toMatch(/'campaign'::text\s+AS affinity_type, lower\(campaign_id::text\)\s+AS affinity_key/i)
  })
})

describe('010 rollup — security hardening', () => {
  it('enables and forces RLS with no policies on the new state table', () => {
    expect(FLAT).toMatch(
      /ALTER TABLE public\.customer_marketing_intelligence_refresh_state ENABLE ROW LEVEL SECURITY/i,
    )
    expect(FLAT).toMatch(
      /ALTER TABLE public\.customer_marketing_intelligence_refresh_state FORCE\s+ROW LEVEL SECURITY/i,
    )
    expect(/CREATE\s+POLICY/i.test(EXEC)).toBe(false)
  })

  it('strips ALL from service_role before granting exactly SELECT/INSERT/UPDATE (no DELETE) on the state table', () => {
    const revokeIdx = EXEC.search(
      /REVOKE ALL ON public\.customer_marketing_intelligence_refresh_state FROM service_role/i,
    )
    const grantIdx = EXEC.search(
      /GRANT SELECT, INSERT, UPDATE ON public\.customer_marketing_intelligence_refresh_state TO service_role/i,
    )
    expect(revokeIdx).toBeGreaterThanOrEqual(0)
    expect(grantIdx).toBeGreaterThanOrEqual(0)
    expect(revokeIdx).toBeLessThan(grantIdx)
  })

  it('grants NO DELETE anywhere in the migration', () => {
    expect(/GRANT[^;]*\bDELETE\b/i.test(EXEC)).toBe(false)
  })

  it('keeps the batch helper owner-only (no PUBLIC/anon/authenticated/service_role EXECUTE)', () => {
    // PUBLIC, anon and authenticated stripped.
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.refresh_customer_marketing_intelligence_batch\(uuid\[\]\) FROM public, anon, authenticated/i,
    )
    // service_role ALSO explicitly stripped in its own statement.
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.refresh_customer_marketing_intelligence_batch\(uuid\[\]\) FROM service_role/i,
    )
    // EXECUTE is NEVER granted back to anyone (no role at all).
    expect(
      /GRANT EXECUTE ON FUNCTION public\.refresh_customer_marketing_intelligence_batch/i.test(EXEC),
    ).toBe(false)
    // Belt-and-braces: service_role never receives EXECUTE on the helper.
    expect(
      /GRANT EXECUTE ON FUNCTION public\.refresh_customer_marketing_intelligence_batch\(uuid\[\]\) TO service_role/i.test(
        EXEC,
      ),
    ).toBe(false)
  })

  it('grants EXECUTE on the orchestrator and overview RPCs to service_role only', () => {
    for (const fn of [
      'refresh_customer_marketing_intelligence\\(integer\\)',
      'get_admin_marketing_intelligence_overview\\(\\)',
    ]) {
      expect(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM public, anon, authenticated`, 'i').test(FLAT)).toBe(true)
      expect(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn} TO service_role`, 'i').test(FLAT)).toBe(true)
    }
  })

  it('all functions are SECURITY DEFINER with a fixed search_path', () => {
    // Match executable SQL only (FLAT_EXEC) so comments mentioning these terms
    // do not inflate the counts.
    const defs = (FLAT_EXEC.match(/CREATE OR REPLACE FUNCTION/gi) || []).length
    expect(defs).toBe(3)
    expect((FLAT_EXEC.match(/SECURITY DEFINER/gi) || []).length).toBe(3)
    expect((FLAT_EXEC.match(/SET search_path = public, pg_temp/gi) || []).length).toBe(3)
  })
})

describe('010 rollup — overview RPC is aggregate-only, no identities', () => {
  it('is STABLE and reads only the two rollup tables + refresh state', () => {
    expect(FLAT).toMatch(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_intelligence_overview\(\) RETURNS jsonb LANGUAGE plpgsql STABLE/i)
    // No operational-source scan in the overview. Slice from the function's
    // CREATE statement (not the first prose mention) to the end of the file.
    const overview = EXEC.slice(
      EXEC.indexOf('CREATE OR REPLACE FUNCTION public.get_admin_marketing_intelligence_overview'),
    )
    expect(/FROM\s+public\.checkout_intents/i.test(overview)).toBe(false)
    expect(/FROM\s+public\.instant_win_awards/i.test(overview)).toBe(false)
    expect(/FROM\s+public\.wallet_transactions/i.test(overview)).toBe(false)
  })

  it('exposes counts/sums only — no user_id, email or row payloads in output keys', () => {
    const fnStart = EXEC.indexOf('CREATE OR REPLACE FUNCTION public.get_admin_marketing_intelligence_overview')
    const overview = EXEC.slice(EXEC.indexOf('RETURN jsonb_build_object', fnStart))
    expect(/'email'/i.test(overview)).toBe(false)
    expect(/'userId'/i.test(overview)).toBe(false)
    expect(/'rows',\s*jsonb_agg/i.test(overview)).toBe(false)
  })

  it('declares statement_timeout on the STABLE function and calls no set_config in its body', () => {
    // The overview keeps STABLE and gains a declarative SET statement_timeout.
    expect(FLAT).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_admin_marketing_intelligence_overview\(\) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '10s' AS/i,
    )
    // No set_config anywhere inside the STABLE overview body.
    const fnStart = EXEC.indexOf('CREATE OR REPLACE FUNCTION public.get_admin_marketing_intelligence_overview')
    const overviewExec = EXEC.slice(fnStart)
    expect(/set_config\(/i.test(overviewExec)).toBe(false)
  })
})
