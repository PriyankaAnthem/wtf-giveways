-- ============================================================================
-- WTF Marketing Hub — Stage 3A: automation configuration & queue foundation
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Create the DATABASE-BACKED, CONFIGURATION-DRIVEN foundation for a proper
--   Marketing Hub. Admin will later change copy, timing, cooldowns, campaigns,
--   discounts and rollout limits WITHOUT a deployment. Only core safety logic
--   and the set of automation trigger types stay defined in application code.
--
--   Everything created here defaults to PAUSED and is UNABLE TO SEND:
--     * marketing_control_state.sending_enabled   = false
--     * marketing_control_state.discovery_enabled = false
--     * marketing_control_state.rollout_limit      = 0
--     * all six seeded automations                 enabled = false
--
-- SCOPE / SAFETY
--   * ATOMIC. The whole migration runs inside a single BEGIN/COMMIT: any
--     failure rolls the entire thing back, so Stage 3A can never be left half
--     installed on the live database.
--   * FAIL FAST. lock_timeout + statement_timeout are set LOCAL so the install
--     aborts quickly instead of blocking a busy production database.
--   * ADDITIVE ONLY. Creates NEW tables/functions; touches migrations 001-004
--     not at all. Safe to run once; IF NOT EXISTS / CREATE OR REPLACE make a
--     re-run a practical no-op.
--   * NO global extension DDL. gen_random_uuid() is already used across this
--     database, so pgcrypto is present; this migration does NOT run
--     CREATE EXTENSION.
--   * NO data backfill. NO recipients inserted. NO existing customers activated.
--     NO pre-registration contacts imported.
--   * NO triggers on checkout, customer-facing, or any existing table.
--   * NO email is sent and NO sending / discovery / leasing capability is
--     created. The only functions added are READ-ONLY admin configuration
--     readers.
--   * Every new table: RLS ENABLED + FORCED, NO policies, all access revoked
--     from anon/authenticated, minimal explicit grants to service_role only.
--
-- REFERENCES TO EXISTING OBJECTS (created by earlier, unrelated migrations):
--     public.discount_codes(id)  -- fixed/percentage, site-wide/campaign codes.
--                                    NB: no per-user limit, no max-total-uses,
--                                    no redemption counter, no minimum spend.
--                                    This stage does NOT pretend those exist.
--     public.campaigns(id)       -- competitions.
--   Both are referenced with ON DELETE RESTRICT so config can never dangle.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migrations 001, 002, 003 and 004.
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database, and never let the
-- install run away. LOCAL = scoped to this transaction only; nothing global.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Preflight (read-only): refuse to run unless every required dependency already
-- exists, and refuse to overlap with a concurrent execution of THIS migration.
--   * to_regclass() is a pure lookup (NULL when absent). We create/alter NONE
--     of these objects here.
--   * pg_try_advisory_xact_lock() takes a transaction-scoped lock, released
--     automatically at COMMIT/ROLLBACK. We RAISE rather than wait, so two
--     simultaneous runs can never interleave.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_dep     text;
BEGIN
  FOREACH v_dep IN ARRAY ARRAY[
    'public.campaigns',
    'public.discount_codes',
    'public.marketing_preferences',
    'public.marketing_suppressions',
    'public.customer_marketing_profiles'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3A migration aborted: required dependency % is missing. Run migrations 001-004 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- Migration-specific advisory key (fixed for THIS migration only).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3a_migration')) THEN
    RAISE EXCEPTION
      'Stage 3A migration aborted: another execution is already in progress (advisory lock held).';
  END IF;
END
$preflight$;

-- ============================================================================
-- 1) marketing_external_contacts
--    Future home for CONSENTED contacts that have no Auth account (e.g. a later
--    reconciliation of pre_registrations). NOTHING is imported in this stage;
--    marketing_enabled defaults false so a freshly-inserted row can never send.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_external_contacts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_lc         text        NOT NULL,
  first_name       text,
  last_name        text,
  source           text        NOT NULL,
  source_record_id uuid,
  consented_at     timestamptz NOT NULL,
  consent_source   text        NOT NULL,
  consent_version  text        NOT NULL,
  marketing_enabled boolean    NOT NULL DEFAULT false,
  unsubscribed_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Email is always stored trimmed + lowercased and non-empty.
  CONSTRAINT marketing_external_contacts_email_lc_chk CHECK (
    email_lc = lower(email_lc) AND email_lc = btrim(email_lc) AND length(email_lc) > 0
  ),
  -- Bounded text fields.
  CONSTRAINT marketing_external_contacts_email_len_chk   CHECK (char_length(email_lc)        <= 320),
  CONSTRAINT marketing_external_contacts_first_len_chk   CHECK (first_name      IS NULL OR char_length(first_name)     <= 200),
  CONSTRAINT marketing_external_contacts_last_len_chk    CHECK (last_name       IS NULL OR char_length(last_name)      <= 200),
  CONSTRAINT marketing_external_contacts_source_len_chk  CHECK (char_length(source)          <= 100),
  CONSTRAINT marketing_external_contacts_csource_len_chk CHECK (char_length(consent_source)  <= 100),
  CONSTRAINT marketing_external_contacts_cver_len_chk    CHECK (char_length(consent_version) <= 50),
  -- An external contact can NEVER be simultaneously enabled AND unsubscribed:
  -- an unsubscribe (unsubscribed_at set) must force marketing_enabled = false.
  CONSTRAINT marketing_external_contacts_enabled_not_unsub_chk CHECK (
    marketing_enabled = false OR unsubscribed_at IS NULL
  )
);

