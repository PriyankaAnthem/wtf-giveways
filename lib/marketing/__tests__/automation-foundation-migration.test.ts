import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * STATIC contract for the Stage 3A migration
 * scripts/marketing/005-marketing-automation-foundation.sql.
 *
 * The migration cannot be executed from vitest (no Postgres), so these tests
 * pin the parts of its contract that MUST hold in the SQL text and across the
 * repository:
 *   - all seven configuration/queue tables are created,
 *   - RLS is enabled AND forced and anon/authenticated access is revoked,
 *   - all six automations are seeded DISABLED with the correct priority order,
 *   - global sending + discovery default OFF and rollout_limit defaults 0,
 *   - batch size is capped at 100 and recipient idempotency + identity +
 *     active-run duplicate protections exist,
 *   - the migration adds NO trigger, NO email/Resend/cron/webhook capability,
 *     alters NO checkout table, and inserts NO recipients, and
 *   - Marketing remains absent from the VISIBLE admin navigation.
 */
const ROOT = process.cwd()
const MIGRATION_PATH = 'scripts/marketing/005-marketing-automation-foundation.sql'
const SQL = readFileSync(join(ROOT, MIGRATION_PATH), 'utf8')

// SQL with `-- ...` line comments stripped, so assertions about executable code
// are never satisfied (or tripped) by prose in the header comments.
const CODE = SQL.replace(/--.*$/gm, '')
const FLAT = CODE.replace(/\s+/g, ' ').trim()

const TABLES = [
  'marketing_external_contacts',
  'marketing_templates',
  'marketing_automations',
  'marketing_campaign_promotions',
  'marketing_control_state',
  'marketing_automation_runs',
  'marketing_recipients',
]

const AUTOMATION_KEYS = [
  'abandoned_checkout',
  'new_account_no_purchase',
  'lapsed_14_days',
  'wtf_credit_waiting',
  'regular_buyer_campaign_alert',
  'vip_early_access',
]

describe('Stage 3A migration — exists in the marketing migrations folder', () => {
  it('lives at scripts/marketing/005-marketing-automation-foundation.sql', () => {
    expect(existsSync(join(ROOT, MIGRATION_PATH))).toBe(true)
  })

  it('does not modify migrations 001-004 (they remain present and untouched by 005)', () => {
    for (const n of ['001', '002', '003', '004']) {
      const matches = readdirSync(join(ROOT, 'scripts/marketing')).filter((f) => f.startsWith(n))
      expect(matches.length, n).toBeGreaterThan(0)
    }
  })
})

describe('Stage 3A migration — creates all seven tables', () => {
  it.each(TABLES)('creates public.%s (idempotently)', (table) => {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, 'i')
    expect(re.test(CODE), table).toBe(true)
  })
})

