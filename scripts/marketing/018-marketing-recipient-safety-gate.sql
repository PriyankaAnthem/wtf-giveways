-- ============================================================================
-- WTF Marketing Hub — Stage 3D1: DETERMINISTIC RECIPIENT SAFETY GATE
-- ----------------------------------------------------------------------------
-- MIGRATION 018
--
-- PURPOSE
--   Install READ-ONLY, fully deterministic recipient-gate infrastructure that
--   answers, for every discovered opportunity, TWO independent questions:
--
--       gate_eligible  — does this opportunity pass EVERY deterministic safety
--                         gate (identity, profile, account/email, consent,
--                         lifecycle, definition, campaign, duplicate, frequency)
--                         AND win next-best-action arbitration for its user?
--       sendable_now    — gate_eligible AND global sending is currently enabled.
--
--   CORE RULE:
--       COMMERCIAL OPPORTUNITY != PERMISSION TO CONTACT != CURRENT SENDABILITY
--   AI never influences any gate. Every decision here is pure deterministic SQL.
--
-- WHAT THIS MIGRATION INSTALLS (functions only; NO data materialisation)
--   Part 0  Idempotent privilege convergence: re-apply the four explicit REVOKEs
--           on the Stage 017 trigger function (production drift already hardened;
--           this makes fresh environments converge). The trigger is NOT changed.
--   Part A  public.wtf_marketing_recipient_gate_preview()  — PRIVATE owner-only
--           canonical gate (revoked from PUBLIC/anon/authenticated/service_role).
--   Part B  public.get_admin_marketing_recipient_gate_overview() — service-role
--           aggregate JSON overview (no identities).
--   Part C  public.get_admin_marketing_recipient_gate_sample(integer) — service-
--           role anonymised QA sample (safe fields only, limit clamped 1..100).
--
-- WHAT THIS MIGRATION MUST NOT DO
--   No recipients created. No opportunity state change. No runs. No sends. No
--   enabling of sending/discovery/definitions. No rollout/frequency-cap change.
--   No external-contact sending. No materialisation. No cron. No AI. No schema
--   change to any table. No change to Stage 017 linkage. Migrations 001-017 are
--   untouched. RLS/policies untouched.
--
-- PRODUCTION SAFETY
--   Single transaction; SET LOCAL lock_timeout so we FAIL rather than block a
--   busy database. Read-only preflight (advisory-locked) + post-install READ-ONLY
--   verification bracket the function installs. ANY failed assertion RAISEs and
--   rolls back the ENTIRE migration.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- PREFLIGHT — advisory lock + ALL read-only assertions BEFORE any change.
-- ============================================================================
DO $preflight$
DECLARE
  v_dep          text;
  v_missing      text[] := ARRAY[]::text[];
  v_id_type      text;

  v_sending      boolean;
  v_discovery    boolean;
  v_rollout      integer;
  v_enabled_defs bigint;

  v_opp_count    bigint;
  v_recip_count  bigint;
  v_runs_count   bigint;

  v_c_new        bigint;
  v_c_winner     bigint;
  v_c_highvalue  bigint;
  v_c_checkout   bigint;
  v_bad_types    bigint;

  -- Stage 017 linkage assertions.
  v_col_type     text;
  v_col_notnull  boolean;
  v_fk_deltype   "char";
  v_fk_valid     boolean;
  v_fk_target    text;
  v_fk_refcol    text;
  v_idx_unique   boolean;
  v_idx_def      text;
  v_trg_enabled  "char";
