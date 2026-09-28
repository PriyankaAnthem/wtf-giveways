import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// -----------------------------------------------------------------------------
// Stage 037 — Static guards over the content-preparation + run-readiness
// migration (scripts/marketing/023-...). These assert the migration text upholds
// every safety invariant WITHOUT touching a live database, matching the style of
// the Stage 022 boundary-foundation migration test.
// -----------------------------------------------------------------------------

const SQL = readFileSync(
  join(process.cwd(), 'scripts/marketing/023-marketing-content-preparation-and-run-readiness.sql'),
  'utf8',
)

// Executable SQL only — `-- ...` line comments stripped, so assertions about what
// the migration DOES are never satisfied (or tripped) by prose in the header,
// which legitimately names the neighbouring pipeline RPCs / the existing validator
// for documentation.
const CODE = SQL.replace(/--.*$/gm, '')

const VALIDATOR = 'wtf_marketing_content_snapshots_are_prepared'

describe('Stage 037 content-preparation + run-readiness migration (static)', () => {
  it('defines exactly the two NEW executor functions', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.prepare_marketing_recipient_content')
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.queue_prepared_marketing_runs')
  })

  it('DOES NOT define, replace, drop, or alter the EXISTING production validator', () => {
    // The validator already exists in production and is authoritative. This
    // migration must only CALL it — never (re)define or modify it. Check the
    // executable SQL so a documentation mention in comments cannot trip this.
    expect(CODE).not.toMatch(new RegExp(`CREATE\\s+FUNCTION\\s+public\\.${VALIDATOR}`, 'i'))
    expect(CODE).not.toMatch(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${VALIDATOR}`, 'i'))
    expect(CODE).not.toMatch(new RegExp(`DROP\\s+FUNCTION[\\s\\S]*${VALIDATOR}`, 'i'))
    expect(CODE).not.toMatch(new RegExp(`ALTER\\s+FUNCTION[\\s\\S]*${VALIDATOR}`, 'i'))
    // And it must not fiddle with the validator's grants either.
    expect(CODE).not.toMatch(new RegExp(`GRANT[\\s\\S]*${VALIDATOR}`, 'i'))
    expect(CODE).not.toMatch(new RegExp(`REVOKE[\\s\\S]*${VALIDATOR}`, 'i'))
  })

  it('creates no table, type, or column (no schema change)', () => {
    expect(SQL).not.toMatch(/CREATE\s+TABLE/i)
    expect(SQL).not.toMatch(/ALTER\s+TABLE/i)
    expect(SQL).not.toMatch(/CREATE\s+TYPE/i)
    expect(SQL).not.toMatch(/DROP\s+TABLE/i)
  })

  it('selects only preparation-eligible recipients from the shipped preview gate', () => {
    // Must reuse the Stage 022 preview rather than re-deriving eligibility.
    expect(SQL).toContain('wtf_marketing_recipient_preparation_preview')
    expect(SQL).toMatch(/preparation_eligible/)
  })

  it('preparation CALLS the existing validator before committing content', () => {
    // The preparation executor must call the validator and refuse to persist a
    // recipient whose snapshots do not satisfy the schemaVersion=1 contract.
    const prepBody = CODE.slice(CODE.indexOf('prepare_marketing_recipient_content'))
    expect(prepBody).toContain(VALIDATOR)
    // It gates the persistence on the boolean result (fail closed on NOT TRUE).
    expect(prepBody).toMatch(/IF\s+NOT\s+v_ok\s+THEN/i)
  })

  it('readiness relies on the SAME validated preparation gate (content_prepared)', () => {
    // Readiness never re-implements the contract; it aggregates content_prepared
    // (which itself embeds the validator's contract) from the shipped gate.
    const readyBody = CODE.slice(CODE.indexOf('queue_prepared_marketing_runs'))
    expect(readyBody).toContain('wtf_marketing_recipient_preparation_preview')
    expect(readyBody).toContain('content_prepared')
  })

  it('writes send-state columns to nothing (never sets sent_at / provider_email_id / status=sent)', () => {
    expect(SQL).not.toMatch(/sent_at\s*=/i)
    expect(SQL).not.toMatch(/provider_email_id\s*=/i)
    expect(SQL).not.toMatch(/status\s*=\s*'sent'/i)
    expect(SQL).not.toMatch(/status\s*=\s*'sending'/i)
  })

  it('never invokes discovery, materialisation, or delivery from within preparation/readiness', () => {
    // Assert against executable SQL (comments stripped): the header prose may name
    // the neighbouring RPCs for documentation, but no CODE path calls them.
    expect(CODE).not.toContain('discover_marketing_opportunities')
    expect(CODE).not.toContain('materialize_marketing_recipients')
    expect(CODE).not.toContain('claim_marketing_delivery_batch')
  })

  it('resolves the campaign URL against the FIXED canonical production base', () => {
    // Exactly https://www.wtf-giveaways.co.uk/giveaways/<slug>, constructed in CODE.
    expect(CODE).toContain('https://www.wtf-giveaways.co.uk')
    expect(CODE).toMatch(/'\/giveaways\/'\s*\|\|\s*c\.slug/)
  })

  it('has NO runtime URL configuration — no GUC / no current_setting / no settings helper', () => {
    expect(CODE).not.toContain('app.marketing_site_url')
    expect(CODE).not.toMatch(/current_setting/i)
    expect(CODE).not.toContain('wtf_marketing_site_base_url')
  })

  it('fully resolves both campaign placeholders (no residual mustache tokens persisted)', () => {
    expect(SQL).toContain('campaign_url')
    expect(SQL).toContain('campaign_title')
    // The executor must replace, not persist, the tokens.
    expect(CODE).toMatch(/regexp_replace\s*\(/i)
  })

  it('only transitions runs preparing -> queued, never backwards or to a send state', () => {
    const readyBody = CODE.slice(CODE.indexOf('queue_prepared_marketing_runs'))
    expect(readyBody).toContain("'queued'")
    expect(readyBody).toContain("'preparing'")
    expect(readyBody).not.toContain("'processing'")
    expect(readyBody).not.toContain("'completed'")
    expect(readyBody).not.toContain("'sent'")
  })

  it('marks a run ready only when it has no unprepared recipients remaining', () => {
    const readyBody = CODE.slice(CODE.indexOf('queue_prepared_marketing_runs'))
    // Every recipient prepared: prepared = total.
    expect(readyBody).toMatch(/prepared\s*=\s*total/i)
  })

  it('restricts EXECUTE to the service role and revokes public/anon/authenticated (NEW RPCs only)', () => {
    expect(SQL).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*FROM\s+PUBLIC/i)
    expect(SQL).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*TO\s+service_role/i)
    expect(SQL).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*TO\s+anon/i)
  })

  it('runs both executors as SECURITY DEFINER with a pinned search_path', () => {
    expect(SQL).toMatch(/SECURITY\s+DEFINER/i)
    expect(SQL).toMatch(/SET\s+search_path/i)
  })

  it('accepts a bounded p_limit on both executors', () => {
    expect(SQL).toMatch(/prepare_marketing_recipient_content\s*\(\s*p_limit/i)
    expect(SQL).toMatch(/queue_prepared_marketing_runs\s*\(\s*p_limit/i)
  })

  it('does NOT reference the old readiness name mark_marketing_runs_ready', () => {
    expect(SQL).not.toContain('mark_marketing_runs_ready')
  })
})

// -----------------------------------------------------------------------------
// Stage 037 FINAL SAFETY CORRECTION — control/rollout bounds, concurrency, and
// campaign_specific branching. Static guards over the corrected migration text.
// -----------------------------------------------------------------------------

// Executable SQL with COMMENT ON FUNCTION ... IS '...'; doc strings ALSO removed,
// so "never invokes X" guards test actual call sites rather than prose that may
// legitimately name a neighbouring RPC for documentation.
const EXEC = CODE.replace(/COMMENT\s+ON\s+FUNCTION[\s\S]*?';/gi, '')

const PREP = CODE.slice(
  CODE.indexOf('FUNCTION public.prepare_marketing_recipient_content'),
  CODE.indexOf('FUNCTION public.queue_prepared_marketing_runs'),
)
const READY = CODE.slice(CODE.indexOf('FUNCTION public.queue_prepared_marketing_runs'))

describe('Stage 037 correction — control + rollout bounds (both executors)', () => {
  it('BOTH read the marketing_control_state singleton (key = default)', () => {
    for (const body of [PREP, READY]) {
      expect(body).toContain('FROM public.marketing_control_state')
      expect(body).toMatch(/key\s*=\s*'default'/)
    }
  })

  it('BOTH fail closed when the control singleton is missing', () => {
    for (const body of [PREP, READY]) {
      expect(body).toMatch(/IF\s+NOT\s+FOUND\s+THEN/i)
      expect(body).toContain("'control_missing'")
    }
  })

  it('BOTH fail closed on invalid maximum_batch_size', () => {
    for (const body of [PREP, READY]) {
      expect(body).toMatch(/v_batch\s+IS\s+NULL\s+OR\s+v_batch\s*<=\s*0/i)
      expect(body).toContain("'invalid_control'")
    }
  })

  it('BOTH fail closed when rollout_limit <= 0', () => {
    for (const body of [PREP, READY]) {
      expect(body).toMatch(/v_rollout\s+IS\s+NULL\s+OR\s+v_rollout\s*<=\s*0/i)
      expect(body).toContain("'rollout_disabled'")
    }
  })

  it('BOTH compute effective limit = LEAST(requested, maximum_batch_size, rollout_limit)', () => {
    for (const body of [PREP, READY]) {
      expect(body).toMatch(/LEAST\s*\(\s*v_requested\s*,\s*v_batch\s*,\s*v_rollout\s*\)/i)
    }
  })

  it('BOTH bound their work by the effective limit, not the raw requested limit', () => {
    // Preparation loops LIMIT v_effective; readiness selects eligible LIMIT v_effective.
    expect(PREP).toMatch(/LIMIT\s+v_effective/i)
    expect(READY).toMatch(/LIMIT\s+v_effective/i)
  })

  it('NEITHER requires sending_enabled or discovery_enabled to proceed', () => {
    // The columns may be selected, but there must be no early-return guard on them.
    for (const body of [PREP, READY]) {
      expect(body).not.toMatch(/IF\s+NOT\s+v_sending/i)
      expect(body).not.toMatch(/IF\s+NOT\s+v_discovery/i)
      expect(body).not.toMatch(/v_sending\s+IS\s+NOT\s+TRUE/i)
      expect(body).not.toMatch(/v_discovery\s+IS\s+NOT\s+TRUE/i)
      expect(body).not.toMatch(/sending_enabled\s*=\s*true/i)
      expect(body).not.toMatch(/discovery_enabled\s*=\s*true/i)
    }
  })
})

describe('Stage 037 correction — concurrency (advisory locks)', () => {
  it('BOTH use a transaction-scoped pg_try_advisory_xact_lock and return busy on contention', () => {
    for (const body of [PREP, READY]) {
      expect(body).toMatch(/pg_try_advisory_xact_lock\s*\(/i)
      expect(body).toContain("'busy'")
      // The busy branch returns before any control read or write.
      expect(body).toMatch(/IF\s+NOT\s+pg_try_advisory_xact_lock[\s\S]*RETURN\s+jsonb_build_object[\s\S]*'busy'/i)
    }
  })

  it('the two executors use DISTINCT advisory lock keys', () => {
    expect(PREP).toContain("hashtext('wtf_marketing_prepare_recipient_content')")
    expect(READY).toContain("hashtext('wtf_marketing_queue_prepared_runs')")
    expect(PREP).not.toContain("hashtext('wtf_marketing_queue_prepared_runs')")
    expect(READY).not.toContain("hashtext('wtf_marketing_prepare_recipient_content')")
  })
})

describe('Stage 037 correction — campaign_specific branching (preparation)', () => {
  it('branches on r.campaign_specific for campaign resolution', () => {
    expect(PREP).toMatch(/IF\s+r\.campaign_specific\s+THEN/i)
  })

  it('campaign-specific requires a resolvable campaign (title + slug -> canonical url)', () => {
    expect(PREP).toMatch(/v_title\s+IS\s+NULL\s+OR\s+btrim\(v_title\)\s*=\s*''/i)
    expect(PREP).toMatch(/v_url\s+NOT\s+LIKE\s+'https:\/\/%\/giveaways\/%'/i)
    expect(PREP).toMatch(/'\/giveaways\/'\s*\|\|\s*c\.slug/)
  })

  it('builds the context campaign block ONLY for campaign-specific opportunities', () => {
    // Base context is schemaVersion + opportunityType; the campaign object is
    // appended conditionally inside the campaign_specific branch.
    expect(PREP).toMatch(/jsonb_build_object\(\s*'schemaVersion',\s*1,\s*'opportunityType'/i)
    expect(PREP).toMatch(/IF\s+r\.campaign_specific\s+THEN[\s\S]*'campaign',\s*jsonb_build_object\('title'/i)
  })

  it('non-campaign path resolves the template WITHOUT joining campaigns', () => {
    // There must be an ELSE branch that selects template copy with no campaign join.
    expect(PREP).toMatch(/ELSE[\s\S]*FROM\s+public\.marketing_templates\s+t\s+WHERE\s+t\.id\s*=\s*r\.template_id/i)
  })

  it('fails closed on ANY unresolved mustache placeholder (either opportunity type)', () => {
    expect(PREP).toMatch(/~\s*'\\\{\\\{'/)
    expect(PREP).toMatch(/v_failed\s*:=\s*v_failed\s*\+\s*1/i)
  })

  it('passes campaign_specific through to the existing production validator', () => {
    expect(PREP).toMatch(new RegExp(`${VALIDATOR}\\s*\\([\\s\\S]*r\\.campaign_specific`, 'i'))
  })
})

describe('Stage 037 correction — readiness safety', () => {
  it('only transitions runs currently status = preparing', () => {
    expect(READY).toMatch(/run\.status\s*=\s*'preparing'/i)
  })

  it('requires every recipient prepared and at least one recipient', () => {
    expect(READY).toMatch(/total\s*>\s*0\s+AND\s+prepared\s*=\s*total/i)
  })

  it('does NOT call wtf_refresh_marketing_run_delivery_state', () => {
    // Executable SQL only (doc-string COMMENTs stripped): the readiness COMMENT
    // documents that it never calls this RPC, but no code path invokes it.
    expect(EXEC).not.toContain('wtf_refresh_marketing_run_delivery_state')
  })

  it('mutates no recipient row (only marketing_automation_runs)', () => {
    expect(READY).not.toMatch(/UPDATE\s+public\.marketing_recipients/i)
    expect(READY).toMatch(/UPDATE\s+public\.marketing_automation_runs/i)
  })
})
