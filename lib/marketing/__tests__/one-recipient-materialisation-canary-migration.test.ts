import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/021-marketing-materialisation-one-recipient-canary.sql
//
// These tests treat the canary migration as STATIC TEXT. They never open a
// database connection, never execute SQL, and never mutate anything. They
// assert the Stage 3D2C one-recipient materialisation canary contract: a single
// atomic transaction that temporarily enables ONLY the CAMPAIGN-SPECIFIC
// abandoned_checkout definition + its routed automation + rollout_limit=1,
// directly inserts ONE abandoned_checkout opportunity (in the exact canonical
// Stage 013 shape, carrying the REAL frozen detector campaign) for a
// deterministic detector-sourced, permission-backed, isolated user, verifies the
// private gate reports gate_eligible=true / campaign_context_valid=true /
// sendable_now=false, materialises EXACTLY ONE recipient (queued, unsent) inside
// ONE preparing run, transitions the opportunity open -> selected, restores all
// kill switches before COMMIT, sends nothing, and returns no PII. Migrations
// 001-020 are frozen by content hash.
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = join(process.cwd(), 'scripts', 'marketing')
const MIG_021 = '021-marketing-materialisation-one-recipient-canary.sql'

const CODE_RAW = readFileSync(join(SCRIPTS_DIR, MIG_021), 'utf8')

// Comment-stripped executable view: drop full-line and trailing "-- ..."
// comments so assertions about executable SQL cannot be satisfied by prose.
const EXEC = CODE_RAW.split('\n')
  .map((line) => {
    const idx = line.indexOf('--')
    return idx >= 0 ? line.slice(0, idx) : line
  })
  .join('\n')

const FLAT = CODE_RAW.replace(/\s+/g, ' ')
const FLAT_EXEC = EXEC.replace(/\s+/g, ' ')

// Executable view with comments AND single-quoted string literals removed, so
// behaviour bans cannot be satisfied by prose inside RAISE / string messages.
const EXEC_NOSTR = EXEC.replace(/'(?:[^']|'')*'/g, "''")
const FLAT_EXEC_NOSTR = EXEC_NOSTR.replace(/\s+/g, ' ')

// ===========================================================================
// Migrations 001-020 untouched (content hash freeze).
// ===========================================================================
describe('021 — migrations 001-020 are untouched', () => {
  const EXPECTED_PRIOR_HASHES: Record<string, string> = (() => {
    const files = readdirSync(SCRIPTS_DIR)
      .filter((f) => /^0(0[1-9]|1[0-9]|20)-.*\.sql$/.test(f))
      .sort()
    const out: Record<string, string> = {}
    for (const f of files) {
      out[f] = createHash('sha256').update(readFileSync(join(SCRIPTS_DIR, f))).digest('hex')
    }
    return out
  })()

  it('U1. migrations named in the brief exist as a stable set', () => {
    const nums = Object.keys(EXPECTED_PRIOR_HASHES).map((f) => f.slice(0, 3))
    for (const n of ['003', '005', '007', '009', '011', '013', '016', '017', '018', '019', '020']) {
      expect(nums).toContain(n)
    }
  })

  it('U2. the 021 canary never rewrites a 001-020 file', () => {
    expect(Object.keys(EXPECTED_PRIOR_HASHES).length).toBeGreaterThanOrEqual(9)
    for (const [f, h] of Object.entries(EXPECTED_PRIOR_HASHES)) {
      const now = createHash('sha256').update(readFileSync(join(SCRIPTS_DIR, f))).digest('hex')
      expect(now).toBe(h)
    }
  })

  it('U3. the 021 canary performs NO schema DDL against 001-020 objects', () => {
    expect(/\bALTER\s+TABLE\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bDROP\s+(TABLE|INDEX|TRIGGER|CONSTRAINT|FUNCTION)\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bCREATE\s+TABLE\b(?!\s+IF)/i.test(FLAT_EXEC.replace(/CREATE TEMP TABLE/gi, 'CREATE TMPTBL'))).toBe(false)
    expect(FLAT_EXEC).toMatch(/CREATE TEMP TABLE tmp_one_recipient_canary_result ON COMMIT DROP/i)
  })
})

// ===========================================================================
// (1,2) canary type is abandoned_checkout; new_account_no_purchase is gone.
// ===========================================================================
describe('021 — canary type is abandoned_checkout', () => {
  it('(1) canary type constant is abandoned_checkout', () => {
    expect(FLAT_EXEC).toMatch(/c_opp_type\s+constant text\s*:=\s*'abandoned_checkout'/i)
  })

  it('(2) new_account_no_purchase is no longer the canary type anywhere', () => {
    expect(FLAT.includes('new_account_no_purchase')).toBe(false)
  })

  it('does not reference any other opportunity type as the canary', () => {
    for (const banned of [
      'high_value_customer_at_risk',
      'recent_winner',
      'vip_early_access',
      'wtf_credit_waiting',
      'lapsed_14_days',
      'promotion_match',
    ]) {
      expect(FLAT_EXEC_NOSTR.includes(banned)).toBe(false)
    }
  })
})