BEGIN
  -- Migration-specific advisory lock (transaction-scoped).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3d1_recipient_safety_gate')) THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 1. Required tables must exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_recipients',
    'public.marketing_opportunities',
    'public.marketing_opportunity_definitions',
    'public.marketing_control_state',
    'public.customer_marketing_profiles',
    'public.marketing_automation_runs',
    'public.campaigns'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: required table % is missing.', array_to_string(v_missing, ', ');
  END IF;

  -- 2. Required functions must exist (exact signatures).
  IF to_regprocedure('public.is_marketing_email_eligible(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: public.is_marketing_email_eligible(uuid, text) is missing.';
  END IF;
  IF to_regprocedure('public.marketing_recipients_guard_opportunity_link()') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 trigger function marketing_recipients_guard_opportunity_link() is missing.';
  END IF;

  -- 3. Stage 017 linkage: opportunity_id column uuid nullable.
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
    INTO v_col_type, v_col_notnull
    FROM pg_attribute a
   WHERE a.attrelid = 'public.marketing_recipients'::regclass
     AND a.attname = 'opportunity_id'
     AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 marketing_recipients.opportunity_id column is missing.';
  END IF;
  IF v_col_type IS DISTINCT FROM 'uuid' OR v_col_notnull IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: opportunity_id must be uuid nullable (got %, notnull=%).', v_col_type, v_col_notnull;
  END IF;

  -- 4. Stage 017 FK: validated, -> marketing_opportunities(id), ON DELETE RESTRICT.
  SELECT c.confdeltype, c.convalidated, c.confrelid::regclass::text,
         (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1])
    INTO v_fk_deltype, v_fk_valid, v_fk_target, v_fk_refcol
    FROM pg_constraint c
   WHERE c.conname = 'marketing_recipients_opportunity_fk'
     AND c.conrelid = 'public.marketing_recipients'::regclass
     AND c.contype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 FK marketing_recipients_opportunity_fk is missing.';
  END IF;
  IF v_fk_target IS DISTINCT FROM 'marketing_opportunities' OR v_fk_refcol IS DISTINCT FROM 'id'
     OR v_fk_deltype <> 'r' OR v_fk_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 FK not as expected (target %.%, ondelete %, validated %).',
      v_fk_target, v_fk_refcol, v_fk_deltype, v_fk_valid;
  END IF;

  -- 5. Stage 017 unique partial index on opportunity_id.
  SELECT i.indisunique, pg_get_indexdef(i.indexrelid)
    INTO v_idx_unique, v_idx_def
    FROM pg_index i
    JOIN pg_class cl ON cl.oid = i.indexrelid
   WHERE cl.relname = 'marketing_recipients_opportunity_unique_idx';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 unique index marketing_recipients_opportunity_unique_idx is missing.';
  END IF;
  IF v_idx_unique IS DISTINCT FROM true OR position('opportunity_id IS NOT NULL' IN v_idx_def) = 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 opportunity index is not the expected unique partial index.';
  END IF;

  -- 6. Stage 017 immutability trigger exists and is enabled.
  SELECT t.tgenabled
    INTO v_trg_enabled
    FROM pg_trigger t
   WHERE t.tgname = 'marketing_recipients_opportunity_link_immutable_trg'
     AND t.tgrelid = 'public.marketing_recipients'::regclass
     AND NOT t.tgisinternal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 immutability trigger is missing.';
  END IF;
  IF v_trg_enabled = 'D' THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Stage 017 immutability trigger is disabled.';
  END IF;

  -- 7. Marketing fully paused.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: Marketing not paused (sending=%, discovery=%, rollout=%).',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- 8. Zero enabled definitions.
  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: % definition(s) enabled; expected 0.', v_enabled_defs;
  END IF;

  -- 9. Ledger exactly six with exact distribution; no other types.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 6 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: marketing_opportunities holds % row(s); expected 6.', v_opp_count;
  END IF;
  SELECT count(*) FILTER (WHERE opportunity_type = 'new_account_no_purchase'),
         count(*) FILTER (WHERE opportunity_type = 'recent_winner_credit_available'),
         count(*) FILTER (WHERE opportunity_type = 'high_value_customer_at_risk'),
         count(*) FILTER (WHERE opportunity_type = 'abandoned_checkout'),
         count(*) FILTER (WHERE opportunity_type NOT IN (
           'new_account_no_purchase', 'recent_winner_credit_available',
           'high_value_customer_at_risk', 'abandoned_checkout'))
    INTO v_c_new, v_c_winner, v_c_highvalue, v_c_checkout, v_bad_types
    FROM public.marketing_opportunities;
  IF v_c_new <> 1 OR v_c_winner <> 2 OR v_c_highvalue <> 2 OR v_c_checkout <> 1 OR v_bad_types <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: unexpected distribution (new=%, winner=%, highValue=%, checkout=%, other=%).',
      v_c_new, v_c_winner, v_c_highvalue, v_c_checkout, v_bad_types;
  END IF;

  -- 10. Controlled-install invariants: zero recipients and zero runs.
  SELECT count(*) INTO v_recip_count FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_count  FROM public.marketing_automation_runs;
  IF v_recip_count <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: marketing_recipients holds % row(s); expected 0 for controlled install.', v_recip_count;
  END IF;
  IF v_runs_count <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: marketing_automation_runs holds % row(s); expected 0 for controlled install.', v_runs_count;
  END IF;
END
$preflight$;