-- One contact per normalised email.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_external_contacts_email_lc_uidx
  ON public.marketing_external_contacts (email_lc);

-- A given source record maps to at most one contact (only when identified).
CREATE UNIQUE INDEX IF NOT EXISTS marketing_external_contacts_source_record_uidx
  ON public.marketing_external_contacts (source, source_record_id)
  WHERE source_record_id IS NOT NULL;

COMMENT ON TABLE public.marketing_external_contacts IS
  'Consented, non-Auth marketing contacts. Nothing imported in Stage 3A. marketing_enabled defaults false so a new row can never send.';

-- ============================================================================
-- 2) marketing_templates
--    STRUCTURED, editable templates only. NO executable JS and NO unrestricted
--    HTML: the eventual email renderer owns the HTML structure; these are just
--    the editable content slots.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key     text        NOT NULL,
  name             text        NOT NULL,
  subject          text        NOT NULL,
  preview_text     text,
  heading          text        NOT NULL,
  body_text        text        NOT NULL,
  cta_label        text        NOT NULL,
  default_url      text,
  discount_code_id uuid        REFERENCES public.discount_codes(id) ON DELETE RESTRICT,
  version          integer     NOT NULL DEFAULT 1,
  is_active        boolean     NOT NULL DEFAULT true,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_templates_version_chk CHECK (version >= 1),
  -- Bounded text fields (structured content, not free-form HTML).
  CONSTRAINT marketing_templates_key_len_chk     CHECK (char_length(template_key) <= 100),
  CONSTRAINT marketing_templates_name_len_chk    CHECK (char_length(name)         <= 200),
  CONSTRAINT marketing_templates_subject_len_chk CHECK (char_length(subject)      <= 300),
  CONSTRAINT marketing_templates_preview_len_chk CHECK (preview_text IS NULL OR char_length(preview_text) <= 300),
  CONSTRAINT marketing_templates_heading_len_chk CHECK (char_length(heading)      <= 300),
  CONSTRAINT marketing_templates_body_len_chk    CHECK (char_length(body_text)    <= 5000),
  CONSTRAINT marketing_templates_cta_len_chk     CHECK (char_length(cta_label)    <= 100),
  CONSTRAINT marketing_templates_url_len_chk     CHECK (default_url IS NULL OR char_length(default_url) <= 2048)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_templates_key_uidx
  ON public.marketing_templates (template_key);

CREATE INDEX IF NOT EXISTS marketing_templates_discount_code_idx
  ON public.marketing_templates (discount_code_id)
  WHERE discount_code_id IS NOT NULL;

COMMENT ON TABLE public.marketing_templates IS
  'Structured, editable email content slots (no executable JS, no unrestricted HTML). The email renderer owns the HTML structure.';