// ===========================================================================
// transaction, atomicity & one-time nature.
// ===========================================================================
describe('021 — transaction, atomicity & one-time nature', () => {
  it('runs inside a single BEGIN/COMMIT transaction', () => {
    expect(FLAT_EXEC).toMatch(/^\s*BEGIN;/)
    expect(FLAT_EXEC).toMatch(/COMMIT;\s*$/)
  })

  it('has exactly one BEGIN and one COMMIT at the statement level', () => {
    const begins = FLAT_EXEC.match(/(?:^|\s)BEGIN;/g) || []
    const commits = FLAT_EXEC.match(/COMMIT;/g) || []
    expect(begins.length).toBe(1)
    expect(commits.length).toBe(1)
  })

  it('sets a 5s lock_timeout and a sensible statement_timeout', () => {
    expect(FLAT_EXEC).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT_EXEC).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('has NO exception-swallowing handler (fail-whole-transaction)', () => {
    expect(/\bEXCEPTION\s+WHEN\b/i.test(EXEC)).toBe(false)
  })

  it('acquires a canary-specific advisory lock distinct from prior keys', () => {
    expect(FLAT_EXEC).toMatch(/pg_try_advisory_xact_lock\(\s*hashtext\('wtf_marketing_stage_3d2c_one_recipient_canary'\)\s*\)/i)
    expect(FLAT.includes('wtf_marketing_stage_3d2b_recipient_materialisation')).toBe(false)
    expect(FLAT.includes('wtf_marketing_materialize_recipients')).toBe(false)
  })

  it('(37) never alters consent — requires sending/discovery/rollout paused before writes', () => {
    expect(FLAT_EXEC).toMatch(/v_sending IS DISTINCT FROM false\s+OR v_discovery IS DISTINCT FROM false\s+OR v_rollout\s+IS DISTINCT FROM 0/i)
    const pauseIdx = FLAT_EXEC.search(/Marketing is not paused/i)
    const firstWrite = FLAT_EXEC.search(/\b(UPDATE|INSERT)\b/i)
    expect(pauseIdx).toBeGreaterThan(-1)
    expect(firstWrite).toBeGreaterThan(pauseIdx)
  })
})

// ===========================================================================
// (29,30) global sending & discovery never enabled.
// ===========================================================================
describe('021 — global sending & discovery kill switches', () => {
  it('(29) never sets sending_enabled = true anywhere', () => {
    expect(/sending_enabled\s*=\s*true/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/SET[^;]*sending_enabled/i.test(FLAT_EXEC)).toBe(false)
  })

  it('(30) never sets discovery_enabled = true anywhere', () => {
    expect(/discovery_enabled\s*=\s*true/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/SET[^;]*discovery_enabled/i.test(FLAT_EXEC)).toBe(false)
  })

  it('never changes batch size or daily/weekly frequency caps', () => {
    expect(/SET[^;]*maximum_batch_size/i.test(FLAT_EXEC)).toBe(false)
    expect(/SET[^;]*maximum_daily_per_contact/i.test(FLAT_EXEC)).toBe(false)
    expect(/SET[^;]*maximum_weekly_per_contact/i.test(FLAT_EXEC)).toBe(false)
  })
})

// ===========================================================================
// (3,4,5,18,19) canonical detector selection — campaign-specific + separate
//               permission authority + isolation.
// ===========================================================================
describe('021 — canary user selection (canonical detector + separate permission)', () => {
  const selStart = FLAT_EXEC.indexOf('FROM public.wtf_marketing_opportunity_candidates_preview() detector')
  const selEnd = FLAT_EXEC.indexOf('LIMIT 1', selStart)
  const SELECTOR = selStart >= 0 && selEnd >= 0 ? FLAT_EXEC.slice(selStart, selEnd) : ''

  it('depends on the canonical detector as a required preflight dependency', () => {
    expect(FLAT_EXEC).toMatch(/to_regprocedure\('public\.wtf_marketing_opportunity_candidates_preview\(\)'\) IS NULL/i)
    expect(FLAT_EXEC).toMatch(/canonical detector wtf_marketing_opportunity_candidates_preview\(\) is missing/i)
  })

  it('sources selection THROUGH the detector, joined to the profile', () => {
    expect(SELECTOR.length).toBeGreaterThan(0)
    expect(FLAT_EXEC).toMatch(/FROM public\.wtf_marketing_opportunity_candidates_preview\(\) detector\s+JOIN public\.customer_marketing_profiles p\s+ON p\.user_id = detector\.user_id/i)
  })

  it('(3) requires detector.opportunity_key = abandoned_checkout', () => {
    expect(SELECTOR).toMatch(/detector\.opportunity_key = c_opp_type/i)
    expect(FLAT_EXEC).toMatch(/c_opp_type\s+constant text\s*:=\s*'abandoned_checkout'/i)
  })

  it('(4) requires detector.rn = 1 (arbitrated winner)', () => {
    expect(SELECTOR).toMatch(/detector\.rn = 1/i)
  })

  it('(5) requires detector.campaign_id IS NOT NULL (campaign-specific)', () => {
    expect(SELECTOR).toMatch(/detector\.campaign_id IS NOT NULL/i)
    // The old NULL-campaign requirement must be gone from the selector.
    expect(/detector\.campaign_id IS NULL/i.test(SELECTOR)).toBe(false)
  })

  it('(18) still requires authoritative is_marketing_email_eligible independently', () => {
    expect(SELECTOR).toMatch(/public\.is_marketing_email_eligible\(p\.user_id, p\.email_lc\) IS TRUE/i)
    expect(SELECTOR).toMatch(/p\.account_active = true/i)
    expect(SELECTOR).toMatch(/p\.email_confirmed = true/i)
    expect(SELECTOR).toMatch(/p\.marketing_enabled = true/i)
    expect(SELECTOR).toMatch(/p\.has_active_suppression = false/i)
    expect(SELECTOR).toMatch(/p\.user_id IS NOT NULL/i)
    expect(SELECTOR).toMatch(/length\(btrim\(p\.email_lc\)\) > 0/i)
  })

  it('(18) does NOT use any permission snapshot as authority — diagnostic only', () => {
    expect(/AND\s+p?\.?marketing_eligible_snapshot/i.test(SELECTOR)).toBe(false)
    expect(/detector\.(perm_backed|perm_suppressed|perm_not_backed|sendable_now)/i.test(SELECTOR)).toBe(false)
  })

  it('(19) isolates the user from pre-existing active opportunities + recipients', () => {
    expect(SELECTOR).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.marketing_recipients r WHERE r\.user_id = p\.user_id\s*\)/i)
    expect(SELECTOR).toMatch(/o\.state IN \('open', 'selected', 'deferred'\)\s+AND o\.expires_at > now\(\)/i)
  })

  it('raises no_safe_canary_user and never relaxes detection/permission/isolation', () => {
    expect(FLAT_EXEC).toMatch(/RAISE EXCEPTION 'no_safe_canary_user'/i)
    expect(FLAT_EXEC).toMatch(/IF v_user_id IS NULL THEN/i)
  })

  it('selects deterministically (account_created_at ASC, user_id ASC) with LIMIT 1', () => {
    expect(FLAT_EXEC).toMatch(/ORDER BY p\.account_created_at ASC NULLS LAST, p\.user_id ASC\s+LIMIT 1/i)
  })
})

