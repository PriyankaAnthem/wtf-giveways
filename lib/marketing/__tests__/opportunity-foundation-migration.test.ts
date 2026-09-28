import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * STATIC contract for the Stage 3C1 schema migration
 * scripts/marketing/007-marketing-opportunity-foundation.sql.
 *
 * The migration cannot be executed from vitest (no Postgres), so these tests
 * pin the parts of its contract that MUST hold in the SQL text:
 *   - it is atomic, fail-fast, advisory-locked and pause-asserted,
 *   - it creates exactly ONE table (marketing_opportunities) + ONE RPC,
 *   - it ALTERs no existing table and modifies migrations 001-006 not at all,
 *   - the exactly-one-identity, six-type, seven-state, decision-mode, priority,
 *     expiry, timestamp, dedupe and JSON-object constraints all exist,
 *   - dedupe is globally unique, the working-set + contact + campaign/promotion
 *     + type indexes exist,
 *   - it inserts NO opportunity / recipient / automation-run rows,
 *   - it references NO checkout table, adds NO Resend/email/cron/AI code,
 *   - RLS is enabled + forced, anon/authenticated revoked, service_role has no
 *     DELETE grant, and the RPC exposes no identities,
 *   - Marketing navigation is unchanged.
 */
const ROOT = process.cwd()
const MIGRATION_PATH = 'scripts/marketing/007-marketing-opportunity-foundation.sql'
const SQL = readFileSync(join(ROOT, MIGRATION_PATH), 'utf8')

// SQL with `-- ...` line comments stripped, so assertions about executable code
// are never satisfied (or tripped) by prose in the header comments.
const CODE = SQL.replace(/--.*$/gm, '')
const FLAT = CODE.replace(/\s+/g, ' ').trim()

describe('Stage 3C1 — exists and leaves earlier migrations intact', () => {
  it('lives at scripts/marketing/007-marketing-opportunity-foundation.sql', () => {
    expect(existsSync(join(ROOT, MIGRATION_PATH))).toBe(true)
  })

  it('does not modify migrations 001-006 (they remain present)', () => {
    for (const n of ['001', '002', '003', '004', '005', '006']) {
      const matches = readdirSync(join(ROOT, 'scripts/marketing')).filter((f) => f.startsWith(n))
      expect(matches.length, n).toBeGreaterThan(0)
    }
  })
})