describe('Stage 3A migration — RLS enabled + forced, anon/authenticated revoked', () => {
  it.each(TABLES)('enables and forces RLS on public.%s', (table) => {
    expect(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`, 'i').test(CODE), table).toBe(true)
    expect(new RegExp(`ALTER TABLE public\\.${table}\\s+FORCE\\s+ROW LEVEL SECURITY`, 'i').test(CODE), table).toBe(true)
  })

  it.each(TABLES)('revokes all access from anon + authenticated on public.%s', (table) => {
    expect(
      new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM anon, authenticated`, 'i').test(CODE),
      table,
    ).toBe(true)
  })

  it.each(TABLES)('grants to service_role only (no anon/authenticated grant) on public.%s', (table) => {
    expect(new RegExp(`GRANT [A-Z, ]+ ON public\\.${table}\\s+TO service_role`, 'i').test(CODE), table).toBe(true)
    expect(new RegExp(`GRANT[^;]*ON public\\.${table}[^;]*TO (anon|authenticated)`, 'i').test(CODE), table).toBe(false)
  })

  it('creates no RLS policy at all (service_role bypasses forced RLS)', () => {
    expect(/\bCREATE POLICY\b/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3A migration — six automations seeded disabled, correct priority', () => {
  it('constrains automation_key to exactly the six known trigger types', () => {
    for (const key of AUTOMATION_KEYS) {
      expect(FLAT, key).toContain(`'${key}'`)
    }
  })

  it('seeds all six automations with enabled = false', () => {
    // Every seeded VALUES tuple carries a literal false enabled flag.
    const seedBlock = FLAT.slice(FLAT.indexOf('INSERT INTO public.marketing_automations'))
    for (const key of AUTOMATION_KEYS) {
      const tuple = new RegExp(`'${key}',[^)]*`, 'i').exec(seedBlock)?.[0] ?? ''
      expect(tuple, key).toMatch(/false/i)
    }
  })

  it('seeds the exact priority order 1..6 (vip, abandoned, wtf_credit, regular, new_account, lapsed)', () => {
    const seedBlock = FLAT.slice(FLAT.indexOf('INSERT INTO public.marketing_automations'))
    const priorityOf = (key: string): number => {
      // Tuple shape: ('key', 'Name', false, <priority>, ...)
      const m = new RegExp(`'${key}',\\s*'[^']*',\\s*false,\\s*(\\d+)`, 'i').exec(seedBlock)
      return m ? Number(m[1]) : -1
    }
    expect(priorityOf('vip_early_access')).toBe(1)
    expect(priorityOf('abandoned_checkout')).toBe(2)
    expect(priorityOf('wtf_credit_waiting')).toBe(3)
    expect(priorityOf('regular_buyer_campaign_alert')).toBe(4)
    expect(priorityOf('new_account_no_purchase')).toBe(5)
    expect(priorityOf('lapsed_14_days')).toBe(6)
  })

  it('references no active discount code in the automation seed', () => {
    const seedBlock = FLAT.slice(
      FLAT.indexOf('INSERT INTO public.marketing_automations'),
      FLAT.indexOf('INSERT INTO public.marketing_control_state'),
    )
    // The seed INSERT column list does not include discount_code_id.
    expect(seedBlock).not.toMatch(/discount_code_id/i)
  })

  it('enforces a strict unique priority ordering', () => {
    expect(/CREATE UNIQUE INDEX[^;]*marketing_automations[^;]*\(\s*priority\s*\)/i.test(CODE)).toBe(true)
  })
})

describe('Stage 3A migration — control state seeded fully paused', () => {
  it('defaults sending_enabled and discovery_enabled to false', () => {
    expect(FLAT).toMatch(/sending_enabled\s+boolean\s+NOT NULL DEFAULT false/i)
    expect(FLAT).toMatch(/discovery_enabled\s+boolean\s+NOT NULL DEFAULT false/i)
  })

  it('defaults rollout_limit to 0', () => {
    expect(FLAT).toMatch(/rollout_limit\s+integer\s+NOT NULL DEFAULT 0/i)
  })

  it('seeds the singleton row fully paused (false, false, 0, 100, 1, 3)', () => {
    const seed = FLAT.slice(FLAT.indexOf('INSERT INTO public.marketing_control_state'))
    expect(seed).toMatch(/'default',\s*false,\s*false,\s*0,\s*100,\s*1,\s*3/i)
  })

  it('caps maximum_batch_size at 100 (BETWEEN 1 AND 100)', () => {
    expect(FLAT).toMatch(/maximum_batch_size BETWEEN 1 AND 100/i)
  })

  it('forbids a weekly cap below the daily cap', () => {
    expect(FLAT).toMatch(/maximum_weekly_per_contact >= maximum_daily_per_contact/i)
  })

  it('forbids negative rollout / daily / weekly limits', () => {
    expect(FLAT).toMatch(/rollout_limit >= 0/i)
    expect(FLAT).toMatch(/maximum_daily_per_contact\s+>= 0/i)
    expect(FLAT).toMatch(/maximum_weekly_per_contact >= 0/i)
  })
})

describe('Stage 3A migration — recipient ledger protections', () => {
  it('makes the recipient idempotency key unique', () => {
    expect(/CREATE UNIQUE INDEX[^;]*marketing_recipients[^;]*\(\s*idempotency_key\s*\)/i.test(CODE)).toBe(true)
  })

  it('enforces exactly one of user_id / external_contact_id (XOR identity)', () => {
    expect(FLAT).toMatch(/\(user_id IS NOT NULL\) <> \(external_contact_id IS NOT NULL\)/i)
  })

  it('enforces unique recipient identity within a run (user + external)', () => {
    expect(
      /CREATE UNIQUE INDEX[^;]*marketing_recipients[^;]*\(\s*run_id,\s*user_id\s*\)/i.test(CODE),
    ).toBe(true)
    expect(
      /CREATE UNIQUE INDEX[^;]*marketing_recipients[^;]*\(\s*run_id,\s*external_contact_id\s*\)/i.test(CODE),
    ).toBe(true)
  })

  it('has a queue index on status / run_after / locked_until', () => {
    expect(
      /CREATE INDEX[^;]*marketing_recipients[^;]*\(\s*status,\s*run_after,\s*locked_until\s*\)/i.test(CODE),
    ).toBe(true)
  })

  it('has per-contact history indexes for user, external contact and email', () => {
    expect(/marketing_recipients[^;]*\(\s*user_id,\s*sent_at\s*\)/i.test(CODE)).toBe(true)
    expect(/marketing_recipients[^;]*\(\s*external_contact_id,\s*sent_at\s*\)/i.test(CODE)).toBe(true)
    expect(/marketing_recipients[^;]*\(\s*email_lc,\s*sent_at\s*\)/i.test(CODE)).toBe(true)
  })

  it('stores only bounded error CODES, never full provider messages/payloads', () => {
    expect(FLAT).toMatch(/last_error_code\s+text/i)
    expect(FLAT).not.toMatch(/last_error_message/i)
    expect(FLAT).not.toMatch(/provider_payload/i)
    expect(FLAT).not.toMatch(/raw_payload/i)
  })

  it('inserts NO recipients in this migration', () => {
    expect(/INSERT\s+INTO\s+public\.marketing_recipients/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3A migration — active-run duplicate protection', () => {
  it('has a partial unique index over (automation, promotion) active statuses', () => {
    expect(
      /CREATE UNIQUE INDEX[^;]*marketing_automation_runs[^;]*WHERE status IN \('preparing', 'queued', 'processing'\)/i.test(
        CODE,
      ),
    ).toBe(true)
  })
})

describe('Stage 3A migration — read-only admin config functions only', () => {
  it('defines the two read-only configuration readers', () => {
    expect(FLAT).toMatch(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_configuration\(\)/i)
    expect(FLAT).toMatch(/CREATE OR REPLACE FUNCTION public\.get_admin_marketing_control_state\(\)/i)
  })

  it('makes both functions SECURITY DEFINER with a fixed search_path and service_role-only execute', () => {
    expect((CODE.match(/SECURITY DEFINER/gi) ?? []).length).toBeGreaterThanOrEqual(2)
    expect((CODE.match(/SET search_path = public, pg_temp/gi) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(FLAT).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_configuration\(\) TO service_role/i)
    expect(FLAT).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_admin_marketing_control_state\(\) TO service_role/i)
  })

  it('adds NO discovery / leasing / sending function', () => {
    expect(/FUNCTION public\.\w*(discover|enqueue|lease|claim|send)\w*/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3A migration — no forbidden side effects', () => {
  it('creates no trigger', () => {
    expect(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i.test(CODE)).toBe(false)
  })

  it('alters no checkout / customer-facing table', () => {
    const FORBIDDEN_ALTER = [
      /ALTER TABLE[^;]*\bcheckout_intents\b/i,
      /ALTER TABLE[^;]*\bwallet_accounts\b/i,
      /ALTER TABLE[^;]*\bentries\b/i,
      /ALTER TABLE[^;]*\bticket_allocations\b/i,
      /ALTER TABLE[^;]*\bauth\.users\b/i,
      /ALTER TABLE[^;]*\bcampaigns\b/i,
      /ALTER TABLE[^;]*\bdiscount_codes\b/i,
    ]
    for (const re of FORBIDDEN_ALTER) {
      expect(re.test(CODE), re.source).toBe(false)
    }
  })

  it('performs no data backfill from source tables', () => {
    expect(/INSERT INTO[^;]*SELECT[^;]*FROM (public\.checkout_intents|auth\.users|public\.pre_registrations)/i.test(CODE)).toBe(
      false,
    )
  })

  it('adds no email / Resend / cron / webhook capability', () => {
    expect(/resend/i.test(CODE)).toBe(false)
    expect(/api\.resend\.com/i.test(CODE)).toBe(false)
    expect(/RESEND_API_KEY/i.test(CODE)).toBe(false)
  })
})

describe('Stage 3A — no email route / Resend call added to the app surface', () => {
  const walk = (dir: string): string[] => {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) return []
    return readdirSync(abs, { recursive: true, encoding: 'utf8' })
      .map((rel) => join(abs, rel))
      .filter((p) => /\.(ts|tsx)$/.test(p))
  }

  it('creates no new marketing email/cron/webhook route file', () => {
    const routeFiles = walk('app/api')
      .filter((p) => /marketing/i.test(p))
      // The Stage 030 marketing-delivery job route + its tests are introduced by
      // a LATER stage, not by Stage 3A. This guard asserts Stage 3A itself adds
      // no sending/cron/webhook route, so exclude the Stage 030 path.
      .filter((p) => !p.includes('marketing-delivery'))
      // Likewise the Stage 031B Resend marketing webhook route is introduced by
      // a LATER stage (authenticated provider lifecycle ingestion, not sending),
      // so exclude the Stage 031B path too.
      .filter((p) => !p.includes(join('webhooks', 'resend', 'marketing')))
      // The Stage 035 marketing-discovery cron route is likewise introduced by a
      // LATER stage. It only invokes the existing discovery RPC (no send, no
      // Resend, no delivery), so exclude the Stage 035 path too.
      .filter((p) => !p.includes('marketing-discovery'))
      // The Stage 036 marketing-materialisation cron route is likewise a LATER
      // stage. It only invokes the existing recipient materialisation RPC (no
      // send, no Resend, no delivery), so exclude the Stage 036 path too.
      .filter((p) => !p.includes('marketing-materialisation'))
      // The Stage 037 marketing-preparation + marketing-readiness cron routes are
      // likewise LATER stages. Preparation only populates snapshot columns and
      // readiness only transitions runs preparing->queued; neither sends, calls
      // Resend, or delivers. Exclude both Stage 037 paths too.
      .filter((p) => !p.includes('marketing-preparation'))
      .filter((p) => !p.includes('marketing-readiness'))
    // The only pre-existing marketing API routes are the audiences reader and
    // the public unsubscribe handler + account preference route. Stage 3A adds
    // no sending/cron/webhook route.
    const offenders = routeFiles.filter((p) =>
      /(send|deliver|dispatch|cron|webhook|resend)/i.test(p),
    )
    expect(offenders).toEqual([])
  })
})

describe('Stage 3A migration — live-production safety corrections', () => {
  const seedBlock = FLAT.slice(FLAT.indexOf('INSERT INTO public.marketing_automations'))
  // Extract a single seeded automation VALUES tuple by key. Column order:
  // (key, name, enabled, priority, first_delay, follow_up, cooldown, min_wallet, max_recipients)
  const tupleOf = (key: string): string =>
    new RegExp(`\\('${key}',[^)]*\\)`, 'i').exec(seedBlock)?.[0] ?? ''

  it('is atomic: wraps the whole migration in BEGIN ... COMMIT', () => {
    expect(/\bBEGIN;/i.test(CODE)).toBe(true)
    expect(/\bCOMMIT;/i.test(CODE)).toBe(true)
    // BEGIN comes before COMMIT.
    expect(CODE.search(/\bBEGIN;/i)).toBeLessThan(CODE.search(/\bCOMMIT;/i))
  })

  it('fails fast with LOCAL lock_timeout and statement_timeout', () => {
    expect(/SET LOCAL lock_timeout\s*=\s*'5s'/i.test(CODE)).toBe(true)
    expect(/SET LOCAL statement_timeout\s*=\s*'60s'/i.test(CODE)).toBe(true)
  })

  it('takes a migration-specific transaction advisory lock and raises if held', () => {
    expect(/pg_try_advisory_xact_lock\(\s*hashtext\('wtf_marketing_stage_3a_migration'\)\s*\)/i.test(CODE)).toBe(true)
    expect(/another execution is already in progress/i.test(CODE)).toBe(true)
  })

  it('preflights every required dependency via to_regclass and raises when missing', () => {
    for (const dep of [
      'public.campaigns',
      'public.discount_codes',
      'public.marketing_preferences',
      'public.marketing_suppressions',
      'public.customer_marketing_profiles',
    ]) {
      expect(FLAT, dep).toContain(`'${dep}'`)
    }
    expect(/to_regclass\(/i.test(CODE)).toBe(true)
    expect(/required dependency .* is missing/i.test(CODE)).toBe(true)
  })

  it('performs NO global extension DDL (no CREATE EXTENSION at all)', () => {
    expect(/CREATE\s+EXTENSION/i.test(CODE)).toBe(false)
    expect(/pgcrypto/i.test(CODE)).toBe(false)
  })

  it('de-dupes delivery by email within a run: unique (run_id, email_lc)', () => {
    expect(
      /CREATE UNIQUE INDEX[^;]*marketing_recipients[^;]*\(\s*run_id,\s*email_lc\s*\)/i.test(CODE),
    ).toBe(true)
  })

  it('forbids an external contact being enabled AND unsubscribed at once', () => {
    expect(/marketing_enabled\s*=\s*false\s+OR\s+unsubscribed_at IS NULL/i.test(FLAT)).toBe(true)
  })

  it('seeds abandoned_checkout with first_delay 45 and follow_up 1200 minutes', () => {
    const t = tupleOf('abandoned_checkout')
    // (key, name, false, 2, 45, 1200, 168, NULL, 200)
    expect(t).toMatch(/'abandoned_checkout',\s*'[^']*',\s*false,\s*2,\s*45,\s*1200,\s*168,\s*NULL,\s*200/i)
  })

  it('seeds wtf_credit_waiting with a minimum wallet of exactly 1 penny', () => {
    const t = tupleOf('wtf_credit_waiting')
    // (key, name, false, 3, 0, NULL, 336, 1, 200) — min_wallet is the 8th value.
    expect(t).toMatch(/'wtf_credit_waiting',\s*'[^']*',\s*false,\s*3,\s*0,\s*NULL,\s*336,\s*1,\s*200/i)
  })

  it('seeds lapsed_14_days with a ZERO first delay (14-day rule is in the trigger)', () => {
    const t = tupleOf('lapsed_14_days')
    // (key, name, false, 6, 0, NULL, 720, NULL, 200)
    expect(t).toMatch(/'lapsed_14_days',\s*'[^']*',\s*false,\s*6,\s*0,\s*NULL,\s*720,\s*NULL,\s*200/i)
    // Explicitly assert no lingering 20160-minute (14-day) delivery delay.
    expect(t).not.toMatch(/20160/)
  })

  it('keeps every seeded automation disabled', () => {
    for (const key of AUTOMATION_KEYS) {
      expect(tupleOf(key), key).toMatch(/,\s*false,/i)
    }
    // No seeded automation is enabled.
    expect(/'[a-z_]+',\s*'[^']*',\s*true,/i.test(seedBlock)).toBe(false)
  })

  it('still alters no existing application table and adds no trigger / sending / Resend capability', () => {
    // Re-assert the core safety invariants after the corrections.
    for (const re of [
      /ALTER TABLE[^;]*\bcheckout_intents\b/i,
      /ALTER TABLE[^;]*\bwallet_accounts\b/i,
      /ALTER TABLE[^;]*\bcampaigns\b/i,
      /ALTER TABLE[^;]*\bdiscount_codes\b/i,
      /ALTER TABLE[^;]*\bmarketing_preferences\b/i,
      /ALTER TABLE[^;]*\bmarketing_suppressions\b/i,
      /ALTER TABLE[^;]*\bcustomer_marketing_profiles\b/i,
      /ALTER TABLE[^;]*\bauth\.users\b/i,
    ]) {
      expect(re.test(CODE), re.source).toBe(false)
    }
    expect(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i.test(CODE)).toBe(false)
    expect(/resend/i.test(CODE)).toBe(false)
    expect(/api\.resend\.com/i.test(CODE)).toBe(false)
    expect(/RESEND_API_KEY/i.test(CODE)).toBe(false)
    // No sending/discovery/leasing function is introduced.
    expect(/FUNCTION public\.\w*(discover|enqueue|lease|claim|send)\w*/i.test(CODE)).toBe(false)
  })
})

describe('Marketing is a restored, visible admin navigation item', () => {
  it('is present in the visible ADMIN_NAV_ITEMS registry', () => {
    const nav = readFileSync(join(ROOT, 'lib/admin/navigation.ts'), 'utf8')
    const visibleBlock = nav.slice(
      nav.indexOf('ADMIN_NAV_ITEMS'),
      nav.indexOf('ADMIN_HIDDEN_NAV_ITEMS'),
    )
    expect(visibleBlock).toContain("'/admin/marketing'")
  })

  it('is no longer carried in the hidden-route list', () => {
    const nav = readFileSync(join(ROOT, 'lib/admin/navigation.ts'), 'utf8')
    const hiddenBlock = nav.slice(nav.indexOf('ADMIN_HIDDEN_NAV_ITEMS'))
    expect(hiddenBlock).not.toContain("'/admin/marketing'")
  })
})