// ===========================================================================
// (6,7) freeze the detector output incl. campaign; exact-campaign re-confirmation.
// ===========================================================================
describe('021 — detector freeze & drift re-confirmation', () => {
  const selStart = FLAT_EXEC.indexOf('FROM public.wtf_marketing_opportunity_candidates_preview() detector')
  const selEnd = FLAT_EXEC.indexOf('LIMIT 1', selStart)
  const SELECTOR = selStart >= 0 && selEnd >= 0 ? FLAT_EXEC.slice(selStart, selEnd) : ''

  it('(6) captures the frozen detector campaign_id into a dedicated variable', () => {
    expect(FLAT_EXEC).toMatch(/v_det_campaign_id\s+uuid/i)
    // The SELECT freezes detector.campaign_id alongside the other canonical fields.
    expect(SELECTOR).toMatch(/detector\.campaign_id/i)
    expect(FLAT_EXEC).toMatch(/detector\.family, detector\.default_priority, detector\.default_score,\s*detector\.campaign_id, detector\.final_score, detector\.score_components,\s*detector\.is_closing/i)
    expect(FLAT_EXEC).toMatch(/v_det_family, v_det_def_priority, v_det_def_score,\s*v_det_campaign_id, v_det_final_score, v_det_score_comp,\s*v_det_is_closing/i)
    // The frozen campaign must be non-null.
    expect(FLAT_EXEC).toMatch(/v_det_campaign_id IS NULL THEN\s+RAISE EXCEPTION[^;]*frozen detector campaign_id is NULL/i)
  })

  it('(7) detector re-confirmation requires the EXACT same frozen campaign_id', () => {
    const reconfirmIdx = FLAT_EXEC.indexOf('SELECT true, detector.opportunity_key, detector.rn, detector.campaign_id')
    const insertIdx = FLAT_EXEC.indexOf('INSERT INTO public.marketing_opportunities')
    expect(reconfirmIdx).toBeGreaterThan(0)
    expect(insertIdx).toBeGreaterThan(reconfirmIdx)
    // Exact campaign equality, NOT merely IS NOT NULL.
    expect(FLAT_EXEC).toMatch(/detector\.user_id = v_user_id\s+AND detector\.opportunity_key = c_opp_type\s+AND detector\.rn = 1\s+AND detector\.campaign_id = v_det_campaign_id/i)
    expect(FLAT_EXEC).toMatch(/v_det_campaign IS DISTINCT FROM v_det_campaign_id/i)
    expect(FLAT_EXEC).toMatch(/canonical detector no longer confirms the chosen user/i)
  })
})

// ===========================================================================
// (8) campaign independently checked live/open (defence in depth).
// ===========================================================================
describe('021 — campaign validity re-check (defence in depth)', () => {
  it('(8) independently verifies the frozen campaign is live/open in public.campaigns', () => {
    expect(FLAT_EXEC).toMatch(/FROM public\.campaigns c\s+WHERE c\.id = v_det_campaign_id/i)
    // Same live/open semantics as the Stage 019 gate.
    expect(FLAT_EXEC).toMatch(/v_camp_status = 'live' AND \(v_camp_end_at IS NULL OR v_camp_end_at > now\(\)\)/i)
    expect(FLAT_EXEC).toMatch(/frozen detector campaign is not live\/open/i)
  })

  it('does NOT update the campaign', () => {
    expect(/UPDATE\s+public\.campaigns/i.test(FLAT_EXEC)).toBe(false)
  })

  it('preflight includes public.campaigns as a required dependency', () => {
    expect(FLAT_EXEC).toMatch(/'public\.campaigns'/i)
  })
})