-- ============================================================================
-- 3) marketing_automations
--    The six automation DEFINITIONS. The SET of trigger types is fixed in code
--    (the automation_key CHECK); everything else is admin-editable config.
--    All six are seeded DISABLED with no discount code references.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_automations (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key              text        NOT NULL,
  name                        text        NOT NULL,
  enabled                     boolean     NOT NULL DEFAULT false,
  priority                    integer     NOT NULL,
  template_id                 uuid        REFERENCES public.marketing_templates(id) ON DELETE SET NULL,
  first_delay_minutes         integer,
  follow_up_delay_minutes     integer,
  cooldown_hours              integer,
  minimum_wallet_pence        integer,
  discount_code_id            uuid        REFERENCES public.discount_codes(id) ON DELETE RESTRICT,
  maximum_recipients_per_run  integer     NOT NULL DEFAULT 100,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid,
  CONSTRAINT marketing_automations_key_chk CHECK (
    automation_key IN (
      'abandoned_checkout',
      'new_account_no_purchase',
      'lapsed_14_days',
      'wtf_credit_waiting',
      'regular_buyer_campaign_alert',
      'vip_early_access'
    )
  ),
  CONSTRAINT marketing_automations_priority_chk       CHECK (priority >= 1),
  CONSTRAINT marketing_automations_first_delay_chk    CHECK (first_delay_minutes     IS NULL OR first_delay_minutes     >= 0),
  CONSTRAINT marketing_automations_follow_delay_chk   CHECK (follow_up_delay_minutes IS NULL OR follow_up_delay_minutes >= 0),
  CONSTRAINT marketing_automations_cooldown_chk       CHECK (cooldown_hours          IS NULL OR cooldown_hours          >= 0),
  CONSTRAINT marketing_automations_min_wallet_chk     CHECK (minimum_wallet_pence    IS NULL OR minimum_wallet_pence    >= 0),
  CONSTRAINT marketing_automations_max_recipients_chk CHECK (maximum_recipients_per_run BETWEEN 1 AND 100000),
  CONSTRAINT marketing_automations_name_len_chk       CHECK (char_length(name) <= 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_automations_key_uidx
  ON public.marketing_automations (automation_key);

-- Priority is a strict ordering: no two automations may share a rank.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_automations_priority_uidx
  ON public.marketing_automations (priority);

COMMENT ON TABLE public.marketing_automations IS
  'The six automation definitions. Trigger-type set is fixed in code; timing/caps/copy are admin-editable. Seeded disabled.';

-- ============================================================================
-- 4) marketing_campaign_promotions
--    Competition-specific regular-buyer / VIP promotions. Creating a promotion
--    NEVER sends an email; it is configuration + status only.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_campaign_promotions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid        NOT NULL REFERENCES public.campaigns(id)          ON DELETE RESTRICT,
  promotion_type text        NOT NULL,
  template_id    uuid        REFERENCES public.marketing_templates(id)          ON DELETE RESTRICT,
  status         text        NOT NULL DEFAULT 'draft',
  scheduled_at   timestamptz,
  rollout_limit  integer     NOT NULL DEFAULT 0,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaign_promotions_type_chk CHECK (
    promotion_type IN ('regular_buyer_campaign_alert', 'vip_early_access')
  ),
  CONSTRAINT marketing_campaign_promotions_status_chk CHECK (
    status IN ('draft', 'scheduled', 'processing', 'completed', 'cancelled', 'failed')
  ),
  CONSTRAINT marketing_campaign_promotions_rollout_chk CHECK (rollout_limit >= 0)
);

CREATE INDEX IF NOT EXISTS marketing_campaign_promotions_campaign_idx
  ON public.marketing_campaign_promotions (campaign_id);

CREATE INDEX IF NOT EXISTS marketing_campaign_promotions_status_idx
  ON public.marketing_campaign_promotions (status);

COMMENT ON TABLE public.marketing_campaign_promotions IS
  'Competition-specific regular-buyer / VIP promotions. Creating a promotion never sends email; it is config + status only.';

