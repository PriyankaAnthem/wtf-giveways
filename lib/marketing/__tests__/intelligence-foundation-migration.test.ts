import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ============================================================================
// Static contract tests for scripts/marketing/009-marketing-intelligence-
// foundation.sql. These assert the migration TEXT only — they never connect to
// a database and never execute SQL. They lock in the Stage 3C2B guarantees:
// an extensible opportunity catalogue, an empty intelligence + affinity
// foundation, a safe opportunities-schema conversion, and a dynamic overview
// RPC — all completely inert, service-role only, Marketing still paused.
// ============================================================================

const SQL_PATH = join(
  process.cwd(),
  'scripts/marketing/009-marketing-intelligence-foundation.sql',
)
const CODE = readFileSync(SQL_PATH, 'utf8')

// Whitespace-flattened view for resilient substring/regex matching.
const FLAT = CODE.replace(/\s+/g, ' ')

// Code with line comments stripped, so "no writes"/"no scan" assertions cannot
// be fooled by explanatory prose in comments.
const EXEC = CODE.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')

// The 27 seeded catalogue keys (6 originals + 21 broader).
const ORIGINAL_SIX = [
  'vip_early_access',
  'abandoned_checkout',
  'wtf_credit_waiting',
  'regular_buyer_campaign_alert',
  'new_account_no_purchase',
  'lapsed_14_days',
]
const BROADER_KEYS = [
  'recent_winner_follow_up',
  'recent_winner_credit_available',
  'first_win_follow_up',
  'high_value_winner_follow_up',
  'fresh_wallet_credit',
  'wallet_credit_campaign_match',
  'personal_cadence_overdue',
  'frequent_buyer_relevant_campaign',
  'vip_relevant_campaign',
  'reveal_affinity_campaign',
  'recently_active_no_relevant_entry',
  'first_to_second_purchase',
  'high_value_abandoned_checkout',
  'repeat_abandoner',
  'lapsed_7_days',
  'lapsed_30_days',
  'high_value_customer_at_risk',
  'vip_reactivation',
  'reactivated_customer_follow_up',
  'campaign_closing_relevant_customer',
  'recent_buyer_cross_campaign',
  'promotion_match',
]

