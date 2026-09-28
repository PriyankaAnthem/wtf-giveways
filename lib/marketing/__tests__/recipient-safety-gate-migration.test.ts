import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Stage 3D1 / migration 018 — deterministic recipient safety gate.
// Pure STATIC-CONTRACT tests: assert the committed SQL text. No DB connection.
// ---------------------------------------------------------------------------
const ROOT = process.cwd()
const SQL_PATH = join(ROOT, 'scripts/marketing/018-marketing-recipient-safety-gate.sql')
const RAW = readFileSync(SQL_PATH, 'utf8')

// Comment-stripped, whitespace-collapsed executable view.
const FLAT_EXEC = RAW.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ')
  .trim()

// Also strip single-quoted string literals so prose/messages can't mask a match.
const FLAT_EXEC_NOSTR = FLAT_EXEC.replace(/'(?:[^']|'')*'/g, "''")

const PRIVATE_FN = 'public.wtf_marketing_recipient_gate_preview()'
const OVERVIEW_FN = 'public.get_admin_marketing_recipient_gate_overview()'
const SAMPLE_FN = 'public.get_admin_marketing_recipient_gate_sample(integer)'

describe('018 recipient safety gate — migration hygiene', () => {
  it('1. migrations 001-017 are untouched (only 018 added)', () => {
    // 018 must not contain DDL that edits earlier migration objects destructively.
    expect(/DROP\s+TABLE/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    // No ALTER of the recipient/opportunity tables (no schema change).
    expect(/ALTER TABLE\s+public\.marketing_recipients/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_opportunities/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('2. explicit trigger-function REVOKEs exist for PUBLIC/anon/authenticated/service_role', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.marketing_recipients_guard_opportunity_link\\(\\) FROM ${role}`,
          'i',
        ).test(FLAT_EXEC),
      ).toBe(true)
    }
  })

  it('3. no table DML writes (no INSERT/UPDATE/DELETE of data)', () => {
    expect(/\bINSERT\s+INTO\b/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/\bUPDATE\s+public\./i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/\bDELETE\s+FROM\b/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    // The only temp table is the read-only baseline (ON COMMIT DROP).
    expect(/CREATE TEMP TABLE tmp_marketing_3d1_baseline[\s\S]*ON COMMIT DROP/i.test(FLAT_EXEC)).toBe(true)
  })

  it('59. no schema changes to any table (only functions/temp/ grants)', () => {
    expect(/ADD COLUMN|DROP COLUMN|ADD CONSTRAINT|CREATE INDEX|CREATE TABLE (?!TEMP)/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('60. migrations 001-017 files still present on disk', () => {
    for (const n of [
      '001-marketing-consent-foundation',
      '003-customer-marketing-profile',
      '005-marketing-automation-foundation',
      '007-marketing-opportunity-foundation',
      '009-marketing-intelligence-foundation',
      '017-marketing-recipient-opportunity-linkage-foundation',
    ]) {
      expect(() => readFileSync(join(ROOT, `scripts/marketing/${n}.sql`), 'utf8')).not.toThrow()
    }
  })
})

describe('018 recipient safety gate — functions & security', () => {
  it('4. private gate exists with STABLE SECURITY DEFINER + safe search_path', () => {
    expect(new RegExp(`CREATE OR REPLACE FUNCTION ${escapeFn(PRIVATE_FN)}`, 'i').test(FLAT_EXEC)).toBe(true)
    // The private gate declaration carries the required attributes.
    const decl = sliceFn(FLAT_EXEC, 'wtf_marketing_recipient_gate_preview')
    expect(/STABLE/i.test(decl)).toBe(true)
    expect(/SECURITY DEFINER/i.test(decl)).toBe(true)
    expect(/SET search_path = public, pg_temp/i.test(decl)).toBe(true)
  })

  it('5+6. private gate direct EXECUTE revoked from service_role AND anon/authenticated/PUBLIC', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(
        new RegExp(`REVOKE ALL ON FUNCTION ${escapeFn(PRIVATE_FN)} FROM ${role}`, 'i').test(FLAT_EXEC),
      ).toBe(true)
    }
    // Private gate must never be GRANTed to anyone.
    expect(new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeFn(PRIVATE_FN)}`, 'i').test(FLAT_EXEC)).toBe(false)
  })

  it('7. admin overview is service-role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(new RegExp(`REVOKE ALL ON FUNCTION ${escapeFn(OVERVIEW_FN)} FROM ${role}`, 'i').test(FLAT_EXEC)).toBe(true)
    }
    expect(new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeFn(OVERVIEW_FN)} TO service_role`, 'i').test(FLAT_EXEC)).toBe(true)
    const decl = sliceFn(FLAT_EXEC, 'get_admin_marketing_recipient_gate_overview')
    expect(/SECURITY DEFINER/i.test(decl)).toBe(true)
    expect(/SET search_path = public, pg_temp/i.test(decl)).toBe(true)
  })

  it('8. admin sample is service-role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(new RegExp(`REVOKE ALL ON FUNCTION ${escapeFn(SAMPLE_FN)} FROM ${role}`, 'i').test(FLAT_EXEC)).toBe(true)
    }
    expect(new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeFn(SAMPLE_FN)} TO service_role`, 'i').test(FLAT_EXEC)).toBe(true)
    const decl = sliceFn(FLAT_EXEC, 'get_admin_marketing_recipient_gate_sample')
    expect(/SECURITY DEFINER/i.test(decl)).toBe(true)
    expect(/SET search_path = public, pg_temp/i.test(decl)).toBe(true)
  })
})

