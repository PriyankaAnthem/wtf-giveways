import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * STATIC migration contract for scripts/marketing/003-customer-marketing-profile.sql.
 *
 * The set-based backfill/incremental behaviour cannot be executed from vitest
 * (no Postgres). These tests pin the parts of the contract that MUST hold in the
 * SQL text so a future edit cannot silently break the canonical revenue rule,
 * the RLS lockdown, the advisory lock, the batch bounds, or the identity-free
 * response. Live behaviour still requires the manual install + verification query
 * documented in the completion report.
 */
const SQL = readFileSync(
  join(process.cwd(), 'scripts/marketing/003-customer-marketing-profile.sql'),
  'utf8',
)
// Whitespace-normalised copy for formula/structure matching across line breaks.
const FLAT = SQL.replace(/\s+/g, ' ')

describe('003 migration — tables, keys, columns', () => {
  it('creates both new tables idempotently', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_marketing_profiles/)
    expect(SQL).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.customer_marketing_profile_refresh_state/,
    )
  })

  it('keys the profile on user_id with a cascading FK to auth.users', () => {
    expect(FLAT).toMatch(
      /user_id uuid PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/,
    )
  })

  it('stores email_lc NOT NULL and never a full name column', () => {
    expect(FLAT).toMatch(/email_lc text NOT NULL/)
    expect(SQL).not.toMatch(/first_name|last_name|full_name|display_name/i)
  })

  it('seeds exactly one singleton refresh-state row, safe to rerun', () => {
    expect(FLAT).toMatch(
      /INSERT INTO public\.customer_marketing_profile_refresh_state \(key\) VALUES \('default'\) ON CONFLICT \(key\) DO NOTHING/,
    )
  })
})

describe('003 migration — indexes (exact, no speculative extras)', () => {
  it('creates the five specified profile indexes', () => {
    expect(SQL).toMatch(/idx_cmp_last_confirmed_at[\s\S]*last_confirmed_at DESC/)
    expect(SQL).toMatch(/idx_cmp_confirmed_order_count[\s\S]*confirmed_order_count/)
    expect(SQL).toMatch(/idx_cmp_lifetime_external_pence[\s\S]*lifetime_external_pence/)
    expect(FLAT).toMatch(
      /idx_cmp_wallet_available_pence ON public\.customer_marketing_profiles \(wallet_available_pence\) WHERE wallet_available_pence > 0/,
    )
    expect(FLAT).toMatch(
      /idx_cmp_eligible_last_confirmed ON public\.customer_marketing_profiles \(marketing_eligible_snapshot, last_confirmed_at DESC\)/,
    )
  })

  it('adds NO index to checkout_intents (existing indexes are reused)', () => {
    expect(SQL).not.toMatch(/ON\s+(public\.)?checkout_intents/i)
  })
})

describe('003 migration — RLS + permissions (service-role only)', () => {
  it('enables AND forces RLS on both tables', () => {
    for (const t of [
      'customer_marketing_profiles',
      'customer_marketing_profile_refresh_state',
    ]) {
      expect(FLAT).toMatch(new RegExp(`ENABLE ROW LEVEL SECURITY`))
      expect(FLAT).toMatch(new RegExp(`ALTER TABLE public\\.${t} +FORCE +ROW LEVEL SECURITY`))
    }
  })

  it('creates no browser policies', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/i)
  })

  it('revokes from anon/authenticated/public and grants only to service_role', () => {
    expect(FLAT).toMatch(/REVOKE ALL ON public\.customer_marketing_profiles FROM public, anon, authenticated/)
    expect(FLAT).toMatch(
      /REVOKE ALL ON public\.customer_marketing_profile_refresh_state FROM public, anon, authenticated/,
    )
    expect(FLAT).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.customer_marketing_profiles TO service_role/)
    expect(FLAT).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_customer_marketing_profiles\(integer\) TO service_role/)
  })

  it('grants execute on the RPC to no one but service_role', () => {
    expect(FLAT).toMatch(
      /REVOKE ALL ON FUNCTION public\.refresh_customer_marketing_profiles\(integer\) FROM public, anon, authenticated/,
    )
    expect(SQL).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO (anon|authenticated|public)/i)
  })
})