describe('Stage 3C1 — atomic, fail-fast, locked, pause-asserted', () => {
  it('is wrapped in a single atomic transaction BEGIN;/COMMIT;', () => {
    // The transaction opens with a bare `BEGIN;` (the other BEGIN belongs to the
    // PL/pgSQL DO block) and closes with exactly one `COMMIT;`.
    expect(FLAT.startsWith('BEGIN;')).toBe(true)
    expect((CODE.match(/\bCOMMIT\s*;/g) || []).length).toBe(1)
    // The transaction COMMIT is the last executable statement.
    expect(FLAT.trim().endsWith('COMMIT;')).toBe(true)
  })

  it('sets fail-fast LOCAL lock_timeout and statement_timeout', () => {
    expect(FLAT).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('takes a migration-specific transaction advisory lock', () => {
    expect(FLAT).toMatch(/pg_try_advisory_xact_lock\(\s*hashtext\('wtf_marketing_stage_3c1_opportunity_foundation'\)\s*\)/i)
  })

  it('asserts the global pause: sending, discovery and rollout are all off', () => {
    // The three pause columns are read into locals, then asserted off.
    expect(FLAT).toMatch(/SELECT sending_enabled, discovery_enabled, rollout_limit/i)
    expect(FLAT).toMatch(/v_sending\s+IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_discovery\s+IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
    // The pause check reads the singleton control row and refuses otherwise.
    expect(FLAT).toMatch(/FROM public\.marketing_control_state\s+WHERE key = 'default'/i)
    expect(FLAT).toMatch(/Refusing to install/i)
  })

  it('preflights every required dependency', () => {
    for (const dep of [
      'public.marketing_automations',
      'public.marketing_external_contacts',
      'public.marketing_campaign_promotions',
      'public.campaigns',
      'public.marketing_control_state',
    ]) {
      expect(FLAT, dep).toContain(`'${dep}'`)
    }
    expect(FLAT).toMatch(/to_regclass\(/i)
  })

  it('never runs CREATE EXTENSION', () => {
    expect(/CREATE\s+EXTENSION/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3C1 — creates exactly one table and alters nothing', () => {
  it('creates exactly one table, and it is marketing_opportunities', () => {
    const creates = [...CODE.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z0-9_.]+)/gi)].map((m) => m[1])
    expect(creates).toEqual(['public.marketing_opportunities'])
  })

  it('creates the table idempotently (IF NOT EXISTS)', () => {
    expect(FLAT).toMatch(/CREATE TABLE IF NOT EXISTS public\.marketing_opportunities/i)
  })

  it('does NOT ALTER any existing table (only RLS enable/force on the new one)', () => {
    const alters = [...CODE.matchAll(/ALTER TABLE\s+([a-z0-9_.]+)/gi)].map((m) => m[1])
    for (const t of alters) expect(t).toBe('public.marketing_opportunities')
  })

  it('id is a uuid primary key defaulting to gen_random_uuid()', () => {
    expect(FLAT).toMatch(/id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/i)
  })
})

describe('Stage 3C1 — identity model', () => {
  it('user_id has NO foreign key (immutable ledger)', () => {
    // No "user_id uuid ... REFERENCES" on the same declaration line.
    expect(/user_id\s+uuid[^\n,]*REFERENCES/i.test(SQL)).toBe(false)
  })

  it('external_contact_id FKs marketing_external_contacts ON DELETE RESTRICT', () => {
    expect(FLAT).toMatch(/external_contact_id\s+uuid\s+REFERENCES public\.marketing_external_contacts\(id\)\s+ON DELETE RESTRICT/i)
  })

  it('enforces exactly-one-identity via an XOR CHECK', () => {
    expect(FLAT).toMatch(/\(user_id IS NOT NULL\)\s*<>\s*\(external_contact_id IS NOT NULL\)/i)
  })

  it('normalises email: lower-case, trimmed, non-empty, max 320', () => {
    expect(FLAT).toMatch(/email_lc = lower\(email_lc\) AND email_lc = btrim\(email_lc\) AND length\(email_lc\) > 0/i)
    expect(FLAT).toMatch(/char_length\(email_lc\) <= 320/i)
  })
})

describe('Stage 3C1 — source & campaign context FKs', () => {
  it('automation_id is NOT NULL and FKs marketing_automations ON DELETE RESTRICT', () => {
    expect(FLAT).toMatch(/automation_id\s+uuid\s+NOT NULL REFERENCES public\.marketing_automations\(id\)\s+ON DELETE RESTRICT/i)
  })

  it('campaign_id FKs campaigns ON DELETE RESTRICT', () => {
    expect(FLAT).toMatch(/campaign_id\s+uuid\s+REFERENCES public\.campaigns\(id\)\s+ON DELETE RESTRICT/i)
  })

  it('promotion_id FKs marketing_campaign_promotions ON DELETE RESTRICT', () => {
    expect(FLAT).toMatch(/promotion_id\s+uuid\s+REFERENCES public\.marketing_campaign_promotions\(id\)\s+ON DELETE RESTRICT/i)
  })
})

describe('Stage 3C1 — value constraints', () => {
  it('opportunity_type is restricted to EXACTLY the six automation keys', () => {
    const six = [
      'vip_early_access',
      'abandoned_checkout',
      'wtf_credit_waiting',
      'regular_buyer_campaign_alert',
      'new_account_no_purchase',
      'lapsed_14_days',
    ]
    const m = FLAT.match(/opportunity_type IN \(([^)]*)\)/i)
    expect(m, 'opportunity_type CHECK present').toBeTruthy()
    const listed = [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1])
    expect(listed.sort()).toEqual([...six].sort())
  })

  it('state is restricted to EXACTLY the seven lifecycle values', () => {
    const seven = ['open', 'selected', 'suppressed', 'deferred', 'expired', 'superseded', 'actioned']
    const m = FLAT.match(/state IN \(([^)]*)\)/i)
    expect(m, 'state CHECK present').toBeTruthy()
    const listed = [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1])
    expect(listed.sort()).toEqual([...seven].sort())
  })

  it('state defaults to open', () => {
    expect(FLAT).toMatch(/state\s+text\s+NOT NULL DEFAULT 'open'/i)
  })

  it('decision_mode allows only NULL, deterministic or ai', () => {
    expect(FLAT).toMatch(/decision_mode IS NULL OR decision_mode IN \('deterministic',\s*'ai'\)/i)
  })

  it('base_priority must be >= 1', () => {
    expect(FLAT).toMatch(/base_priority >= 1/i)
  })

  it('score is a bounded numeric(10,4) column', () => {
    expect(FLAT).toMatch(/score\s+numeric\(10,4\)/i)
    // It is NOT an unbounded `numeric` with no precision.
    expect(/score\s+numeric\s*,/i.test(FLAT)).toBe(false)
  })

  it('score permits NULL and is bounded to the 0-1000 range', () => {
    expect(FLAT).toMatch(/score IS NULL OR \(score >= 0 AND score <= 1000\)/i)
  })

  it('score cannot be below 0 or above 1000 (explicit bounds present)', () => {
    const m = FLAT.match(/score IS NULL OR \(([^)]*)\)/i)
    expect(m, 'score range CHECK present').toBeTruthy()
    expect(m![1]).toMatch(/score >= 0/i)
    expect(m![1]).toMatch(/score <= 1000/i)
  })

  it('requires expires_at strictly after detected_at', () => {
    expect(FLAT).toMatch(/expires_at > detected_at/i)
  })

  it('selected_at / actioned_at cannot predate detection', () => {
    expect(FLAT).toMatch(/selected_at IS NULL OR selected_at >= detected_at/i)
    expect(FLAT).toMatch(/actioned_at IS NULL OR actioned_at >= detected_at/i)
  })

  it('bounds dedupe_key length (non-empty, max 300)', () => {
    expect(FLAT).toMatch(/char_length\(dedupe_key\) > 0 AND char_length\(dedupe_key\) <= 300/i)
  })

  it('requires reason and context_snapshot to be JSON objects', () => {
    expect(FLAT).toMatch(/jsonb_typeof\(reason\) = 'object'/i)
    expect(FLAT).toMatch(/jsonb_typeof\(context_snapshot\) = 'object'/i)
  })

  it('bounds reason to a maximum of 4096 bytes', () => {
    expect(FLAT).toMatch(/octet_length\(reason::text\) <= 4096/i)
  })

  it('bounds context_snapshot to a maximum of 8192 bytes', () => {
    expect(FLAT).toMatch(/octet_length\(context_snapshot::text\) <= 8192/i)
  })

  it('reason and context_snapshot default to empty objects', () => {
    expect(FLAT).toMatch(/reason\s+jsonb\s+NOT NULL DEFAULT '\{\}'::jsonb/i)
    expect(FLAT).toMatch(/context_snapshot\s+jsonb\s+NOT NULL DEFAULT '\{\}'::jsonb/i)
  })
})