describe('018 recipient safety gate — identity & gates 1-6', () => {
  it('9+10. user identity required; external contact fails closed', () => {
    expect(/o\.user_id IS NOT NULL AND o\.external_contact_id IS NULL/i.test(FLAT_EXEC)).toBe(true)
    expect(/external_contact_not_supported/.test(FLAT_EXEC)).toBe(true)
  })

  it('11. profile match required', () => {
    expect(/LEFT JOIN public\.customer_marketing_profiles p ON p\.user_id = o\.user_id/i.test(FLAT_EXEC)).toBe(true)
    expect(/profile_unmatched/.test(FLAT_EXEC)).toBe(true)
  })

  it('12-14. account active / email confirmed / email presence required', () => {
    expect(/account_inactive/.test(FLAT_EXEC)).toBe(true)
    expect(/email_unconfirmed/.test(FLAT_EXEC)).toBe(true)
    expect(/email_missing/.test(FLAT_EXEC)).toBe(true)
    expect(/btrim\(b\.email_lc\) <> ''/i.test(FLAT_EXEC)).toBe(true)
  })

  it('15-17. marketing_enabled, suppression, authoritative eligibility recheck', () => {
    expect(/marketing_disabled/.test(FLAT_EXEC)).toBe(true)
    expect(/active_suppression/.test(FLAT_EXEC)).toBe(true)
    expect(/authoritative_marketing_ineligible/.test(FLAT_EXEC)).toBe(true)
    expect(/public\.is_marketing_email_eligible\(o\.user_id, p\.email_lc\)/i.test(FLAT_EXEC)).toBe(true)
  })

  it('18. cached snapshot is diagnostic only (never contributes to eligibility)', () => {
    // marketing_eligible_snapshot appears only as a passthrough/diagnostic column,
    // never inside the pre_nba_gate_eligible conjunction.
    const preNba = sliceBetween(FLAT_EXEC, 'AS pre_nba_gate_eligible', 'FROM flags f')
    expect(preNba.length).toBeGreaterThan(0)
    expect(/marketing_eligible_snapshot/i.test(preNba)).toBe(false)
  })

  it('19+20. opportunity open + not expired required', () => {
    expect(/opportunity_not_open/.test(FLAT_EXEC)).toBe(true)
    expect(/opportunity_expired/.test(FLAT_EXEC)).toBe(true)
    expect(/f\.state = 'open'/i.test(FLAT_EXEC)).toBe(true)
    expect(/f\.expires_at > now\(\)/i.test(FLAT_EXEC)).toBe(true)
  })

  it('21+22. definition must exist and be enabled', () => {
    expect(/LEFT JOIN public\.marketing_opportunity_definitions d ON d\.opportunity_key = o\.opportunity_type/i.test(FLAT_EXEC)).toBe(true)
    expect(/definition_missing/.test(FLAT_EXEC)).toBe(true)
    expect(/definition_disabled/.test(FLAT_EXEC)).toBe(true)
  })

  it('23-27. campaign context: id + exists + live + end null/future; non-campaign requires null', () => {
    expect(/LEFT JOIN public\.campaigns c ON c\.id = o\.campaign_id/i.test(FLAT_EXEC)).toBe(true)
    expect(/c\.status = 'live' AND \(c\.end_at IS NULL OR c\.end_at > now\(\)\)/i.test(FLAT_EXEC)).toBe(true)
    expect(/b\.campaign_id IS NOT NULL AND b\.campaign_row_exists AND b\.campaign_live/i.test(FLAT_EXEC)).toBe(true)
    // non-campaign requires NULL campaign
    expect(/ELSE \(b\.campaign_id IS NULL\)/i.test(FLAT_EXEC)).toBe(true)
    expect(/campaign_context_invalid/.test(FLAT_EXEC)).toBe(true)
  })
})