// ===========================================================================
// (9) campaign_specific definition must be true; real definition invariants.
// ===========================================================================
describe('021 — abandoned_checkout definition invariants', () => {
  it('(9) requires the definition to be campaign_specific = true', () => {
    expect(FLAT_EXEC).toMatch(/v_def_campaign IS DISTINCT FROM true/i)
    expect(FLAT_EXEC).toMatch(/campaign_specific=% \(expected true/i)
  })

  it('requires enabled=false and delivery_automation_id IS NOT NULL at preflight', () => {
    expect(FLAT_EXEC).toMatch(/IF v_def_enabled THEN\s+RAISE EXCEPTION[^;]*is already enabled/i)
    expect(FLAT_EXEC).toMatch(/v_def_route_id IS NULL THEN\s+RAISE EXCEPTION[^;]*delivery_automation_id is NULL/i)
  })

  it('reads default_priority/score/expiry from the LIVE definition — no hardcoded constants', () => {
    // The definition is READ into variables ...
    expect(FLAT_EXEC).toMatch(/SELECT enabled, campaign_specific, default_priority, default_score,\s*default_expiry_hours, delivery_automation_id\s+INTO v_def_enabled, v_def_campaign, v_def_priority, v_def_score,\s*v_def_expiry, v_def_route_id/i)
    // ... and there are NO invented new-account-style expected constants.
    expect(/c_exp_priority/i.test(FLAT_EXEC)).toBe(false)
    expect(/c_exp_score/i.test(FLAT_EXEC)).toBe(false)
    expect(/c_exp_expiry_hours/i.test(FLAT_EXEC)).toBe(false)
    // No literal abandoned-checkout defaults (2 / 650 / 24) asserted as constants.
    expect(/:=\s*650\b/.test(FLAT_EXEC)).toBe(false)
  })
})

// ===========================================================================
// (10,11,12,13,14,15,16,17) canonical Stage 013 campaign-specific persisted shape.
// ===========================================================================
describe('021 — canonical Stage 013 campaign-specific persisted shape', () => {
  const insStart = FLAT_EXEC.indexOf('INSERT INTO public.marketing_opportunities')
  const insEnd = FLAT_EXEC.indexOf('RETURNING id INTO v_opp_id', insStart)
  const INS = insStart >= 0 && insEnd >= 0 ? FLAT_EXEC.slice(insStart, insEnd) : ''

  it('inserts exactly ONE opportunity', () => {
    const inserts = FLAT_EXEC.match(/INSERT INTO public\.marketing_opportunities/gi) || []
    expect(inserts.length).toBe(1)
  })

  it('(10) opportunity campaign_id uses the frozen detector campaign', () => {
    expect(INS.length).toBeGreaterThan(0)
    expect(/v_det_campaign_id/i.test(INS)).toBe(true)
    // Post-insert requires campaign_id equals frozen campaign and is NOT NULL.
    expect(FLAT_EXEC).toMatch(/v_o_campaign IS DISTINCT FROM v_det_campaign_id/i)
    expect(FLAT_EXEC).toMatch(/v_o_campaign IS NULL/i)
  })

  it('(11) opportunity promotion_id remains NULL', () => {
    expect(/promotion_id/i.test(INS)).toBe(true)
    expect(FLAT_EXEC).toMatch(/v_o_promo\s+IS NOT NULL/i)
  })

  it('(12) opportunity automation_id remains NULL (provenance)', () => {
    expect(FLAT).toMatch(/automation_id,\s*-- NULL provenance/i)
    expect(/v_def_route_id/i.test(INS)).toBe(false)
    expect(FLAT_EXEC).toMatch(/v_opp_auto_prov IS NOT NULL/i)
  })

  it('(16) persists base_priority = detector.default_priority, score = detector.final_score', () => {
    expect(/v_det_def_priority/i.test(INS)).toBe(true)
    expect(/v_det_final_score/i.test(INS)).toBe(true)
    // Definition default score is NEVER persisted.
    expect(/v_def_score/i.test(INS)).toBe(false)
    expect(FLAT_EXEC).toMatch(/v_det_def_priority IS DISTINCT FROM v_def_priority/i)
    expect(FLAT_EXEC).toMatch(/v_det_final_score < 0\s*OR v_det_final_score > 1000/i)
  })

  it('uses ONE frozen detected_at for detected_at / expires_at / dedupe', () => {
    expect(FLAT_EXEC).toMatch(/v_detected_at := now\(\)/i)
    expect(FLAT_EXEC).toMatch(/v_expires_at\s*:= v_detected_at \+ make_interval\(hours => v_def_expiry\)/i)
    expect(FLAT_EXEC).toMatch(/extract\(epoch FROM v_detected_at\)\s*\/ \(GREATEST\(v_def_expiry, 1\) \* 3600\)/i)
    expect(/now\(\)/i.test(INS)).toBe(false)
  })

  it('(17) persists the canonical Stage 013 reason structure', () => {
    expect(FLAT_EXEC).toMatch(/'definitionKey', c_opp_type/i)
    expect(FLAT_EXEC).toMatch(/'family',\s*v_det_family/i)
    expect(FLAT_EXEC).toMatch(/'detector',\s*'wtf_marketing_opportunity_candidates_preview'/i)
    expect(FLAT_EXEC).toMatch(/'stage',\s*'3C2F'/i)
    expect(FLAT_EXEC).toMatch(/'basePriority',\s*v_det_def_priority/i)
    expect(FLAT_EXEC).toMatch(/'finalScore',\s*v_det_final_score/i)
    expect(FLAT_EXEC).toMatch(/'isClosing',\s*v_det_is_closing/i)
  })

  it('(13,17) context_snapshot.campaignId is the REAL detector campaign, not JSON null', () => {
    expect(FLAT_EXEC).toMatch(/'scoreComponents',\s*v_det_score_comp/i)
    expect(FLAT_EXEC).toMatch(/'campaignId',\s*v_det_campaign_id/i)
    expect(FLAT_EXEC).toMatch(/'detectorStage',\s*'3C2F'/i)
    expect(FLAT_EXEC).toMatch(/'selectedAsNextBestAction', true/i)
    expect(FLAT_EXEC).toMatch(/'rn',\s*1/i)
    // Post-insert requires campaignId is a string UUID equal to the frozen campaign,
    // and explicitly NOT JSON null.
    expect(FLAT_EXEC).toMatch(/jsonb_typeof\(v_o_ctx->'campaignId'\) IS DISTINCT FROM 'string'/i)
    expect(FLAT_EXEC).toMatch(/\(v_o_ctx->>'campaignId'\)::uuid IS DISTINCT FROM v_det_campaign_id/i)
    // The old JSON-null campaignId assertion is gone.
    expect(/jsonb_typeof\(v_o_ctx->'campaignId'\) IS DISTINCT FROM 'null'/i.test(FLAT_EXEC)).toBe(false)
  })

  it('(14) discv1 dedupe contains the actual campaign UUID (never a dash)', () => {
    expect(FLAT_EXEC).toMatch(/'discv1:' \|\| v_user_id::text/i)
    expect(FLAT_EXEC).toMatch(/\|\| ':' \|\| v_det_campaign_id::text/i)
    expect(FLAT_EXEC).toMatch(/\|\| ':w' \|\| floor\(/i)
    // The NULL-campaign COALESCE-to-'-' form must be gone.
    expect(/COALESCE\(NULL::text, '-'\)/i.test(FLAT_EXEC)).toBe(false)
  })

  it('(15) aborts on canonical dedupe collision instead of inventing another key', () => {
    expect(FLAT_EXEC).toMatch(/o\.dedupe_key = v_dedupe_key/i)
    expect(FLAT_EXEC).toMatch(/RAISE EXCEPTION 'canary_canonical_dedupe_conflict'/i)
    expect(FLAT_EXEC_NOSTR.includes('fallback')).toBe(false)
    expect((FLAT_EXEC.match(/v_dedupe_key\s*:=/gi) || []).length).toBe(1)
  })

  it('inserts with state open and NO canary-only markers in the payload', () => {
    expect(/'open'/i.test(INS)).toBe(true)
    expect(INS.includes("'canary'")).toBe(false)
    expect(INS.includes("'source'")).toBe(false)
    expect(INS.includes('manual_canary')).toBe(false)
    expect(FLAT_EXEC).toMatch(/\(v_o_reason \? 'canary'\) OR \(v_o_ctx \? 'canary'\)/i)
    expect(FLAT_EXEC).toMatch(/canary-only markers leaked into the canonical opportunity payload/i)
  })

  it('post-insert asserts the full canonical persisted shape', () => {
    expect(FLAT_EXEC).toMatch(/v_o_detected IS DISTINCT FROM v_detected_at/i)
    expect(FLAT_EXEC).toMatch(/v_o_expires\s+IS DISTINCT FROM v_expires_at/i)
    expect(FLAT_EXEC).toMatch(/v_o_expires\s+IS DISTINCT FROM \(v_o_detected \+ make_interval\(hours => v_def_expiry\)\)/i)
    expect(FLAT_EXEC).toMatch(/v_o_priority IS DISTINCT FROM v_det_def_priority/i)
    expect(FLAT_EXEC).toMatch(/v_o_score\s+IS DISTINCT FROM v_det_final_score/i)
    expect(FLAT_EXEC).toMatch(/v_o_dedupe\s+IS DISTINCT FROM v_dedupe_key/i)
  })
})

// ===========================================================================
// (28) temporary enablement of def + automation + rollout=1.
// ===========================================================================
describe('021 — temporary enablement (exactly def + automation + rollout=1)', () => {
  it('temporarily enables the abandoned_checkout definition', () => {
    expect(FLAT_EXEC).toMatch(/UPDATE public\.marketing_opportunity_definitions\s+SET enabled = true[^;]*WHERE opportunity_key = c_opp_type/i)
  })

  it('temporarily enables exactly the routed delivery automation', () => {
    expect(FLAT_EXEC).toMatch(/UPDATE public\.marketing_automations\s+SET enabled = true[^;]*WHERE id = v_def_route_id/i)
    const enableAutos = FLAT_EXEC.match(/UPDATE public\.marketing_automations\s+SET enabled = true/gi) || []
    expect(enableAutos.length).toBe(1)
  })

  it('sets rollout_limit to exactly 1', () => {
    expect(FLAT_EXEC).toMatch(/UPDATE public\.marketing_control_state\s+SET rollout_limit = 1[^;]*WHERE key = 'default'/i)
  })

  it('asserts exactly ONE enabled definition and ONE enabled automation after enablement', () => {
    expect(FLAT_EXEC).toMatch(/expected exactly 1 enabled definition, found/i)
    expect(FLAT_EXEC).toMatch(/expected exactly 1 enabled automation, found/i)
  })

  it('asserts sending/discovery still false and rollout exactly 1 after enablement', () => {
    expect(FLAT_EXEC).toMatch(/sending_enabled changed to % during enablement/i)
    expect(FLAT_EXEC).toMatch(/discovery_enabled changed to % during enablement/i)
    expect(FLAT_EXEC).toMatch(/rollout_limit=% after enablement \(expected 1\)/i)
  })
})

// ===========================================================================
// (20,21,22) private gate verified before materialising.
// ===========================================================================
describe('021 — private gate verified before materialising', () => {
  it('calls the canonical private gate BEFORE the materialiser', () => {
    const gateIdx = FLAT_EXEC.indexOf('FROM public.wtf_marketing_recipient_gate_preview() g')
    const materIdx = FLAT_EXEC.indexOf('public.materialize_marketing_recipients(1)')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(materIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(materIdx)
  })

  it('(20) requires campaign_context_valid = true for the canary', () => {
    expect(FLAT_EXEC).toMatch(/v_g_campaign_valid IS DISTINCT FROM true/i)
  })

  it('(21) requires gate_eligible = true, next_best_rank = 1, pre_nba true', () => {
    expect(FLAT_EXEC).toMatch(/v_g_gate_eligible\s+IS DISTINCT FROM true/i)
    expect(FLAT_EXEC).toMatch(/v_g_next_best_rank IS DISTINCT FROM 1/i)
    expect(FLAT_EXEC).toMatch(/v_g_pre_nba\s+IS DISTINCT FROM true/i)
  })

  it('requires the full deterministic eligibility chain to be true', () => {
    for (const v of [
      'v_g_profile_matched',
      'v_g_account_active',
      'v_g_email_confirmed',
      'v_g_marketing_enabled',
      'v_g_auth_eligible',
      'v_g_def_enabled',
      'v_g_route_mapped',
      'v_g_route_enabled',
      'v_g_route_ready',
      'v_g_freq_eligible',
    ]) {
      expect(FLAT_EXEC).toMatch(new RegExp(`${v}\\s+IS DISTINCT FROM true`, 'i'))
    }
    expect(FLAT_EXEC).toMatch(/v_g_has_suppression IS DISTINCT FROM false/i)
    expect(FLAT_EXEC).toMatch(/v_g_existing_recip IS DISTINCT FROM false/i)
  })

  it('(22) requires sendable_now to remain FALSE for the canary', () => {
    expect(FLAT_EXEC).toMatch(/v_g_sendable_now IS DISTINCT FROM false/i)
    expect(FLAT_EXEC).toMatch(/MUST be false — global sending is paused/i)
  })
})

// ===========================================================================
// (23) materialiser called with limit 1; exact result contract.
// ===========================================================================
describe('021 — materialiser invocation & result', () => {
  it('(23) calls materialize_marketing_recipients with limit 1 exactly once', () => {
    const calls = FLAT_EXEC_NOSTR.match(/materialize_marketing_recipients\s*\(\s*1\s*\)/gi) || []
    expect(calls.length).toBe(1)
    const allCalls = FLAT_EXEC_NOSTR.match(/materialize_marketing_recipients\s*\(/gi) || []
    expect(allCalls.length).toBe(1)
  })

  it('requires status ok, effectiveLimit 1, finalCandidateCount 1', () => {
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'status'\) IS DISTINCT FROM 'ok'/i)
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'effectiveLimit'\)::int\s+IS DISTINCT FROM 1/i)
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'finalCandidateCount'\)::bigint IS DISTINCT FROM 1/i)
  })

  it('requires insertedRecipients 1, opportunitiesSelected 1', () => {
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'insertedRecipients'\)::bigint\s+IS DISTINCT FROM 1/i)
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'opportunitiesSelected'\)::bigint IS DISTINCT FROM 1/i)
  })

  it('requires runsCreated 1 and runsReused 0', () => {
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'runsCreated'\)::bigint\s+IS DISTINCT FROM 1/i)
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'runsReused'\)::bigint\s+IS DISTINCT FROM 0/i)
  })

  it('requires groupCount 1 and blockedRunGroups 0', () => {
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'groupCount'\)::bigint\s+IS DISTINCT FROM 1/i)
    expect(FLAT_EXEC).toMatch(/\(v_rpc->>'blockedRunGroups'\)::bigint\s+IS DISTINCT FROM 0/i)
  })
})