describe('Stage 3C1 — indexes', () => {
  it('dedupe_key has a UNIQUE index (global detection idempotency)', () => {
    expect(FLAT).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS marketing_opportunities_dedupe_key_uidx\s+ON public\.marketing_opportunities \(dedupe_key\)/i)
  })

  it('does NOT add a naive UNIQUE(user_id, opportunity_type)', () => {
    expect(/UNIQUE[^;]*\(\s*user_id\s*,\s*opportunity_type\s*\)/i.test(FLAT)).toBe(false)
  })

  it('has a partial working-set index on state = open', () => {
    expect(FLAT).toMatch(/marketing_opportunities_open_workingset_idx[\s\S]*?WHERE state = 'open'/i)
  })

  it('has contact-arbitration indexes for user, external contact and email', () => {
    expect(FLAT).toMatch(/marketing_opportunities_user_state_idx\s+ON public\.marketing_opportunities \(user_id, state, expires_at\)\s+WHERE user_id IS NOT NULL/i)
    expect(FLAT).toMatch(/marketing_opportunities_external_state_idx\s+ON public\.marketing_opportunities \(external_contact_id, state, expires_at\)\s+WHERE external_contact_id IS NOT NULL/i)
    expect(FLAT).toMatch(/marketing_opportunities_email_state_idx\s+ON public\.marketing_opportunities \(email_lc, state, expires_at\)/i)
  })

  it('has partial campaign and promotion indexes', () => {
    expect(FLAT).toMatch(/marketing_opportunities_campaign_idx\s+ON public\.marketing_opportunities \(campaign_id\)\s+WHERE campaign_id IS NOT NULL/i)
    expect(FLAT).toMatch(/marketing_opportunities_promotion_idx\s+ON public\.marketing_opportunities \(promotion_id\)\s+WHERE promotion_id IS NOT NULL/i)
  })

  it('has an opportunity_type + state index', () => {
    expect(FLAT).toMatch(/marketing_opportunities_type_state_idx\s+ON public\.marketing_opportunities \(opportunity_type, state\)/i)
  })
})