describe('003 migration — canonical calculations match reporting exactly', () => {
  it('uses the eligible confirmed-order scope', () => {
    expect(FLAT).toMatch(/ci\.state = 'confirmed'/)
    expect(FLAT).toMatch(/ci\.provider IS DISTINCT FROM 'debug'/)
    expect(FLAT).toMatch(/ci\.ref IS NULL OR ci\.ref NOT LIKE 'SIM-%'/)
  })

  it('uses the external-revenue fallback (external_payment_pence else total - wallet credit)', () => {
    expect(FLAT).toMatch(
      /WHEN ci\.external_payment_pence IS NOT NULL THEN ci\.external_payment_pence ELSE COALESCE\(ci\.total_pence, 0\) - COALESCE\(ci\.wallet_credit_pence, 0\)/,
    )
  })

  it('uses confirmed_at for first/last purchase timing', () => {
    expect(FLAT).toMatch(/MIN\(ci\.confirmed_at\) AS first_confirmed_at/)
    expect(FLAT).toMatch(/MAX\(ci\.confirmed_at\) AS last_confirmed_at/)
  })

  it('computes wallet available with GREATEST(.., 0) and never goes negative', () => {
    expect(FLAT).toMatch(
      /GREATEST\(COALESCE\(w\.balance_pence, 0\) - COALESCE\(w\.reserved_pence, 0\), 0\)/,
    )
  })

  it('selects the last campaign deterministically (confirmed_at DESC, id DESC tie-break)', () => {
    expect(FLAT).toMatch(
      /DISTINCT ON \(ci\.user_id\)[\s\S]*ORDER BY ci\.user_id, ci\.confirmed_at DESC, ci\.id DESC/,
    )
  })
})

describe('003 migration — eligibility snapshot semantics', () => {
  it('email_confirmed derives from auth.users.email_confirmed_at', () => {
    expect(FLAT).toMatch(/\(u\.email_confirmed_at IS NOT NULL\) AS email_confirmed/)
  })

  it('account_active derives from deleted_at IS NULL', () => {
    expect(FLAT).toMatch(/\(t\.deleted_at IS NULL\) AS account_active/)
  })

  it('no preference row means marketing_enabled false', () => {
    expect(FLAT).toMatch(/COALESCE\(p\.email_marketing_enabled, false\) AS marketing_enabled/)
  })

  it('snapshot requires active + confirmed + enabled + not suppressed', () => {
    expect(FLAT).toMatch(
      /\(t\.deleted_at IS NULL\) AND t\.email_confirmed AND COALESCE\(p\.email_marketing_enabled, false\) AND \(s\.user_id IS NULL\) \) AS marketing_eligible_snapshot/,
    )
  })

  it('matches active suppression by user id OR normalised email', () => {
    expect(FLAT).toMatch(/s\.revoked_at IS NULL AND \(s\.user_id = t\.id OR s\.email_lc = t\.email_lc\)/)
  })
})