describe('018 recipient safety gate — gates 7-9 & global control', () => {
  it('28. existing recipient checked via Stage 017 opportunity_id linkage', () => {
    expect(/EXISTS \(\s*SELECT 1 FROM public\.marketing_recipients r2 WHERE r2\.opportunity_id = o\.id\s*\)/i.test(FLAT_EXEC)).toBe(true)
    expect(/existing_recipient/.test(FLAT_EXEC)).toBe(true)
  })

  it('29+30. caps use control-state columns (not hardcoded 1/3)', () => {
    expect(/maximum_daily_per_contact/.test(FLAT_EXEC)).toBe(true)
    expect(/maximum_weekly_per_contact/.test(FLAT_EXEC)).toBe(true)
    // No literal numeric cap comparison against sends.
    expect(/sends_last_24h\s*[<>=]+\s*[13]\b/i.test(FLAT_EXEC)).toBe(false)
  })

  it('31-34. rolling 24h/7d over sent_at only; not delivered/clicked/etc', () => {
    expect(/now\(\) - interval '24 hours'/i.test(FLAT_EXEC)).toBe(true)
    expect(/now\(\) - interval '7 days'/i.test(FLAT_EXEC)).toBe(true)
    const freqCte = sliceBetween(FLAT_EXEC, 'freq AS (', ') , base AS')
    const freq = freqCte.length ? freqCte : sliceBetween(FLAT_EXEC, 'freq AS (', 'base AS (')
    expect(/r\.sent_at IS NOT NULL/i.test(freq)).toBe(true)
    expect(/delivered_at|clicked_at|bounced_at|complained_at/i.test(freq)).toBe(false)
  })

  it('35. invalid frequency config fails closed', () => {
    expect(/frequency_configuration_invalid/.test(FLAT_EXEC)).toBe(true)
    expect(/daily_frequency_limit > 0 AND b\.weekly_frequency_limit > 0/i.test(FLAT_EXEC)).toBe(true)
    expect(/daily_frequency_cap/.test(FLAT_EXEC)).toBe(true)
    expect(/weekly_frequency_cap/.test(FLAT_EXEC)).toBe(true)
  })

  it('36-41. NBA ranks only survivors, partition by user, deterministic order', () => {
    // Rank guarded by pre_nba_gate_eligible; survivors sorted first.
    expect(/WHEN c\.pre_nba_gate_eligible\s*THEN row_number\(\) OVER \(/i.test(FLAT_EXEC)).toBe(true)
    expect(/PARTITION BY c\.user_id/i.test(FLAT_EXEC)).toBe(true)
    expect(/ORDER BY \(NOT c\.pre_nba_gate_eligible\), c\.base_priority ASC, c\.score DESC NULLS LAST, c\.detected_at DESC, c\.opportunity_id ASC/i.test(FLAT_EXEC)).toBe(true)
    expect(/not_next_best_action/.test(FLAT_EXEC)).toBe(true)
  })

  it('42+43. gateEligible independent of sending; sendableNow requires sending', () => {
    expect(/r\.pre_nba_gate_eligible AND r\.next_best_rank = 1\)\s*AS gate_eligible/i.test(FLAT_EXEC)).toBe(true)
    expect(/r\.pre_nba_gate_eligible AND r\.next_best_rank = 1 AND COALESCE\(r\.global_sending_enabled, false\)\)\s*AS sendable_now/i.test(FLAT_EXEC)).toBe(true)
    expect(/global_sending_disabled/.test(FLAT_EXEC)).toBe(true)
    // Global sending flag must NOT appear inside the pre_nba conjunction.
    const preNba = sliceBetween(FLAT_EXEC, 'AS pre_nba_gate_eligible', 'FROM flags f')
    expect(/global_sending_enabled/i.test(preNba)).toBe(false)
  })
})