describe('Stage 3C1 — no data, no side effects', () => {
  it('inserts NO rows at all (no INSERT statement in executable code)', () => {
    expect(/\bINSERT\s+INTO\b/i.test(CODE)).toBe(false)
  })

  it('creates NO recipients and NO automation runs', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_recipients/i.test(CODE)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_automation_runs/i.test(CODE)).toBe(false)
  })

  it('references NO checkout / payment / ticket / wallet table in executable code', () => {
    for (const t of [
      'checkout_intents',
      'ticket_allocations',
      'wallet_accounts',
      'wallet_ledger',
      'instant_win',
      'entries',
    ]) {
      expect(new RegExp(t, 'i').test(CODE), t).toBe(false)
    }
  })

  it('adds NO Resend / email sending code', () => {
    expect(/resend/i.test(CODE)).toBe(false)
    expect(/RESEND_API_KEY/i.test(SQL)).toBe(false)
    expect(/send[_-]?email/i.test(CODE)).toBe(false)
  })

  it('adds NO trigger', () => {
    expect(/CREATE\s+TRIGGER/i.test(CODE)).toBe(false)
    expect(/CREATE\s+OR\s+REPLACE\s+TRIGGER/i.test(CODE)).toBe(false)
  })

  it('does NOT enable sending/discovery or change rollout (control state read-only)', () => {
    // No write to the control singleton anywhere in this migration.
    expect(/UPDATE\s+public\.marketing_control_state/i.test(CODE)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(CODE)).toBe(false)
    // No assignment turning sending/discovery on or rollout up.
    expect(/sending_enabled\s*=\s*true/i.test(CODE)).toBe(false)
    expect(/discovery_enabled\s*=\s*true/i.test(CODE)).toBe(false)
  })

  it('introduces NO AI package or integration', () => {
    for (const token of ['openai', '@ai-sdk', 'generateText', 'streamText', 'anthropic', 'ai_gateway', 'AI_GATEWAY']) {
      expect(new RegExp(token, 'i').test(SQL), token).toBe(false)
    }
  })
})

describe('Stage 3C1 — security', () => {
  it('enables and forces RLS on the new table', () => {
    expect(FLAT).toMatch(/ALTER TABLE public\.marketing_opportunities ENABLE ROW LEVEL SECURITY/i)
    expect(FLAT).toMatch(/ALTER TABLE public\.marketing_opportunities FORCE\s+ROW LEVEL SECURITY/i)
  })

  it('creates NO RLS policy (browser has no access path)', () => {
    expect(/CREATE\s+POLICY/i.test(CODE)).toBe(false)
  })

  it('revokes all table access from anon and authenticated', () => {
    expect(FLAT).toMatch(/REVOKE ALL ON public\.marketing_opportunities FROM anon, authenticated/i)
  })

  it('grants service_role SELECT/INSERT/UPDATE but NOT DELETE', () => {
    const grant = FLAT.match(/GRANT ([A-Z, ]+) ON public\.marketing_opportunities TO service_role/i)
    expect(grant, 'table grant present').toBeTruthy()
    expect(grant![1]).toMatch(/SELECT/i)
    expect(grant![1]).toMatch(/INSERT/i)
    expect(grant![1]).toMatch(/UPDATE/i)
    expect(/DELETE/i.test(grant![1])).toBe(false)
  })
})

