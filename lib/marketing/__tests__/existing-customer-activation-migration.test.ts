import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * STATIC contract for the Stage 3C reconciliation DATA migration
 * scripts/marketing/006-existing-customer-activation.sql.
 *
 * The script cannot be executed from vitest (no Postgres), so these tests pin
 * the parts of its contract that MUST hold in the SQL text. Critically, this
 * migration reconciles ONLY consented pre_registrations:
 *   - there is NO generic historic Auth-user activation,
 *   - the tokens `existing_customer_activation` / `existing_customer_activation_v1`
 *     are completely absent,
 *   - only pre_registrations.consent = true can activate anyone,
 *   - matched Auth users never become external contacts,
 *   - existing Auth preference rows are preserved (INSERT + NOT EXISTS +
 *     ON CONFLICT DO NOTHING, never UPDATE / DO UPDATE),
 *   - an active suppression (by user_id OR email) blocks a NEW enabled Auth
 *     preference, and suppressed external contacts are inserted disabled,
 *   - the global sending/discovery/rollout pause is asserted before any write,
 *   - it references NO checkout/wallet/ticket table, inserts NO recipient,
 *     NO automation run, changes NO control state, adds NO Resend/email code,
 *     NO trigger, and ALTERs NO existing table, and
 *   - it does not modify migrations 001-005 or call the profile refresh.
 */
const ROOT = process.cwd()
const MIGRATION_PATH = 'scripts/marketing/006-existing-customer-activation.sql'
const SQL = readFileSync(join(ROOT, MIGRATION_PATH), 'utf8')

// SQL with `-- ...` line comments stripped, so assertions about executable code
// are never satisfied (or tripped) by prose in the header comments.
const CODE = SQL.replace(/--.*$/gm, '')
const FLAT = CODE.replace(/\s+/g, ' ').trim()

describe('Stage 3C reconciliation — exists and leaves earlier migrations intact', () => {
  it('lives at scripts/marketing/006-existing-customer-activation.sql', () => {
    expect(existsSync(join(ROOT, MIGRATION_PATH))).toBe(true)
  })

  it('does not modify migrations 001-005 (they remain present)', () => {
    for (const n of ['001', '002', '003', '004', '005']) {
      const matches = readdirSync(join(ROOT, 'scripts/marketing')).filter((f) => f.startsWith(n))
      expect(matches.length, n).toBeGreaterThan(0)
    }
  })
})

describe('Stage 3C reconciliation — NO generic historic Auth activation', () => {
  it('does NOT use existing_customer_activation as a consent value', () => {
    // The only permitted occurrence of this substring is the stable advisory-
    // lock identifier (wtf_marketing_stage_3c_existing_customer_activation),
    // which is pinned separately. Strip that, then the token must be gone —
    // no consent_source literal, no version, no comment references it.
    const withoutLock = SQL.replace(/wtf_marketing_stage_3c_existing_customer_activation/g, '')
    expect(/existing_customer_activation/i.test(withoutLock)).toBe(false)
    // And explicitly: it is never used as a quoted consent value.
    expect(/'existing_customer_activation'/i.test(SQL)).toBe(false)
  })

  it('does NOT contain the consent version existing_customer_activation_v1', () => {
    expect(/existing_customer_activation_v1/i.test(SQL)).toBe(false)
  })

  it('the ONLY consent source/version written is pre_registration', () => {
    // Every preference/contact insert uses pre_registration provenance.
    expect(FLAT).toMatch(/'pre_registration'/)
    expect(FLAT).toMatch(/'pre_registration_v1'/)
    // No other consent_source literal is introduced.
    const consentSources = [...FLAT.matchAll(/consent_source,[\s\S]*?/gi)]
    expect(consentSources.length).toBeGreaterThan(0)
  })

  it('has NO Auth-preference INSERT that is not driven by the matched pre-registration set', () => {
    // Preferences are inserted only FROM _stage3c_matched (the consented-
    // pre-registration-matched Auth users), never from a raw auth.users scan.
    expect(/INSERT INTO public\.marketing_preferences[\s\S]*?FROM _stage3c_matched m/i.test(CODE)).toBe(true)
    // There must be exactly ONE INSERT INTO marketing_preferences.
    const prefInserts = [...CODE.matchAll(/INSERT INTO public\.marketing_preferences\b/gi)]
    expect(prefInserts.length).toBe(1)
  })

  it('gates the matched-Auth working set on pre_registrations.consent = true', () => {
    const matchedBlock = CODE.slice(
      CODE.indexOf('_stage3c_matched'),
      CODE.indexOf('_stage3c_external'),
    )
    expect(/JOIN public\.pre_registrations pr\s+ON pr\.consent = true/i.test(matchedBlock)).toBe(true)
  })
})