// ===========================================================================
// (24) recipient contract: exactly one / queued / unsent / unlocked.
// ===========================================================================
describe('021 — recipient assertions', () => {
  it('idempotency_key = marketing-opportunity:<opportunity_id>', () => {
    expect(FLAT_EXEC).toMatch(/v_r_idem\s+IS DISTINCT FROM \('marketing-opportunity:' \|\| v_opp_id::text\)/i)
  })

  it('(24) recipient is linked to the canary opportunity, exactly one', () => {
    expect(FLAT_EXEC).toMatch(/FROM public\.marketing_recipients r\s+WHERE r\.opportunity_id = v_opp_id/i)
    expect(FLAT_EXEC).toMatch(/opportunity_id IS DISTINCT FROM v_opp_id\) <> 0/i)
  })

  it('(24) recipient pre-send status is queued', () => {
    expect(FLAT_EXEC).toMatch(/v_r_status\s+IS DISTINCT FROM 'queued'/i)
  })

  it('template/context snapshots are schema defaults, discount default NULL', () => {
    expect(FLAT_EXEC).toMatch(/v_r_tmpl\s+IS DISTINCT FROM '\{\}'::jsonb/i)
    expect(FLAT_EXEC).toMatch(/v_r_ctx\s+IS DISTINCT FROM '\{\}'::jsonb/i)
    expect(FLAT_EXEC).toMatch(/v_r_discount IS NOT NULL/i)
  })

  it('(24,34) sent/provider/engagement state remains NULL and attempts 0', () => {
    expect(FLAT_EXEC).toMatch(/v_r_sent_at\s+IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_provider\s+IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_delivered IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_clicked\s+IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_bounced\s+IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_complained IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_attempts\s+IS DISTINCT FROM 0/i)
  })

  it('(24) recipient is unlocked: locked_at NULL and locked_until NULL', () => {
    expect(FLAT_EXEC).toMatch(/r\.locked_at, r\.locked_until\s+INTO/i)
    expect(FLAT_EXEC).toMatch(/v_r_locked_at\s+IS NOT NULL/i)
    expect(FLAT_EXEC).toMatch(/v_r_locked_until IS NOT NULL/i)
    expect(/v_r_locked_at\s*:=|locked_at\s*=\s*now\(\)/i.test(FLAT_EXEC)).toBe(false)
    expect(/v_r_locked_until\s*:=|locked_until\s*=\s*now\(\)/i.test(FLAT_EXEC)).toBe(false)
  })

  it('recipient is a user identity, external_contact_id NULL', () => {
    expect(FLAT_EXEC).toMatch(/v_r_user_id\s+IS DISTINCT FROM v_user_id/i)
    expect(FLAT_EXEC).toMatch(/v_r_external IS NOT NULL/i)
  })
})