describe('Stage 3C1 — read-only aggregate RPC', () => {
  it('defines exactly get_admin_marketing_opportunity_overview() RETURNS jsonb', () => {
    expect(FLAT).toMatch(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_overview\(\)\s+RETURNS jsonb/i)
  })

  it('remains STABLE (read-only volatility)', () => {
    // STABLE appears in the function declaration, between RETURNS jsonb and the
    // AS $$ body, so the function is never VOLATILE.
    const decl = FLAT.match(/RETURNS jsonb\s+LANGUAGE plpgsql\s+([\s\S]*?)\s+AS \$\$/i)
    expect(decl, 'function declaration present').toBeTruthy()
    expect(decl![1]).toMatch(/\bSTABLE\b/i)
  })

  it('is SECURITY DEFINER with a fixed search_path', () => {
    expect(FLAT).toMatch(/SECURITY DEFINER/i)
    expect(FLAT).toMatch(/SET search_path = public, pg_temp/i)
  })

  it('sets the 10s statement_timeout declaratively via the SET clause', () => {
    expect(FLAT).toMatch(/SET statement_timeout = '10s'/i)
    // The SET clause is part of the declaration (before the AS $$ body).
    const decl = FLAT.match(/RETURNS jsonb\s+LANGUAGE plpgsql\s+([\s\S]*?)\s+AS \$\$/i)
    expect(decl, 'function declaration present').toBeTruthy()
    expect(decl![1]).toMatch(/SET statement_timeout = '10s'/i)
    expect(decl![1]).toMatch(/SET search_path = public, pg_temp/i)
  })

  it('makes NO set_config call anywhere in the migration', () => {
    // The STABLE function must not write any runtime GUC; the whole file is free
    // of set_config so nothing can smuggle a write into a read-only function.
    expect(/set_config\s*\(/i.test(CODE)).toBe(false)
  })

  it('returns the required aggregate keys', () => {
    for (const key of [
      "'generatedAt'",
      "'total'",
      "'open'",
      "'selected'",
      "'suppressed'",
      "'deferred'",
      "'expired'",
      "'actioned'",
      "'deterministicSelected'",
      "'aiSelected'",
      "'countByState'",
      "'countByType'",
    ]) {
      expect(FLAT, key).toContain(key)
    }
  })

  it('deterministicSelected counts only CURRENTLY-selected rows', () => {
    expect(FLAT).toMatch(/'deterministicSelected',\s*count\(\*\) FILTER \(WHERE decision_mode = 'deterministic' AND state = 'selected'\)/i)
  })

  it('aiSelected counts only CURRENTLY-selected rows', () => {
    expect(FLAT).toMatch(/'aiSelected',\s*count\(\*\) FILTER \(WHERE decision_mode = 'ai' AND state = 'selected'\)/i)
  })

  it('the selected-decision counters are never a bare decision_mode filter', () => {
    // Guard against regressing to counting every row with that decision_mode.
    expect(/FILTER \(WHERE decision_mode = 'deterministic'\)/i.test(FLAT)).toBe(false)
    expect(/FILTER \(WHERE decision_mode = 'ai'\)/i.test(FLAT)).toBe(false)
  })

  it('exposes NO identities (no user_id/email/rows in the output payload)', () => {
    // The RETURN jsonb_build_object payload must not surface identity columns.
    const ret = FLAT.slice(FLAT.search(/RETURN jsonb_build_object/i))
    expect(/'email/i.test(ret)).toBe(false)
    expect(/'userId'/i.test(ret)).toBe(false)
    expect(/user_id/i.test(ret)).toBe(false)
  })

  it('reads ONLY marketing_opportunities (no checkout scan, no other source table)', () => {
    const fnStart = CODE.search(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_overview/i)
    const fnBody = CODE.slice(fnStart)
    const froms = [...fnBody.matchAll(/FROM\s+(public\.[a-z_]+)/gi)].map((m) => m[1])
    for (const f of froms) expect(f).toBe('public.marketing_opportunities')
  })

  it('is service-role only (execute revoked from public/anon/authenticated)', () => {
    expect(FLAT).toMatch(/REVOKE ALL ON FUNCTION public\.get_admin_marketing_opportunity_overview\(\) FROM public, anon, authenticated/i)
    expect(FLAT).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_opportunity_overview\(\) TO service_role/i)
  })

  it('creates exactly one function', () => {
    const fns = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z0-9_.]+)/gi)].map((m) => m[1])
    expect(fns).toEqual(['public.get_admin_marketing_opportunity_overview'])
  })
})

describe('Stage 3C1 — Marketing navigation unchanged', () => {
  it('does not touch the admin navigation module', () => {
    const nav = readFileSync(join(ROOT, 'lib/admin/navigation.ts'), 'utf8')
    // The opportunity engine is a hidden foundation: no nav entry references it.
    expect(/opportunit/i.test(nav)).toBe(false)
    expect(/\/admin\/opportunities/i.test(nav)).toBe(false)
  })
})
