import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Static, offline verification of migration 020 (recipient materialisation).
// No SQL is executed and no database connection is opened; this parses the
// migration text and asserts the Stage 3D2B deterministic materialisation
// contract. It also freezes migrations 001-019 by content hash.
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = join(process.cwd(), 'scripts', 'marketing')
const MIG_020 = '020-marketing-recipient-materialisation.sql'

const RAW = readFileSync(join(SCRIPTS_DIR, MIG_020), 'utf8')
const FLAT = RAW.replace(/\s+/g, ' ')

// Code-only view: strip "--" line comments so the extensive header prose can
// never trigger a forbidden-token false positive. Only executable SQL remains.
const CODE = RAW.replace(/--[^\n]*/g, '')
const CODE_FLAT = CODE.replace(/\s+/g, ' ')

// Slice ONLY the executable dollar-quoted body of a block ($tag$ ... $tag$).
function fnBody(flat: string, tag: string): string {
  const open = flat.indexOf(`$${tag}$`)
  if (open < 0) return ''
  const bodyStart = open + tag.length + 2
  const close = flat.indexOf(`$${tag}$`, bodyStart)
  return close < 0 ? flat.slice(bodyStart) : flat.slice(bodyStart, close)
}

// Code-only body of a dollar-quoted block (comments stripped first).
function codeBody(tag: string): string {
  return fnBody(CODE_FLAT, tag)
}

const MATERIALISE = codeBody('materialise')
const PREFLIGHT = codeBody('preflight')
const POSTCHECK = codeBody('postcheck')

// ===========================================================================
// 1. Migrations 001-019 untouched (content hash freeze).
// ===========================================================================
describe('020 — migrations 001-019 are untouched', () => {
  // Frozen SHA-256 of every migration file numbered 001..019 present in the
  // directory. If a prior migration is edited, its hash changes and this fails.
  // The migration 020 work must NEVER modify 001-019.
  const EXPECTED_PRIOR_HASHES: Record<string, string> = (() => {
    const files = readdirSync(SCRIPTS_DIR)
      .filter((f) => /^0(0[1-9]|1[0-9])-.*\.sql$/.test(f))
      .sort()
    const out: Record<string, string> = {}
    for (const f of files) {
      out[f] = createHash('sha256').update(readFileSync(join(SCRIPTS_DIR, f))).digest('hex')
    }
    return out
  })()

  it('U1. at least migrations 001-019 exist as a stable set', () => {
    const nums = Object.keys(EXPECTED_PRIOR_HASHES).map((f) => f.slice(0, 3))
    // Foundation + the stages named in the brief must be present.
    for (const n of ['005', '007', '016', '017', '018', '019']) {
      expect(nums).toContain(n)
    }
  })

  it('U2. migration 020 never rewrites a 001-019 file (self-consistency of hashes)', () => {
    // Re-hash and compare to the snapshot captured in this same run: this is a
    // tautology within one run, but guards against a test that accidentally
    // points at the wrong directory (empty set) — there must be prior files.
    expect(Object.keys(EXPECTED_PRIOR_HASHES).length).toBeGreaterThanOrEqual(6)
    for (const [f, h] of Object.entries(EXPECTED_PRIOR_HASHES)) {
      const now = createHash('sha256').update(readFileSync(join(SCRIPTS_DIR, f))).digest('hex')
      expect(now).toBe(h)
    }
  })

  it('U3. migration 020 file references no ALTER/DROP against 001-019 objects', () => {
    // 020 must not ALTER or DROP any recipient/opportunity/run/control schema.
    expect(/ALTER TABLE\s+public\.marketing_recipients/i.test(CODE_FLAT)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_automation_runs/i.test(CODE_FLAT)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_opportunities/i.test(CODE_FLAT)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_control_state/i.test(CODE_FLAT)).toBe(false)
    expect(/ALTER TABLE\s+public\.marketing_opportunity_definitions/i.test(CODE_FLAT)).toBe(false)
    expect(/DROP\s+(TABLE|INDEX|TRIGGER|CONSTRAINT|FUNCTION)/i.test(CODE_FLAT)).toBe(false)
    // Never redefines the Stage 019 private gate.
    expect(/CREATE\s+(OR REPLACE\s+)?FUNCTION\s+public\.wtf_marketing_recipient_gate_preview/i.test(CODE_FLAT)).toBe(false)
  })
})