describe('018 recipient safety gate — output safety & PII', () => {
  const ALLOWED_CODES = [
    'external_contact_not_supported', 'profile_unmatched', 'account_inactive', 'email_unconfirmed',
    'email_missing', 'marketing_disabled', 'active_suppression', 'authoritative_marketing_ineligible',
    'opportunity_not_open', 'opportunity_expired', 'definition_missing', 'definition_disabled',
    'campaign_context_invalid', 'existing_recipient', 'frequency_configuration_invalid',
    'daily_frequency_cap', 'weekly_frequency_cap', 'not_next_best_action', 'global_sending_disabled',
  ]

  it('44. only safe blocker codes are emitted', () => {
    // Every ARRAY['x'] literal used for blockers must be in the allowed set.
    const codes = Array.from(FLAT_EXEC.matchAll(/ARRAY\['([a-z_]+)'\]/g)).map((m) => m[1])
    expect(codes.length).toBeGreaterThan(0)
    for (const c of codes) expect(ALLOWED_CODES).toContain(c)
  })

  it('45. overview exposes no identity fields', () => {
    const decl = sliceFn(FLAT_EXEC, 'get_admin_marketing_recipient_gate_overview')
    expect(/email_lc|user_id|campaign_id|opportunity_id|external_contact_id/i.test(decl.replace(/user_id IS (NOT )?NULL/gi, ''))).toBe(false)
  })

  it('46. sample exposes only safe fields (no raw identifiers)', () => {
    const decl = sliceFn(FLAT_EXEC, 'get_admin_marketing_recipient_gate_sample')
    expect(/customerHash/.test(decl)).toBe(true)
    expect(/md5\(/.test(decl)).toBe(true)
    // Must NOT select raw identity/email/campaign/opportunity columns as output.
    // (Safe booleans like "emailConfirmed" are allowed; only raw email_lc is banned.)
    expect(/g\.email_lc\b/i.test(decl)).toBe(false)
    expect(/g\.user_id\b(?![:)])/i.test(decl.replace(/coalesce\(g\.user_id::text[^)]*\)/gi, ''))).toBe(false)
    expect(/AS "?emailLc"?/i.test(decl)).toBe(false)
    // campaignContext is a boolean derived from campaign_id IS NOT NULL, not the id.
    expect(/g\.campaign_id IS NOT NULL\)\s*AS "campaignContext"/i.test(decl)).toBe(true)
  })

  it('47. sample clamps limit to 1..100 (default 25)', () => {
    expect(/p_limit integer DEFAULT 25/i.test(FLAT_EXEC)).toBe(true)
    expect(/LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 100\)/i.test(FLAT_EXEC)).toBe(true)
  })
})

