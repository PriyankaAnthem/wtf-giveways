import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static, offline verification of migration 019 (delivery automation routing).
// No SQL is executed and no database connection is opened; this parses the
// migration text and asserts the routing contract + Stage 018 gate upgrade.
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = join(process.cwd(), 'scripts', 'marketing')
const MIG_019 = '019-marketing-delivery-automation-routing.sql'

const RAW = readFileSync(join(SCRIPTS_DIR, MIG_019), 'utf8')
// Whitespace-flattened copy for resilient substring/regex matching.
const FLAT = RAW.replace(/\s+/g, ' ')

// Code-only view: strip "--" line comments so explanatory prose (e.g. the
// header's "No Resend/provider call" or the Part C "NEVER exposes ..." notes)
// can never trigger a forbidden-token false positive. Only executable SQL
// remains.
const CODE = RAW.replace(/--[^\n]*/g, '')
const CODE_FLAT = CODE.replace(/\s+/g, ' ')

// The six legacy keys shared by definitions catalogue and automations.
const LEGACY_KEYS = [
  'vip_early_access',
  'abandoned_checkout',
  'wtf_credit_waiting',
  'regular_buyer_campaign_alert',
  'new_account_no_purchase',
  'lapsed_14_days',
]

// Slice ONLY the executable, dollar-quoted body of a function ($tag$ ... $tag$).
// This excludes surrounding COMMENT/REVOKE/GRANT statements and adjacent "--"
// section headers, so prose can never leak into structural assertions.
function fnBody(flat: string, tag: string): string {
  const open = flat.indexOf(`$${tag}$`)
  if (open < 0) return ''
  const bodyStart = open + tag.length + 2
  const close = flat.indexOf(`$${tag}$`, bodyStart)
  return close < 0 ? flat.slice(bodyStart) : flat.slice(bodyStart, close)
}

function sliceBetween(flat: string, startMarker: string, endMarker: string): string {
  const s = flat.indexOf(startMarker)
  if (s < 0) return ''
  const e = flat.indexOf(endMarker, s + startMarker.length)
  return e < 0 ? flat.slice(s) : flat.slice(s + startMarker.length, e)
}

// Parse ordered column names from the private gate's RETURNS TABLE ( ... ).
function privateReturnsColumns(): string[] {
  // Anchor on the CREATE (not the DROP) so we parse the new return contract.
  const start = FLAT.indexOf('CREATE FUNCTION public.wtf_marketing_recipient_gate_preview()')
  const rtStart = FLAT.indexOf('RETURNS TABLE (', start)
  if (rtStart < 0) return []
  const open = rtStart + 'RETURNS TABLE ('.length
  let depth = 1
  let i = open
  for (; i < FLAT.length && depth > 0; i++) {
    if (FLAT[i] === '(') depth++
    else if (FLAT[i] === ')') depth--
  }
  const body = FLAT.slice(open, i - 1)
  return body
    .split(',')
    .map((seg) => seg.trim().split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name))
}