describe('009 intelligence foundation — migration shape & safety', () => {
  it('is wrapped in a single atomic transaction BEGIN;/COMMIT;', () => {
    const execTrimmed = EXEC.trim()
    expect(execTrimmed.startsWith('BEGIN;')).toBe(true)
    expect(execTrimmed.endsWith('COMMIT;')).toBe(true)
    expect((EXEC.match(/\bCOMMIT\s*;/g) || []).length).toBe(1)
  })

  it('sets fail-fast lock_timeout and statement_timeout LOCAL', () => {
    expect(FLAT).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('uses a migration-specific advisory xact lock', () => {
    expect(FLAT).toMatch(
      /pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2b_intelligence_foundation'\)\)/i,
    )
  })

  it('preflights all required dependencies', () => {
    for (const dep of [
      'public.marketing_opportunities',
      'public.marketing_automations',
      'public.marketing_control_state',
      'public.customer_marketing_profiles',
      'public.marketing_external_contacts',
      'public.marketing_campaign_promotions',
      'public.marketing_templates',
      'public.campaigns',
    ]) {
      expect(FLAT).toContain(`'${dep}'`)
    }
    expect(FLAT).toMatch(/to_regclass\(v_dep\) IS NULL/i)
  })

  it('asserts the global pause: sending, discovery and rollout are all off', () => {
    expect(FLAT).toMatch(/SELECT sending_enabled, discovery_enabled, rollout_limit/i)
    expect(FLAT).toMatch(/v_sending\s+IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_discovery\s+IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
    expect(FLAT).toMatch(/FROM public\.marketing_control_state\s+WHERE key = 'default'/i)
    expect(FLAT).toMatch(/Refusing to install/i)
  })

  it('asserts the opportunity ledger is EMPTY before schema conversion', () => {
    expect(FLAT).toMatch(/SELECT count\(\*\) INTO v_opp_count FROM public\.marketing_opportunities/i)
    expect(FLAT).toMatch(/v_opp_count <> 0/i)
    expect(FLAT).toMatch(/schema conversion requires an empty ledger/i)
  })

  it('never UPDATEs marketing_control_state (read-only pause check)', () => {
    expect(/UPDATE\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
  })
})

describe('009 — opportunity catalogue', () => {
  it('creates marketing_opportunity_definitions', () => {
    expect(FLAT).toMatch(/CREATE TABLE IF NOT EXISTS public\.marketing_opportunity_definitions/i)
    expect(FLAT).toMatch(/opportunity_key\s+text\s+PRIMARY KEY/i)
  })

  it('is NOT tied to marketing_automations (no FK to automations from the catalogue)', () => {
    // Isolate the definitions CREATE TABLE body.
    const m = EXEC.match(/CREATE TABLE IF NOT EXISTS public\.marketing_opportunity_definitions \((.*?)\);/i)
    expect(m, 'definitions table found').toBeTruthy()
    expect(/marketing_automations/i.test(m![1])).toBe(false)
  })

  it('constrains opportunity_key to a lower-case trimmed [a-z0-9_] token, max 100', () => {
    expect(FLAT).toMatch(/opportunity_key = lower\(opportunity_key\)/i)
    expect(FLAT).toMatch(/opportunity_key = btrim\(opportunity_key\)/i)
    expect(FLAT).toMatch(/opportunity_key ~ '\^\[a-z0-9_\]\+\$'/i)
    expect(FLAT).toMatch(/char_length\(opportunity_key\) BETWEEN 1 AND 100/i)
  })

  it('bounds display_name, description and family', () => {
    expect(FLAT).toMatch(/char_length\(btrim\(display_name\)\) BETWEEN 1 AND 200/i)
    expect(FLAT).toMatch(/char_length\(btrim\(description\)\) BETWEEN 1 AND 1000/i)
    expect(FLAT).toMatch(/family ~ '\^\[a-z0-9_\]\+\$'/i)
    expect(FLAT).toMatch(/char_length\(family\) BETWEEN 1 AND 50/i)
  })

  it('bounds default_priority, default_score (0-1000) and default_expiry_hours', () => {
    expect(FLAT).toMatch(/default_priority >= 1/i)
    expect(FLAT).toMatch(/default_score >= 0 AND default_score <= 1000/i)
    expect(FLAT).toMatch(/default_expiry_hours > 0 AND default_expiry_hours <= 2160/i)
  })

  it('seeds with ON CONFLICT DO NOTHING', () => {
    expect(FLAT).toMatch(/INSERT INTO public\.marketing_opportunity_definitions/i)
    expect(FLAT).toMatch(/ON CONFLICT \(opportunity_key\) DO NOTHING/i)
  })

  it('preserves all six original opportunity keys', () => {
    for (const key of ORIGINAL_SIX) {
      expect(FLAT).toContain(`'${key}'`)
    }
  })

  it('includes the broader winner/wallet/cadence/affinity/lifecycle/checkout/promotion catalogue', () => {
    for (const key of BROADER_KEYS) {
      expect(FLAT).toContain(`'${key}'`)
    }
  })

  it('seeds EVERY definition with enabled = false', () => {
    // Isolate the VALUES block of the seed INSERT and assert no true literal.
    const m = CODE.match(/INSERT INTO public\.marketing_opportunity_definitions[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/i)
    expect(m, 'seed VALUES block found').toBeTruthy()
    const values = m![1]
    // Every seeded row ends its literal list with ", false)" — the enabled flag.
    // There must be at least 27 rows and NOT ONE ending in ", true)".
    const rowEndings = values.match(/,\s*(true|false)\)/g) || []
    expect(rowEndings.length).toBeGreaterThanOrEqual(27)
    for (const ending of rowEndings) {
      expect(ending).toMatch(/,\s*false\)/)
    }
  })

  it('uses the expected opportunity families', () => {
    for (const fam of ['winner', 'wallet', 'cadence', 'affinity', 'lifecycle', 'checkout', 'promotion']) {
      expect(FLAT).toContain(`'${fam}'`)
    }
  })
})

describe('009 — winner-marketing boundary (no loss / no streak framing)', () => {
  it('contains NO losing-streak / near-miss / loss-chasing / vulnerability definitions', () => {
    for (const banned of [
      'losing_streak',
      'loss_streak',
      'near_miss',
      'nearly_won',
      'almost_won',
      'chasing_losses',
      'chase_losses',
      'cumulative_loss',
      'loss_chasing',
      'due_a_win',
      'due_win',
      'ride_the_streak',
      'financial_vulnerability',
      'vulnerable',
    ]) {
      expect(FLAT.toLowerCase()).not.toContain(banned)
    }
  })

  it('documents the winner-marketing boundary in the header', () => {
    expect(FLAT).toMatch(/WINNER-MARKETING BOUNDARY/i)
    expect(FLAT).toMatch(/no loss signal/i)
  })
})

describe('009 — marketing_opportunities extensibility conversion', () => {
  it('drops the obsolete six-value opportunity_type CHECK', () => {
    expect(FLAT).toMatch(
      /ALTER TABLE public\.marketing_opportunities\s+DROP CONSTRAINT IF EXISTS marketing_opportunities_type_chk/i,
    )
  })

  it('makes automation_id nullable without dropping the column', () => {
    expect(FLAT).toMatch(
      /ALTER TABLE public\.marketing_opportunities\s+ALTER COLUMN automation_id DROP NOT NULL/i,
    )
    // The column is not dropped.
    expect(/DROP COLUMN\s+automation_id/i.test(EXEC)).toBe(false)
  })

  it('adds an FK opportunity_type -> marketing_opportunity_definitions ON DELETE RESTRICT', () => {
    expect(FLAT).toMatch(/ADD CONSTRAINT marketing_opportunities_type_fkey/i)
    expect(FLAT).toMatch(/FOREIGN KEY \(opportunity_type\)/i)
    expect(FLAT).toMatch(/REFERENCES public\.marketing_opportunity_definitions \(opportunity_key\)/i)
    expect(FLAT).toMatch(/ON DELETE RESTRICT/i)
  })

  it('does NOT rename opportunity_type', () => {
    expect(/RENAME COLUMN\s+opportunity_type/i.test(EXEC)).toBe(false)
  })

  it('leaves the other marketing_opportunities safety constraints untouched', () => {
    // These constraint names belong to migration 007 and must not be dropped by 009.
    for (const c of [
      'marketing_opportunities_identity_chk',
      'marketing_opportunities_email_lc_chk',
      'marketing_opportunities_state_chk',
      'marketing_opportunities_decision_mode_chk',
      'marketing_opportunities_score_range_chk',
      'marketing_opportunities_expiry_chk',
      'marketing_opportunities_dedupe_len_chk',
      'marketing_opportunities_reason_object_chk',
      'marketing_opportunities_context_object_chk',
    ]) {
      expect(EXEC).not.toContain(`DROP CONSTRAINT IF EXISTS ${c}`)
      expect(EXEC).not.toContain(`DROP CONSTRAINT ${c}`)
    }
    // Only the obsolete type CHECK is dropped.
    expect((EXEC.match(/DROP CONSTRAINT IF EXISTS/gi) || []).length).toBe(1)
  })
})

describe('009 — customer_marketing_intelligence', () => {
  it('creates the table with a user_id primary key and NO FK to auth.users', () => {
    expect(FLAT).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_marketing_intelligence/i)
    expect(FLAT).toMatch(/user_id\s+uuid\s+PRIMARY KEY/i)
    const m = EXEC.match(/CREATE TABLE IF NOT EXISTS public\.customer_marketing_intelligence \((.*?)\);/i)
    expect(m, 'intelligence table found').toBeTruthy()
    expect(/auth\.users/i.test(m![1])).toBe(false)
  })

  it('has the expected derived behavioural columns', () => {
    for (const col of [
      'orders_7d', 'orders_14d', 'orders_30d', 'orders_60d', 'orders_90d',
      'external_spend_30d_pence', 'external_spend_90d_pence',
      'average_external_order_value_pence', 'highest_external_order_value_pence',
      'previous_confirmed_at', 'average_purchase_gap_hours',
      'last_win_at', 'win_count', 'wins_30d', 'last_win_value_pence',
      'last_win_fulfilment_type', 'last_win_campaign_id',
      'last_wallet_credit_at', 'last_wallet_debit_at',
      'wallet_credit_received_30d_pence', 'wallet_spent_30d_pence',
      'last_abandoned_at', 'abandoned_7d_count', 'abandoned_30d_count',
      'last_abandoned_campaign_id', 'source_updated_at', 'refreshed_at',
    ]) {
      expect(FLAT).toContain(col)
    }
  })

  it('restricts last_win_fulfilment_type to verified WTF values only', () => {
    expect(FLAT).toMatch(
      /last_win_fulfilment_type IN \('cash', 'wallet_credit', 'manual'\)/i,
    )
  })

  it('constrains the order windows to be monotonically non-decreasing', () => {
    expect(FLAT).toMatch(
      /CONSTRAINT cmi_orders_window_monotonic_chk CHECK \(\s*orders_7d <= orders_14d\s*AND orders_14d <= orders_30d\s*AND orders_30d <= orders_60d\s*AND orders_60d <= orders_90d\s*\)/i,
    )
  })

  it('constrains 30d external spend to not exceed 90d external spend', () => {
    expect(FLAT).toMatch(
      /CONSTRAINT cmi_spend_window_monotonic_chk CHECK \(\s*external_spend_30d_pence <= external_spend_90d_pence\s*\)/i,
    )
  })

  it('constrains wins_30d to not exceed win_count', () => {
    expect(FLAT).toMatch(
      /CONSTRAINT cmi_wins_window_monotonic_chk CHECK \(\s*wins_30d <= win_count\s*\)/i,
    )
  })

  it('constrains abandoned_7d_count to not exceed abandoned_30d_count', () => {
    expect(FLAT).toMatch(
      /CONSTRAINT cmi_abandoned_window_monotonic_chk CHECK \(\s*abandoned_7d_count <= abandoned_30d_count\s*\)/i,
    )
  })

  it('constrains average order value to not exceed highest when both exist', () => {
    expect(FLAT).toMatch(
      /CONSTRAINT cmi_avg_le_highest_chk CHECK \(\s*average_external_order_value_pence IS NULL\s*OR highest_external_order_value_pence IS NULL\s*OR average_external_order_value_pence <= highest_external_order_value_pence\s*\)/i,
    )
  })

  it('stores no consent / eligibility columns (permission stays elsewhere)', () => {
    const m = EXEC.match(/CREATE TABLE IF NOT EXISTS public\.customer_marketing_intelligence \((.*?)\);/i)
    expect(m).toBeTruthy()
    const body = m![1].toLowerCase()
    expect(body).not.toContain('email_marketing_enabled')
    expect(body).not.toContain('marketing_eligible')
    expect(body).not.toContain('unsubscribed')
    expect(body).not.toContain('suppress')
    expect(body).not.toContain('consent')
  })

  it('has restrained useful indexes', () => {
    expect(FLAT).toMatch(/customer_marketing_intelligence_last_win_at_idx[\s\S]*?WHERE last_win_at IS NOT NULL/i)
    expect(FLAT).toMatch(/customer_marketing_intelligence_last_credit_at_idx/i)
    expect(FLAT).toMatch(/customer_marketing_intelligence_last_abandoned_at_idx/i)
    expect(FLAT).toMatch(/customer_marketing_intelligence_orders_30d_idx/i)
  })
})

describe('009 — customer_campaign_affinity', () => {
  it('creates the table with the composite primary key', () => {
    expect(FLAT).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_campaign_affinity/i)
    expect(FLAT).toMatch(/PRIMARY KEY \(user_id, affinity_type, affinity_key\)/i)
  })

  it('token-validates affinity_type/affinity_key but does NOT value-lock them', () => {
    expect(FLAT).toMatch(/affinity_type ~ '\^\[a-z0-9_\]\+\$'/i)
    expect(FLAT).toMatch(/affinity_key ~ '\^\[a-z0-9_-\]\+\$'/i)
    // No rigid IN (...) list permanently restricting affinity_type values.
    expect(/affinity_type IN \(/i.test(EXEC)).toBe(false)
  })

  it('affinity_type stays underscore/token-only (no hyphen)', () => {
    // affinity_type must NOT admit hyphens — only affinity_key does.
    expect(FLAT).toMatch(/affinity_type ~ '\^\[a-z0-9_\]\+\$'/i)
    expect(/affinity_type ~ '\^\[a-z0-9_-\]\+\$'/i.test(FLAT)).toBe(false)
  })

  it('affinity_key permits hyphens so UUID/slug-style keys are valid', () => {
    // The key pattern includes a hyphen inside the class, enabling campaign
    // UUIDs (which contain hyphens) as keys for affinity_type = campaign.
    expect(FLAT).toMatch(/affinity_key ~ '\^\[a-z0-9_-\]\+\$'/i)
    // A representative campaign UUID matches the key pattern.
    const keyPattern = /^[a-z0-9_-]+$/
    expect(keyPattern.test('9f8b2c1a-4d3e-4a2b-8c7d-1e2f3a4b5c6d')).toBe(true)
    // ...but still rejects whitespace / illegal characters.
    expect(keyPattern.test('bad key')).toBe(false)
    expect(keyPattern.test('BAD-UPPER')).toBe(false)
    // The bounded length (1..100) is retained.
    expect(FLAT).toMatch(/char_length\(affinity_key\) BETWEEN 1 AND 100/i)
  })

  it('indexes affinity_type + affinity_key lookups', () => {
    expect(FLAT).toMatch(/customer_campaign_affinity_type_key_idx\s+ON public\.customer_campaign_affinity \(affinity_type, affinity_key\)/i)
  })
})

describe('009 — RLS, grants, and no-signal-table guarantees', () => {
  it('enables and forces RLS on every new table', () => {
    for (const t of [
      'marketing_opportunity_definitions',
      'customer_marketing_intelligence',
      'customer_campaign_affinity',
    ]) {
      expect(FLAT).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, 'i'))
      expect(FLAT).toMatch(new RegExp(`ALTER TABLE public\\.${t} FORCE\\s+ROW LEVEL SECURITY`, 'i'))
    }
  })

  it('revokes anon/authenticated and grants service_role only (no DELETE) on every new table', () => {
    for (const t of [
      'marketing_opportunity_definitions',
      'customer_marketing_intelligence',
      'customer_campaign_affinity',
    ]) {
      expect(FLAT).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`, 'i'))
      expect(FLAT).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE ON public\\.${t} TO service_role`, 'i'))
    }
    // No DELETE granted anywhere in the migration.
    expect(/GRANT[^;]*\bDELETE\b/i.test(EXEC)).toBe(false)
  })

  it('explicitly revokes ALL from service_role BEFORE the restricted grant on every new table', () => {
    for (const t of [
      'marketing_opportunity_definitions',
      'customer_marketing_intelligence',
      'customer_campaign_affinity',
    ]) {
      // The explicit hardening revoke exists...
      const revokeRe = new RegExp(`REVOKE ALL ON public\\.${t} FROM service_role`, 'i')
      expect(revokeRe.test(FLAT)).toBe(true)
      // ...and it appears BEFORE the service_role grant for that same table.
      const revokeIdx = EXEC.search(
        new RegExp(`REVOKE ALL ON public\\.${t} FROM service_role`, 'i'),
      )
      const grantIdx = EXEC.search(
        new RegExp(`GRANT SELECT, INSERT, UPDATE ON public\\.${t} TO service_role`, 'i'),
      )
      expect(revokeIdx).toBeGreaterThanOrEqual(0)
      expect(grantIdx).toBeGreaterThanOrEqual(0)
      expect(revokeIdx).toBeLessThan(grantIdx)
    }
  })

  it('grants service_role EXACTLY SELECT, INSERT, UPDATE on every new table (no DELETE verb)', () => {
    for (const t of [
      'marketing_opportunity_definitions',
      'customer_marketing_intelligence',
      'customer_campaign_affinity',
    ]) {
      const grantMatch = FLAT.match(
        new RegExp(`GRANT ([^;]*?) ON public\\.${t} TO service_role`, 'i'),
      )
      expect(grantMatch, `grant present for ${t}`).toBeTruthy()
      const verbs = grantMatch![1]
        .split(',')
        .map((v) => v.trim().toUpperCase())
        .sort()
      expect(verbs).toEqual(['INSERT', 'SELECT', 'UPDATE'])
      expect(verbs).not.toContain('DELETE')
    }
  })

  it('explicitly revokes DELETE on the existing marketing_opportunities ledger', () => {
    expect(FLAT).toMatch(/REVOKE DELETE ON public\.marketing_opportunities FROM service_role/i)
  })

  it('does NOT otherwise re-grant or alter marketing_opportunities permissions', () => {
    // The only permission statement touching marketing_opportunities is the
    // defensive DELETE revoke: no new GRANT and no REVOKE ALL on the ledger.
    expect(/GRANT[^;]*ON public\.marketing_opportunities\b/i.test(EXEC)).toBe(false)
    expect(/REVOKE ALL ON public\.marketing_opportunities\b/i.test(EXEC)).toBe(false)
  })

  it('creates NO customer_marketing_signals or marketing_signal_definitions table', () => {
    expect(/CREATE TABLE[^;]*customer_marketing_signals/i.test(EXEC)).toBe(false)
    expect(/CREATE TABLE[^;]*marketing_signal_definitions/i.test(EXEC)).toBe(false)
  })

  it('does NOT ALTER customer_marketing_profiles', () => {
    expect(/ALTER TABLE\s+public\.customer_marketing_profiles/i.test(EXEC)).toBe(false)
  })
})