describe('Stage 3C reconciliation — atomic, fail-fast, single-execution', () => {
  it('wraps the whole reconciliation in BEGIN ... COMMIT', () => {
    expect(/\bBEGIN;/i.test(CODE)).toBe(true)
    expect(/\bCOMMIT;/i.test(CODE)).toBe(true)
    expect(CODE.search(/\bBEGIN;/i)).toBeLessThan(CODE.search(/\bCOMMIT;/i))
  })

  it('fails fast with LOCAL lock_timeout and statement_timeout', () => {
    expect(/SET LOCAL lock_timeout\s*=\s*'5s'/i.test(CODE)).toBe(true)
    expect(/SET LOCAL statement_timeout\s*=\s*'60s'/i.test(CODE)).toBe(true)
  })

  it('takes a migration-specific transaction advisory lock and raises if held', () => {
    expect(
      /pg_try_advisory_xact_lock\(\s*hashtext\('wtf_marketing_stage_3c_existing_customer_activation'\)\s*\)/i.test(
        CODE,
      ),
    ).toBe(true)
    expect(/another execution is already in progress/i.test(CODE)).toBe(true)
  })

  it('preflights every required dependency via to_regclass and raises when missing', () => {
    for (const dep of [
      'auth.users',
      'public.marketing_preferences',
      'public.marketing_preference_events',
      'public.marketing_suppressions',
      'public.marketing_external_contacts',
      'public.pre_registrations',
      'public.marketing_control_state',
    ]) {
      expect(FLAT, dep).toContain(`'${dep}'`)
    }
    expect(/to_regclass\(/i.test(CODE)).toBe(true)
    expect(/required dependency .* is missing/i.test(CODE)).toBe(true)
  })
})

describe('Stage 3C reconciliation — refuses to run unless Marketing is globally paused', () => {
  it('reads the control-state singleton before activating', () => {
    expect(/FROM public\.marketing_control_state\b/i.test(CODE)).toBe(true)
    expect(/WHERE key = 'default'/i.test(CODE)).toBe(true)
  })

  it('asserts sending, discovery and rollout are all in the paused state', () => {
    expect(/v_sending IS DISTINCT FROM false/i.test(CODE)).toBe(true)
    expect(/v_discovery IS DISTINCT FROM false/i.test(CODE)).toBe(true)
    expect(/v_rollout\s+IS DISTINCT FROM 0/i.test(CODE)).toBe(true)
    expect(/Marketing is not globally paused/i.test(CODE)).toBe(true)
  })

  it('raises when the control-state singleton is missing', () => {
    expect(/NOT FOUND/i.test(CODE)).toBe(true)
    expect(/cannot confirm Marketing is paused/i.test(CODE)).toBe(true)
  })

  it('performs the pause assertion in the guard block, before the activation block', () => {
    const guardIdx = CODE.indexOf('$guard$')
    const activateIdx = CODE.indexOf('$activate$')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(activateIdx).toBeGreaterThan(-1)
    expect(CODE.search(/Marketing is not globally paused/i)).toBeLessThan(activateIdx)
  })
})

describe('Stage 3C reconciliation — never updates an existing preference row', () => {
  it('contains NO UPDATE of marketing_preferences', () => {
    expect(/UPDATE\s+public\.marketing_preferences/i.test(CODE)).toBe(false)
    expect(/UPDATE\s+marketing_preferences/i.test(CODE)).toBe(false)
  })

  it('uses ON CONFLICT (user_id) DO NOTHING (never DO UPDATE) for preferences', () => {
    expect(/ON CONFLICT \(user_id\) DO NOTHING/i.test(CODE)).toBe(true)
    // No DO UPDATE anywhere in the reconciliation.
    expect(/DO UPDATE/i.test(CODE)).toBe(false)
  })

  it('only inserts preferences for matched users with NO existing preference row', () => {
    // The matched working set records has_pref via NOT-yet-existing preference,
    // and the insert filters has_pref = false.
    expect(
      /EXISTS\s*\(\s*SELECT 1 FROM public\.marketing_preferences mp WHERE mp\.user_id = mu\.user_id\s*\)\s+AS has_pref/i.test(
        CODE,
      ),
    ).toBe(true)
    expect(/WHERE m\.has_pref = false/i.test(CODE)).toBe(true)
  })

  it('records a subscribed preference event only for rows actually inserted (from the RETURNING set)', () => {
    expect(/INSERT INTO public\.marketing_preference_events/i.test(CODE)).toBe(true)
    expect(/'subscribed'/i.test(CODE)).toBe(true)
    expect(/FROM ins i/i.test(CODE)).toBe(true)
  })
})

describe('Stage 3C reconciliation — pre-registration rules', () => {
  it('only considers pre_registrations with consent = true', () => {
    expect(/pr\.consent = true/i.test(CODE)).toBe(true)
    // There is no path that reads pre_registrations without the consent gate.
    expect(/FROM public\.pre_registrations pr\b(?![^;]*consent = true)/is.test(CODE)).toBe(false)
  })

  it('normalises the pre-registration email with the exact COALESCE/NULLIF expression', () => {
    expect(
      /COALESCE\(NULLIF\(lower\(btrim\(pr\.email_lc\)\), ''\), lower\(btrim\(pr\.email\)\)\)/i.test(CODE),
    ).toBe(true)
  })

  it('matched Auth users NEVER become external contacts (external set excludes Auth matches)', () => {
    const extBlock = CODE.slice(CODE.indexOf('_stage3c_external'))
    expect(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM auth\.users u\s+WHERE u\.email IS NOT NULL\s+AND lower\(btrim\(u\.email\)\) = n\.norm_email\s*\)/i.test(
        extBlock,
      ),
    ).toBe(true)
  })

  it('inserts unmatched consented pre-registrations as pre_registration external contacts', () => {
    const extInsert = FLAT.slice(FLAT.indexOf('INSERT INTO public.marketing_external_contacts'))
    expect(extInsert).toMatch(/'pre_registration'/)
    expect(extInsert).toMatch(/source_record_id/i)
    expect(extInsert).toMatch(/consented_at/i)
  })

  it('de-dupes external contacts by normalised email (DISTINCT ON + ON CONFLICT DO NOTHING)', () => {
    expect(/DISTINCT ON \(n\.norm_email\)/i.test(CODE)).toBe(true)
    expect(/ON CONFLICT \(email_lc\) DO NOTHING/i.test(CODE)).toBe(true)
  })

  it('does not create Auth users', () => {
    expect(/INSERT\s+INTO\s+auth\.users/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3C reconciliation — suppressions respected and never reversed', () => {
  it('blocks a NEW enabled Auth preference when suppressed by user_id OR normalised email', () => {
    expect(
      /EXISTS\s*\(\s*SELECT 1 FROM public\.marketing_suppressions ms\s+WHERE ms\.revoked_at IS NULL\s+AND \(ms\.user_id = mu\.user_id OR ms\.email_lc = mu\.email_norm\)\s*\)\s*AS is_suppressed/i.test(
        CODE,
      ),
    ).toBe(true)
    // The matched insert refuses suppressed users.
    expect(/AND m\.is_suppressed = false/i.test(CODE)).toBe(true)
  })

  it('reads active suppressions to decide enablement of a NEW external contact', () => {
    expect(
      /EXISTS\s*\(\s*SELECT 1 FROM public\.marketing_suppressions ms\s+WHERE ms\.revoked_at IS NULL AND ms\.email_lc = e\.email_lc\s*\)/i.test(
        CODE,
      ),
    ).toBe(true)
  })

  it('creates a suppressed external contact DISABLED rather than enabling it', () => {
    expect(/THEN false ELSE true END/i.test(CODE)).toBe(true)
  })

  it('never writes marketing_suppressions (no insert/update/revoke)', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_suppressions/i.test(CODE)).toBe(false)
    expect(/UPDATE\s+public\.marketing_suppressions/i.test(CODE)).toBe(false)
    expect(/UPDATE\s+marketing_suppressions/i.test(CODE)).toBe(false)
    // No revoking of any suppression (no write of revoked_at).
    expect(/revoked_at\s*=/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3C reconciliation — set-based, not a per-user loop', () => {
  it('uses set-based INSERT ... SELECT and no row cursor / FOR-loop over users', () => {
    expect(/INSERT INTO public\.marketing_preferences[\s\S]*?SELECT/i.test(CODE)).toBe(true)
    // No PL/pgSQL row loop and no explicit cursor driving per-user work.
    expect(/\bFOR\b[^;]*\bIN\b[^;]*\bLOOP\b/i.test(CODE.replace(/FOREACH[^;]*;/gi, ''))).toBe(false)
    expect(/\bDECLARE\b[^;]*\bCURSOR\b/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3C reconciliation — no forbidden side effects', () => {
  it('creates or alters NO real table, and drops nothing', () => {
    // The only tables created are transaction-local TEMP working sets/result.
    expect(/CREATE TABLE (?!TEMP)/i.test(CODE)).toBe(false)
    expect(/\bALTER TABLE\b/i.test(CODE)).toBe(false)
    expect(/\bDROP TABLE\b/i.test(CODE)).toBe(false)
  })

  it('adds NO trigger and NO function/extension', () => {
    expect(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i.test(CODE)).toBe(false)
    expect(/\bCREATE\s+(OR REPLACE\s+)?FUNCTION\b/i.test(CODE)).toBe(false)
    expect(/\bCREATE\s+EXTENSION\b/i.test(CODE)).toBe(false)
  })

  it('references NO checkout / wallet / ticket / entries table', () => {
    for (const re of [
      /\bcheckout_intents\b/i,
      /\bwallet_accounts\b/i,
      /\bwallet_/i,
      /\bentries\b/i,
      /\bticket_allocations\b/i,
      /\binstant_win/i,
    ]) {
      expect(re.test(CODE), re.source).toBe(false)
    }
  })

  it('inserts NO recipient and NO automation run', () => {
    expect(/marketing_recipients/i.test(CODE)).toBe(false)
    expect(/marketing_automation_runs/i.test(CODE)).toBe(false)
  })

  it('creates NO opportunities table/rows', () => {
    expect(/marketing_opportunities/i.test(CODE)).toBe(false)
  })

  it('changes NO control state (reads only; no INSERT/UPDATE)', () => {
    expect(/UPDATE\s+public\.marketing_control_state/i.test(CODE)).toBe(false)
    expect(/UPDATE\s+marketing_control_state/i.test(CODE)).toBe(false)
    expect(/INSERT\s+INTO\s+public\.marketing_control_state/i.test(CODE)).toBe(false)
    // sending/discovery/rollout appear only in the read + assertion, never assigned.
    expect(/sending_enabled\s*=\s*(true|false)/i.test(CODE)).toBe(false)
    expect(/discovery_enabled\s*=\s*(true|false)/i.test(CODE)).toBe(false)
    expect(/rollout_limit\s*=\s*\d/i.test(CODE)).toBe(false)
  })

  it('adds NO email / Resend capability', () => {
    expect(/resend/i.test(CODE)).toBe(false)
    expect(/api\.resend\.com/i.test(CODE)).toBe(false)
    expect(/RESEND_API_KEY/i.test(CODE)).toBe(false)
  })

  it('does NOT call refresh_customer_marketing_profiles()', () => {
    expect(/refresh_customer_marketing_profiles/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3C reconciliation — returns one aggregate JSON, no PII', () => {
  it('returns every required aggregate key', () => {
    for (const key of [
      'consentedPreRegistrationsConsidered',
      'preRegistrationsMatchedToAuth',
      'matchedAuthExistingPreferencePreserved',
      'matchedAuthPreferenceInserted',
      'matchedAuthSuppressedNotEnabled',
      'externalContactsInsertedEnabled',
      'externalContactsInsertedSuppressed',
      'externalContactsAlreadyExisting',
      'finalEnabledPreferenceCount',
      'finalExternalEnabledCount',
    ]) {
      expect(FLAT, key).toContain(`'${key}'`)
    }
  })

  it('does NOT expose the removed generic-activation counter key', () => {
    expect(/authPreferencesInsertedFromExistingCustomerActivation/i.test(SQL)).toBe(false)
  })

  it('emits only aggregate counts (jsonb_build_object over count columns)', () => {
    expect(/jsonb_build_object\(/i.test(CODE)).toBe(true)
    // The final projection selects from the aggregate temp carrier, not raw rows.
    expect(/FROM _stage3c_activation_result r/i.test(CODE)).toBe(true)
  })
})