-- ============================================================================
-- 5) marketing_control_state
--    Global safety kill-switches + rollout ceilings. Singleton row key='default'.
--    Seeded fully PAUSED: nothing can send or discover until an admin flips it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_control_state (
  key                        text        PRIMARY KEY DEFAULT 'default',
  sending_enabled            boolean     NOT NULL DEFAULT false,
  discovery_enabled          boolean     NOT NULL DEFAULT false,
  rollout_limit              integer     NOT NULL DEFAULT 0,
  maximum_batch_size         integer     NOT NULL DEFAULT 100,
  maximum_daily_per_contact  integer     NOT NULL DEFAULT 1,
  maximum_weekly_per_contact integer     NOT NULL DEFAULT 3,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid,
  CONSTRAINT marketing_control_state_singleton_chk  CHECK (key = 'default'),
  CONSTRAINT marketing_control_state_batch_chk      CHECK (maximum_batch_size BETWEEN 1 AND 100),
  CONSTRAINT marketing_control_state_rollout_chk    CHECK (rollout_limit >= 0),
  CONSTRAINT marketing_control_state_daily_chk      CHECK (maximum_daily_per_contact  >= 0),
  CONSTRAINT marketing_control_state_weekly_chk     CHECK (maximum_weekly_per_contact >= 0),
  -- A weekly cap can never be stricter than the daily cap.
  CONSTRAINT marketing_control_state_weekly_gte_daily_chk CHECK (
    maximum_weekly_per_contact >= maximum_daily_per_contact
  )
);

COMMENT ON TABLE public.marketing_control_state IS
  'Singleton global marketing kill-switches + rollout ceilings. Seeded fully paused (sending/discovery disabled, rollout_limit 0).';