describe('018 recipient safety gate — install preflight & post-install', () => {
  it('48+49. post-install asserts gateEligible=0 and sendableNow=0', () => {
    expect(/final,gateEligible/.test(FLAT_EXEC)).toBe(true)
    expect(/final,sendableNow/.test(FLAT_EXEC)).toBe(true)
    expect(/gateEligible=% but MUST be 0/i.test(RAW)).toBe(true)
    expect(/sendableNow=% but MUST be 0/i.test(RAW)).toBe(true)
  })

  it('50-54. counts/controls/definitions invariants asserted', () => {
    expect(/recipient count changed/i.test(RAW)).toBe(true)
    expect(/run count changed/i.test(RAW)).toBe(true)
    expect(/opportunity count is % \(before %\); expected 6 unchanged/i.test(RAW)).toBe(true)
    expect(/control state changed/i.test(RAW)).toBe(true)
    expect(/definition\(s\) enabled; expected 0/i.test(RAW)).toBe(true)
  })

  it('preflight requires paused state, 0 defs, 6-row distribution, 0 recipients/runs, Stage 017 linkage', () => {
    expect(/Marketing not paused/i.test(RAW)).toBe(true)
    expect(/marketing_opportunities holds % row\(s\); expected 6/i.test(RAW)).toBe(true)
    expect(/expected 0 for controlled install/i.test(RAW)).toBe(true)
    expect(/marketing_recipients_opportunity_fk/i.test(RAW)).toBe(true)
    expect(/marketing_recipients_opportunity_unique_idx/i.test(RAW)).toBe(true)
    expect(/marketing_recipients_opportunity_link_immutable_trg/i.test(RAW)).toBe(true)
  })

  it('post-install verifies privilege matrix for all three functions and trigger fn', () => {
    expect(new RegExp(`has_function_privilege\\('service_role', '${escapeFn(PRIVATE_FN)}', 'EXECUTE'\\)`, 'i').test(FLAT_EXEC)).toBe(true)
    expect(new RegExp(`has_function_privilege\\('service_role', '${escapeFn(OVERVIEW_FN)}', 'EXECUTE'\\)`, 'i').test(FLAT_EXEC)).toBe(true)
    expect(new RegExp(`has_function_privilege\\('service_role', '${escapeFn(SAMPLE_FN)}', 'EXECUTE'\\)`, 'i').test(FLAT_EXEC)).toBe(true)
  })
})