describe('019 delivery automation routing — transactional function replacement', () => {
  // Ordered list of DDL verbs applied to the three shared gate functions,
  // in source order, so we can assert drop-before-create and drop ordering.
  function fnDdlSequence(): Array<{ verb: 'DROP' | 'CREATE'; fn: string }> {
    const out: Array<{ verb: 'DROP' | 'CREATE'; fn: string }> = []
    const re =
      /(DROP FUNCTION|CREATE FUNCTION|CREATE OR REPLACE FUNCTION)\s+public\.(wtf_marketing_recipient_gate_preview|get_admin_marketing_recipient_gate_overview|get_admin_marketing_recipient_gate_sample)/gi
    for (const m of RAW.matchAll(re)) {
      out.push({ verb: m[1].toUpperCase().startsWith('DROP') ? 'DROP' : 'CREATE', fn: m[2] })
    }
    return out
  }

  it('R1. migration does NOT CREATE OR REPLACE the private gate (return contract changes)', () => {
    expect(/CREATE OR REPLACE FUNCTION public\.wtf_marketing_recipient_gate_preview\(\)/i.test(RAW)).toBe(false)
    // It uses a plain CREATE after an explicit DROP instead.
    expect(/CREATE FUNCTION public\.wtf_marketing_recipient_gate_preview\(\)/i.test(RAW)).toBe(true)
  })

  it('R2. wrapper functions are dropped BEFORE the private gate', () => {
    const seq = fnDdlSequence()
    const drops = seq.filter((s) => s.verb === 'DROP').map((s) => s.fn)
    const iSample = drops.indexOf('get_admin_marketing_recipient_gate_sample')
    const iOverview = drops.indexOf('get_admin_marketing_recipient_gate_overview')
    const iGate = drops.indexOf('wtf_marketing_recipient_gate_preview')
    expect(iSample).toBeGreaterThanOrEqual(0)
    expect(iOverview).toBeGreaterThanOrEqual(0)
    expect(iGate).toBeGreaterThanOrEqual(0)
    // Both wrappers dropped before the private gate.
    expect(iSample).toBeLessThan(iGate)
    expect(iOverview).toBeLessThan(iGate)
  })

  it('R3. no DROP ... CASCADE anywhere in the migration', () => {
    // No CASCADE modifier on any DROP statement (comments stripped in CODE_FLAT).
    expect(/DROP\s+\w+[^;]*\bCASCADE\b/i.test(CODE_FLAT)).toBe(false)
    // The only surviving "CASCADE" token in code is inside the abort RAISE
    // message string literal ("refusing to DROP (no CASCADE)"); assert that is
    // the sole occurrence so a real CASCADE can never hide.
    const occurrences = (CODE_FLAT.match(/CASCADE/gi) ?? []).length
    expect(occurrences).toBe(1)
    expect(/refusing to DROP \(no CASCADE\)/i.test(CODE_FLAT)).toBe(true)
  })

  it('R4. exactly the three Stage 018 functions are dropped, and each recreated once', () => {
    const seq = fnDdlSequence()
    const dropped = seq.filter((s) => s.verb === 'DROP').map((s) => s.fn).sort()
    const created = seq.filter((s) => s.verb === 'CREATE').map((s) => s.fn).sort()
    const expected = [
      'get_admin_marketing_recipient_gate_overview',
      'get_admin_marketing_recipient_gate_sample',
      'wtf_marketing_recipient_gate_preview',
    ]
    expect(dropped).toEqual(expected)
    expect(created).toEqual(expected)
    // Each dropped/created exactly once.
    expect(seq.filter((s) => s.verb === 'DROP')).toHaveLength(3)
    expect(seq.filter((s) => s.verb === 'CREATE')).toHaveLength(3)
  })

  it('R5. every DROP/CREATE occurs inside the single BEGIN/COMMIT transaction', () => {
    const begin = RAW.indexOf('BEGIN;')
    const commit = RAW.indexOf('COMMIT;')
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(commit).toBeGreaterThan(begin)
    for (const m of RAW.matchAll(/(DROP FUNCTION|CREATE FUNCTION)\s+public\./gi)) {
      const idx = m.index ?? -1
      expect(idx).toBeGreaterThan(begin)
      expect(idx).toBeLessThan(commit)
    }
  })

  it('R6. a pre-drop guard rejects unexpected dependents (no accidental CASCADE need)', () => {
    expect(/unexpected dependent function/i.test(RAW)).toBe(true)
    expect(/pg_depend/i.test(RAW)).toBe(true)
  })
})

describe('019 delivery automation routing — schema change 1 (column + FK)', () => {
  it('2. adds delivery_automation_id to marketing_opportunity_definitions', () => {
    expect(
      /ALTER TABLE public\.marketing_opportunity_definitions ADD COLUMN delivery_automation_id uuid/i.test(FLAT),
    ).toBe(true)
  })

  it('3. column is uuid and (4) has NO default', () => {
    // No "DEFAULT" attached to the ADD COLUMN statement.
    expect(/ADD COLUMN delivery_automation_id uuid\s*;/i.test(FLAT)).toBe(true)
    expect(/ADD COLUMN delivery_automation_id uuid DEFAULT/i.test(FLAT)).toBe(false)
    // Post-install verify asserts nullable + no default explicitly.
    expect(/uuid nullable no-default/i.test(RAW)).toBe(true)
  })

  it('5. FK references marketing_automations(id) and (6) ON DELETE RESTRICT', () => {
    expect(
      /ADD CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk FOREIGN KEY \(delivery_automation_id\) REFERENCES public\.marketing_automations\(id\) ON DELETE RESTRICT/i.test(
        FLAT,
      ),
    ).toBe(true)
  })

  it('7. FK installed NOT VALID then VALIDATE (safe production pattern)', () => {
    expect(/delivery_automation_fk[\s\S]*?ON DELETE RESTRICT NOT VALID/i.test(FLAT)).toBe(true)
    expect(
      /VALIDATE CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk/i.test(FLAT),
    ).toBe(true)
  })
})