describe('009 — dynamic overview RPC', () => {
  it('re-creates the overview function with the required attributes', () => {
    expect(FLAT).toMatch(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_overview\(\)/i)
    const decl = FLAT.match(/RETURNS jsonb\s+LANGUAGE plpgsql\s+([\s\S]*?)\s+AS \$\$/i)
    expect(decl, 'declaration present').toBeTruthy()
    expect(decl![1]).toMatch(/\bSTABLE\b/i)
    expect(decl![1]).toMatch(/SECURITY DEFINER/i)
    expect(decl![1]).toMatch(/SET search_path = public, pg_temp/i)
    expect(decl![1]).toMatch(/SET statement_timeout = '10s'/i)
  })

  it('builds countByType dynamically from the catalogue (no six hard-coded VALUES)', () => {
    expect(FLAT).toMatch(
      /jsonb_object_agg\(d\.opportunity_key, COALESCE\(c\.cnt, 0\)\)[\s\S]*?FROM public\.marketing_opportunity_definitions d/i,
    )
    // The obsolete hard-coded six-type VALUES list is gone from the RPC.
    expect(FLAT).not.toMatch(
      /VALUES\s*\(\s*'vip_early_access'\s*\),\s*\(\s*'abandoned_checkout'\s*\)/i,
    )
  })

  it('keeps the state counts and selected decision-mode counts', () => {
    expect(FLAT).toMatch(/'deterministicSelected', count\(\*\) FILTER \(WHERE decision_mode = 'deterministic' AND state = 'selected'\)/i)
    expect(FLAT).toMatch(/'aiSelected', count\(\*\) FILTER \(WHERE decision_mode = 'ai' AND state = 'selected'\)/i)
    expect(FLAT).toMatch(/'countByState', v_by_state/i)
  })

  it('exposes aggregate definition counts but NOT descriptions or raw rows', () => {
    expect(FLAT).toMatch(/'enabledDefinitionCount', v_def_enabled/i)
    expect(FLAT).toMatch(/'totalDefinitionCount', v_def_total/i)
    // The RPC does not select display_name/description into its output.
    const fn = FLAT.match(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_overview[\s\S]*?\$\$;/i)
    expect(fn).toBeTruthy()
    expect(/display_name/i.test(fn![0])).toBe(false)
    expect(/\bdescription\b/i.test(fn![0])).toBe(false)
  })

  it('is service-role-only EXECUTE', () => {
    expect(FLAT).toMatch(/REVOKE ALL ON FUNCTION public\.get_admin_marketing_opportunity_overview\(\) FROM public, anon, authenticated/i)
    expect(FLAT).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_opportunity_overview\(\) TO service_role/i)
  })
})