-- Capture baseline counts (verified unchanged post-install). Dropped at COMMIT.
CREATE TEMP TABLE tmp_marketing_3d1_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.marketing_recipients)      AS recipients_before,
  (SELECT count(*) FROM public.marketing_automation_runs) AS runs_before,
  (SELECT count(*) FROM public.marketing_opportunities)   AS opportunities_before;

-- ============================================================================
-- PART 0 — IDEMPOTENT PRIVILEGE CONVERGENCE (Stage 017 trigger-function drift).
--   The LIVE database was hardened manually after 017. Re-apply the four
--   explicit REVOKEs so fresh environments converge to the same state. This is
--   NOT a new feature and the trigger itself is untouched.
-- ============================================================================
REVOKE ALL ON FUNCTION public.marketing_recipients_guard_opportunity_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketing_recipients_guard_opportunity_link() FROM anon;
REVOKE ALL ON FUNCTION public.marketing_recipients_guard_opportunity_link() FROM authenticated;
REVOKE ALL ON FUNCTION public.marketing_recipients_guard_opportunity_link() FROM service_role;

DO $verify_trigger_revokes$
BEGIN
  IF has_function_privilege('anon', 'public.marketing_recipients_guard_opportunity_link()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.marketing_recipients_guard_opportunity_link()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.marketing_recipients_guard_opportunity_link()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D1 (018) aborted: trigger-function EXECUTE still granted to an application role after REVOKE.';
  END IF;
END
$verify_trigger_revokes$;

-- ============================================================================
-- PART A — PRIVATE CANONICAL RECIPIENT GATE (owner-only).
--   Pure set-based deterministic SQL. One row per opportunity. May expose
--   internal identity (opportunity_id/user_id/email_lc/campaign_id) because
--   future OWNER-executed materialisation needs it. Application roles CANNOT
--   invoke it — only the SECURITY DEFINER admin RPCs (running as owner) do.
--
--   Determinism notes:
--     * Every source boolean is COALESCE'd so a missing profile/definition/
--       campaign fails CLOSED, never NULL-passes.
--     * Authoritative consent is is_marketing_email_eligible(user_id, email_lc);
--       the cached marketing_eligible_snapshot is DIAGNOSTIC ONLY and never
--       contributes to eligibility.
--     * NBA arbitration ranks ONLY pre-NBA survivors (ineligible rows sort last
--       via the leading (NOT pre_nba_gate_eligible) key and are never ranked).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wtf_marketing_recipient_gate_preview()
RETURNS TABLE (
  opportunity_id                 uuid,
  user_id                        uuid,
  email_lc                       text,
  opportunity_type               text,
  campaign_id                    uuid,
  state                          text,
  base_priority                  integer,
  score                          numeric,
  detected_at                    timestamptz,
  expires_at                     timestamptz,
  profile_matched                boolean,
  account_active                 boolean,
  email_confirmed                boolean,
  marketing_enabled              boolean,
  has_active_suppression         boolean,
  marketing_eligible_snapshot    boolean,
  authoritative_marketing_eligible boolean,
  definition_exists              boolean,
  definition_enabled             boolean,
  campaign_specific              boolean,
  campaign_context_valid         boolean,
  existing_recipient             boolean,
  sends_last_24h                 bigint,
  sends_last_7d                  bigint,
  daily_frequency_limit          integer,
  weekly_frequency_limit         integer,
  frequency_config_valid         boolean,
  frequency_eligible             boolean,
  pre_nba_gate_eligible          boolean,
  next_best_rank                 bigint,
  gate_eligible                  boolean,
  global_sending_enabled         boolean,
  sendable_now                   boolean,
  blocker_reasons                text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $gate$
WITH cs AS (
  -- Guaranteed EXACTLY-ONE-ROW singleton. A FROM-less SELECT of scalar
  -- subqueries always yields one row: if the control singleton (key='default')
  -- is absent, every column is NULL rather than the CTE being empty. This is
  -- deliberate so the later CROSS JOIN cs can NEVER annihilate opportunities —
  -- each opportunity stays represented and fails CLOSED (NULL sending -> false;
  -- NULL frequency limits -> frequency_config_valid = false).
  SELECT
    (SELECT mcs.sending_enabled            FROM public.marketing_control_state mcs WHERE mcs.key = 'default') AS sending_enabled,
    (SELECT mcs.maximum_daily_per_contact  FROM public.marketing_control_state mcs WHERE mcs.key = 'default') AS maximum_daily_per_contact,
    (SELECT mcs.maximum_weekly_per_contact FROM public.marketing_control_state mcs WHERE mcs.key = 'default') AS maximum_weekly_per_contact
),
freq AS (
  -- A send consumes frequency the moment sent_at is recorded — never
  -- delivered_at/clicked_at/bounced_at/complained_at, never status alone.
  SELECT r.user_id,
         count(*) FILTER (WHERE r.sent_at > now() - interval '24 hours') AS s24,
         count(*) FILTER (WHERE r.sent_at > now() - interval '7 days')   AS s7
    FROM public.marketing_recipients r
   WHERE r.sent_at IS NOT NULL
     AND r.user_id IS NOT NULL
   GROUP BY r.user_id
),
base AS (
  SELECT
    o.id                                   AS opportunity_id,
    o.user_id                              AS user_id,
    p.email_lc                             AS email_lc,
    o.opportunity_type                     AS opportunity_type,
    o.campaign_id                          AS campaign_id,
    o.state                                AS state,
    o.base_priority                        AS base_priority,
    o.score                                AS score,
    o.detected_at                          AS detected_at,
    o.expires_at                           AS expires_at,
    (o.user_id IS NOT NULL AND o.external_contact_id IS NULL) AS is_user_identity,
    (p.user_id IS NOT NULL)                AS profile_matched,
    p.account_active                       AS account_active,
    p.email_confirmed                      AS email_confirmed,
    p.marketing_enabled                    AS marketing_enabled,
    p.has_active_suppression               AS has_active_suppression,
    p.marketing_eligible_snapshot          AS marketing_eligible_snapshot,
    -- Authoritative consent: only evaluated for a matched USER identity; else
    -- fails closed to false. Computed exactly once per row.
    COALESCE(
      CASE
        WHEN o.user_id IS NOT NULL AND o.external_contact_id IS NULL AND p.user_id IS NOT NULL
          THEN public.is_marketing_email_eligible(o.user_id, p.email_lc)
        ELSE false
      END, false)                          AS authoritative_marketing_eligible,
    (d.opportunity_key IS NOT NULL)        AS definition_exists,
    COALESCE(d.enabled, false)             AS definition_enabled,
    COALESCE(d.campaign_specific, false)   AS campaign_specific,
    (c.id IS NOT NULL)                     AS campaign_row_exists,
    (c.status = 'live' AND (c.end_at IS NULL OR c.end_at > now())) AS campaign_live,
    EXISTS (
      SELECT 1 FROM public.marketing_recipients r2 WHERE r2.opportunity_id = o.id
    )                                      AS existing_recipient,
    COALESCE(f.s24, 0)                     AS sends_last_24h,
    COALESCE(f.s7, 0)                      AS sends_last_7d,
    cs.sending_enabled                     AS global_sending_enabled,
    cs.maximum_daily_per_contact           AS daily_frequency_limit,
    cs.maximum_weekly_per_contact          AS weekly_frequency_limit
  FROM public.marketing_opportunities o
  LEFT JOIN public.customer_marketing_profiles p     ON p.user_id = o.user_id
  LEFT JOIN public.marketing_opportunity_definitions d ON d.opportunity_key = o.opportunity_type
  LEFT JOIN public.campaigns c                       ON c.id = o.campaign_id
  LEFT JOIN freq f                                   ON f.user_id = o.user_id
  CROSS JOIN cs
),
flags AS (
  SELECT
    b.*,
    (b.email_lc IS NOT NULL AND btrim(b.email_lc) <> '') AS email_present,
    -- Campaign context: fails closed unless the definition exists and the
    -- campaign shape exactly matches the definition's campaign_specific flag.
    CASE
      WHEN NOT b.definition_exists THEN false
      WHEN b.campaign_specific THEN (b.campaign_id IS NOT NULL AND b.campaign_row_exists AND b.campaign_live)
      ELSE (b.campaign_id IS NULL)
    END AS campaign_context_valid,
    -- Frequency config must be present and strictly positive, else fail closed.
    (b.daily_frequency_limit IS NOT NULL AND b.weekly_frequency_limit IS NOT NULL
       AND b.daily_frequency_limit > 0 AND b.weekly_frequency_limit > 0) AS frequency_config_valid
  FROM base b
),
computed AS (
  SELECT
    f.*,
    (f.frequency_config_valid
       AND f.sends_last_24h < f.daily_frequency_limit
       AND f.sends_last_7d  < f.weekly_frequency_limit) AS frequency_eligible,
    (
      f.is_user_identity
      AND f.profile_matched
      AND COALESCE(f.account_active, false)
      AND COALESCE(f.email_confirmed, false)
      AND (f.email_lc IS NOT NULL AND btrim(f.email_lc) <> '')
      AND COALESCE(f.marketing_enabled, false)
      AND NOT COALESCE(f.has_active_suppression, false)
      AND f.authoritative_marketing_eligible
      AND f.state = 'open'
      AND f.expires_at > now()
      AND f.definition_exists
      AND f.definition_enabled
      AND f.campaign_context_valid
      AND NOT f.existing_recipient
      AND (f.frequency_config_valid
             AND f.sends_last_24h < f.daily_frequency_limit
             AND f.sends_last_7d  < f.weekly_frequency_limit)
    ) AS pre_nba_gate_eligible
  FROM flags f
),
ranked AS (
  SELECT
    c.*,
    CASE
      WHEN c.pre_nba_gate_eligible
        THEN row_number() OVER (
               PARTITION BY c.user_id
               ORDER BY (NOT c.pre_nba_gate_eligible),  -- survivors (false) first
                        c.base_priority ASC,
                        c.score DESC NULLS LAST,
                        c.detected_at DESC,
                        c.opportunity_id ASC
             )
      ELSE NULL
    END AS next_best_rank
  FROM computed c
)
SELECT
  r.opportunity_id,
  r.user_id,
  r.email_lc,
  r.opportunity_type,
  r.campaign_id,
  r.state,
  r.base_priority,
  r.score,
  r.detected_at,
  r.expires_at,
  r.profile_matched,
  r.account_active,
  r.email_confirmed,
  r.marketing_enabled,
  r.has_active_suppression,
  r.marketing_eligible_snapshot,
  r.authoritative_marketing_eligible,
  r.definition_exists,
  r.definition_enabled,
  r.campaign_specific,
  r.campaign_context_valid,
  r.existing_recipient,
  r.sends_last_24h,
  r.sends_last_7d,
  r.daily_frequency_limit,
  r.weekly_frequency_limit,
  r.frequency_config_valid,
  r.frequency_eligible,
  r.pre_nba_gate_eligible,
  r.next_best_rank,
  (r.pre_nba_gate_eligible AND r.next_best_rank = 1)                          AS gate_eligible,
  COALESCE(r.global_sending_enabled, false)                                   AS global_sending_enabled,
  (r.pre_nba_gate_eligible AND r.next_best_rank = 1 AND COALESCE(r.global_sending_enabled, false)) AS sendable_now,
  -- Deterministic, PII-free blocker codes in fixed gate order.
  (ARRAY[]::text[]
    || CASE WHEN NOT r.is_user_identity                                 THEN ARRAY['external_contact_not_supported'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT r.profile_matched                                  THEN ARRAY['profile_unmatched'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.profile_matched AND NOT COALESCE(r.account_active, false)   THEN ARRAY['account_inactive'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.profile_matched AND NOT COALESCE(r.email_confirmed, false)  THEN ARRAY['email_unconfirmed'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.profile_matched AND NOT r.email_present              THEN ARRAY['email_missing'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.profile_matched AND NOT COALESCE(r.marketing_enabled, false) THEN ARRAY['marketing_disabled'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.profile_matched AND COALESCE(r.has_active_suppression, false) THEN ARRAY['active_suppression'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.is_user_identity AND r.profile_matched AND NOT r.authoritative_marketing_eligible THEN ARRAY['authoritative_marketing_ineligible'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.state <> 'open'                                      THEN ARRAY['opportunity_not_open'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.expires_at <= now()                                  THEN ARRAY['opportunity_expired'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT r.definition_exists                                THEN ARRAY['definition_missing'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.definition_exists AND NOT r.definition_enabled       THEN ARRAY['definition_disabled'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.definition_exists AND NOT r.campaign_context_valid   THEN ARRAY['campaign_context_invalid'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.existing_recipient                                   THEN ARRAY['existing_recipient'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT r.frequency_config_valid                           THEN ARRAY['frequency_configuration_invalid'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.frequency_config_valid AND r.sends_last_24h >= r.daily_frequency_limit  THEN ARRAY['daily_frequency_cap'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.frequency_config_valid AND r.sends_last_7d  >= r.weekly_frequency_limit THEN ARRAY['weekly_frequency_cap'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.pre_nba_gate_eligible AND r.next_best_rank IS DISTINCT FROM 1 THEN ARRAY['not_next_best_action'] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT COALESCE(r.global_sending_enabled, false)          THEN ARRAY['global_sending_disabled'] ELSE ARRAY[]::text[] END
  ) AS blocker_reasons
FROM ranked r
$gate$;

COMMENT ON FUNCTION public.wtf_marketing_recipient_gate_preview() IS
  'Stage 3D1 PRIVATE canonical deterministic recipient gate (owner-only; EXECUTE revoked from PUBLIC/anon/authenticated/service_role). One row per opportunity with every gate signal, NBA rank, gate_eligible and sendable_now. Read-only; AI never influences any gate. Cached marketing_eligible_snapshot is diagnostic only — authoritative consent is is_marketing_email_eligible. Internal infrastructure for future owner-executed materialisation; NOT for direct application use.';

-- PRIVATE: revoke direct EXECUTE from every role, including service_role.
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM anon;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM authenticated;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM service_role;

-- ============================================================================
-- PART B — ADMIN AGGREGATE OVERVIEW (service-role only, no identities).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_recipient_gate_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $overview$
  WITH g AS (
    SELECT * FROM public.wtf_marketing_recipient_gate_preview()
  ),
  cs AS (
    SELECT sending_enabled, discovery_enabled, rollout_limit,
           maximum_daily_per_contact, maximum_weekly_per_contact
      FROM public.marketing_control_state
     WHERE key = 'default'
  ),
  reasons AS (
    SELECT code, count(*)::bigint AS cnt
      FROM (SELECT unnest(g.blocker_reasons) AS code FROM g) x
     GROUP BY code
  ),
  by_type AS (
    SELECT g.opportunity_type AS t,
           jsonb_build_object(
             'total',                count(*)::bigint,
             'authoritativeEligible',count(*) FILTER (WHERE g.authoritative_marketing_eligible)::bigint,
             'definitionEnabled',    count(*) FILTER (WHERE g.definition_enabled)::bigint,
             'campaignContextValid', count(*) FILTER (WHERE g.campaign_context_valid)::bigint,
             'noExistingRecipient',  count(*) FILTER (WHERE NOT g.existing_recipient)::bigint,
             'frequencyEligible',    count(*) FILTER (WHERE g.frequency_eligible)::bigint,
             'gateEligible',         count(*) FILTER (WHERE g.gate_eligible)::bigint,
             'sendableNow',          count(*) FILTER (WHERE g.sendable_now)::bigint
           ) AS payload
      FROM g
     GROUP BY g.opportunity_type
  )
  SELECT jsonb_build_object(
    'generatedAt', now(),
    'controlState', jsonb_build_object(
      'sendingEnabled',         (SELECT sending_enabled FROM cs),
      'discoveryEnabled',       (SELECT discovery_enabled FROM cs),
      'rolloutLimit',           (SELECT rollout_limit FROM cs),
      'maximumDailyPerContact', (SELECT maximum_daily_per_contact FROM cs),
      'maximumWeeklyPerContact',(SELECT maximum_weekly_per_contact FROM cs)
    ),
    'ledger', jsonb_build_object(
      'totalOpportunities',          (SELECT count(*)::bigint FROM g),
      'userIdentityOpportunities',   (SELECT count(*) FILTER (WHERE user_id IS NOT NULL)::bigint FROM g),
      'externalIdentityOpportunities',(SELECT count(*) FILTER (WHERE user_id IS NULL)::bigint FROM g)
    ),
    'profilePermission', jsonb_build_object(
      'profileMatched',           (SELECT count(*) FILTER (WHERE profile_matched)::bigint FROM g),
      'accountActive',            (SELECT count(*) FILTER (WHERE account_active)::bigint FROM g),
      'emailConfirmed',           (SELECT count(*) FILTER (WHERE email_confirmed)::bigint FROM g),
      'marketingEnabled',         (SELECT count(*) FILTER (WHERE marketing_enabled)::bigint FROM g),
      'activeSuppression',        (SELECT count(*) FILTER (WHERE has_active_suppression)::bigint FROM g),
      'marketingSnapshotEligible',(SELECT count(*) FILTER (WHERE marketing_eligible_snapshot)::bigint FROM g),
      'authoritativeEligible',    (SELECT count(*) FILTER (WHERE authoritative_marketing_eligible)::bigint FROM g)
    ),
    'opportunity', jsonb_build_object(
      'open',                 (SELECT count(*) FILTER (WHERE state = 'open')::bigint FROM g),
      'notExpired',           (SELECT count(*) FILTER (WHERE expires_at > now())::bigint FROM g),
      'definitionExists',     (SELECT count(*) FILTER (WHERE definition_exists)::bigint FROM g),
      'definitionEnabled',    (SELECT count(*) FILTER (WHERE definition_enabled)::bigint FROM g),
      'campaignContextValid', (SELECT count(*) FILTER (WHERE campaign_context_valid)::bigint FROM g),
      'noExistingRecipient',  (SELECT count(*) FILTER (WHERE NOT existing_recipient)::bigint FROM g)
    ),
    'frequency', jsonb_build_object(
      'underDailyCap',    (SELECT count(*) FILTER (WHERE frequency_config_valid AND sends_last_24h < daily_frequency_limit)::bigint FROM g),
      'underWeeklyCap',   (SELECT count(*) FILTER (WHERE frequency_config_valid AND sends_last_7d  < weekly_frequency_limit)::bigint FROM g),
      'frequencyEligible',(SELECT count(*) FILTER (WHERE frequency_eligible)::bigint FROM g)
    ),
    'arbitration', jsonb_build_object(
      'preNbaEligible',  (SELECT count(*) FILTER (WHERE pre_nba_gate_eligible)::bigint FROM g),
      'nextBestEligible',(SELECT count(*) FILTER (WHERE next_best_rank = 1)::bigint FROM g)
    ),
    'final', jsonb_build_object(
      'gateEligible', (SELECT count(*) FILTER (WHERE gate_eligible)::bigint FROM g),
      'sendableNow',  (SELECT count(*) FILTER (WHERE sendable_now)::bigint FROM g)
    ),
    'blockedByReason', COALESCE((SELECT jsonb_object_agg(code, cnt) FROM reasons), '{}'::jsonb),
    'byOpportunityType', COALESCE((SELECT jsonb_object_agg(t, payload) FROM by_type), '{}'::jsonb)
  )
$overview$;

COMMENT ON FUNCTION public.get_admin_marketing_recipient_gate_overview() IS
  'Stage 3D1 service-role aggregate overview of the deterministic recipient gate. Read-only, no identities. Calls the PRIVATE gate as owner. gateEligible is independent of sending_enabled; sendableNow additionally requires sending_enabled=true.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_overview() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_overview() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_recipient_gate_overview() TO service_role;

-- ============================================================================
-- PART C — ANONYMISED QA SAMPLE (service-role only, safe fields only).
--   customerHash = first 12 chars of md5(user identity). NO raw identifiers,
--   emails, campaign/opportunity/recipient ids, provider ids, dedupe keys, or
--   raw reason/context/payment data are ever exposed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_recipient_gate_sample(
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $sample$
  WITH bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) AS lim
  ),
  g AS (
    SELECT * FROM public.wtf_marketing_recipient_gate_preview()
  ),
  ordered AS (
    SELECT
      substr(md5(coalesce(g.user_id::text, 'ext:' || g.opportunity_id::text)), 1, 12) AS "customerHash",
      g.opportunity_type              AS "opportunityType",
      g.state                         AS "state",
      g.base_priority                 AS "basePriority",
      g.score                         AS "score",
      (g.campaign_id IS NOT NULL)     AS "campaignContext",
      g.profile_matched               AS "profileMatched",
      g.account_active                AS "accountActive",
      g.email_confirmed               AS "emailConfirmed",
      g.marketing_enabled             AS "marketingEnabled",
      g.has_active_suppression        AS "activeSuppression",
      g.marketing_eligible_snapshot   AS "marketingSnapshotEligible",
      g.authoritative_marketing_eligible AS "authoritativeEligible",
      g.definition_enabled            AS "definitionEnabled",
      g.campaign_context_valid        AS "campaignContextValid",
      g.existing_recipient            AS "existingRecipient",
      g.sends_last_24h                AS "sendsLast24h",
      g.sends_last_7d                 AS "sendsLast7d",
      g.daily_frequency_limit         AS "dailyFrequencyLimit",
      g.weekly_frequency_limit        AS "weeklyFrequencyLimit",
      g.frequency_eligible            AS "frequencyEligible",
      g.pre_nba_gate_eligible         AS "preNbaGateEligible",
      g.next_best_rank                AS "nextBestRank",
      g.gate_eligible                 AS "gateEligible",
      g.global_sending_enabled        AS "globalSendingEnabled",
      g.sendable_now                  AS "sendableNow",
      g.blocker_reasons               AS "blockerReasons"
    FROM g
    ORDER BY g.base_priority ASC,
             g.score DESC NULLS LAST,
             g.detected_at DESC,
             g.opportunity_id ASC
    LIMIT (SELECT lim FROM bounded)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb) FROM ordered
$sample$;

COMMENT ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) IS
  'Stage 3D1 service-role anonymised QA sample of the deterministic recipient gate (limit clamped 1..100, default 25). Read-only. Exposes only safe diagnostic fields plus a 12-char customerHash; never user_id/email/campaign/opportunity/recipient ids or raw reason/context/payment data.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) TO service_role;

-- ============================================================================
-- POST-INSTALL VERIFICATION — READ-ONLY; ANY failure rolls back everything.
-- ============================================================================
DO $postcheck$
DECLARE
  v_overview      jsonb;
  v_gate_eligible bigint;
  v_sendable_now  bigint;

  v_recip_now     bigint;
  v_runs_now      bigint;
  v_opp_now       bigint;
  v_recip_before  bigint;
  v_runs_before   bigint;
  v_opp_before    bigint;

  v_sending       boolean;
  v_discovery     boolean;
  v_rollout       integer;
  v_enabled_defs  bigint;
BEGIN
  -- Call ONLY the read-only admin overview RPC.
  v_overview := public.get_admin_marketing_recipient_gate_overview();

  v_gate_eligible := (v_overview #>> '{final,gateEligible}')::bigint;
  v_sendable_now  := (v_overview #>> '{final,sendableNow}')::bigint;

  -- Hard control/definition-state invariants (NOT consent counts).
  IF v_gate_eligible <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: gateEligible=% but MUST be 0 while all definitions are disabled.', v_gate_eligible;
  END IF;
  IF v_sendable_now <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: sendableNow=% but MUST be 0 while sending is disabled.', v_sendable_now;
  END IF;

  -- No data materialised; ledger and controls unchanged.
  SELECT recipients_before, runs_before, opportunities_before
    INTO v_recip_before, v_runs_before, v_opp_before
    FROM tmp_marketing_3d1_baseline;

  SELECT count(*) INTO v_recip_now FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_now  FROM public.marketing_automation_runs;
  SELECT count(*) INTO v_opp_now   FROM public.marketing_opportunities;

  IF v_recip_now <> 0 OR v_recip_now <> v_recip_before THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: recipient count changed (% -> %); expected 0.', v_recip_before, v_recip_now;
  END IF;
  IF v_runs_now <> 0 OR v_runs_now <> v_runs_before THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: run count changed (% -> %); expected 0.', v_runs_before, v_runs_now;
  END IF;
  IF v_opp_now <> 6 OR v_opp_now <> v_opp_before THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: opportunity count is % (before %); expected 6 unchanged.', v_opp_now, v_opp_before;
  END IF;

  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: control state changed (sending=%, discovery=%, rollout=%).',
      v_sending, v_discovery, v_rollout;
  END IF;

  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: % definition(s) enabled; expected 0.', v_enabled_defs;
  END IF;

  -- Privilege verification: PRIVATE gate direct EXECUTE denied to every role.
  IF has_function_privilege('anon', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: PRIVATE gate EXECUTE is granted to an application role.';
  END IF;

  -- Admin overview: service_role only.
  IF NOT has_function_privilege('service_role', 'public.get_admin_marketing_recipient_gate_overview()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_admin_marketing_recipient_gate_overview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_admin_marketing_recipient_gate_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: admin overview privileges are not service-role-only.';
  END IF;

  -- Admin sample: service_role only.
  IF NOT has_function_privilege('service_role', 'public.get_admin_marketing_recipient_gate_sample(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_admin_marketing_recipient_gate_sample(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_admin_marketing_recipient_gate_sample(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: admin sample privileges are not service-role-only.';
  END IF;

  -- Trigger-function EXECUTE still denied (Part 0 convergence held).
  IF has_function_privilege('anon', 'public.marketing_recipients_guard_opportunity_link()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.marketing_recipients_guard_opportunity_link()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.marketing_recipients_guard_opportunity_link()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D1 (018) verify aborted: trigger-function EXECUTE granted to an application role.';
  END IF;
END
$postcheck$;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * Three functions installed: PRIVATE gate (owner-only) + two service-role
--     admin RPCs (overview + anonymised sample).
--   * Stage 017 trigger-function REVOKEs re-applied idempotently; trigger and
--     all table schemas/RLS unchanged.
--   * READ-ONLY: no recipients/runs created, no opportunity state changed, no
--     control/definition mutation, no sends, no cron, no AI.
--   * With all definitions disabled, gateEligible = 0; with sending disabled,
--     sendableNow = 0 (both asserted post-install).
--   * Migrations 001-017 untouched.
-- ============================================================================
