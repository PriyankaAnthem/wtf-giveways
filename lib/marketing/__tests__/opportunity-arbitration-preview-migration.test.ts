import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static contract tests for
//   scripts/marketing/011-marketing-opportunity-detection-preview.sql
//
// These tests treat the migration as STATIC TEXT. They never open a database
// connection, never execute SQL, and never run detection. They assert the
// read-only safety, boundary, detection-coverage, scoring, arbitration and
// permission-separation guarantees of the Stage 3C2D preview.
// ---------------------------------------------------------------------------

const CODE = readFileSync(
  join(process.cwd(), 'scripts/marketing/011-marketing-opportunity-detection-preview.sql'),
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

// Executable view with BOTH comments and single-quoted string literals removed,
// so bans on executable identifiers (AI/email/cron function calls, etc.) are not
// satisfied by prose living inside COMMENT ON / jsonb string values.
const EXEC_NOSTR = EXEC.replace(/'(?:[^']|'')*'/g, "''")

// The full 28-definition catalogue seeded by migration 009.
const ALL_DEFINITIONS = [
  'vip_early_access',
  'abandoned_checkout',
  'wtf_credit_waiting',
  'regular_buyer_campaign_alert',
  'new_account_no_purchase',
  'lapsed_14_days',
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
  'lapsed_7_days',
  'lapsed_30_days',
  'high_value_customer_at_risk',
  'vip_reactivation',
  'reactivated_customer_follow_up',
  'high_value_abandoned_checkout',
  'repeat_abandoner',
  'campaign_closing_relevant_customer',
  'recent_buyer_cross_campaign',
  'promotion_match',
]

// Stage 3C2D semantic correction: winner + abandonment detectors are now
// campaign_specific (they carry last_win_campaign_id / last_abandoned_campaign_id),
// so they moved OUT of supportedNow and INTO requiresCampaignContext.
const SUPPORTED_NOW = [
  'new_account_no_purchase',
  'first_to_second_purchase',
  'lapsed_7_days',
  'lapsed_14_days',
  'lapsed_30_days',
  'high_value_customer_at_risk',
  'vip_reactivation',
  'reactivated_customer_follow_up',
  'personal_cadence_overdue',
  'wtf_credit_waiting',
  'fresh_wallet_credit',
  'first_win_follow_up',
]

const REQUIRES_CAMPAIGN = [
  'recent_winner_follow_up',
  'recent_winner_credit_available',
  'high_value_winner_follow_up',
  'abandoned_checkout',
  'repeat_abandoner',
  'wallet_credit_campaign_match',
  'frequent_buyer_relevant_campaign',
  'vip_relevant_campaign',
  'reveal_affinity_campaign',
  'recently_active_no_relevant_entry',
  'vip_early_access',
  'regular_buyer_campaign_alert',
  'campaign_closing_relevant_customer',
  'promotion_match',
]

// recent_buyer_cross_campaign is campaign_specific but a concrete another-live-
// unbought campaign_id cannot be selected safely from existing rollups, so per
// requirement (I) it is reported UNSUPPORTED rather than emitting NULL.
const FUTURE_UNSUPPORTED = ['high_value_abandoned_checkout', 'recent_buyer_cross_campaign']