-- ============================================================================
-- 6) marketing_automation_runs
--    One row per discovery/queue run of an automation (optionally scoped to a
--    promotion). Counters are populated by FUTURE application logic. At most one
--    ACTIVE run per (automation, promotion) combination.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_automation_runs (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id             uuid        NOT NULL REFERENCES public.marketing_automations(id)          ON DELETE RESTRICT,
  promotion_id              uuid        REFERENCES public.marketing_campaign_promotions(id)           ON DELETE RESTRICT,
  status                    text        NOT NULL DEFAULT 'preparing',
  rollout_limit_snapshot    integer     NOT NULL DEFAULT 0,
  template_version_snapshot integer,
  candidate_count           integer     NOT NULL DEFAULT 0,
  queued_count              integer     NOT NULL DEFAULT 0,
  sent_count                integer     NOT NULL DEFAULT 0,
  skipped_count             integer     NOT NULL DEFAULT 0,
  failed_count              integer     NOT NULL DEFAULT 0,
  started_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_automation_runs_status_chk CHECK (
    status IN ('preparing', 'queued', 'processing', 'completed', 'cancelled', 'failed')
  ),
  CONSTRAINT marketing_automation_runs_rollout_snap_chk CHECK (rollout_limit_snapshot >= 0),
  CONSTRAINT marketing_automation_runs_tversion_chk     CHECK (template_version_snapshot IS NULL OR template_version_snapshot >= 1),
  CONSTRAINT marketing_automation_runs_counts_chk CHECK (
    candidate_count >= 0 AND queued_count >= 0 AND sent_count >= 0
    AND skipped_count >= 0 AND failed_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS marketing_automation_runs_automation_idx
  ON public.marketing_automation_runs (automation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS marketing_automation_runs_promotion_idx
  ON public.marketing_automation_runs (promotion_id)
  WHERE promotion_id IS NOT NULL;

-- Only ONE active run per (automation, promotion) combination. promotion_id is
-- nullable, so COALESCE to a fixed sentinel makes the "automation-only" case
-- (promotion_id IS NULL) participate in uniqueness too.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_automation_runs_active_uidx
  ON public.marketing_automation_runs (
    automation_id,
    COALESCE(promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('preparing', 'queued', 'processing');

COMMENT ON TABLE public.marketing_automation_runs IS
  'One row per automation discovery/queue run. Counters filled by future logic. At most one active run per (automation, promotion).';

-- ============================================================================
-- 7) marketing_recipients
--    The DURABLE, auditable delivery ledger + queue. NO rows are inserted in
--    this stage. Exactly one of user_id / external_contact_id is present.
--    Snapshots are immutable after queueing (enforced in future app logic).
--    Only bounded ERROR CODES are stored — never full provider messages or raw
--    provider payloads.
--
--    user_id is a plain uuid with NO FK: this is an immutable audit ledger, so
--    deleting an Auth user must never rewrite history or break the
--    exactly-one-identity invariant. external_contact_id keeps an FK with
--    ON DELETE RESTRICT so a contact with delivery history cannot be deleted.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_recipients (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 uuid        NOT NULL REFERENCES public.marketing_automation_runs(id)     ON DELETE CASCADE,
  user_id                uuid,
  external_contact_id    uuid        REFERENCES public.marketing_external_contacts(id)            ON DELETE RESTRICT,
  email_lc               text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'queued',
  priority               integer     NOT NULL DEFAULT 0,
  run_after              timestamptz NOT NULL DEFAULT now(),
  attempts               integer     NOT NULL DEFAULT 0,
  max_attempts           integer     NOT NULL DEFAULT 3,
  locked_at              timestamptz,
  locked_until           timestamptz,
  provider_email_id      text,
  idempotency_key        text        NOT NULL,
  template_snapshot      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context_snapshot       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  discount_code_snapshot jsonb,
  skip_reason            text,
  last_error_code        text,
  sent_at                timestamptz,
  delivered_at           timestamptz,
  clicked_at             timestamptz,
  bounced_at             timestamptz,
  complained_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- Exactly one identity: a recipient is either an Auth user OR an external
  -- contact, never both and never neither.
  CONSTRAINT marketing_recipients_identity_chk CHECK (
    (user_id IS NOT NULL) <> (external_contact_id IS NOT NULL)
  ),
  CONSTRAINT marketing_recipients_status_chk CHECK (
    status IN ('queued', 'processing', 'sent', 'delivered', 'clicked',
               'skipped', 'failed', 'bounced', 'complained', 'cancelled')
  ),
  CONSTRAINT marketing_recipients_attempts_chk     CHECK (attempts >= 0),
  CONSTRAINT marketing_recipients_max_attempts_chk CHECK (max_attempts >= 1),
  CONSTRAINT marketing_recipients_priority_chk     CHECK (priority >= 0),
  -- Email is always stored trimmed + lowercased and non-empty.
  CONSTRAINT marketing_recipients_email_lc_chk CHECK (
    email_lc = lower(email_lc) AND email_lc = btrim(email_lc) AND length(email_lc) > 0
  ),
  -- Bounded text fields; only short codes are ever stored for errors/reasons.
  CONSTRAINT marketing_recipients_email_len_chk      CHECK (char_length(email_lc)          <= 320),
  CONSTRAINT marketing_recipients_provider_len_chk   CHECK (provider_email_id IS NULL OR char_length(provider_email_id) <= 200),
  CONSTRAINT marketing_recipients_idem_len_chk       CHECK (char_length(idempotency_key)   <= 200),
  CONSTRAINT marketing_recipients_skip_len_chk       CHECK (skip_reason      IS NULL OR char_length(skip_reason)      <= 100),
  CONSTRAINT marketing_recipients_errcode_len_chk    CHECK (last_error_code  IS NULL OR char_length(last_error_code)  <= 100)
);

-- Idempotency is globally unique: a given logical send exists at most once.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_recipients_idempotency_uidx
  ON public.marketing_recipients (idempotency_key);

-- Unique recipient identity WITHIN a run (separately for user + external
-- contact, since exactly one of the two is populated per row).
CREATE UNIQUE INDEX IF NOT EXISTS marketing_recipients_run_user_uidx
  ON public.marketing_recipients (run_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_recipients_run_external_uidx
  ON public.marketing_recipients (run_id, external_contact_id)
  WHERE external_contact_id IS NOT NULL;

-- Belt-and-braces address de-dupe: even across the user/external split, one
-- email address can be queued at most ONCE per run. This prevents an Auth user
-- and an external contact that happen to share an email from both being
-- delivered the same run.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_recipients_run_email_uidx
  ON public.marketing_recipients (run_id, email_lc);

-- Queue claim index: find the next due, unlocked work fast.
CREATE INDEX IF NOT EXISTS marketing_recipients_queue_idx
  ON public.marketing_recipients (status, run_after, locked_until);

-- Per-contact history indexes (frequency caps + auditing).
CREATE INDEX IF NOT EXISTS marketing_recipients_user_sent_idx
  ON public.marketing_recipients (user_id, sent_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_recipients_external_sent_idx
  ON public.marketing_recipients (external_contact_id, sent_at)
  WHERE external_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_recipients_email_sent_idx
  ON public.marketing_recipients (email_lc, sent_at);

COMMENT ON TABLE public.marketing_recipients IS
  'Durable delivery ledger + queue. No rows inserted in Stage 3A. Exactly one of user_id/external_contact_id. Only error CODES stored, never raw provider payloads/messages.';

-- ============================================================================
-- Security: RLS ENABLED + FORCED, NO policies, no anon/authenticated access.
-- Only service_role (which bypasses RLS) may touch these tables, and browser
-- code can never read or write them directly.
-- ============================================================================
ALTER TABLE public.marketing_external_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_external_contacts    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_templates            FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automations          FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_promotions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_promotions  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_control_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_control_state        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automation_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automation_runs      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_recipients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_recipients           FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_external_contacts   FROM anon, authenticated;
REVOKE ALL ON public.marketing_templates           FROM anon, authenticated;
REVOKE ALL ON public.marketing_automations         FROM anon, authenticated;
REVOKE ALL ON public.marketing_campaign_promotions FROM anon, authenticated;
REVOKE ALL ON public.marketing_control_state       FROM anon, authenticated;
REVOKE ALL ON public.marketing_automation_runs     FROM anon, authenticated;
REVOKE ALL ON public.marketing_recipients          FROM anon, authenticated;

-- Minimal explicit grants for the trusted server role. No DELETE is granted on
-- the audit ledgers (recipients / runs) or the singleton control row.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_external_contacts   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_templates           TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.marketing_automations          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaign_promotions  TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.marketing_control_state         TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.marketing_automation_runs       TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.marketing_recipients            TO service_role;

-- ============================================================================
-- Seed data (idempotent). All automations DISABLED; control state PAUSED.
-- ============================================================================

-- Six automation definitions, seeded DISABLED, correct priority order, modest
-- recipient caps, NO discount code references. Delays/cooldowns are sensible
-- starting defaults that admins edit later without a deployment.
INSERT INTO public.marketing_automations (
  automation_key, name, enabled, priority,
  first_delay_minutes, follow_up_delay_minutes, cooldown_hours,
  minimum_wallet_pence, maximum_recipients_per_run
) VALUES
  ('vip_early_access',             'VIP Early Access',             false, 1,    0, NULL, 168, NULL, 100),
  ('abandoned_checkout',           'Abandoned Checkout',           false, 2,   45, 1200, 168, NULL, 200),
  ('wtf_credit_waiting',           'WTF Credit Waiting',           false, 3,    0, NULL, 336,    1, 200),
  ('regular_buyer_campaign_alert', 'Regular Buyer Campaign Alert', false, 4,    0, NULL, 168, NULL, 500),
  ('new_account_no_purchase',      'New Account, No Purchase',     false, 5, 1440, NULL, 336, NULL, 200),
  ('lapsed_14_days',               'Lapsed 14 Days',               false, 6,    0, NULL, 720, NULL, 200)
ON CONFLICT (automation_key) DO NOTHING;

-- Singleton control row, seeded fully PAUSED.
INSERT INTO public.marketing_control_state (
  key, sending_enabled, discovery_enabled, rollout_limit,
  maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact
) VALUES
  ('default', false, false, 0, 100, 1, 3)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Read-only admin configuration functions.
--   SECURITY DEFINER + fixed search_path + service_role-only EXECUTE. They
--   return CONFIGURATION / AGGREGATE data ONLY: no recipient identities, no raw
--   customer rows, no checkout scans. They cannot enqueue, lease or send.
-- ============================================================================

-- get_admin_marketing_configuration: one compact snapshot of the automation +
-- template + promotion configuration, plus aggregate-only counters. External
-- contacts are exposed ONLY as an aggregate count (never rows/identities).
CREATE OR REPLACE FUNCTION public.get_admin_marketing_configuration()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Transaction-local safety limit so a pathological run self-terminates.
  PERFORM set_config('statement_timeout', '10s', true);

  SELECT jsonb_build_object(
    'generatedAt', now(),
    'automations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'automationKey',            a.automation_key,
        'name',                     a.name,
        'enabled',                  a.enabled,
        'priority',                 a.priority,
        'hasTemplate',              (a.template_id IS NOT NULL),
        'firstDelayMinutes',        a.first_delay_minutes,
        'followUpDelayMinutes',     a.follow_up_delay_minutes,
        'cooldownHours',            a.cooldown_hours,
        'minimumWalletPence',       a.minimum_wallet_pence,
        'hasDiscountCode',          (a.discount_code_id IS NOT NULL),
        'maximumRecipientsPerRun',  a.maximum_recipients_per_run,
        'updatedAt',                a.updated_at
      ) ORDER BY a.priority)
      FROM public.marketing_automations a
    ), '[]'::jsonb),
    'templates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'templateKey',     t.template_key,
        'name',            t.name,
        'isActive',        t.is_active,
        'version',         t.version,
        'hasDiscountCode', (t.discount_code_id IS NOT NULL),
        'updatedAt',       t.updated_at
      ) ORDER BY t.template_key)
      FROM public.marketing_templates t
    ), '[]'::jsonb),
    'promotionCountsByStatus', COALESCE((
      SELECT jsonb_object_agg(status, cnt)
      FROM (
        SELECT status, count(*)::bigint AS cnt
        FROM public.marketing_campaign_promotions
        GROUP BY status
      ) s
    ), '{}'::jsonb),
    'externalContactCount',        (SELECT count(*)::bigint FROM public.marketing_external_contacts),
    'externalContactEnabledCount', (SELECT count(*)::bigint FROM public.marketing_external_contacts WHERE marketing_enabled),
    'activeRunCount', (
      SELECT count(*)::bigint FROM public.marketing_automation_runs
      WHERE status IN ('preparing', 'queued', 'processing')
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_configuration() IS
  'Stage 3A read-only admin config snapshot (automations, templates, promotion status counts, aggregate contact/run counts). No identities, no customer rows, no checkout scans, no sending. Service-role only.';

-- get_admin_marketing_control_state: the singleton control row as jsonb.
CREATE OR REPLACE FUNCTION public.get_admin_marketing_control_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '10s', true);

  SELECT jsonb_build_object(
    'key',                     c.key,
    'sendingEnabled',          c.sending_enabled,
    'discoveryEnabled',        c.discovery_enabled,
    'rolloutLimit',            c.rollout_limit,
    'maximumBatchSize',        c.maximum_batch_size,
    'maximumDailyPerContact',  c.maximum_daily_per_contact,
    'maximumWeeklyPerContact', c.maximum_weekly_per_contact,
    'updatedAt',               c.updated_at
  )
  INTO v_result
  FROM public.marketing_control_state c
  WHERE c.key = 'default';

  -- If the singleton is somehow absent, present a safe fully-paused shape.
  IF v_result IS NULL THEN
    v_result := jsonb_build_object(
      'key', 'default',
      'sendingEnabled', false,
      'discoveryEnabled', false,
      'rolloutLimit', 0,
      'maximumBatchSize', 100,
      'maximumDailyPerContact', 1,
      'maximumWeeklyPerContact', 3,
      'updatedAt', NULL
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_control_state() IS
  'Stage 3A read-only singleton marketing control state as jsonb. No identities, no sending. Service-role only.';

-- Functions are callable ONLY by the trusted server role.
REVOKE ALL ON FUNCTION public.get_admin_marketing_configuration() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_marketing_control_state() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_admin_marketing_configuration() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_control_state() TO service_role;

COMMIT;

-- ============================================================================
-- End of Stage 3A migration.
--   * Wrapped in a single atomic BEGIN/COMMIT with fail-fast lock/statement
--     timeouts and a dependency + advisory-lock preflight.
--   * 7 new tables, all RLS enabled + forced, service-role only.
--   * 6 automations seeded DISABLED; control state seeded fully PAUSED.
--   * NO recipients inserted, NO customers activated, NO contacts imported.
--   * NO triggers, NO email, NO sending/discovery/leasing capability.
--   * NO CREATE EXTENSION, NO ALTER of any existing table.
-- ============================================================================