describe('018 recipient safety gate — forbidden operations', () => {
  it('55-58. no materialisation / email / AI / cron', () => {
    expect(/pg_cron|cron\.schedule/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/resend|smtp|send_email|net\.http|http_post/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/openai|gpt|anthropic|\bai_/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    // No enabling of sending/discovery/definitions.
    expect(/sending_enabled\s*=\s*true/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/discovery_enabled\s*=\s*true/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/SET enabled\s*=\s*true/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('single atomic transaction with lock/statement timeouts and advisory lock', () => {
    expect(/^BEGIN;/m.test(RAW)).toBe(true)
    expect(/COMMIT;/m.test(RAW)).toBe(true)
    expect(/SET LOCAL lock_timeout/i.test(RAW)).toBe(true)
    expect(/SET LOCAL statement_timeout/i.test(RAW)).toBe(true)
    expect(/pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3d1_recipient_safety_gate'\)\)/i.test(RAW)).toBe(true)
  })
})

describe('018 recipient safety gate — frequency-config contract fix', () => {
  it('C1. private RETURNS TABLE declares frequency_config_valid boolean', () => {
    const cols = privateReturnsColumns()
    expect(cols).toContain('frequency_config_valid')
    // Declared as boolean.
    expect(/frequency_config_valid\s+boolean/i.test(FLAT_EXEC)).toBe(true)
  })

  it('C2. private final SELECT emits frequency_config_valid in the matching position', () => {
    // It must be emitted between weekly_frequency_limit and frequency_eligible,
    // exactly mirroring the RETURNS TABLE ordering.
    expect(
      /r\.weekly_frequency_limit,\s*r\.frequency_config_valid,\s*r\.frequency_eligible,/i.test(FLAT_EXEC),
    ).toBe(true)
    const cols = privateReturnsColumns()
    const iLimit = cols.indexOf('weekly_frequency_limit')
    const iCfg = cols.indexOf('frequency_config_valid')
    const iElig = cols.indexOf('frequency_eligible')
    expect(iLimit).toBeGreaterThanOrEqual(0)
    expect(iCfg).toBe(iLimit + 1)
    expect(iElig).toBe(iCfg + 1)
  })

  it('C3. overview references ONLY columns actually returned by the private gate', () => {
    const declared = new Set(privateReturnsColumns())
    const overviewDecl = sliceFn(FLAT_EXEC, 'get_admin_marketing_recipient_gate_overview')
    // (a) No qualified g.<col> reference may be undeclared.
    const refs = qualifiedGRefs(overviewDecl)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) expect(declared.has(r), `overview references undeclared g.${r}`).toBe(true)
    // (b) frequency_config_valid — the previously-undeclared column — is now both
    // declared by the private gate AND referenced by the overview (unqualified,
    // inside the frequency FILTER clauses).
    expect(declared.has('frequency_config_valid')).toBe(true)
    expect(/FILTER \(WHERE frequency_config_valid\b/i.test(overviewDecl)).toBe(true)
  })

  it('C3b. sample references ONLY columns actually returned by the private gate', () => {
    const declared = new Set(privateReturnsColumns())
    const refs = qualifiedGRefs(sliceFn(FLAT_EXEC, 'get_admin_marketing_recipient_gate_sample'))
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) expect(declared.has(r), `sample references undeclared g.${r}`).toBe(true)
  })

  it('C4. underDailyCap uses frequency_config_valid + sends_last_24h + daily_frequency_limit', () => {
    expect(
      /'underDailyCap',\s*\(SELECT count\(\*\) FILTER \(WHERE frequency_config_valid AND sends_last_24h < daily_frequency_limit\)/i.test(
        FLAT_EXEC,
      ),
    ).toBe(true)
  })

  it('C5. underWeeklyCap uses frequency_config_valid + sends_last_7d + weekly_frequency_limit', () => {
    expect(
      /'underWeeklyCap',\s*\(SELECT count\(\*\) FILTER \(WHERE frequency_config_valid AND sends_last_7d < weekly_frequency_limit\)/i.test(
        FLAT_EXEC,
      ),
    ).toBe(true)
  })

  it('C6. frequency_config_valid is fail-closed: present + strictly-positive both limits, no hardcoded 1/3', () => {
    expect(
      /\(b\.daily_frequency_limit IS NOT NULL AND b\.weekly_frequency_limit IS NOT NULL AND b\.daily_frequency_limit > 0 AND b\.weekly_frequency_limit > 0\) AS frequency_config_valid/i.test(
        FLAT_EXEC,
      ),
    ).toBe(true)
    // Caps come from control columns, never literal 1/3 defaults.
    expect(/COALESCE\([^)]*,\s*[13]\)\s+AS (daily|weekly)_frequency_limit/i.test(FLAT_EXEC)).toBe(false)
  })

  it('C7. control singleton is a guaranteed single-row CTE (no zero-row CROSS JOIN annihilation)', () => {
    // The cs CTE must be a FROM-less scalar-subquery singleton, not a direct
    // SELECT ... FROM marketing_control_state WHERE key='default' that can be empty.
    const csDecl = sliceBetween(FLAT_EXEC, 'WITH cs AS (', '), freq AS (')
    expect(csDecl.length).toBeGreaterThan(0)
    // Three scalar subqueries, one per control field.
    expect((csDecl.match(/\(SELECT [^)]*FROM public\.marketing_control_state[^)]*\)/gi) || []).length).toBe(3)
    // The old empty-prone shape (bare FROM ... WHERE key='default' as the CTE body) is gone.
    expect(/WITH cs AS \(\s*SELECT sending_enabled, maximum_daily_per_contact, maximum_weekly_per_contact\s+FROM public\.marketing_control_state/i.test(FLAT_EXEC)).toBe(false)
    // CROSS JOIN cs remains (now safe because cs always has exactly one row).
    expect(/CROSS JOIN cs/i.test(FLAT_EXEC)).toBe(true)
  })

  it('C8. missing control singleton fails closed per-opportunity (NULLs -> false), never drops rows', () => {
    // sending -> COALESCE(...,false) at final SELECT.
    expect(/COALESCE\(r\.global_sending_enabled, false\)\s*AS global_sending_enabled/i.test(FLAT_EXEC)).toBe(true)
    // NULL frequency limits force frequency_config_valid=false via the IS NOT NULL guards (already asserted in C6),
    // which forces frequency_configuration_invalid and pre_nba=false. No filtering of opportunities on cs.
    // Assert base CTE selects FROM marketing_opportunities as the driving table (so all opps are represented).
    expect(/FROM public\.marketing_opportunities o\b/i.test(FLAT_EXEC)).toBe(true)
    // cs contributes columns via CROSS JOIN only; it is never referenced in a
    // predicate that could exclude an opportunity (no "WHERE cs." / "cs. IS NULL").
    expect(/WHERE\s+cs\./i.test(FLAT_EXEC)).toBe(false)
    expect(/AND\s+cs\.\w+\s+IS/i.test(FLAT_EXEC)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Parse the ordered list of column names declared in the private gate's
// RETURNS TABLE ( ... ) clause.
function privateReturnsColumns(): string[] {
  const start = FLAT_EXEC.indexOf('FUNCTION public.wtf_marketing_recipient_gate_preview()')
  const rtStart = FLAT_EXEC.indexOf('RETURNS TABLE (', start)
  if (rtStart < 0) return []
  const open = rtStart + 'RETURNS TABLE ('.length
  // Find matching close paren.
  let depth = 1
  let i = open
  for (; i < FLAT_EXEC.length && depth > 0; i++) {
    if (FLAT_EXEC[i] === '(') depth++
    else if (FLAT_EXEC[i] === ')') depth--
  }
  const body = FLAT_EXEC.slice(open, i - 1)
  return body
    .split(',')
    .map((seg) => seg.trim().split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name))
}

// Collect distinct qualified g.<column> references within a function body slice.
function qualifiedGRefs(decl: string): string[] {
  const out = new Set<string>()
  for (const m of decl.matchAll(/\bg\.([a-z_][a-z0-9_]*)/gi)) out.add(m[1])
  return Array.from(out)
}

function escapeFn(sig: string): string {
  return sig.replace(/[.()]/g, (m) => `\\${m}`)
}

// Slice the CREATE OR REPLACE FUNCTION ... body up to its language/attr tail,
// for a given function name, from the flattened text.
function sliceFn(flat: string, name: string): string {
  const start = flat.indexOf(`FUNCTION public.${name}`)
  if (start < 0) return ''
  // End at the GRANT/REVOKE block that follows the COMMENT for that function.
  const after = flat.indexOf(`COMMENT ON FUNCTION public.${name}`, start)
  return after < 0 ? flat.slice(start) : flat.slice(start, after)
}

function sliceBetween(flat: string, from: string, to: string): string {
  const a = flat.indexOf(from)
  if (a < 0) return ''
  const b = flat.indexOf(to, a + from.length)
  return b < 0 ? flat.slice(a) : flat.slice(a + from.length, b)
}