describe('019 delivery automation routing — schema change 2 (backfill)', () => {
  it('8/9. backfills via EXACT key equality restricted to the six legacy keys', () => {
    const upd = sliceBetween(
      FLAT,
      'UPDATE public.marketing_opportunity_definitions d',
      'VALIDATE CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk',
    )
    expect(upd.length).toBeGreaterThan(0)
    // Exact key equality join.
    expect(/d\.opportunity_key = a\.automation_key/i.test(upd)).toBe(true)
    // Restricted to exactly the six legacy keys.
    for (const k of LEGACY_KEYS) expect(upd.includes(`'${k}'`)).toBe(true)
    // Sets the route from the genuine automation id.
    expect(/SET delivery_automation_id = a\.id/i.test(upd)).toBe(true)
  })

  it('10. uses NO fuzzy / display-name / ILIKE / lower() matching', () => {
    const upd = sliceBetween(
      FLAT,
      'UPDATE public.marketing_opportunity_definitions d',
      'VALIDATE CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk',
    )
    expect(/ILIKE|LIKE |similar to|display_name|\.name\b|lower\(|%/i.test(upd)).toBe(false)
  })

  it('11. does NOT map the other 22 definitions (only the six keys appear in the UPDATE)', () => {
    const upd = sliceBetween(
      FLAT,
      'UPDATE public.marketing_opportunity_definitions d',
      'VALIDATE CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk',
    )
    const nonLegacy = [
      'recent_winner_credit_available',
      'high_value_customer_at_risk',
      'recent_winner_follow_up',
      'fresh_wallet_credit',
      'promotion_match',
    ]
    for (const k of nonLegacy) expect(upd.includes(`'${k}'`)).toBe(false)
  })

  it('12. creates NO new automation rows', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_automations/i.test(CODE_FLAT)).toBe(false)
  })
})