describe('009 — completely inert (no data processing, nothing goes live)', () => {
  it('inserts ONLY catalogue definition rows (no other INSERT)', () => {
    const inserts = EXEC.match(/INSERT INTO public\.[a-z_]+/gi) || []
    expect(inserts.length).toBe(1)
    expect(inserts[0]).toMatch(/INSERT INTO public\.marketing_opportunity_definitions/i)
  })

  it('creates no opportunities, recipients, or automation runs', () => {
    expect(/INSERT INTO public\.marketing_opportunities/i.test(EXEC)).toBe(false)
    expect(/INSERT INTO public\.marketing_recipients/i.test(EXEC)).toBe(false)
    expect(/INSERT INTO public\.marketing_automation_runs/i.test(EXEC)).toBe(false)
  })

  it('populates NO customer behavioural data (intelligence & affinity stay empty)', () => {
    expect(/INSERT INTO public\.customer_marketing_intelligence/i.test(EXEC)).toBe(false)
    expect(/INSERT INTO public\.customer_campaign_affinity/i.test(EXEC)).toBe(false)
  })

  it('scans no behavioural source tables', () => {
    for (const t of ['checkout_intents', 'instant_win_awards', 'wallet_transactions', 'entries', 'ticket_allocations']) {
      expect(EXEC).not.toContain(t)
    }
  })

  it('adds no cron, no AI, no Resend/email', () => {
    expect(/resend|nodemailer|smtp|mailgun|sendEmail/i.test(EXEC)).toBe(false)
    expect(/cron/i.test(EXEC)).toBe(false)
    expect(/openai|anthropic|ai_gateway|generateText/i.test(EXEC)).toBe(false)
  })

  it('enables no definition and no automation, and never flips the control state on', () => {
    // No UPDATE that sets enabled = true anywhere.
    expect(/enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/sending_enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/discovery_enabled\s*=\s*true/i.test(EXEC)).toBe(false)
  })

  it('creates exactly the three new tables and no others', () => {
    const creates = EXEC.match(/CREATE TABLE IF NOT EXISTS public\.[a-z_]+/gi) || []
    expect(creates.length).toBe(3)
    expect(creates.join(' ')).toMatch(/marketing_opportunity_definitions/i)
    expect(creates.join(' ')).toMatch(/customer_marketing_intelligence/i)
    expect(creates.join(' ')).toMatch(/customer_campaign_affinity/i)
  })
})