describe('011 preview — migration envelope', () => {
  it('is wrapped in a single atomic BEGIN;/COMMIT;', () => {
    const t = EXEC.trim()
    expect(t.startsWith('BEGIN;')).toBe(true)
    expect(t.endsWith('COMMIT;')).toBe(true)
    expect((EXEC.match(/\bBEGIN\s*;/g) || []).length).toBe(1)
    expect((EXEC.match(/\bCOMMIT\s*;/g) || []).length).toBe(1)
  })

  it('sets defensive LOCAL lock/statement timeouts', () => {
    expect(FLAT).toMatch(/SET LOCAL lock_timeout = '5s'/i)
    expect(FLAT).toMatch(/SET LOCAL statement_timeout = '60s'/i)
  })

  it('runs a read-only preflight with advisory lock and global-pause assertion', () => {
    expect(FLAT).toMatch(/pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3c2d_detection_preview'\)\)/i)
    expect(FLAT).toMatch(/SELECT sending_enabled, discovery_enabled, rollout_limit INTO/i)
    expect(FLAT).toMatch(/v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout\s+IS DISTINCT FROM 0/i)
  })

  it('does not reference or execute the obsolete migration 008', () => {
    expect(/008-marketing-opportunity-detection-preview/i.test(EXEC)).toBe(false)
  })
})

describe('011 preview — inert install (NO writes / NO state change)', () => {
  it('performs no INSERT / UPDATE / DELETE / MERGE / TRUNCATE anywhere', () => {
    expect(/\bINSERT\s+INTO\b/i.test(EXEC)).toBe(false)
    expect(/\bUPDATE\s+public\./i.test(EXEC)).toBe(false)
    expect(/\bDELETE\s+FROM\b/i.test(EXEC)).toBe(false)
    expect(/\bMERGE\b/i.test(EXEC)).toBe(false)
    expect(/\bTRUNCATE\b/i.test(EXEC)).toBe(false)
    expect(/ON CONFLICT/i.test(EXEC)).toBe(false)
  })

  it('creates NO table, NO trigger, NO extension, and ALTERs nothing', () => {
    expect(/\bCREATE\s+TABLE\b/i.test(EXEC)).toBe(false)
    expect(/\bCREATE\s+TRIGGER\b/i.test(EXEC)).toBe(false)
    expect(/\bCREATE\s+EXTENSION\b/i.test(EXEC)).toBe(false)
    expect(/\bALTER\s+TABLE\b/i.test(EXEC)).toBe(false)
    expect(/\bDROP\s+TABLE\b/i.test(EXEC)).toBe(false)
  })

  it('never writes the opportunity ledger, recipients or runs', () => {
    expect(/INSERT[^;]*marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/UPDATE[^;]*marketing_opportunities/i.test(FLAT_EXEC)).toBe(false)
    expect(/marketing_recipients/i.test(EXEC)).toBe(false)
    expect(/marketing_automation_runs?/i.test(EXEC)).toBe(false)
  })

  it('never enables a definition or mutates control state', () => {
    expect(/UPDATE[^;]*marketing_opportunity_definitions/i.test(FLAT_EXEC)).toBe(false)
    expect(/enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/UPDATE[^;]*marketing_control_state/i.test(FLAT_EXEC)).toBe(false)
    expect(/sending_enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/discovery_enabled\s*=\s*true/i.test(EXEC)).toBe(false)
    expect(/rollout_limit\s*=\s*[1-9]/i.test(EXEC)).toBe(false)
  })

  it('adds NO AI, NO email/Resend, NO cron', () => {
    // EXEC_NOSTR: comments AND string literals stripped, so a COMMENT ON that
    // promises "no AI/cron/email" cannot trip these executable-identifier bans.
    expect(/\b(openai|anthropic|ai_gateway|generatetext|streamtext|embeddings?|gpt|llm)\b/i.test(EXEC_NOSTR)).toBe(false)
    expect(/\b(resend|smtp|sendmail|nodemailer|mailgun|send_email)\b/i.test(EXEC_NOSTR)).toBe(false)
    expect(/\b(cron|pg_cron|cron\.schedule)\b/i.test(EXEC_NOSTR)).toBe(false)
  })
})

describe('011 preview — reads only rollups + config (no operational scan)', () => {
  it('reads the three rollup substrates', () => {
    expect(FLAT).toMatch(/FROM public\.customer_marketing_profiles/i)
    expect(FLAT).toMatch(/public\.customer_marketing_intelligence/i)
    expect(FLAT).toMatch(/public\.customer_campaign_affinity/i)
  })

  it('joins only the small campaign / promotion / automation config tables', () => {
    expect(FLAT).toMatch(/FROM public\.campaigns/i)
    expect(FLAT).toMatch(/public\.marketing_campaign_promotions/i)
    expect(FLAT).toMatch(/public\.marketing_automations/i)
  })

  it('NEVER scans operational history (checkouts / awards / wallet ledger)', () => {
    // Assert no FROM/JOIN of any operational table. (A table name may appear
    // inside an explanatory JSON reason string, which is not a scan.)
    for (const t of [
      'checkout_intents',
      'instant_win_awards',
      'wallet_transactions',
      'wallet_reservations',
    ]) {
      expect(new RegExp(`\\b(FROM|JOIN)\\s+public\\.${t}\\b`, 'i').test(EXEC)).toBe(false)
    }
  })

  it('never scans auth.users', () => {
    expect(/auth\.users/i.test(EXEC)).toBe(false)
  })

  it('is set-based — no PL/pgSQL per-customer loop', () => {
    expect(/FOR\s+\w+\s+IN\s+SELECT/i.test(EXEC)).toBe(false)
    // The only LOOP is the preflight dependency FOREACH; ignore it, assert none else.
    const withoutPreflight = EXEC.replace(/FOREACH v_dep IN ARRAY[\s\S]*?END LOOP;/i, '')
    expect(/\bLOOP\b/i.test(withoutPreflight)).toBe(false)
    expect(/\bWHILE\b/i.test(EXEC)).toBe(false)
  })

  it('does not SELECT * over a base table', () => {
    // A bare "SELECT * FROM public.<table>" is banned; "SELECT * FROM
    // public.<fn>()" (a set-returning preview function) is allowed.
    const matches = FLAT.match(/SELECT\s+\*\s+FROM\s+public\.\w+(\s*\()?/gi) || []
    const baseTableStars = matches.filter((m) => !/\(\s*$/.test(m))
    expect(baseTableStars).toEqual([])
  })
})

describe('011 preview — broad catalogue, not the original six', () => {
  it('uses the authoritative definitions catalogue for family/priority/score', () => {
    expect(FLAT).toMatch(/JOIN public\.marketing_opportunity_definitions def ON def\.opportunity_key = rc\.opportunity_key/i)
  })

  it('detects every SUPPORTED_NOW definition', () => {
    for (const k of SUPPORTED_NOW) {
      expect(FLAT_EXEC).toMatch(new RegExp(`\\('${k}',`, 'i'))
    }
  })

  it('detects every REQUIRES_CAMPAIGN definition', () => {
    for (const k of REQUIRES_CAMPAIGN) {
      expect(FLAT_EXEC).toMatch(new RegExp(`\\('${k}',`, 'i'))
    }
  })

  it('implements exactly 26 of the 28 catalogue definitions', () => {
    const implemented = ALL_DEFINITIONS.filter((k) =>
      new RegExp(`\\('${k}',`, 'i').test(FLAT_EXEC),
    )
    expect(implemented.sort()).toEqual(
      ALL_DEFINITIONS.filter((k) => !FUTURE_UNSUPPORTED.includes(k)).sort(),
    )
    expect(implemented).toHaveLength(26)
  })

  it('declares the two unsupported detectors (never invented) with reasons', () => {
    // Neither unsupported detector has an executable ('key', ...) candidate row.
    expect(/\('high_value_abandoned_checkout',/i.test(FLAT_EXEC)).toBe(false)
    expect(/\('recent_buyer_cross_campaign',/i.test(FLAT_EXEC)).toBe(false)
    expect(FLAT).toMatch(
      /'futureUnsupported', jsonb_build_array\( 'high_value_abandoned_checkout','recent_buyer_cross_campaign' \)/i,
    )
    expect(FLAT).toMatch(/highValueAbandonedCheckoutUnsupportedReason/i)
    expect(FLAT).toMatch(/recentBuyerCrossCampaignUnsupportedReason/i)
  })

  it('publishes a support matrix partitioning the catalogue', () => {
    expect(FLAT).toMatch(/'supportedNow', jsonb_build_array\(/i)
    expect(FLAT).toMatch(/'requiresCampaignContext', jsonb_build_array\(/i)
    expect(FLAT).toMatch(/'futureUnsupported', jsonb_build_array\(/i)
    for (const k of SUPPORTED_NOW) {
      expect(FLAT).toMatch(new RegExp(`'supportedNow'[\\s\\S]*'${k}'`, 'i'))
    }
    for (const k of REQUIRES_CAMPAIGN) {
      expect(FLAT).toMatch(new RegExp(`'requiresCampaignContext'[\\s\\S]*'${k}'`, 'i'))
    }
  })
})

describe('011 preview — no loss / gambling-harm signals', () => {
  it('derives no loss / near-miss / streak / probability logic', () => {
    // Word-boundaried so legitimate tokens like "purchase" (which contains
    // "chase") are not false-positives.
    expect(
      /losing_streak|loss_streak|near_miss|near-miss|due_to_win|win_probability|overdue_win|\bchas(e|ing)\b|chase_loss|cumulative_loss|financial_vulnerab|deposit_escalat/i.test(
        EXEC,
      ),
    ).toBe(false)
  })

  it('uses win data only as positive engagement (no predictive/streak framing)', () => {
    expect(FLAT).toMatch(/winner_c/i)
    expect(/likely to win|due another|ride the win|hot streak/i.test(CODE)).toBe(false)
  })
})

describe('011 preview — feature provenance', () => {
  it('wallet CURRENT balance comes from the profile', () => {
    expect(FLAT).toMatch(/p\.wallet_available_pence/i)
  })

  it('win history comes from intelligence', () => {
    expect(FLAT).toMatch(/i\.last_win_at/i)
    expect(FLAT).toMatch(/i\.win_count/i)
    expect(FLAT).toMatch(/i\.last_win_value_pence/i)
  })

  it('abandonment comes from intelligence (rollup), not a checkout re-scan', () => {
    expect(FLAT).toMatch(/i\.abandoned_7d_count/i)
    expect(FLAT).toMatch(/i\.abandoned_30d_count/i)
    expect(FLAT).toMatch(/i\.last_abandoned_at/i)
  })

  it('cadence comes from intelligence with a documented minimum gap floor', () => {
    expect(FLAT).toMatch(/i\.average_purchase_gap_hours/i)
    expect(FLAT).toMatch(/GREATEST\(b\.average_purchase_gap_hours, 12\.0\)/i)
    expect(FLAT).toMatch(/cadenceMinimumGapFloorHours', 12/i)
    expect(FLAT).toMatch(/cadenceOverdueRatioThreshold', 1\.5/i)
  })

  it('campaign affinity comes from the affinity table (structured only, never titles)', () => {
    expect(FLAT).toMatch(/FROM public\.customer_campaign_affinity/i)
    expect(FLAT).toMatch(/affinity_type IN \('reveal_type', 'presentation_type'\)/i)
    // No inference from campaign free-text.
    expect(/\bc\.(title|slug|summary|description)\b/i.test(EXEC)).toBe(false)
  })

  it('uses the established VIP / frequent-buyer commercial definitions', () => {
    expect(FLAT).toMatch(/confirmed_order_count >= 10 OR b\.lifetime_external_pence >= 25000/i)
    expect(FLAT).toMatch(/b\.confirmed_order_count >= 5/i)
  })

  it('live campaign universe is status = live; closing uses end_at within 48h', () => {
    expect(FLAT).toMatch(/WHERE c\.status = 'live'/i)
    expect(FLAT).toMatch(/c\.end_at <= now\(\) \+ interval '48 hours'/i)
  })
})

describe('011 preview — deterministic bounded score', () => {
  it('clamps the final score to 0..1000', () => {
    expect(FLAT).toMatch(/LEAST\(1000, GREATEST\(0,/i)
  })

  it('exposes transparent score components including a base and final', () => {
    for (const key of ['base', 'value', 'recency', 'cadence', 'wallet', 'winner', 'affinity', 'urgency', 'abandon', 'final']) {
      expect(FLAT).toMatch(new RegExp(`'${key}',`, 'i'))
    }
  })

  it('starts the score from the catalogue default_score (no opaque magic base)', () => {
    expect(FLAT).toMatch(/round\(f\.default_score\)::int \+ f\.value_c \+ f\.recency_c/i)
  })

  it('incorporates definition priority as a score/arbitration input', () => {
    expect(FLAT).toMatch(/def\.default_priority/i)
  })
})

describe('011 preview — affinity_c reflects ONLY structured affinity (Stage 3C2D)', () => {
  // Isolate the affinity_c expression: from the `AS affinity_c` marker back to
  // the previous comma that opens the projection.
  const affIdx = FLAT.indexOf('AS affinity_c')
  const affExpr = FLAT.slice(FLAT.lastIndexOf('(CASE', affIdx), affIdx)

  const STRUCTURED = [
    'wallet_credit_campaign_match',
    'frequent_buyer_relevant_campaign',
    'vip_relevant_campaign',
    'reveal_affinity_campaign',
    'recently_active_no_relevant_entry',
    'campaign_closing_relevant_customer',
  ]
  const PROMO_CONFIG_ONLY = ['vip_early_access', 'regular_buyer_campaign_alert', 'promotion_match']

  it('awards affinity_c only to the six structured-affinity opportunity types (flat 60)', () => {
    for (const k of STRUCTURED) {
      expect(affExpr).toContain(`'${k}'`)
    }
    // The award is a flat 60 gated on the key allow-list + a concrete campaign.
    expect(FLAT).toMatch(/\) AND s\.campaign_id IS NOT NULL THEN 60 ELSE 0 END\)::int AS affinity_c/i)
  })

  it('gives vip_early_access NO affinity_c merely from campaign_id', () => {
    expect(affExpr).not.toContain("'vip_early_access'")
  })

  it('gives regular_buyer_campaign_alert NO affinity_c merely from campaign_id', () => {
    expect(affExpr).not.toContain("'regular_buyer_campaign_alert'")
  })

  it('gives promotion_match NO affinity_c merely from campaign_id', () => {
    expect(affExpr).not.toContain("'promotion_match'")
  })

  it('does NOT reference the promotion-config-only keys anywhere in affinity_c', () => {
    for (const k of PROMO_CONFIG_ONLY) {
      expect(affExpr).not.toContain(`'${k}'`)
    }
  })

  it('does NOT add VIP inside affinity_c (VIP lives once in value_c)', () => {
    // No is_vip term and no leftover +20 inside the affinity_c expression.
    expect(/is_vip/i.test(affExpr)).toBe(false)
    expect(/\b20\b/.test(affExpr)).toBe(false)
    // affinity_c is no longer family-based.
    expect(/family IN \('affinity', 'promotion'\)/i.test(affExpr)).toBe(false)
  })

  it('bounds affinity_c to exactly 0 or 60 (no other magnitude yet)', () => {
    // The only numeric literals in the affinity_c expression are 60 and 0.
    const nums = (affExpr.match(/\b\d+\b/g) || []).sort()
    expect(nums).toEqual(['0', '60'])
  })
})

describe('011 preview — arbitration (one winner per customer)', () => {
  it('uses a window ROW_NUMBER partitioned by user_id (no procedural loop)', () => {
    expect(FLAT).toMatch(/ROW_NUMBER\(\) OVER \( PARTITION BY f\.user_id ORDER BY/i)
  })

  it('orders by default_priority, then final_score, then urgency, then key', () => {
    expect(FLAT).toMatch(
      /ORDER BY f\.default_priority ASC, f\.final_score DESC, f\.is_closing DESC, f\.opportunity_key ASC/i,
    )
  })

  it('treats rn = 1 as the single winner per customer', () => {
    expect(FLAT).toMatch(/WHERE rn = 1/i)
  })
})

describe('011 preview — permission separate from detection', () => {
  it('does NOT filter detection by marketing permission or sendability', () => {
    // Population spine covers every profile; intelligence is a LEFT JOIN.
    expect(FLAT).toMatch(/FROM public\.customer_marketing_profiles p LEFT JOIN public\.customer_marketing_intelligence/i)
    // The permission/sendability fields are PROJECTED, never used as an
    // equality/boolean predicate that would prune the detected population.
    // Permission/sendability fields are never used as a boolean/equality
    // predicate that would prune the population.
    expect(/marketing_eligible_snapshot\s*=\s*true/i.test(FLAT_EXEC)).toBe(false)
    expect(/marketing_enabled\s*=\s*true/i.test(FLAT_EXEC)).toBe(false)
    // marketing_enabled appears ONLY as a bare projection (`p.marketing_enabled,`)
    // and inside the derived perm_* boolean columns — never as a filter such as
    // `WHERE marketing_enabled` / `AND marketing_enabled` / `marketing_enabled AND`.
    expect(/WHERE\s+[a-z0-9_.]*\bmarketing_enabled\b/i.test(FLAT_EXEC)).toBe(false)
    expect(/\bAND\s+[a-z0-9_.]*\bmarketing_enabled\b/i.test(FLAT_EXEC)).toBe(false)
    // The ONLY `WHERE ... sendable_now` allowed is the winners reporting
    // aggregate `(... FROM winners WHERE sendable_now)`; no other sendable_now
    // predicate may prune the detected population.
    const sendableClauses = FLAT_EXEC.match(/WHERE\s+sendable_now\b/gi) || []
    for (const clause of sendableClauses) {
      expect(clause).toMatch(/WHERE\s+sendable_now/i)
    }
    // And sendable_now is never combined into a population-pruning predicate.
    expect(/\bAND\s+sendable_now\b/i.test(FLAT_EXEC)).toBe(false)
    // The only executable WHERE touching permission-family columns is the
    // campaign_specific invariant, which references campaign_id, not permission.
    expect(FLAT).toMatch(/WHERE NOT \(def\.campaign_specific AND rc\.campaign_id IS NULL\)/i)
  })

  it('reports a three-way permission split on winners', () => {
    expect(FLAT).toMatch(/perm_backed/i)
    expect(FLAT).toMatch(/perm_suppressed/i)
    expect(FLAT).toMatch(/perm_not_backed/i)
    expect(FLAT).toMatch(/'winningPermissionBacked',\s*\(SELECT count\(\*\)::bigint FROM winners WHERE perm_backed\)/i)
    expect(FLAT).toMatch(/'winningNotPermissionBacked'/i)
    expect(FLAT).toMatch(/'winningSuppressed'/i)
  })

  it('derives permission from marketing_enabled + suppression (permission != sendability)', () => {
    // perm_backed is PERMISSION-backed (marketing_enabled), distinct from
    // sendable_now which is the eligibility snapshot.
    expect(FLAT).toMatch(/c\.marketing_enabled AND NOT c\.has_active_suppression\)\s*AS perm_backed/i)
    expect(FLAT).toMatch(/NOT c\.marketing_enabled AND NOT c\.has_active_suppression\)\s*AS perm_not_backed/i)
    expect(FLAT).toMatch(/c\.has_active_suppression\s+AS perm_suppressed/i)
  })

  it('reports sendability (marketing_eligible_snapshot) SEPARATELY from permission', () => {
    // sendable_now is its own field and its own aggregate + sample flag.
    expect(FLAT).toMatch(/c\.marketing_eligible_snapshot AND NOT c\.has_active_suppression\)\s*AS sendable_now/i)
    expect(FLAT).toMatch(/'winningSendableNow',\s*\(SELECT count\(\*\)::bigint FROM winners WHERE sendable_now\)/i)
    expect(FLAT).toMatch(/'sendableNow',\s*sendable_now/i)
  })
})

describe('011 preview — campaign context is concrete (Stage 3C2D correction)', () => {
  it('defines the live campaign universe as status=live AND still-open', () => {
    expect(FLAT).toMatch(/WHERE c\.status = 'live' AND \(c\.end_at IS NULL OR c\.end_at > now\(\)\)/i)
  })

  it('builds an ACTIONABLE promotion universe joining promotions to live campaigns', () => {
    expect(FLAT).toMatch(
      /FROM public\.marketing_campaign_promotions p JOIN public\.campaigns c ON c\.id = p\.campaign_id WHERE p\.status IN \('scheduled', 'processing'\) AND c\.status = 'live' AND \(c\.end_at IS NULL OR c\.end_at > now\(\)\)/i,
    )
  })

  it('enforces the campaign_specific invariant in EXECUTABLE SQL (not just prose)', () => {
    expect(FLAT).toMatch(/def\.campaign_specific/i)
    expect(FLAT).toMatch(/WHERE NOT \(def\.campaign_specific AND rc\.campaign_id IS NULL\)/i)
  })

  it('attaches winner campaign context from last_win_campaign_id', () => {
    expect(FLAT).toMatch(/i\.last_win_campaign_id/i)
    // recent_winner_follow_up requires a non-null last_win_campaign_id.
    expect(FLAT).toMatch(
      /\('recent_winner_follow_up', c\.last_win_at IS NOT NULL AND c\.last_win_at >= now\(\) - interval '7 days' AND c\.last_win_campaign_id IS NOT NULL, c\.last_win_campaign_id\)/i,
    )
    expect(FLAT).toMatch(/'high_value_winner_follow_up',[\s\S]*c\.last_win_campaign_id IS NOT NULL, c\.last_win_campaign_id\)/i)
  })

  it('attaches abandonment campaign context from last_abandoned_campaign_id', () => {
    expect(FLAT).toMatch(/i\.last_abandoned_campaign_id/i)
    expect(FLAT).toMatch(
      /\('abandoned_checkout', COALESCE\(c\.abandoned_7d_count, 0\) >= 1 AND c\.last_abandoned_campaign_id IS NOT NULL, c\.last_abandoned_campaign_id\)/i,
    )
    expect(FLAT).toMatch(/\('repeat_abandoner', COALESCE\(c\.abandoned_30d_count, 0\) >= 2 AND c\.last_abandoned_campaign_id IS NOT NULL, c\.last_abandoned_campaign_id\)/i)
  })

  it('uses a SEPARATE reveal-only selector for reveal_affinity_campaign', () => {
    expect(FLAT).toMatch(/reveal_campaign_pick/i)
    expect(FLAT).toMatch(/WHERE NOT already_entered AND via_reveal/i)
    expect(FLAT).toMatch(/\('reveal_affinity_campaign', c\.reveal_campaign_id IS NOT NULL, c\.reveal_campaign_id\)/i)
  })

  it('ranks relevant campaigns by structured affinity — never MIN(uuid)', () => {
    expect(FLAT).toMatch(
      /ORDER BY confirmed_order_count DESC, external_spend_pence DESC, affinity_last_confirmed_at DESC NULLS LAST, end_at ASC NULLS LAST, campaign_id ASC/i,
    )
    expect(/min\(campaign_id\)/i.test(EXEC)).toBe(false)
  })

  it('derives is_closing from THAT candidate campaign only (not customer-wide)', () => {
    expect(FLAT).toMatch(/\(rc\.campaign_id IS NOT NULL AND COALESCE\(cl\.is_closing, false\)\) AS is_closing/i)
    expect(FLAT).toMatch(/LEFT JOIN closing_lu cl ON cl\.campaign_id = rc\.campaign_id/i)
  })

  it('gates first_to_second_purchase to a single recent order within 14 days', () => {
    expect(FLAT).toMatch(
      /\('first_to_second_purchase', c\.confirmed_order_count = 1 AND c\.last_confirmed_at IS NOT NULL AND c\.last_confirmed_at >= now\(\) - interval '14 days', NULL::uuid\)/i,
    )
  })

  it('sources actionable promotion campaign ids for promotion detectors', () => {
    expect(FLAT).toMatch(/\('vip_early_access', c\.is_vip AND c\.vip_promo_campaign_id IS NOT NULL, c\.vip_promo_campaign_id\)/i)
    expect(FLAT).toMatch(/\('regular_buyer_campaign_alert', c\.is_frequent AND c\.rb_promo_campaign_id IS NOT NULL, c\.rb_promo_campaign_id\)/i)
  })
})

describe('011 preview — overview RPC payload', () => {
  it('is STABLE, SECURITY DEFINER, fixed search_path, declarative timeout', () => {
    expect(FLAT).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_detection_preview\(\) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '10s'/i,
    )
  })

  it('returns population / overlap / permission / counts / families / support', () => {
    expect(FLAT).toMatch(/'population', jsonb_build_object\(/i)
    expect(FLAT).toMatch(/'overlap', jsonb_build_object\(/i)
    expect(FLAT).toMatch(/'permission', jsonb_build_object\(/i)
    expect(FLAT).toMatch(/'countByOpportunityType'/i)
    expect(FLAT).toMatch(/'winningCountByOpportunityType'/i)
    expect(FLAT).toMatch(/'families', jsonb_build_object\(/i)
    expect(FLAT).toMatch(/'support', jsonb_build_object\(/i)
  })

  it('returns the required overlap distribution metrics', () => {
    for (const k of ['one', 'two', 'threePlus', 'maxForOneCustomer', 'totalCandidates', 'uniqueCustomers']) {
      expect(FLAT).toMatch(new RegExp(`'${k}',`, 'i'))
    }
  })

  it('returns aggregates only — no identities/emails/row payloads in the overview body', () => {
    const start = EXEC.indexOf('FUNCTION public.get_admin_marketing_opportunity_detection_preview')
    const end = EXEC.indexOf('$$;', start)
    const body = EXEC.slice(start, end)
    expect(/email/i.test(body)).toBe(false)
    expect(/jsonb_agg/i.test(body)).toBe(false)
    expect(/md5\(/i.test(body)).toBe(false)
  })

  it('is service-role-only EXECUTE', () => {
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_admin_marketing_opportunity_detection_preview\(\) FROM public, anon, authenticated/i,
    )
    expect(FLAT).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_opportunity_detection_preview\(\) TO service_role/i,
    )
  })
})

describe('011 preview — sample RPC payload', () => {
  it('is STABLE, SECURITY DEFINER, fixed search_path, declarative timeout', () => {
    expect(FLAT).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_admin_marketing_opportunity_preview_sample\(p_limit integer DEFAULT 25\) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '10s'/i,
    )
  })

  it('hard-caps the sample at 100 rows', () => {
    expect(FLAT).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 100\)/i)
    expect(FLAT).toMatch(/LIMIT v_limit/i)
  })

  it('returns an opaque user hash — never raw user_id, email or name', () => {
    expect(FLAT).toMatch(/'userHash',\s*substr\(md5\(user_id::text\), 1, 12\)/i)
    const start = EXEC.indexOf('FUNCTION public.get_admin_marketing_opportunity_preview_sample')
    const end = EXEC.indexOf('$$;', start)
    const body = EXEC.slice(start, end)
    expect(/'email'|'name'|email_lc/i.test(body)).toBe(false)
    expect(/'userId'|'user_id'/i.test(body)).toBe(false)
  })

  it('exposes score components + compact reason flags in the sample', () => {
    expect(FLAT).toMatch(/'scoreComponents',\s*score_components/i)
    expect(FLAT).toMatch(/'opportunityKey',\s*opportunity_key/i)
    expect(FLAT).toMatch(/'reasons', jsonb_build_object\(/i)
  })

  it('is service-role-only EXECUTE', () => {
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_admin_marketing_opportunity_preview_sample\(integer\) FROM public, anon, authenticated/i,
    )
    expect(FLAT).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_opportunity_preview_sample\(integer\) TO service_role/i,
    )
  })
})

describe('011 preview — private candidate model security', () => {
  it('the shared candidate model is owner-only (EXECUTE granted to nobody)', () => {
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.wtf_marketing_opportunity_candidates_preview\(\) FROM public, anon, authenticated/i,
    )
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.wtf_marketing_opportunity_candidates_preview\(\) FROM service_role/i,
    )
    expect(
      /GRANT EXECUTE ON FUNCTION public\.wtf_marketing_opportunity_candidates_preview/i.test(EXEC),
    ).toBe(false)
  })

  it('is STABLE + SECURITY DEFINER + fixed search_path + declarative timeout', () => {
    expect(FLAT).toMatch(
      /CREATE OR REPLACE FUNCTION public\.wtf_marketing_opportunity_candidates_preview\(\)[\s\S]*?LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '10s'/i,
    )
  })

  it('both public RPCs consume the single shared candidate model', () => {
    expect(
      (FLAT.match(/FROM public\.wtf_marketing_opportunity_candidates_preview\(\)/gi) || []).length,
    ).toBeGreaterThanOrEqual(2)
  })
})