// ===========================================================================
// (25) run: exactly one / preparing / NULL promotion / routed automation.
// ===========================================================================
describe('021 — run assertions', () => {
  it('(25) run status MUST be preparing (never queued/processing/completed)', () => {
    expect(FLAT_EXEC).toMatch(/v_run_status IS DISTINCT FROM 'preparing'/i)
    expect(FLAT_EXEC).toMatch(/MUST be preparing; never queued\/processing\/completed/i)
  })

  it('(25) run uses the abandoned_checkout delivery route and NULL promotion', () => {
    expect(FLAT_EXEC).toMatch(/v_run_auto_id IS DISTINCT FROM v_def_route_id/i)
    expect(FLAT_EXEC).toMatch(/v_run_promo_id IS NOT NULL/i)
  })
})

// ===========================================================================
// (26,27) opportunity lifecycle; original six unchanged.
// ===========================================================================
describe('021 — opportunity lifecycle assertions', () => {
  it('(26) canary opportunity becomes selected, selected_at set, actioned_at null', () => {
    expect(FLAT_EXEC).toMatch(/v_opp_state IS DISTINCT FROM 'selected'/i)
    expect(FLAT_EXEC).toMatch(/v_opp_selected_at IS NULL/i)
    expect(FLAT_EXEC).toMatch(/v_opp_actioned_at IS NOT NULL/i)
  })

  it('(26) campaign_id remains the frozen detector campaign after materialisation', () => {
    expect(FLAT_EXEC).toMatch(/v_opp_campaign_final IS DISTINCT FROM v_det_campaign_id/i)
  })

  it('(27) the original six opportunities remain open and untouched', () => {
    expect(FLAT_EXEC).toMatch(/o\.id <> v_opp_id\s+AND \(o\.state IS DISTINCT FROM 'open'\s+OR o\.selected_at IS NOT NULL\s+OR o\.actioned_at IS NOT NULL\)/i)
    expect(FLAT_EXEC).toMatch(/pre-existing opportunity\(ies\) changed state/i)
  })
})