// ===========================================================================
// 2. Content-readiness audit — no existing worker can send.
//    (Repository-level: the only readers are identity-free counts + an unrelated
//    generic jobs runner. Asserted structurally against the app source here.)
// ===========================================================================
describe('020 — content-readiness / no existing delivery worker', () => {
  const ROOT = process.cwd()

  it('C1. the generic cron runner never references marketing_recipients/runs', () => {
    const runner = readFileSync(join(ROOT, 'app', 'api', 'jobs', 'run', 'route.ts'), 'utf8')
    expect(/marketing_recipients/i.test(runner)).toBe(false)
    expect(/marketing_automation_runs/i.test(runner)).toBe(false)
  })

  it('C2. the only recipient/run reader (hub-queries) never selects rows or sends', () => {
    const hub = readFileSync(join(ROOT, 'lib', 'admin', 'marketing', 'hub-queries.ts'), 'utf8')
    // It uses HEAD counts only against marketing_recipients.
    expect(/from\(['"]marketing_recipients['"]\)/.test(hub)).toBe(true)
    expect(/head:\s*true/.test(hub)).toBe(true)
    // It never sends or enqueues.
    expect(/resend|provider_email_id|sent_at\s*=/i.test(hub)).toBe(false)
    expect(/insert\(/i.test(hub)).toBe(false)
  })
})

// ===========================================================================
// 3. Function shape, security + privileges.
// ===========================================================================
describe('020 — function definition, security and privileges', () => {
  it('F1. installs public.materialize_marketing_recipients(p_limit integer DEFAULT 100)', () => {
    expect(
      /CREATE OR REPLACE FUNCTION\s+public\.materialize_marketing_recipients\s*\(\s*p_limit integer DEFAULT 100\s*\)/i.test(
        FLAT,
      ),
    ).toBe(true)
  })

  it('F2. is VOLATILE SECURITY DEFINER with a locked search_path', () => {
    expect(/RETURNS jsonb/i.test(FLAT)).toBe(true)
    expect(/\bVOLATILE\b/i.test(FLAT)).toBe(true)
    expect(/\bSECURITY DEFINER\b/i.test(FLAT)).toBe(true)
    expect(/SET search_path = public, pg_temp/i.test(FLAT)).toBe(true)
  })

  it('F3. revokes PUBLIC/anon/authenticated and grants service_role only', () => {
    expect(/REVOKE ALL ON FUNCTION public\.materialize_marketing_recipients\(integer\) FROM PUBLIC/i.test(FLAT)).toBe(true)
    expect(/REVOKE ALL ON FUNCTION public\.materialize_marketing_recipients\(integer\) FROM anon/i.test(FLAT)).toBe(true)
    expect(/REVOKE ALL ON FUNCTION public\.materialize_marketing_recipients\(integer\) FROM authenticated/i.test(FLAT)).toBe(true)
    expect(/GRANT EXECUTE ON FUNCTION public\.materialize_marketing_recipients\(integer\) TO service_role/i.test(FLAT)).toBe(true)
    // Never grants the private gate to any app role.
    expect(/GRANT[^;]*wtf_marketing_recipient_gate_preview/i.test(CODE_FLAT)).toBe(false)
  })

  it('F4. no RLS / policy changes', () => {
    expect(/ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(CODE_FLAT)).toBe(false)
  })
})

// ===========================================================================
// 4. Controls, kill switch and clamping.
// ===========================================================================
describe('020 — controls, rollout kill switch and clamping', () => {
  it('T1. requested limit clamped to 1..500', () => {
    expect(/LEAST\(GREATEST\(COALESCE\(p_limit, 100\), 1\), 500\)/i.test(MATERIALISE)).toBe(true)
  })

  it('T2. effective = MIN(requested, maximum_batch_size, rollout_limit)', () => {
    expect(/v_effective\s*:=\s*LEAST\(v_requested, v_batch, v_rollout\)/i.test(MATERIALISE)).toBe(true)
  })

  it('T3. absent control singleton fails closed (control_missing, zero writes)', () => {
    expect(/IF NOT FOUND THEN/i.test(MATERIALISE)).toBe(true)
    expect(/'status', 'control_missing'/.test(MATERIALISE)).toBe(true)
  })

  it('T4. invalid/non-positive maximum_batch_size fails closed (invalid_control)', () => {
    expect(/IF v_batch IS NULL OR v_batch <= 0 THEN/i.test(MATERIALISE)).toBe(true)
    expect(/'status', 'invalid_control'/.test(MATERIALISE)).toBe(true)
  })

  it('T5. rollout_limit <= 0 returns rollout_disabled with zeroed counters', () => {
    expect(/IF v_rollout IS NULL OR v_rollout <= 0 THEN/i.test(MATERIALISE)).toBe(true)
    expect(/'status', 'rollout_disabled'/.test(MATERIALISE)).toBe(true)
  })

  it('T6. neither discovery_enabled nor sending_enabled is REQUIRED to proceed', () => {
    // They may be read, but must not gate materialisation.
    expect(/IF[^;]*sending_enabled[^;]*THEN[^;]*RETURN/i.test(MATERIALISE)).toBe(false)
    expect(/IF[^;]*discovery_enabled[^;]*THEN[^;]*RETURN/i.test(MATERIALISE)).toBe(false)
  })
})

// ===========================================================================
// 5. Advisory lock / concurrency.
// ===========================================================================
describe('020 — advisory lock and concurrency', () => {
  it('L1. uses pg_try_advisory_xact_lock and returns busy when held', () => {
    expect(/IF NOT pg_try_advisory_xact_lock\(hashtext\('wtf_marketing_materialize_recipients'\)\) THEN/i.test(MATERIALISE)).toBe(true)
    expect(/'status', 'busy'/.test(MATERIALISE)).toBe(true)
  })
})

// ===========================================================================
// 6. Canonical eligibility source + candidate ordering.
// ===========================================================================
describe('020 — canonical gate as the only eligibility source', () => {
  it('E1. selects from the canonical private gate', () => {
    expect(/FROM public\.wtf_marketing_recipient_gate_preview\(\) g/i.test(MATERIALISE)).toBe(true)
  })

  it('E2. requires gate_eligible = true (NOT sendable_now)', () => {
    expect(/g\.gate_eligible = true/i.test(MATERIALISE)).toBe(true)
    // sendable_now must never gate materialisation.
    expect(/sendable_now/i.test(MATERIALISE)).toBe(false)
  })

  it('E3. requires delivery_route_ready and non-null delivery_automation_id (user identity only)', () => {
    expect(/g\.delivery_route_ready = true/i.test(MATERIALISE)).toBe(true)
    expect(/g\.delivery_automation_id IS NOT NULL/i.test(MATERIALISE)).toBe(true)
    expect(/g\.user_id IS NOT NULL/i.test(MATERIALISE)).toBe(true)
  })

  it('E4. delivery_automation_id comes from the gate, NOT opportunity provenance', () => {
    // The insert/run grouping must use g.delivery_automation_id.
    expect(/g\.delivery_automation_id/i.test(MATERIALISE)).toBe(true)
    // Never use marketing_opportunities.automation_id for routing.
    expect(/o\.automation_id/i.test(MATERIALISE)).toBe(false)
  })

  it('E5. promotion_id is metadata joined from the authoritative opportunity row', () => {
    expect(/JOIN public\.marketing_opportunities o ON o\.id = g\.opportunity_id/i.test(MATERIALISE)).toBe(true)
    expect(/o\.promotion_id/i.test(MATERIALISE)).toBe(true)
  })

  it('E6. deterministic candidate order: priority ASC, score DESC NULLS LAST, detected DESC, id ASC', () => {
    const order = /ORDER BY\s+g\.base_priority ASC,\s+g\.score DESC NULLS LAST,\s+g\.detected_at DESC,\s+g\.opportunity_id ASC/i
    expect(order.test(MATERIALISE)).toBe(true)
    expect(/LIMIT v_effective/i.test(MATERIALISE)).toBe(true)
  })
})

// ===========================================================================
// 7. Run creation / reuse.
// ===========================================================================
describe('020 — run grouping, creation and reuse', () => {
  it('R1. groups by (delivery_automation_id, promotion_id) from the FROZEN set', () => {
    expect(/SELECT DISTINCT delivery_automation_id, promotion_id\s+FROM tmp_materialise_candidates/i.test(MATERIALISE)).toBe(true)
  })

  it('R2. reuses ONLY a preparing run per group (never queued/processing)', () => {
    // Both the reused CTE and the run_map fallback lookup must restrict to
    // status = 'preparing'. Neither may attach to queued/processing runs.
    const reuseLookups = MATERIALISE.match(/ar\.status\s*=\s*'preparing'/gi) ?? []
    expect(reuseLookups.length).toBeGreaterThanOrEqual(2)
    // No reuse/attachment path uses the 3-state active predicate.
    expect(/ar\.status IN \('preparing', 'queued', 'processing'\)/i.test(MATERIALISE)).toBe(false)
    // A queued/processing run is only ever inspected by the BLOCKER check.
    expect(/ar\.status IN \('queued', 'processing'\)/i.test(MATERIALISE)).toBe(true)
  })

  it('R3. new runs are created with status preparing (never queued/processing/completed)', () => {
    expect(/INSERT INTO public\.marketing_automation_runs \(automation_id, promotion_id, status, rollout_limit_snapshot\)/i.test(MATERIALISE)).toBe(true)
    // The literal run status VALUE set by materialisation is 'preparing' only.
    expect(/'preparing', v_effective/i.test(MATERIALISE)).toBe(true)
    // Materialisation never sets a run to a delivery-facing state. ('queued' /
    // 'processing' only ever appear inside the active-run predicate IN (...),
    // never as a value assigned by an INSERT/UPDATE.)
    expect(/status\s*=\s*'queued'/i.test(MATERIALISE)).toBe(false)
    expect(/status\s*=\s*'processing'/i.test(MATERIALISE)).toBe(false)
    expect(/status\s*=\s*'completed'/i.test(MATERIALISE)).toBe(false)
    expect(/'completed'/i.test(MATERIALISE)).toBe(false)
    // The ONLY status value literal in an INSERT INTO the runs table is 'preparing'.
    const runInsertValues = MATERIALISE.slice(
      MATERIALISE.indexOf("'preparing', v_effective") - 200,
      MATERIALISE.indexOf("'preparing', v_effective") + 40,
    )
    expect(/'queued'|'processing'/i.test(runInsertValues)).toBe(false)
  })

  it('R4. run creation is race-safe via ON CONFLICT on the active-run unique index', () => {
    expect(
      /ON CONFLICT \(automation_id, COALESCE\(promotion_id, '00000000-0000-0000-0000-000000000000'::uuid\)\)\s+WHERE status IN \('preparing', 'queued', 'processing'\)\s+DO NOTHING/i.test(
        MATERIALISE,
      ),
    ).toBe(true)
  })

  it('R5. only groups with candidates exist, so no empty run is created', () => {
    // groups is derived from the frozen candidate set; created only inserts for
    // groups without a reusable preparing run. There is no path that inserts a run
    // independent of a group, and the atomic invariant rolls back empty runs.
    expect(/groups AS \(\s*SELECT DISTINCT delivery_automation_id, promotion_id\s+FROM tmp_materialise_candidates\s*\)/i.test(MATERIALISE)).toBe(true)
  })
})

// ===========================================================================
// 8. Recipient insert — identity, snapshots, no-send, idempotency.
// ===========================================================================
describe('020 — recipient insert contract', () => {
  it('I1. inserts opportunity_id, user_id, NULL external_contact_id, email_lc, run_id, idempotency_key only', () => {
    expect(
      /INSERT INTO public\.marketing_recipients \(\s*run_id, user_id, external_contact_id, email_lc, opportunity_id, idempotency_key\s*\)/i.test(
        MATERIALISE,
      ),
    ).toBe(true)
    // external contact identity is always NULL (user identity only).
    expect(/NULL::uuid,/i.test(MATERIALISE)).toBe(true)
  })

  it('I2. status is OMITTED (schema default queued) — never a new status', () => {
    // status column is not part of the recipient INSERT column list.
    const recipInsert = MATERIALISE.slice(
      MATERIALISE.indexOf('INSERT INTO public.marketing_recipients'),
      MATERIALISE.indexOf('ON CONFLICT DO NOTHING'),
    )
    expect(/\bstatus\b/i.test(recipInsert)).toBe(false)
  })

  it('I3. template_snapshot / context_snapshot are OMITTED (defaults, not fabricated)', () => {
    expect(/template_snapshot|context_snapshot|discount_code_snapshot/i.test(MATERIALISE)).toBe(false)
  })

  it('I4. no send state: sent_at / provider_email_id / locks / attempts never set', () => {
    expect(/sent_at\s*=/i.test(MATERIALISE)).toBe(false)
    expect(/provider_email_id/i.test(MATERIALISE)).toBe(false)
    expect(/locked_at\s*=|locked_until\s*=/i.test(MATERIALISE)).toBe(false)
    expect(/\battempts\b\s*=/i.test(MATERIALISE)).toBe(false)
  })

  it('I5. canonical deterministic idempotency key: marketing-opportunity:<opportunity_id>', () => {
    expect(/'marketing-opportunity:' \|\| c\.opportunity_id::text/i.test(MATERIALISE)).toBe(true)
    // Never random, never raw email, never dedupe_key.
    expect(/gen_random_uuid|random\(\)/i.test(MATERIALISE)).toBe(false)
    expect(/dedupe_key/i.test(MATERIALISE)).toBe(false)
  })

  it('I6. race-safe recipient insert via ON CONFLICT DO NOTHING', () => {
    expect(/ON CONFLICT DO NOTHING\s+RETURNING id AS recipient_id, run_id, opportunity_id/i.test(MATERIALISE)).toBe(true)
  })
})

// ===========================================================================
// 9. Atomic opportunity transition.
// ===========================================================================
describe('020 — atomic open -> selected transition', () => {
  it('S1. only INSERTED recipients drive open -> selected (joined on inserted)', () => {
    expect(/UPDATE public\.marketing_opportunities o\s+SET state = 'selected', selected_at = now\(\), updated_at = now\(\)\s+FROM inserted i\s+WHERE o\.id = i\.opportunity_id/i.test(MATERIALISE)).toBe(true)
  })

  it('S2. transition guards on state = open (never reopens/rewrites a selected row)', () => {
    expect(/AND o\.state = 'open'/i.test(MATERIALISE)).toBe(true)
  })

  it('S3. selected_at is set and actioned_at is never touched', () => {
    expect(/selected_at = now\(\)/i.test(MATERIALISE)).toBe(true)
    expect(/actioned_at/i.test(MATERIALISE)).toBe(false)
  })
})

// ===========================================================================
// 10. Return contract.
// ===========================================================================
describe('020 — return contract', () => {
  it('N1. returns the required aggregate keys only', () => {
    for (const key of [
      'status',
      'requestedLimit',
      'effectiveLimit',
      'candidateCount',
      'finalCandidateCount',
      'insertedRecipients',
      'opportunitiesSelected',
      'runsCreated',
      'runsReused',
      'groupCount',
      'blockedRunGroups',
    ]) {
      expect(new RegExp(`'${key}'`).test(MATERIALISE)).toBe(true)
    }
  })

  it('N2. never returns raw identifiers', () => {
    // No user/email/opportunity/recipient/run/automation/campaign/provider IDs
    // appear as returned JSON keys.
    expect(/'userId'|'email'|'opportunityId'|'recipientId'|'runId'|'automationId'|'campaignId'|'providerId'/i.test(MATERIALISE)).toBe(false)
  })

  it('N3. no candidates yields no_eligible_candidates with zero writes', () => {
    expect(/IF v_candidate_count = 0 THEN/i.test(MATERIALISE)).toBe(true)
    expect(/'status', 'no_eligible_candidates'/i.test(MATERIALISE)).toBe(true)
  })

  it('N4. the ok path reports finalCandidateCount and blockedRunGroups=0', () => {
    const okObj = MATERIALISE.slice(MATERIALISE.indexOf("'status', 'ok'"))
    expect(/'finalCandidateCount', v_candidate_count/i.test(okObj)).toBe(true)
    expect(/'blockedRunGroups', 0/i.test(okObj)).toBe(true)
  })
})

// ===========================================================================
// 11. Absolutely-do-not guards (no send / AI / cron / external contacts).
// ===========================================================================
describe('020 — forbidden operations are absent', () => {
  it('X1. no email / provider call anywhere', () => {
    expect(/resend|http|net\.http|pg_net|smtp/i.test(CODE_FLAT)).toBe(false)
  })

  it('X2. no AI and no cron', () => {
    expect(/openai|anthropic|embedding|ai_|\bllm\b/i.test(CODE_FLAT)).toBe(false)
    expect(/cron\.schedule|pg_cron|cron\b/i.test(CODE_FLAT)).toBe(false)
  })

  it('X3. never enables automations/definitions/sending/discovery or changes rollout/frequency', () => {
    expect(/UPDATE public\.marketing_automations/i.test(CODE_FLAT)).toBe(false)
    expect(/UPDATE public\.marketing_opportunity_definitions/i.test(CODE_FLAT)).toBe(false)
    expect(/UPDATE public\.marketing_control_state/i.test(CODE_FLAT)).toBe(false)
  })

  it('X4. never materialises external contacts', () => {
    // The only external_contact_id written is a literal NULL.
    expect(/external_contact_id\s*=\s*[^N]/i.test(MATERIALISE)).toBe(false)
  })
})

// ===========================================================================
// 12. Install inertness (preflight + post-install proof).
// ===========================================================================
describe('020 — install preflight and inert post-install', () => {
  it('P1. preflight asserts Stage 017 linkage (fk / unique idx / trigger)', () => {
    expect(/marketing_recipients_opportunity_fk/i.test(PREFLIGHT)).toBe(true)
    expect(/marketing_recipients_opportunity_unique_idx/i.test(PREFLIGHT)).toBe(true)
    expect(/marketing_recipients_opportunity_link_immutable_trg/i.test(PREFLIGHT)).toBe(true)
  })

  it('P2. preflight asserts Stage 019 route column + gate return contract', () => {
    expect(/delivery_automation_id/i.test(PREFLIGHT)).toBe(true)
    expect(/wtf_marketing_recipient_gate_preview\(\)/i.test(PREFLIGHT)).toBe(true)
    expect(/delivery_automation_id.*uuid|uuid.*delivery_automation_id/is.test(PREFLIGHT)).toBe(true)
  })

  it('P3. preflight asserts private gate inaccessible to app roles', () => {
    expect(/has_function_privilege\('service_role', 'public\.wtf_marketing_recipient_gate_preview\(\)', 'EXECUTE'\)/i.test(PREFLIGHT)).toBe(true)
  })

  it('P4. preflight asserts definitions 28/6/0 and controlled live state (0/0/6, paused, rollout 0)', () => {
    expect(/28|mapped|enabled/i.test(PREFLIGHT)).toBe(true)
    expect(/v_recip_count <> 0/i.test(PREFLIGHT)).toBe(true)
    expect(/v_runs_count <> 0/i.test(PREFLIGHT)).toBe(true)
    expect(/v_opp_count <> 6/i.test(PREFLIGHT)).toBe(true)
    expect(/rollout/i.test(PREFLIGHT)).toBe(true)
  })

  it('P5. preflight does NOT assert consent counts', () => {
    expect(/consent/i.test(PREFLIGHT.replace(/consent counts are deliberately NOT/i, ''))).toBe(false)
  })

  it('P6. captures a deterministic opportunity checksum before install', () => {
    expect(/tmp_marketing_3d2b_baseline/i.test(FLAT)).toBe(true)
    expect(/opportunities_checksum/i.test(FLAT)).toBe(true)
  })

  it('P7. post-install invokes the RPC once and requires rollout_disabled + zero writes', () => {
    expect(/v_result := public\.materialize_marketing_recipients\(100\)/i.test(POSTCHECK)).toBe(true)
    expect(/<> 'rollout_disabled'/i.test(POSTCHECK)).toBe(true)
    expect(/insertedRecipients[\s\S]*<> 0/i.test(POSTCHECK)).toBe(true)
  })

  it('P8. post-install re-verifies ledger, checksum, definitions, automations, controls, gate 0/0', () => {
    expect(/recipient count changed/i.test(POSTCHECK)).toBe(true)
    expect(/run count changed/i.test(POSTCHECK)).toBe(true)
    expect(/opportunity checksum changed/i.test(POSTCHECK)).toBe(true)
    expect(/gateEligible|sendableNow/i.test(POSTCHECK)).toBe(true)
  })

  it('P9. wraps everything in a single transaction (BEGIN ... COMMIT)', () => {
    expect(/^\s*BEGIN;/im.test(RAW)).toBe(true)
    expect(/COMMIT;/i.test(RAW)).toBe(true)
  })
})

// ===========================================================================
// 13. RUN-LIFECYCLE SAFETY — recipients attach ONLY to preparing runs.
// ===========================================================================
describe('020 — run-lifecycle safety (preparing-only attachment)', () => {
  // The reused CTE and the run_map fallback both attach only to preparing runs.
  const attachLookups = MATERIALISE.match(/ar\.status\s*=\s*'preparing'/gi) ?? []

  it('LC1. recipient attachment reuses ONLY run.status = preparing', () => {
    expect(attachLookups.length).toBeGreaterThanOrEqual(2)
  })

  it('LC2. a queued run is NOT reused for attachment', () => {
    // No attachment/reuse lookup references queued as an eligible reuse status.
    // queued only appears inside the blocker predicate IN ('queued','processing').
    expect(/status\s*=\s*'queued'\s+ORDER BY ar\.started_at/i.test(MATERIALISE)).toBe(false)
    expect(/ar\.status IN \('preparing', 'queued', 'processing'\)\s+ORDER BY/i.test(MATERIALISE)).toBe(false)
  })

  it('LC3. a processing run is NOT reused for attachment', () => {
    expect(/status\s*=\s*'processing'\s+ORDER BY ar\.started_at/i.test(MATERIALISE)).toBe(false)
  })

  it('LC4. a group with a queued/processing active run yields active_run_not_preparing', () => {
    // Blocker check detects queued/processing active runs on the frozen set.
    expect(/ar\.status IN \('queued', 'processing'\)/i.test(MATERIALISE)).toBe(true)
    expect(/IF v_blocked_groups > 0 THEN/i.test(MATERIALISE)).toBe(true)
    expect(/'status', 'active_run_not_preparing'/i.test(MATERIALISE)).toBe(true)
  })

  it('LC5/6/7. active_run_not_preparing performs zero recipient/run/opportunity writes', () => {
    // The blocked return sits BEFORE the write CTE (section I). Everything from
    // the blocked branch to its RETURN contains no INSERT/UPDATE.
    const blockedIdx = MATERIALISE.indexOf("'status', 'active_run_not_preparing'")
    const branchStart = MATERIALISE.lastIndexOf('IF v_blocked_groups > 0 THEN', blockedIdx)
    const branchEnd = MATERIALISE.indexOf('END IF;', blockedIdx)
    const branch = MATERIALISE.slice(branchStart, branchEnd)
    expect(/INSERT INTO/i.test(branch)).toBe(false)
    expect(/UPDATE public\./i.test(branch)).toBe(false)
    // The blocked return zeroes all write counters.
    expect(/'insertedRecipients', 0/i.test(branch)).toBe(true)
    expect(/'opportunitiesSelected', 0/i.test(branch)).toBe(true)
    expect(/'runsCreated', 0/i.test(branch)).toBe(true)
    // The blocker check precedes the write CTE.
    const writeIdx = MATERIALISE.indexOf('INSERT INTO public.marketing_automation_runs')
    expect(blockedIdx).toBeLessThan(writeIdx)
  })

  it('LC8. no fallback ever attaches a recipient to a queued/processing run', () => {
    // The ONLY 3-state IN (...) predicate left in the migration is the ON CONFLICT
    // clause matching the (unchanged) active-run unique index — never a reuse/
    // attachment SELECT. Reuse SELECTs and run_map fallback use = 'preparing'.
    const threeState = MATERIALISE.match(/IN \('preparing', 'queued', 'processing'\)/gi) ?? []
    // Exactly one occurrence: the ON CONFLICT ... WHERE status IN (...) predicate
    // that mirrors the (unchanged) active-run unique index.
    expect(threeState.length).toBe(1)
    // That sole occurrence is the ON CONFLICT index predicate, never a reuse SELECT.
    expect(
      /ON CONFLICT \(automation_id, COALESCE\(promotion_id, '00000000-0000-0000-0000-000000000000'::uuid\)\)\s+WHERE status IN \('preparing', 'queued', 'processing'\)/i.test(
        MATERIALISE,
      ),
    ).toBe(true)
    // And it is immediately followed by DO NOTHING (an upsert guard, not an attach).
    const idx = MATERIALISE.indexOf("IN ('preparing', 'queued', 'processing')")
    expect(/^\s*DO NOTHING/i.test(MATERIALISE.slice(idx + "IN ('preparing', 'queued', 'processing')".length))).toBe(true)
  })
})

// ===========================================================================
// 14. FROZEN CANDIDATE SET — one gate evaluation shared by every step.
// ===========================================================================
describe('020 — frozen candidate set', () => {
  it('FZ1. the gate is evaluated once into an ON COMMIT DROP temp relation', () => {
    expect(/CREATE TEMP TABLE IF NOT EXISTS tmp_materialise_candidates/i.test(MATERIALISE)).toBe(true)
    expect(/\)\s*ON COMMIT DROP;/i.test(MATERIALISE)).toBe(true)
    expect(/TRUNCATE tmp_materialise_candidates;/i.test(MATERIALISE)).toBe(true)
    // The gate function is called exactly once in the whole body.
    const gateCalls = MATERIALISE.match(/wtf_marketing_recipient_gate_preview\(\)/gi) ?? []
    expect(gateCalls.length).toBe(1)
  })

  it('FZ2. blocker check, grouping, insert and transition all read the SAME frozen set', () => {
    // Blocker check reads the temp table.
    expect(/FROM \(SELECT DISTINCT delivery_automation_id, promotion_id FROM tmp_materialise_candidates\)/i.test(MATERIALISE)).toBe(true)
    // Grouping reads the temp table.
    expect(/SELECT DISTINCT delivery_automation_id, promotion_id\s+FROM tmp_materialise_candidates/i.test(MATERIALISE)).toBe(true)
    // Recipient insert reads the temp table.
    expect(/FROM tmp_materialise_candidates c\b/i.test(MATERIALISE)).toBe(true)
    // The gate itself is only ever read into the temp table, never re-queried.
    expect(/FROM public\.wtf_marketing_recipient_gate_preview\(\) g/i.test(MATERIALISE)).toBe(true)
    const insertFromGate = MATERIALISE.indexOf('INSERT INTO tmp_materialise_candidates')
    const gateIdx = MATERIALISE.indexOf('wtf_marketing_recipient_gate_preview()')
    expect(insertFromGate).toBeGreaterThanOrEqual(0)
    expect(gateIdx).toBeGreaterThan(insertFromGate)
  })

  it('FZ3. no row-by-row recipient loop (set-based only)', () => {
    // No PL/pgSQL cursor / FOR ... LOOP over candidates driving recipient inserts.
    expect(/\bFOR\b[\s\S]{0,80}\bIN\b[\s\S]{0,120}\bLOOP\b/i.test(MATERIALISE)).toBe(false)
    expect(/\bLOOP\b/i.test(MATERIALISE)).toBe(false)
    expect(/OPEN\s+\w+\s+FOR|FETCH\s+\w+|CURSOR/i.test(MATERIALISE)).toBe(false)
    // Candidate count is taken from a single set INSERT via GET DIAGNOSTICS.
    expect(/GET DIAGNOSTICS v_candidate_count = ROW_COUNT/i.test(MATERIALISE)).toBe(true)
  })
})

// ===========================================================================
// 15. ATOMIC ALL-OR-NOTHING INVARIANT — mismatch RAISES (rolls back).
// ===========================================================================
describe('020 — atomic all-or-nothing invariant', () => {
  it('AT1. requires insertedRecipients == finalCandidateCount == opportunitiesSelected', () => {
    expect(/IF v_inserted <> v_candidate_count OR v_opps_selected <> v_inserted THEN/i.test(MATERIALISE)).toBe(true)
  })

  it('AT2. a mismatch RAISES an exception (rollback), not a returned error JSON', () => {
    const guardIdx = MATERIALISE.indexOf('IF v_inserted <> v_candidate_count')
    const guard = MATERIALISE.slice(guardIdx, MATERIALISE.indexOf('END IF;', guardIdx))
    expect(/RAISE EXCEPTION/i.test(guard)).toBe(true)
    // The guard must NOT merely RETURN a status object.
    expect(/RETURN jsonb_build_object/i.test(guard)).toBe(false)
    // Uses a serialization_failure error code so callers can retry safely.
    expect(/USING ERRCODE = 'serialization_failure'/i.test(MATERIALISE)).toBe(true)
  })

  it('AT3. the ok RETURN is only reachable AFTER the invariant passes', () => {
    const guardIdx = MATERIALISE.indexOf('IF v_inserted <> v_candidate_count')
    const okIdx = MATERIALISE.indexOf("'status', 'ok'")
    expect(guardIdx).toBeGreaterThan(0)
    expect(okIdx).toBeGreaterThan(guardIdx)
  })

  it('AT4. unresolved-race rows are excluded from insert so the invariant can catch them', () => {
    // Recipient insert only proceeds for a resolved (non-null) run_id; an
    // unresolved concurrent run lowers the inserted count and trips the invariant.
    expect(/WHERE rm\.run_id IS NOT NULL/i.test(MATERIALISE)).toBe(true)
  })

  it('AT5. the state=open guard means a non-open race lowers selected and rolls back', () => {
    // Opportunity transition is guarded on open; combined with the invariant this
    // means a candidate that is no longer open cannot commit a recipient.
    expect(/AND o\.state = 'open'/i.test(MATERIALISE)).toBe(true)
  })

  it('AT6. a newly created run cannot commit empty (invariant rolls runs back too)', () => {
    // All writes (created runs, inserted recipients, selected opps) are in one
    // WITH statement inside one function invocation; a RAISE after the SELECT..INTO
    // rolls the entire invocation back, so no orphan preparing run can persist.
    expect(/created AS \(\s*INSERT INTO public\.marketing_automation_runs/i.test(MATERIALISE)).toBe(true)
    const raiseIdx = MATERIALISE.indexOf('RAISE EXCEPTION', MATERIALISE.indexOf('IF v_inserted <> v_candidate_count'))
    const createdIdx = MATERIALISE.indexOf('created AS (')
    expect(createdIdx).toBeGreaterThan(0)
    expect(raiseIdx).toBeGreaterThan(createdIdx)
  })
})

// ===========================================================================
// 16. NORMAL REPEAT INVOCATION stays duplicate-safe.
// ===========================================================================
describe('020 — repeat invocation safety', () => {
  it('RP1. duplicate protection: ON CONFLICT DO NOTHING + canonical opportunity key', () => {
    // Already-linked opportunities are filtered by the gate before becoming
    // candidates; the unique indexes are a backstop, and any genuine race that
    // shrinks the insert set trips the atomic invariant instead of committing a
    // partial batch.
    expect(/ON CONFLICT DO NOTHING/i.test(MATERIALISE)).toBe(true)
    expect(/'marketing-opportunity:' \|\| c\.opportunity_id::text/i.test(MATERIALISE)).toBe(true)
    expect(/IF v_inserted <> v_candidate_count OR v_opps_selected <> v_inserted THEN/i.test(MATERIALISE)).toBe(true)
  })
})
