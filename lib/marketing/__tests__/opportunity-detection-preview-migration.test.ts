import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ============================================================================
// Static contract tests for scripts/marketing/008-marketing-opportunity-
// detection-preview.sql. These assert the migration TEXT only — they never
// connect to a database and never execute SQL. They lock in the Stage 3C2
// guarantees: a single read-only, service-role-only detection preview RPC that
// writes NOTHING and leaves marketing_opportunities empty.
// ============================================================================

const SQL_PATH = join(
  process.cwd(),
  'scripts/marketing/008-marketing-opportunity-detection-preview.sql',
)
const CODE = readFileSync(SQL_PATH, 'utf8')

// Whitespace-flattened view for resilient substring/regex matching.
const FLAT = CODE.replace(/\s+/g, ' ')

// Code with line comments stripped, so "no writes" style assertions cannot be
// fooled by prose in comments.
const NO_LINE_COMMENTS = CODE.replace(/--[^\n]*/g, '')
const EXEC = NO_LINE_COMMENTS.replace(/\s+/g, ' ')

describe('008 opportunity detection preview — migration shape', () => {
  it('is wrapped in a single atomic transaction BEGIN;/COMMIT;', () => {
    // The file opens with a documentation header, so BEGIN; is the first
    // EXECUTABLE statement (EXEC strips comments) and COMMIT; is the last.
    const execTrimmed = EXEC.trim()
    expect(execTrimmed.startsWith('BEGIN;')).toBe(true)
    expect(execTrimmed.endsWith('COMMIT;')).toBe(true)
    expect((EXEC.match(/\bCOMMIT\s*;/g) || []).length).toBe(1)
  })

  it('sets fail-fast LOCAL lock and statement timeouts', () => {
    expect(FLAT).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('runs a read-only dependency + advisory-lock preflight', () => {
    expect(FLAT).toMatch(/to_regclass/i)
    expect(FLAT).toMatch(/pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2_detection_preview'\)\)/i)
  })

  it('verifies the eligibility function dependency exists', () => {
    expect(FLAT).toMatch(/to_regprocedure\('public\.is_marketing_email_eligible\(uuid, text\)'\)/i)
  })

  it('asserts the global pause (sending/discovery/rollout all off)', () => {
    expect(FLAT).toMatch(/SELECT sending_enabled, discovery_enabled, rollout_limit/i)
    expect(FLAT).toMatch(/v_sending\s+IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_discovery\s+IS DISTINCT FROM false/i)
    expect(FLAT).toMatch(/v_rollout\s+IS DISTINCT FROM 0/i)
    expect(FLAT).toMatch(/Refusing to install a detection preview/i)
  })
})

describe('008 opportunity detection preview — function security', () => {
  it('creates exactly one preview function', () => {
    const matches = CODE.match(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_detection_preview\(\)/gi) || []
    expect(matches.length).toBe(1)
  })

  it('takes no arguments and returns jsonb', () => {
    expect(FLAT).toMatch(/get_admin_marketing_opportunity_detection_preview\(\)\s+RETURNS jsonb/i)
  })

  it('is STABLE (read-only volatility), never VOLATILE', () => {
    const decl = FLAT.match(/RETURNS jsonb\s+LANGUAGE plpgsql\s+([\s\S]*?)\s+AS \$\$/i)
    expect(decl, 'function declaration present').toBeTruthy()
    expect(decl![1]).toMatch(/\bSTABLE\b/i)
    expect(/\bVOLATILE\b/i.test(FLAT)).toBe(false)
  })

  it('is SECURITY DEFINER with a fixed search_path', () => {
    expect(FLAT).toMatch(/SECURITY DEFINER/i)
    expect(FLAT).toMatch(/SET search_path = public, pg_temp/i)
  })

  it('sets the 10s statement_timeout declaratively (no set_config)', () => {
    expect(FLAT).toMatch(/SET statement_timeout = '10s'/i)
    const decl = FLAT.match(/RETURNS jsonb\s+LANGUAGE plpgsql\s+([\s\S]*?)\s+AS \$\$/i)
    expect(decl![1]).toMatch(/SET statement_timeout = '10s'/i)
    expect(/set_config\s*\(/i.test(CODE)).toBe(false)
  })

  it('is service-role only (revokes public/anon/authenticated, grants service_role)', () => {
    expect(FLAT).toMatch(/REVOKE ALL ON FUNCTION public\.get_admin_marketing_opportunity_detection_preview\(\) FROM public, anon, authenticated/i)
    expect(FLAT).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_opportunity_detection_preview\(\) TO service_role/i)
  })
})

describe('008 opportunity detection preview — absolutely no writes', () => {
  it('performs NO INSERT / UPDATE / DELETE / UPSERT anywhere', () => {
    expect(/\bINSERT\s+INTO\b/i.test(EXEC)).toBe(false)
    expect(/\bUPDATE\s+\w/i.test(EXEC)).toBe(false)
    expect(/\bDELETE\s+FROM\b/i.test(EXEC)).toBe(false)
    expect(/\bMERGE\b/i.test(EXEC)).toBe(false)
    expect(/ON CONFLICT/i.test(EXEC)).toBe(false)
    expect(/\bRETURNING\b/i.test(EXEC)).toBe(false)
  })

  it('never writes to marketing_opportunities (stays at 0 rows)', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_opportunities/i.test(EXEC)).toBe(false)
    expect(/UPDATE\s+public\.marketing_opportunities/i.test(EXEC)).toBe(false)
    // It is not even referenced in an executable SELECT; only the preflight
    // existence check names it.
    expect(/FROM\s+public\.marketing_opportunities/i.test(EXEC)).toBe(false)
  })

  it('never writes to the recipients / runs / control / consent tables', () => {
    for (const t of [
      'marketing_recipients',
      'marketing_automation_runs',
      'marketing_control_state',
      'marketing_preferences',
      'marketing_suppressions',
      'customer_marketing_profiles',
      'checkout_intents',
      'campaigns',
    ]) {
      expect(new RegExp(`INSERT\\s+INTO\\s+public\\.${t}`, 'i').test(EXEC), `no INSERT into ${t}`).toBe(false)
      expect(new RegExp(`UPDATE\\s+public\\.${t}`, 'i').test(EXEC), `no UPDATE of ${t}`).toBe(false)
      expect(new RegExp(`DELETE\\s+FROM\\s+public\\.${t}`, 'i').test(EXEC), `no DELETE from ${t}`).toBe(false)
    }
  })

  it('never references marketing_recipients or marketing_automation_runs at all', () => {
    expect(/marketing_recipients/i.test(EXEC)).toBe(false)
    expect(/marketing_automation_runs/i.test(EXEC)).toBe(false)
  })

  it('does not ALTER/CREATE/DROP any table, trigger, or extension', () => {
    expect(/\bALTER\s+TABLE\b/i.test(EXEC)).toBe(false)
    expect(/\bCREATE\s+TABLE\b/i.test(EXEC)).toBe(false)
    expect(/\bDROP\s+TABLE\b/i.test(EXEC)).toBe(false)
    expect(/\bCREATE\s+TRIGGER\b/i.test(EXEC)).toBe(false)
    expect(/\bCREATE\s+EXTENSION\b/i.test(EXEC)).toBe(false)
  })

  it('marketing_control_state is only READ in the pause assertion', () => {
    expect(/FROM\s+public\.marketing_control_state/i.test(EXEC)).toBe(true)
    expect(/UPDATE\s+public\.marketing_control_state/i.test(EXEC)).toBe(false)
  })
})

describe('008 opportunity detection preview — no automation/cron/AI/email', () => {
  it('adds no cron job', () => {
    expect(/cron\.schedule/i.test(CODE)).toBe(false)
    expect(/vercel\.json|CRON_SECRET/i.test(CODE)).toBe(false)
  })

  it('adds no AI', () => {
    expect(/openai|anthropic|ai[_-]?gateway|generateText|streamText|embedding|llm/i.test(CODE)).toBe(false)
  })

  it('sends no email', () => {
    // Executable code only — the header comment legitimately mentions "Resend"
    // to document that no email is sent.
    expect(/resend|sendEmail|smtp|nodemailer|mailgun/i.test(EXEC)).toBe(false)
  })

  it('enables no sending/discovery and changes no rollout', () => {
    expect(/sending_enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/discovery_enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/rollout_limit\s*=\s*[1-9]/i.test(EXEC)).toBe(false)
  })
})

describe('008 opportunity detection preview — no identities / raw rows', () => {
  it('returns aggregates only — no email addresses in the output payload', () => {
    // The jsonb payload never selects email_lc / raw emails into output.
    expect(/jsonb_build_object[\s\S]*email_lc/i.test(FLAT)).toBe(false)
  })

  it('does not SELECT * anywhere', () => {
    // "SELECT f.*" over an internal CTE of already-derived booleans is allowed;
    // a bare "SELECT *" over a base table is not.
    expect(/SELECT\s+\*\s+FROM\s+public\./i.test(FLAT)).toBe(false)
  })

  it('uses no procedural FOR/WHILE/LOOP per-customer loop', () => {
    expect(/\bFOR\b[\s\S]{0,40}\bIN\b[\s\S]{0,40}\bLOOP\b/i.test(CODE)).toBe(false)
    expect(/\bWHILE\b[\s\S]{0,40}\bLOOP\b/i.test(CODE)).toBe(false)
  })
})

describe('008 opportunity detection preview — six detectors', () => {
  const detectorKeys = [
    'vip_early_access',
    'abandoned_checkout',
    'wtf_credit_waiting',
    'regular_buyer_campaign_alert',
    'new_account_no_purchase',
    'lapsed_14_days',
  ]

  it('the opportunities payload contains all six detector keys', () => {
    const oppBlock = FLAT.match(/'opportunities', jsonb_build_object\(([\s\S]*?)\), 'overlap'/i)
    expect(oppBlock, 'opportunities block present').toBeTruthy()
    for (const k of detectorKeys) {
      expect(oppBlock![1], `detector ${k} present`).toContain(`'${k}'`)
    }
  })

  it('every detector reports matched and currentlySendable separately', () => {
    // matched appears once per detector; currentlySendable once per detector.
    expect((FLAT.match(/'matched'/g) || []).length).toBeGreaterThanOrEqual(6)
    expect((FLAT.match(/'currentlySendable'/g) || []).length).toBeGreaterThanOrEqual(6)
  })

  it('matching does NOT require marketing permission (behaviour-only flags)', () => {
    // Each behavioural matched count filters on the behaviour flag, and the
    // sendable count adds "AND eligible" — proving they are separate.
    expect(FLAT).toMatch(/count\(\*\) FILTER \(WHERE f_wtf\)::bigint\s+AS wtf_matched/i)
    expect(FLAT).toMatch(/count\(\*\) FILTER \(WHERE f_wtf AND eligible\)::bigint\s+AS wtf_sendable/i)
    expect(FLAT).toMatch(/count\(\*\) FILTER \(WHERE f_lapsed\)::bigint\s+AS lapsed_matched/i)
    expect(FLAT).toMatch(/count\(\*\) FILTER \(WHERE f_lapsed AND eligible\)::bigint\s+AS lapsed_sendable/i)
  })

  it('uses marketing_eligible_snapshot as the fast sendability metric, not per-row eligibility calls', () => {
    expect(FLAT).toMatch(/marketing_eligible_snapshot/i)
    // is_marketing_email_eligible is NOT called inside the function body
    // (only checked for existence in the preflight).
    const body = FLAT.match(/AS \$\$([\s\S]*?)\$\$;/i)
    expect(body, 'function body present').toBeTruthy()
    expect(/is_marketing_email_eligible\s*\(/i.test(body![1])).toBe(false)
  })
})

describe('008 opportunity detection preview — checkout_intents access', () => {
  it('reads checkout_intents with a bounded recent window (<= 48h)', () => {
    expect(FLAT).toMatch(/v_abandoned_from\s+timestamptz := v_now - interval '48 hours'/i)
    expect(FLAT).toMatch(/ci\.created_at >= v_abandoned_from/i)
    expect(FLAT).toMatch(/ci\.created_at <= v_ac_cutoff/i)
  })

  it('abandoned detection excludes confirmed / debug / SIM checkouts', () => {
    expect(FLAT).toMatch(/ci\.state IS DISTINCT FROM 'confirmed'/i)
    expect(FLAT).toMatch(/ci\.provider IS DISTINCT FROM 'debug'/i)
    expect(FLAT).toMatch(/ci\.ref NOT LIKE 'SIM-%'/i)
  })

  it('abandoned detection excludes customers who later confirmed the SAME campaign', () => {
    expect(FLAT).toMatch(/abandoned_no_conversion AS \(/i)
    expect(FLAT).toMatch(/WHERE NOT EXISTS \(/i)
    expect(FLAT).toMatch(/c\.campaign_id = aw\.campaign_id/i)
    expect(FLAT).toMatch(/c\.state = 'confirmed'/i)
    expect(FLAT).toMatch(/c\.confirmed_at >= aw\.created_at/i)
  })

  it('deduplicates abandoned candidates by customer', () => {
    // EXEC strips the inline "-- deduplicate by customer" comment that sits
    // between AS ( and SELECT in the source.
    expect(EXEC).toMatch(/abandoned_users AS \( SELECT DISTINCT user_id FROM abandoned_no_conversion \)/i)
  })

  it('reports recentCheckoutRowsScanned for the abandoned detector', () => {
    expect(FLAT).toMatch(/'recentCheckoutRowsScanned'/i)
  })

  it('regular-buyer campaign purchase read is bounded to CONFIGURED promotion campaigns only', () => {
    expect(FLAT).toMatch(/rb_promo_campaigns AS \(/i)
    expect(FLAT).toMatch(/JOIN rb_promo_campaigns rc ON rc\.campaign_id = c\.campaign_id/i)
  })
})

describe('008 opportunity detection preview — promotion-driven detectors', () => {
  it('VIP requires an explicitly configured vip_early_access promotion', () => {
    expect(FLAT).toMatch(/promotion_type = 'vip_early_access'\s+AND status IN \('scheduled', 'processing'\)/i)
    // VIP behaviour flag is gated by v_vip_promos > 0.
    expect(FLAT).toMatch(/v_vip_promos > 0\s+AND \(p\.confirmed_order_count >= 10 OR p\.lifetime_external_pence >= 25000\)/i)
    expect(FLAT).toMatch(/'configuredPromotions', v_vip_promos/i)
  })

  it('regular buyer requires an explicitly configured regular_buyer_campaign_alert promotion', () => {
    expect(FLAT).toMatch(/promotion_type = 'regular_buyer_campaign_alert'\s+AND status IN \('scheduled', 'processing'\)/i)
    expect(FLAT).toMatch(/'configuredPromotions',\s+v_rb_promos/i)
  })

  it('regular buyer reuses the canonical frequent-buyer definition (>= 5 orders)', () => {
    expect(FLAT).toMatch(/frequent_buyers AS \([\s\S]*?confirmed_order_count >= 5/i)
  })

  it('regular buyer excludes customers who already purchased that campaign', () => {
    expect(FLAT).toMatch(/already_purchased/i)
    expect(FLAT).toMatch(/rb_candidate_users AS \([\s\S]*?WHERE already_purchased = false/i)
    expect(FLAT).toMatch(/'alreadyPurchasedExcluded'/i)
  })
})

describe('008 opportunity detection preview — profile-only detectors reuse canonical Stage 2 windows', () => {
  it('lapsed_14_days uses confirmed_order_count > 0 AND last_confirmed_at < now()-14d', () => {
    expect(FLAT).toMatch(/v_14d\s+timestamptz := v_now - interval '14 days'/i)
    expect(FLAT).toMatch(/p\.confirmed_order_count > 0\s+AND p\.last_confirmed_at IS NOT NULL\s+AND p\.last_confirmed_at < v_14d/i)
  })

  it('new_account_no_purchase uses the 7-day window and the automation first delay', () => {
    expect(FLAT).toMatch(/v_new_window_from timestamptz := v_now - interval '7 days'/i)
    expect(FLAT).toMatch(/p\.confirmed_order_count = 0/i)
    expect(FLAT).toMatch(/p\.account_created_at <= v_na_cutoff/i)
    expect(FLAT).toMatch(/p\.account_created_at >= v_new_window_from/i)
  })

  it('uses the automation first_delay_minutes / minimum_wallet_pence config, not hard-coded literals', () => {
    expect(FLAT).toMatch(/first_delay_minutes\)\s+FILTER \(WHERE automation_key = 'abandoned_checkout'\)/i)
    expect(FLAT).toMatch(/first_delay_minutes\)\s+FILTER \(WHERE automation_key = 'new_account_no_purchase'\)/i)
    expect(FLAT).toMatch(/minimum_wallet_pence\) FILTER \(WHERE automation_key = 'wtf_credit_waiting'\)/i)
    expect(FLAT).toMatch(/p\.wallet_available_pence >= v_wtf_min_wallet/i)
  })
})

describe('008 opportunity detection preview — overlap + winner simulation', () => {
  it('returns the required overlap aggregate keys', () => {
    for (const k of [
      'uniqueCustomersMatchingAnyOpportunity',
      'uniqueCurrentlySendableMatchingAnyOpportunity',
      'totalOpportunityMatches',
      'customersMatchingMoreThanOneOpportunity',
      'maximumOpportunitiesMatchedByOneCustomer',
      'opportunityMatchDistribution',
    ]) {
      expect(FLAT, `overlap key ${k}`).toContain(`'${k}'`)
    }
  })

  it('returns a 0..6 match distribution', () => {
    const dist = FLAT.match(/'opportunityMatchDistribution', jsonb_build_object\(([\s\S]*?)\)\s*\)/i)
    expect(dist, 'distribution block present').toBeTruthy()
    for (const n of ['0', '1', '2', '3', '4', '5', '6']) {
      expect(dist![1], `distribution bucket ${n}`).toContain(`'${n}'`)
    }
  })

  it('computes a deterministic winner using marketing_automations.priority', () => {
    expect(FLAT).toMatch(/winners AS \(/i)
    expect(FLAT).toMatch(/JOIN public\.marketing_automations a ON a\.automation_key = f\.key/i)
    expect(FLAT).toMatch(/ORDER BY a\.priority ASC\s+LIMIT 1/i)
  })

  it('wouldWinByType reports a count for each of the six types', () => {
    const block = FLAT.match(/'wouldWinByType', jsonb_build_object\(([\s\S]*?)\)\s*\)\s+INTO v_result/i)
    expect(block, 'wouldWinByType block present').toBeTruthy()
    for (const k of [
      'vip_early_access',
      'abandoned_checkout',
      'wtf_credit_waiting',
      'regular_buyer_campaign_alert',
      'new_account_no_purchase',
      'lapsed_14_days',
    ]) {
      expect(block![1], `winner type ${k}`).toContain(`'${k}'`)
    }
  })
})

describe('008 opportunity detection preview — external contacts explicitness', () => {
  it('reports enabled external contacts and marks them not behaviour-scored', () => {
    expect(FLAT).toMatch(/'enabledExternalContacts',\s+e\.enabled_external/i)
    expect(FLAT).toMatch(/'externalContactsNotBehaviourScored',\s+e\.enabled_external/i)
  })

  it('does not pretend external contacts match behavioural opportunities', () => {
    // External contacts are counted only in the population block; they never
    // feed the flags CTE (which is driven solely by customer_marketing_profiles).
    expect(FLAT).toMatch(/flags AS \([\s\S]*?FROM public\.customer_marketing_profiles p/i)
    expect(/marketing_external_contacts[\s\S]{0,120}f_vip/i.test(FLAT)).toBe(false)
  })
})