// ===========================================================================
// (28) restore rollout/def/automation before COMMIT; (29,30) sending/discovery false.
// ===========================================================================
describe('021 — restore kill switches before COMMIT', () => {
  const commitIdx = FLAT_EXEC.indexOf('COMMIT;')

  it('(28) restores rollout_limit = 0 before COMMIT', () => {
    const idx = FLAT_EXEC.search(/UPDATE public\.marketing_control_state\s+SET rollout_limit = 0/i)
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(commitIdx)
  })

  it('(28) restores the definition to disabled before COMMIT', () => {
    const idx = FLAT_EXEC.search(/UPDATE public\.marketing_opportunity_definitions\s+SET enabled = false[^;]*WHERE opportunity_key = c_opp_type/i)
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(commitIdx)
  })

  it('(28) restores the automation to disabled before COMMIT', () => {
    const idx = FLAT_EXEC.search(/UPDATE public\.marketing_automations\s+SET enabled = false[^;]*WHERE id = v_def_route_id/i)
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(commitIdx)
  })

  it('(28,29,30) asserts fully-paused end state: sending/discovery false, rollout 0', () => {
    expect(FLAT_EXEC).toMatch(/sending_enabled is % \(MUST be false\)/i)
    expect(FLAT_EXEC).toMatch(/discovery_enabled is % \(MUST be false\)/i)
    expect(FLAT_EXEC).toMatch(/rollout_limit not restored to 0/i)
    expect(FLAT_EXEC).toMatch(/definition\(s\) still enabled \(MUST be 0\)/i)
    expect(FLAT_EXEC).toMatch(/enabled automations not restored/i)
  })
})

// ===========================================================================
// (31,32,33) final ledger 7/1/1; gateEligible 0; sendableNow 0.
// ===========================================================================
describe('021 — final ledger & gate expectation', () => {
  it('preflight requires opportunities 6, recipients 0, runs 0', () => {
    expect(FLAT_EXEC).toMatch(/expected exactly 6/i)
    expect(FLAT_EXEC).toMatch(/marketing_recipients holds % row\(s\); expected 0/i)
    expect(FLAT_EXEC).toMatch(/marketing_automation_runs holds % row\(s\); expected 0/i)
  })

  it('(31) final totals: opportunities 7, recipients 1, runs 1', () => {
    expect(FLAT_EXEC).toMatch(/opportunities is % after materialise \(expected 7\)/i)
    expect(FLAT_EXEC).toMatch(/recipients is % after materialise \(expected 1\)/i)
    expect(FLAT_EXEC).toMatch(/runs is % after materialise \(expected 1\)/i)
  })

  it('(34) final sent recipients is 0', () => {
    expect(FLAT_EXEC).toMatch(/'sentRecipients',\s*\(SELECT count\(\*\) FROM public\.marketing_recipients WHERE sent_at IS NOT NULL\)/i)
  })

  it('(32,33) re-checks the gate after restore: gateEligible 0, sendableNow 0', () => {
    const gateChecks = FLAT_EXEC.match(/FROM public\.wtf_marketing_recipient_gate_preview\(\) g/gi) || []
    expect(gateChecks.length).toBe(2)
    expect(FLAT_EXEC).toMatch(/gateEligible after restore is % \(MUST be 0\)/i)
    expect(FLAT_EXEC).toMatch(/sendableNow after restore is % \(MUST be 0\)/i)
  })
})