describe('003 migration — refresh RPC contract', () => {
  it('has the exact signature and returns jsonb, security definer, fixed search_path', () => {
    expect(FLAT).toMatch(
      /CREATE OR REPLACE FUNCTION public\.refresh_customer_marketing_profiles\( p_backfill_batch_size integer DEFAULT 500 \) RETURNS jsonb/,
    )
    expect(FLAT).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/)
  })

  it('sets statement + lock timeouts before doing work', () => {
    expect(FLAT).toMatch(/set_config\('statement_timeout'/)
    expect(FLAT).toMatch(/set_config\('lock_timeout'/)
  })

  it('takes a transaction-scoped advisory lock and skips (does not stack) when held', () => {
    expect(FLAT).toMatch(/pg_try_advisory_xact_lock\(v_lock_key\)/)
    expect(FLAT).toMatch(/'skippedBecauseLocked', true/)
  })

  it('clamps batch size to default 500, min 1, max 1000', () => {
    expect(FLAT).toMatch(/v_batch := COALESCE\(p_backfill_batch_size, 500\)/)
    expect(FLAT).toMatch(/IF v_batch < 1 THEN v_batch := 500/)
    expect(FLAT).toMatch(/IF v_batch > 1000 THEN v_batch := 1000/)
  })

  it('advances the backfill cursor only after a successful batch', () => {
    expect(FLAT).toMatch(/v_processed := public\.refresh_customer_marketing_profiles_batch\(v_ids\); .*v_state\.backfill_cursor := v_ids\[v_count\]/)
  })

  it('on backfill completion seeds the first incremental floor to backfill_started_at', () => {
    expect(FLAT).toMatch(/v_state\.backfill_complete := true;[\s\S]*v_state\.last_incremental_at := v_state\.backfill_started_at/)
  })

  it('incremental uses a 15-minute overlap against the watermark', () => {
    expect(FLAT).toMatch(/v_overlap +interval := interval '15 minutes'/)
    expect(FLAT).toMatch(
      /v_since := COALESCE\(v_state\.last_incremental_at, v_state\.backfill_started_at, v_now\) - v_overlap/,
    )
  })

  it('gathers incremental candidates from all six change sources and dedupes', () => {
    expect(FLAT).toMatch(/array_agg\(DISTINCT uid\)/)
    expect(FLAT).toMatch(/FROM auth\.users u WHERE u\.updated_at >= v_since/)
    expect(FLAT).toMatch(/FROM public\.wallet_accounts w WHERE w\.updated_at >= v_since/)
    expect(FLAT).toMatch(/FROM public\.marketing_preferences mp WHERE mp\.updated_at >= v_since/)
    expect(FLAT).toMatch(/s\.created_at >= v_since OR s\.revoked_at >= v_since/)
  })

  it('detects checkout candidates by any row change (not only currently-confirmed) so refund/void transitions are recomputed', () => {
    // The checkout-intents DETECTION branch must key on confirmed_at/updated_at
    // and must NOT be gated on ci.state = 'confirmed' (that gate would strand a
    // profile whose latest order later leaves the confirmed state). The strict
    // eligible scope is re-applied when aggregates are computed.
    expect(FLAT).toMatch(
      /FROM public\.checkout_intents ci WHERE ci\.user_id IS NOT NULL AND ci\.provider IS DISTINCT FROM 'debug' AND \(ci\.ref IS NULL OR ci\.ref NOT LIKE 'SIM-%'\) AND \(ci\.confirmed_at >= v_since OR ci\.updated_at >= v_since\)/,
    )
  })
})

describe('003 migration — writes nowhere but the two profile tables', () => {
  it('never INSERT/UPDATE/DELETE against source tables', () => {
    for (const t of [
      'checkout_intents',
      'wallet_accounts',
      'marketing_preferences',
      'marketing_suppressions',
      'marketing_preference_events',
    ]) {
      expect(SQL).not.toMatch(new RegExp(`INSERT INTO public\\.${t}`, 'i'))
      expect(SQL).not.toMatch(new RegExp(`UPDATE public\\.${t}`, 'i'))
      expect(SQL).not.toMatch(new RegExp(`DELETE FROM public\\.${t}`, 'i'))
    }
  })

  it('does not touch auth.users for writes', () => {
    expect(SQL).not.toMatch(/INSERT INTO auth\.users|UPDATE auth\.users|DELETE FROM auth\.users/i)
  })
})

describe('003 migration — adds no sending capability', () => {
  it('creates no campaigns/recipients/templates tables and no email code', () => {
    expect(SQL).not.toMatch(/marketing_campaigns|marketing_recipients|campaign_recipients|email_templates/i)
    expect(SQL).not.toMatch(/resend|smtp|sendgrid|nodemailer/i)
  })
})

describe('003 migration — does not modify Stage 0 migrations', () => {
  it('001 and 002 remain present and untouched by 003 (separate files)', () => {
    expect(existsSync(join(process.cwd(), 'scripts/marketing/001-marketing-consent-foundation.sql'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'scripts/marketing/002-marketing-preference-idempotency.sql'))).toBe(true)
    // 003 must not redefine Stage 0 functions.
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(set_marketing_email_preference|unsubscribe_marketing_email|is_marketing_email_eligible|marketing_can_reenable)\b/)
  })
})