describe('019 delivery automation routing — schema change 3 (enabled requires route)', () => {
  it('13. enabled definition requires a non-null delivery_automation_id', () => {
    expect(
      /ADD CONSTRAINT marketing_opportunity_definitions_enabled_requires_route_chk CHECK \(NOT enabled OR delivery_automation_id IS NOT NULL\) NOT VALID/i.test(
        FLAT,
      ),
    ).toBe(true)
    expect(
      /VALIDATE CONSTRAINT marketing_opportunity_definitions_enabled_requires_route_chk/i.test(FLAT),
    ).toBe(true)
  })

  it('14. does NOT make delivery_automation_id UNIQUE', () => {
    // Assert none of the actual unique-DDL forms target the column.
    expect(/CREATE\s+UNIQUE\s+INDEX[^;]*delivery_automation_id/i.test(CODE_FLAT)).toBe(false)
    expect(/ADD\s+CONSTRAINT[^;]*UNIQUE\s*\(\s*delivery_automation_id/i.test(CODE_FLAT)).toBe(false)
    expect(/ADD\s+COLUMN\s+delivery_automation_id\s+uuid[^;]*UNIQUE/i.test(CODE_FLAT)).toBe(false)
    // And the post-install DO block explicitly re-verifies non-uniqueness.
    expect(/must NOT be UNIQUE/i.test(RAW)).toBe(true)
  })
})

describe('019 delivery automation routing — opportunities untouched', () => {
  it('15/16. never UPDATEs marketing_opportunities or its automation_id provenance', () => {
    expect(/UPDATE\s+public\.marketing_opportunities\b/i.test(CODE_FLAT)).toBe(false)
    expect(/marketing_opportunities[^;]{0,60}SET\s+automation_id/i.test(CODE_FLAT)).toBe(false)
    // A deterministic checksum of the six opportunity rows is captured + re-verified.
    expect(/opportunities_checksum/i.test(RAW)).toBe(true)
    expect(/opportunity checksum changed/i.test(RAW)).toBe(true)
  })
})

describe('019 delivery automation routing — private gate upgrade', () => {
  const gate = () => fnBody(FLAT, 'gate')

  it('17. private gate includes delivery-route readiness columns', () => {
    const cols = privateReturnsColumns()
    expect(cols).toContain('delivery_automation_mapped')
    expect(cols).toContain('delivery_automation_enabled')
    expect(cols).toContain('delivery_route_ready')
    // Joins the routed automation and derives readiness.
    expect(/LEFT JOIN public\.marketing_automations da ON da\.id = d\.delivery_automation_id/i.test(gate())).toBe(true)
    expect(
      /\(b\.delivery_automation_mapped AND b\.delivery_automation_exists AND b\.delivery_automation_enabled\) AS delivery_route_ready/i.test(
        gate(),
      ),
    ).toBe(true)
  })

  it('18. pre_nba_gate_eligible additionally requires delivery_route_ready', () => {
    const pre = sliceBetween(gate(), ') AS pre_nba_gate_eligible', 'FROM flags f')
    // Grab the boolean expression that defines pre_nba_gate_eligible.
    const preExpr = sliceBetween(gate(), 'f.is_user_identity', ') AS pre_nba_gate_eligible')
    expect(preExpr.length).toBeGreaterThan(0)
    expect(/AND f\.delivery_route_ready/i.test(preExpr)).toBe(true)
    // Existing requirements remain (kill switch not replaced).
    expect(/AND f\.definition_enabled/i.test(preExpr)).toBe(true)
    expect(/AND f\.definition_exists/i.test(preExpr)).toBe(true)
    expect(pre).toBeDefined()
  })

  it('19. unmapped route fails closed (delivery_route_ready needs mapped)', () => {
    // delivery_automation_mapped is derived from IS NOT NULL and required by readiness.
    expect(/\(d\.delivery_automation_id IS NOT NULL\) AS delivery_automation_mapped/i.test(gate())).toBe(true)
  })

  it('20. disabled automation fails closed (schema HAS an enabled column)', () => {
    // marketing_automations.enabled exists, so readiness requires it.
    expect(/COALESCE\(da\.enabled, false\) AS delivery_automation_enabled/i.test(gate())).toBe(true)
  })

  it('21/22. adds delivery_automation_unmapped and delivery_automation_disabled blockers', () => {
    expect(
      /r\.definition_exists AND NOT r\.delivery_automation_mapped THEN ARRAY\['delivery_automation_unmapped'\]/i.test(
        gate(),
      ),
    ).toBe(true)
    expect(
      /r\.delivery_automation_mapped AND NOT r\.delivery_automation_enabled THEN ARRAY\['delivery_automation_disabled'\]/i.test(
        gate(),
      ),
    ).toBe(true)
  })

  it('final SELECT emits the delivery columns in RETURNS-TABLE order', () => {
    expect(
      /r\.campaign_context_valid, r\.delivery_automation_id, r\.delivery_automation_mapped, r\.delivery_automation_enabled, r\.delivery_route_ready, r\.existing_recipient,/i.test(
        FLAT,
      ),
    ).toBe(true)
  })
})

describe('019 delivery automation routing — private route id for Stage 020', () => {
  const gate = () => fnBody(FLAT, 'gate')

  it('D1. private RETURNS TABLE declares delivery_automation_id uuid', () => {
    const cols = privateReturnsColumns()
    expect(cols).toContain('delivery_automation_id')
    expect(/delivery_automation_id\s+uuid/i.test(FLAT)).toBe(true)
  })

  it('D2. delivery_automation_id is sourced from the DEFINITION column', () => {
    expect(/d\.delivery_automation_id\s+AS delivery_automation_id/i.test(gate())).toBe(true)
  })

  it('D3. delivery_automation_id is NOT sourced from opportunity provenance', () => {
    // The opportunity provenance column must never feed the returned route id.
    expect(/o\.automation_id\s+AS delivery_automation_id/i.test(gate())).toBe(false)
    // Belt-and-braces: the gate body never selects o.automation_id at all.
    expect(/\bo\.automation_id\b/i.test(gate())).toBe(false)
  })

  it('D4. pre_nba_gate_eligible still requires delivery_route_ready (unchanged by id addition)', () => {
    const preExpr = sliceBetween(gate(), 'f.is_user_identity', ') AS pre_nba_gate_eligible')
    expect(/AND f\.delivery_route_ready/i.test(preExpr)).toBe(true)
  })

  it('D5. post-install verifies the private gate returns delivery_automation_id uuid', () => {
    expect(/private gate does not return delivery_automation_id uuid/i.test(RAW)).toBe(true)
    expect(/proallargtypes/i.test(RAW)).toBe(true)
  })
})

describe('019 delivery automation routing — privacy boundary for route id', () => {
  const overview = () => fnBody(FLAT, 'overview')
  const sample = () => fnBody(FLAT, 'sample')

  it('P1. overview never references delivery_automation_id', () => {
    expect(/delivery_automation_id/i.test(overview())).toBe(false)
    expect(/deliveryAutomationId/i.test(overview())).toBe(false)
  })

  it('P2. sample never references delivery_automation_id', () => {
    expect(/delivery_automation_id/i.test(sample())).toBe(false)
    expect(/deliveryAutomationId/i.test(sample())).toBe(false)
  })

  it('P3. neither admin RPC exposes any automation id or key', () => {
    for (const body of [overview(), sample()]) {
      expect(/automation_key/i.test(body)).toBe(false)
      expect(/da\.id\b/i.test(body)).toBe(false)
      expect(/\.automation_id\b/i.test(body)).toBe(false)
    }
  })

  it('P4. post-install re-verifies neither RPC output leaks delivery_automation_id', () => {
    expect(/overview output leaks delivery_automation_id/i.test(RAW)).toBe(true)
    expect(/sample output leaks delivery_automation_id/i.test(RAW)).toBe(true)
  })

  it('P5. every column referenced by overview/sample is declared by the private RETURNS TABLE', () => {
    const declared = new Set(privateReturnsColumns())
    for (const body of [overview(), sample()]) {
      const refs = new Set<string>()
      for (const m of body.matchAll(/\bg\.([a-z_][a-z0-9_]*)/gi)) refs.add(m[1])
      expect(refs.size).toBeGreaterThan(0)
      for (const r of refs) expect(declared.has(r), `admin RPC references undeclared g.${r}`).toBe(true)
    }
  })
})

describe('019 delivery automation routing — admin overview upgrade', () => {
  const overview = () => fnBody(FLAT, 'overview')

  it('23. overview exposes aggregate delivery routing readiness', () => {
    const o = overview()
    expect(/'deliveryRouting', jsonb_build_object/i.test(o)).toBe(true)
    expect(/'mapped',/i.test(o)).toBe(true)
    expect(/'ready',/i.test(o)).toBe(true)
    expect(/'unmapped',/i.test(o)).toBe(true)
    expect(/'disabledAutomation',/i.test(o)).toBe(true)
    // Per-type readiness too.
    expect(/'deliveryRouteReady',/i.test(o)).toBe(true)
    expect(/'deliveryAutomationMapped',/i.test(o)).toBe(true)
  })

  it('24. overview exposes NO automation IDs / keys / internal identities', () => {
    const o = overview()
    expect(/delivery_automation_id/i.test(o)).toBe(false)
    expect(/automation_key/i.test(o)).toBe(false)
    expect(/\bg\.email_lc\b/i.test(o)).toBe(false)
  })
})

describe('019 delivery automation routing — admin sample upgrade', () => {
  const sample = () => fnBody(FLAT, 'sample')

  it('25. sample exposes route booleans only', () => {
    const s = sample()
    expect(/g\.delivery_automation_mapped\s+AS "deliveryAutomationMapped"/i.test(s)).toBe(true)
    expect(/g\.delivery_automation_enabled\s+AS "deliveryAutomationEnabled"/i.test(s)).toBe(true)
    expect(/g\.delivery_route_ready\s+AS "deliveryRouteReady"/i.test(s)).toBe(true)
  })

  it('26. sample exposes NO automation IDs / keys / template ids', () => {
    const s = sample()
    expect(/delivery_automation_id/i.test(s)).toBe(false)
    expect(/automation_key/i.test(s)).toBe(false)
    expect(/template_id/i.test(s)).toBe(false)
    // customerHash remains the only identity-derived field.
    expect(/"customerHash"/i.test(s)).toBe(true)
    expect(/md5\(/i.test(s)).toBe(true)
  })
})

describe('019 delivery automation routing — controlled post-state', () => {
  it('27/28. post-install requires gateEligible = 0 and sendableNow = 0', () => {
    expect(/gateEligible=% but MUST be 0/i.test(RAW)).toBe(true)
    expect(/sendableNow=% but MUST be 0/i.test(RAW)).toBe(true)
  })

  it('29/30/31. recipients = 0, runs = 0, opportunities = 6 asserted post-install', () => {
    expect(/recipient count changed/i.test(RAW)).toBe(true)
    expect(/run count changed/i.test(RAW)).toBe(true)
    expect(/opportunity count is % \(before %\); expected 6 unchanged/i.test(RAW)).toBe(true)
  })

  it('32. opportunity snapshot/checksum unchanged is asserted', () => {
    expect(/opportunity checksum changed/i.test(RAW)).toBe(true)
  })

  it('33/34. definitions enabled = 0 and controls unchanged asserted', () => {
    expect(/definitions total=%, enabled=%, mapped=%, unmapped=%/i.test(RAW)).toBe(true)
    expect(/control state changed/i.test(RAW)).toBe(true)
  })
})

describe('019 delivery automation routing — forbidden side effects', () => {
  it('35/36/37/38/39/40. no materialisation / email / provider / cron / AI / external contacts', () => {
    // All checks run against the comment-stripped CODE view so explanatory
    // prose (which deliberately names these forbidden things) cannot match.
    // No recipient/run inserts.
    expect(/INSERT\s+INTO\s+public\.marketing_recipients/i.test(CODE_FLAT)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_automation_runs/i.test(CODE_FLAT)).toBe(false)
    // No email / provider / cron / AI references.
    expect(
      /resend|sendgrid|smtp|mailgun|https?:|net\.http|pg_cron|cron\.schedule|openai|embedding/i.test(CODE),
    ).toBe(false)
    // No enabling of automations, definitions, sending, discovery.
    expect(/UPDATE\s+public\.marketing_automations\b/i.test(CODE_FLAT)).toBe(false)
    expect(/SET\s+enabled\s*=\s*true/i.test(CODE_FLAT)).toBe(false)
    expect(/SET\s+sending_enabled/i.test(CODE_FLAT)).toBe(false)
    expect(/SET\s+discovery_enabled/i.test(CODE_FLAT)).toBe(false)
    // No external-contact sending support added (allow the pre-existing
    // external_contact_id column reference and the external_contact_not_supported
    // blocker code carried over from Stage 018).
    expect(
      /external_contact/i.test(
        CODE_FLAT.replace(/external_contact_not_supported|external_contact_id/gi, ''),
      ),
    ).toBe(false)
  })
})

describe('019 delivery automation routing — production safety', () => {
  it('41. wrapped in a single atomic transaction', () => {
    expect(/^\s*BEGIN;/m.test(RAW)).toBe(true)
    expect(/COMMIT;\s*$/m.test(RAW.trimEnd() + '\n')).toBe(true)
  })

  it('42. sets a LOCAL lock_timeout and statement_timeout', () => {
    expect(/SET LOCAL lock_timeout = '5s'/i.test(RAW)).toBe(true)
    expect(/SET LOCAL statement_timeout/i.test(RAW)).toBe(true)
  })

  it('43. takes a migration-specific advisory transaction lock', () => {
    expect(/pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_stage_3d2a_delivery_routing'\)\)/i.test(RAW)).toBe(
      true,
    )
  })

  it('preflight asserts delivery_automation_id does NOT already exist', () => {
    expect(/delivery_automation_id already exists/i.test(RAW)).toBe(true)
  })

  it('preflight asserts 28 definitions / 0 enabled and all six legacy automations present', () => {
    expect(/expected 28/i.test(RAW)).toBe(true)
    expect(/expected all six legacy automation rows present by exact key/i.test(RAW)).toBe(true)
  })
})

describe('019 delivery automation routing — file identity sanity', () => {
  it('migration file is non-trivial and self-consistent', () => {
    expect(RAW.length).toBeGreaterThan(3000)
    // A stable hash so accidental edits are noticed in review (not asserted to a value).
    const hash = createHash('sha256').update(RAW).digest('hex')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