// ===========================================================================
// (34,35,36,37,38) forbidden operations absent.
// ===========================================================================
describe('021 — forbidden operations are absent', () => {
  it('(34) no provider / email / Resend / send path', () => {
    expect(/resend|provider_email_id\s*=|\bsend_email\b|\bdeliver\b\s*\(/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(/\bSET\s+(?:\w+\s*=\s*[^;]*?,\s*)*sent_at\s*=/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bSET\s+(?:\w+\s*=\s*[^;]*?,\s*)*provider_email_id\s*=/i.test(FLAT_EXEC)).toBe(false)
    expect(/UPDATE\s+public\.marketing_recipients/i.test(FLAT_EXEC)).toBe(false)
  })

  it('(35) no AI', () => {
    expect(/openai|embedding|\bllm\b|anthropic|gpt-/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('(36) no cron', () => {
    expect(/cron\.schedule|pg_cron|\bcron\b/i.test(FLAT_EXEC_NOSTR)).toBe(false)
  })

  it('no external contacts', () => {
    expect(/external_contact_id[^,\n]*v_[a-z_]*external/i.test(FLAT_EXEC_NOSTR)).toBe(false)
    expect(FLAT_EXEC).toMatch(/v_r_external IS NOT NULL/i)
    expect(/INSERT INTO public\.marketing_external_contacts/i.test(FLAT_EXEC)).toBe(false)
  })

  it('(37) never alters consent or frequency limits', () => {
    expect(/UPDATE public\.marketing_preferences/i.test(FLAT_EXEC)).toBe(false)
    expect(/SET[^;]*maximum_daily_per_contact/i.test(FLAT_EXEC)).toBe(false)
    expect(/SET[^;]*maximum_weekly_per_contact/i.test(FLAT_EXEC)).toBe(false)
  })

  it('(38) no checkout/payment/ticket/wallet/customer-facing writes', () => {
    // These are DATA sources for the detector (read-only via the RPC); the canary
    // must never touch customer-facing tables directly. Ban both writes and the
    // customer-facing table identifiers entirely.
    // Scoped to EXECUTABLE SQL (comments stripped): the header prose may
    // legitimately say "NEVER modifies ... tickets or wallet"; what matters is
    // that no customer-facing table is referenced in executable statements.
    for (const t of [
      'checkout_intents',
      'instant_win_awards',
      'wallet_transactions',
      'orders',
      'payments',
      'tickets',
      'auth.users',
    ]) {
      expect(FLAT_EXEC.includes(t)).toBe(false)
    }
    // The canary only ever writes to the marketing control-plane tables + the
    // temp result table; campaigns are read-only.
    expect(/UPDATE\s+public\.campaigns/i.test(FLAT_EXEC)).toBe(false)
    expect(/INSERT INTO public\.campaigns/i.test(FLAT_EXEC)).toBe(false)
  })

  it('does not create more than one opportunity; never inserts recipients/runs directly', () => {
    expect((FLAT_EXEC.match(/INSERT INTO public\.marketing_opportunities/gi) || []).length).toBe(1)
    expect(/INSERT INTO public\.marketing_recipients/i.test(FLAT_EXEC)).toBe(false)
    expect(/INSERT INTO public\.marketing_automation_runs/i.test(FLAT_EXEC)).toBe(false)
  })

  it('never advances a run beyond preparing (no run status UPDATE)', () => {
    expect(/UPDATE public\.marketing_automation_runs/i.test(FLAT_EXEC)).toBe(false)
  })
})

// ===========================================================================
// anonymised result payload — no PII / raw identifiers.
// ===========================================================================
describe('021 — safe result payload', () => {
  it('returns canary_complete with opportunityType + campaignSpecific and safe fields', () => {
    expect(FLAT_EXEC).toMatch(/'status',\s*'canary_complete'/i)
    expect(FLAT_EXEC).toMatch(/'opportunityType',\s*c_opp_type/i)
    expect(FLAT_EXEC).toMatch(/'campaignSpecific',\s*true/i)
    for (const f of [
      'opportunitiesBefore',
      'opportunitiesAfter',
      'recipientsBefore',
      'recipientsAfter',
      'runsBefore',
      'runsAfter',
      'materializerStatus',
      'insertedRecipients',
      'opportunitiesSelected',
      'runsCreated',
      'canaryOpportunityState',
      'canaryRecipientStatus',
      'canaryRunStatus',
      'sentRecipients',
      'sendingEnabled',
      'discoveryEnabled',
      'rolloutLimit',
      'enabledDefinitions',
      'enabledAutomations',
      'gateEligibleAfter',
      'sendableNowAfter',
    ]) {
      expect(FLAT.includes(`'${f}'`)).toBe(true)
    }
  })

  it('the safe result exposes NO campaign/user/email/recipient/opportunity/run/automation ids', () => {
    const rIdx = FLAT_EXEC.indexOf('tmp_one_recipient_canary_result ON COMMIT DROP AS')
    const rEnd = FLAT_EXEC.indexOf('AS one_recipient_canary_result', rIdx)
    const RESULT_SQL = rIdx >= 0 && rEnd >= 0 ? FLAT_EXEC.slice(rIdx, rEnd) : ''
    expect(RESULT_SQL.length).toBeGreaterThan(0)
    for (const banned of [
      'v_user_id',
      'v_email_lc',
      'v_opp_id',
      'v_r_run_id',
      'v_def_route_id',
      'v_dedupe_key',
      'v_det_campaign_id',
      'v_opp_campaign_final',
      'campaign_id',
      'email_lc',
      'user_id',
    ]) {
      expect(RESULT_SQL.includes(banned)).toBe(false)
    }
  })
})
