-- ============================================================================
-- WTF Marketing Hub — Stage 3D2A: AUTHORITATIVE DELIVERY AUTOMATION ROUTING
-- ----------------------------------------------------------------------------
-- MIGRATION 019
--
-- PURPOSE
--   Establish the DURABLE, authoritative recipient-delivery routing contract so
--   a future recipient-materialisation stage (020) can resolve the mandatory
--   marketing_automation_runs.automation_id from an opportunity WITHOUT inventing
--   values or weakening constraints. The route lives on the catalogue that owns
--   opportunity_type — public.marketing_opportunity_definitions — NOT on
--   marketing_opportunities.automation_id (which remains optional provenance
--   exactly as migration 009 designed it).
--
--   This migration also upgrades the Stage 018 canonical recipient gate so that
--   delivery-route readiness becomes part of gate eligibility: an opportunity can
--   never become gate_eligible unless its definition has an authoritative, usable
--   delivery automation (mapped AND that automation is enabled).
--
-- WHAT THIS MIGRATION INSTALLS
--   Schema 1  ADD nullable column marketing_opportunity_definitions.delivery_automation_id
--             (uuid, NO default) + FK -> marketing_automations(id) ON DELETE
--             RESTRICT (NOT VALID then VALIDATE) + COMMENT.
--   Schema 2  BACKFILL delivery_automation_id for EXACTLY the six legacy
--             definition keys, by EXACT key equality to the genuine existing
--             automation row. No other definition mapped. No automation created.
--   Schema 3  CHECK constraint (NOT enabled OR delivery_automation_id IS NOT NULL)
--             (NOT VALID then VALIDATE) so an unmapped definition can never be
--             enabled. delivery_automation_id is NOT made UNIQUE (many
--             definitions may legitimately share one automation later).
--   Gate      REPLACE the three Stage 018 functions (private gate + admin
--             overview + admin sample) as a faithful SUPERSET adding delivery-
--             route readiness. Because the private gate's RETURNS TABLE contract
--             changes (new delivery_automation_id + routing columns), the stack
--             is DROPped (wrappers first, private gate last; NO CASCADE) and
--             recreated inside this same transaction — PostgreSQL cannot
--             CREATE OR REPLACE a function while changing its OUT columns.
--             Migration 018 itself is NOT modified.
--
-- WHAT THIS MIGRATION MUST NOT DO
--   No automation rows created. No placeholder/fake automations. No templates.
--   No content fabricated. No automation config changed. No automation enabled.
--   No opportunity definition enabled. No update to marketing_opportunities
--   (including its automation_id provenance). No recipients/runs/opportunities
--   created. No opportunity marked selected/actioned. No email. No Resend/provider
--   call. No change to sending/discovery/rollout/frequency caps. No external-
--   contact support. No materialisation. No AI. No cron. No checkout/payments/
--   tickets/wallet/customer-facing code. No change to migrations 001-018. No
--   change to any table RLS/policies.
--
-- PRODUCTION SAFETY
--   Single transaction; SET LOCAL lock_timeout so we FAIL rather than block a
--   busy database. Nullable ADD COLUMN with NO default (no table rewrite). FK and
--   CHECK added NOT VALID then VALIDATE'd. Only six definition rows updated. No
--   operational/checkout tables scanned. Read-only advisory-locked preflight and
--   post-install verification bracket the changes. ANY failed assertion RAISEs and
--   rolls back the ENTIRE migration.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase SQL
--   editor (or psql), AFTER migration 018, while Marketing is paused.
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

  v_col_exists   boolean;

  v_def_total    bigint;
  v_def_enabled  bigint;

  v_auto_total   bigint;
  v_auto_legacy  bigint;

  v_opp_count    bigint;
  v_c_checkout   bigint;
  v_c_new        bigint;
  v_c_highvalue  bigint;
  v_c_winner     bigint;
  v_bad_types    bigint;

  v_recip_count  bigint;
  v_runs_count   bigint;

  v_sending      boolean;
  v_discovery    boolean;
  v_rollout      integer;
BEGIN
  -- Migration-specific advisory lock (transaction-scoped).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3d2a_delivery_routing')) THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 1. Required tables must exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_automations',
    'public.marketing_opportunity_definitions',
    'public.marketing_opportunities',
    'public.marketing_automation_runs',
    'public.marketing_recipients',
    'public.marketing_control_state',
    'public.customer_marketing_profiles',
    'public.campaigns'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: required table % is missing.', array_to_string(v_missing, ', ');
  END IF;

  -- 2. Stage 018 functions must exist (exact signatures).
  IF to_regprocedure('public.wtf_marketing_recipient_gate_preview()') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: Stage 018 private gate wtf_marketing_recipient_gate_preview() is missing.';
  END IF;
  IF to_regprocedure('public.get_admin_marketing_recipient_gate_overview()') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: Stage 018 get_admin_marketing_recipient_gate_overview() is missing.';
  END IF;
  IF to_regprocedure('public.get_admin_marketing_recipient_gate_sample(integer)') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: Stage 018 get_admin_marketing_recipient_gate_sample(integer) is missing.';
  END IF;

  -- 3. Stage 018 private gate must be inaccessible directly to application roles.
  IF has_function_privilege('anon', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: Stage 018 PRIVATE gate is directly executable by an application role.';
  END IF;

  -- 4. delivery_automation_id must NOT already exist.
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.marketing_opportunity_definitions'::regclass
       AND attname = 'delivery_automation_id'
       AND NOT attisdropped
  ) INTO v_col_exists;
  IF v_col_exists THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: column marketing_opportunity_definitions.delivery_automation_id already exists.';
  END IF;

  -- 5. Definitions catalogue: exactly 28 rows, 0 enabled.
  SELECT count(*), count(*) FILTER (WHERE enabled)
    INTO v_def_total, v_def_enabled
    FROM public.marketing_opportunity_definitions;
  IF v_def_total <> 28 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: marketing_opportunity_definitions has % row(s); expected 28.', v_def_total;
  END IF;
  IF v_def_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: % definition(s) enabled; expected 0.', v_def_enabled;
  END IF;

  -- 6. Automations: the six genuine legacy rows must all be present by exact key.
  SELECT count(*) INTO v_auto_total FROM public.marketing_automations;
  SELECT count(*) INTO v_auto_legacy
    FROM public.marketing_automations
   WHERE automation_key IN (
     'vip_early_access', 'abandoned_checkout', 'wtf_credit_waiting',
     'regular_buyer_campaign_alert', 'new_account_no_purchase', 'lapsed_14_days'
   );
  IF v_auto_legacy <> 6 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: expected all six legacy automation rows present by exact key; found %.', v_auto_legacy;
  END IF;

  -- 7. Opportunity ledger: exactly six, exact distribution, no other types.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 6 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: marketing_opportunities holds % row(s); expected 6.', v_opp_count;
  END IF;
  SELECT count(*) FILTER (WHERE opportunity_type = 'abandoned_checkout'),
         count(*) FILTER (WHERE opportunity_type = 'new_account_no_purchase'),
         count(*) FILTER (WHERE opportunity_type = 'high_value_customer_at_risk'),
         count(*) FILTER (WHERE opportunity_type = 'recent_winner_credit_available'),
         count(*) FILTER (WHERE opportunity_type NOT IN (
           'abandoned_checkout', 'new_account_no_purchase',
           'high_value_customer_at_risk', 'recent_winner_credit_available'))
    INTO v_c_checkout, v_c_new, v_c_highvalue, v_c_winner, v_bad_types
    FROM public.marketing_opportunities;
  IF v_c_checkout <> 1 OR v_c_new <> 1 OR v_c_highvalue <> 2 OR v_c_winner <> 2 OR v_bad_types <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: unexpected distribution (checkout=%, new=%, highValue=%, winner=%, other=%).',
      v_c_checkout, v_c_new, v_c_highvalue, v_c_winner, v_bad_types;
  END IF;

  -- 8. Controlled-install invariants: zero recipients and zero runs.
  SELECT count(*) INTO v_recip_count FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_count  FROM public.marketing_automation_runs;
  IF v_recip_count <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: marketing_recipients holds % row(s); expected 0.', v_recip_count;
  END IF;
  IF v_runs_count <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: marketing_automation_runs holds % row(s); expected 0.', v_runs_count;
  END IF;

  -- 9. Marketing fully paused.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: Marketing not paused (sending=%, discovery=%, rollout=%).',
      v_sending, v_discovery, v_rollout;
  END IF;
END
$preflight$;

-- ============================================================================
-- BASELINE CAPTURE — counts + deterministic checksum of the six opportunity
-- rows over their STABLE columns (no volatile now()/updated_at). Verified
-- unchanged post-install to prove opportunities are untouched. ON COMMIT DROP.
-- ============================================================================
CREATE TEMP TABLE tmp_marketing_3d2a_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.marketing_recipients)      AS recipients_before,
  (SELECT count(*) FROM public.marketing_automation_runs) AS runs_before,
  (SELECT count(*) FROM public.marketing_opportunities)   AS opportunities_before,
  (
    SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), ''))
      FROM (
        SELECT md5(
          coalesce(o.id::text, '')                  || '~' ||
          coalesce(o.user_id::text, '')             || '~' ||
          coalesce(o.external_contact_id::text, '') || '~' ||
          coalesce(o.opportunity_type, '')          || '~' ||
          coalesce(o.campaign_id::text, '')         || '~' ||
          coalesce(o.state, '')                     || '~' ||
          coalesce(o.base_priority::text, '')       || '~' ||
          coalesce(o.score::text, '')               || '~' ||
          coalesce(o.automation_id::text, '')       || '~' ||
          coalesce(o.detected_at::text, '')         || '~' ||
          coalesce(o.expires_at::text, '')
        ) AS row_sig
          FROM public.marketing_opportunities o
      ) s
  ) AS opportunities_checksum;

-- ============================================================================
-- SCHEMA CHANGE 1 — AUTHORITATIVE DELIVERY ROUTE COLUMN + FK.
--   Nullable, NO default (no table rewrite). FK ON DELETE RESTRICT so a routed
--   automation can never be deleted out from under a definition. FK added
--   NOT VALID then VALIDATE'd (safest production locking pattern).
-- ============================================================================
ALTER TABLE public.marketing_opportunity_definitions
  ADD COLUMN delivery_automation_id uuid;

ALTER TABLE public.marketing_opportunity_definitions
  ADD CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk
  FOREIGN KEY (delivery_automation_id)
  REFERENCES public.marketing_automations(id)
  ON DELETE RESTRICT
  NOT VALID;

COMMENT ON COLUMN public.marketing_opportunity_definitions.delivery_automation_id IS
  'Authoritative recipient-DELIVERY routing automation for this opportunity type. DISTINCT from marketing_opportunities.automation_id (which is optional discovery provenance only). Future recipient materialisation MUST resolve the run automation through this definition column, never through opportunity provenance. NULL means this definition has no delivery route and therefore CANNOT advance to recipient materialisation (and cannot be enabled, per the enabled-requires-route constraint). Not UNIQUE: many definitions may intentionally share one delivery automation.';

-- ============================================================================
-- SCHEMA CHANGE 2 — BACKFILL ONLY THE SIX AUTHORITATIVE LEGACY MATCHES.
--   Exact key equality (definition.opportunity_key = automation.automation_key)
--   restricted to the six legacy keys. No fuzzy/display-name matching. No other
--   definition is mapped. No automation row is created.
-- ============================================================================
UPDATE public.marketing_opportunity_definitions d
   SET delivery_automation_id = a.id,
       updated_at = now()
  FROM public.marketing_automations a
 WHERE d.opportunity_key = a.automation_key
   AND d.opportunity_key IN (
     'vip_early_access',
     'abandoned_checkout',
     'wtf_credit_waiting',
     'regular_buyer_campaign_alert',
     'new_account_no_purchase',
     'lapsed_14_days'
   );

-- Validate the FK now that the six routed rows hold genuine automation ids.
ALTER TABLE public.marketing_opportunity_definitions
  VALIDATE CONSTRAINT marketing_opportunity_definitions_delivery_automation_fk;

-- ============================================================================
-- SCHEMA CHANGE 3 — ENABLED DEFINITIONS MUST HAVE A DELIVERY ROUTE.
--   An unmapped definition can never be enabled. All definitions are currently
--   disabled, so the constraint is trivially satisfied and VALIDATE succeeds.
--   delivery_automation_id is deliberately NOT made UNIQUE.
-- ============================================================================
ALTER TABLE public.marketing_opportunity_definitions
  ADD CONSTRAINT marketing_opportunity_definitions_enabled_requires_route_chk
  CHECK (NOT enabled OR delivery_automation_id IS NOT NULL)
  NOT VALID;

ALTER TABLE public.marketing_opportunity_definitions
  VALIDATE CONSTRAINT marketing_opportunity_definitions_enabled_requires_route_chk;

-- ============================================================================
-- STAGE 018 GATE UPGRADE — TRANSACTIONAL FUNCTION REPLACEMENT.
--   The private gate's RETURNS TABLE contract CHANGES (new delivery-routing
--   columns), and PostgreSQL cannot CREATE OR REPLACE a function while altering
--   its OUT-column structure. We therefore DROP the exact Stage 018 stack and
--   recreate it, all inside this single transaction so there is never a
--   committed state where any function is missing.
--
--   Dependency-safe DROP order: the two admin wrappers (which SELECT * FROM the
--   private gate) FIRST, then the private gate LAST. NO "DROP ... CASCADE" is
--   used anywhere: if an unexpected live dependency blocks a DROP, the whole
--   migration RAISEs and rolls back rather than silently deleting unrelated
--   objects.
--
--   Guard: confirm the ONLY dependents of the private gate are exactly the two
--   known admin wrappers before dropping anything. Any other dependent aborts.
-- ============================================================================
DO $replace_guard$
DECLARE
  v_unexpected text;
BEGIN
  -- Enumerate functions that depend on the private gate via pg_depend, excluding
  -- the two wrappers we intend to drop and the private gate itself. Any row here
  -- means DROP would fail (or would require CASCADE) — we abort instead.
  SELECT string_agg(DISTINCT dependent.oid::regprocedure::text, ', ')
    INTO v_unexpected
    FROM pg_depend dep
    JOIN pg_proc dependent ON dependent.oid = dep.objid
   WHERE dep.refobjid = 'public.wtf_marketing_recipient_gate_preview()'::regprocedure
     AND dep.classid = 'pg_proc'::regclass
     AND dep.deptype IN ('n', 'a')
     AND dependent.oid <> 'public.wtf_marketing_recipient_gate_preview()'::regprocedure
     AND dependent.oid <> 'public.get_admin_marketing_recipient_gate_overview()'::regprocedure
     AND dependent.oid <> 'public.get_admin_marketing_recipient_gate_sample(integer)'::regprocedure;
  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2A (019) aborted: private gate has unexpected dependent function(s) [%]; refusing to DROP (no CASCADE).', v_unexpected;
  END IF;
END
$replace_guard$;

-- Drop the wrappers FIRST (they reference the private gate), then the gate.
-- Plain DROP (no CASCADE, no IF EXISTS — preflight already proved they exist):
-- any unexpected dependency makes these fail and roll back the transaction.
DROP FUNCTION public.get_admin_marketing_recipient_gate_sample(integer);
DROP FUNCTION public.get_admin_marketing_recipient_gate_overview();
DROP FUNCTION public.wtf_marketing_recipient_gate_preview();

-- ----------------------------------------------------------------------------
-- PART A — PRIVATE canonical gate (recreated), now including delivery-route
--   readiness AND the authoritative delivery_automation_id for Stage 020
--   materialisation. pre_nba_gate_eligible additionally requires
--   delivery_route_ready. delivery_route_ready = mapped AND routed automation
--   exists AND enabled. delivery_automation_id is INTERNAL-ONLY (never surfaced
--   through either admin RPC) and is sourced ONLY from the definition column.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.wtf_marketing_recipient_gate_preview()
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
  delivery_automation_id         uuid,
  delivery_automation_mapped     boolean,
  delivery_automation_enabled    boolean,
  delivery_route_ready           boolean,
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
    -- Delivery routing (Stage 3D2A): authoritative route from the DEFINITION.
    -- INTERNAL-ONLY id for Stage 020 run.automation_id; NEVER exposed by admin RPCs.
    -- Sourced ONLY from the definition column, never from opportunity provenance.
    d.delivery_automation_id               AS delivery_automation_id,
    (d.delivery_automation_id IS NOT NULL) AS delivery_automation_mapped,
    (da.id IS NOT NULL)                    AS delivery_automation_exists,
    COALESCE(da.enabled, false)            AS delivery_automation_enabled,
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
  LEFT JOIN public.customer_marketing_profiles p       ON p.user_id = o.user_id
  LEFT JOIN public.marketing_opportunity_definitions d ON d.opportunity_key = o.opportunity_type
  LEFT JOIN public.marketing_automations da            ON da.id = d.delivery_automation_id
  LEFT JOIN public.campaigns c                         ON c.id = o.campaign_id
  LEFT JOIN freq f                                     ON f.user_id = o.user_id
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
    -- Delivery route ready: mapped AND the routed automation exists AND enabled.
    -- Fails closed if unmapped, dangling, or the automation is disabled.
    (b.delivery_automation_mapped AND b.delivery_automation_exists AND b.delivery_automation_enabled) AS delivery_route_ready,
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
      AND f.delivery_route_ready
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
  r.delivery_automation_id,
  r.delivery_automation_mapped,
  r.delivery_automation_enabled,
  r.delivery_route_ready,
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
    || CASE WHEN r.definition_exists AND NOT r.delivery_automation_mapped THEN ARRAY['delivery_automation_unmapped'] ELSE ARRAY[]::text[] END
    || CASE WHEN r.delivery_automation_mapped AND NOT r.delivery_automation_enabled THEN ARRAY['delivery_automation_disabled'] ELSE ARRAY[]::text[] END
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
  'Stage 3D2A PRIVATE canonical deterministic recipient gate (owner-only; EXECUTE revoked from PUBLIC/anon/authenticated/service_role). Superset of Stage 018 adding delivery-route readiness: pre_nba_gate_eligible now additionally requires delivery_route_ready (definition mapped to a delivery automation that exists AND is enabled). Read-only; AI never influences any gate. Route resolves through marketing_opportunity_definitions.delivery_automation_id, never through opportunity provenance. Internal infrastructure for future owner-executed materialisation; NOT for direct application use.';

-- PRIVATE: re-apply revokes (CREATE OR REPLACE does not reset ACLs, but assume nothing).
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM anon;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM authenticated;
REVOKE ALL ON FUNCTION public.wtf_marketing_recipient_gate_preview() FROM service_role;

-- ============================================================================
-- PART B — ADMIN AGGREGATE OVERVIEW (service-role only, no identities).
--   Adds deliveryRouting aggregate + per-type deliveryRouteReady /
--   deliveryAutomationMapped. New safe routing blockers appear naturally in
--   blockedByReason via unnest.
-- ============================================================================
CREATE FUNCTION public.get_admin_marketing_recipient_gate_overview()
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
             'total',                   count(*)::bigint,
             'authoritativeEligible',   count(*) FILTER (WHERE g.authoritative_marketing_eligible)::bigint,
             'definitionEnabled',       count(*) FILTER (WHERE g.definition_enabled)::bigint,
             'campaignContextValid',    count(*) FILTER (WHERE g.campaign_context_valid)::bigint,
             'deliveryAutomationMapped',count(*) FILTER (WHERE g.delivery_automation_mapped)::bigint,
             'deliveryRouteReady',      count(*) FILTER (WHERE g.delivery_route_ready)::bigint,
             'noExistingRecipient',     count(*) FILTER (WHERE NOT g.existing_recipient)::bigint,
             'frequencyEligible',       count(*) FILTER (WHERE g.frequency_eligible)::bigint,
             'gateEligible',            count(*) FILTER (WHERE g.gate_eligible)::bigint,
             'sendableNow',             count(*) FILTER (WHERE g.sendable_now)::bigint
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
    'deliveryRouting', jsonb_build_object(
      'mapped',            (SELECT count(*) FILTER (WHERE delivery_automation_mapped)::bigint FROM g),
      'ready',             (SELECT count(*) FILTER (WHERE delivery_route_ready)::bigint FROM g),
      'unmapped',          (SELECT count(*) FILTER (WHERE NOT delivery_automation_mapped)::bigint FROM g),
      'disabledAutomation',(SELECT count(*) FILTER (WHERE delivery_automation_mapped AND NOT delivery_automation_enabled)::bigint FROM g)
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
  'Stage 3D2A service-role aggregate overview of the deterministic recipient gate. Read-only, no identities/automation ids. Calls the PRIVATE gate as owner. Adds deliveryRouting (mapped/ready/unmapped/disabledAutomation) and per-type deliveryRouteReady/deliveryAutomationMapped. gateEligible is independent of sending_enabled; sendableNow additionally requires sending_enabled=true.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_overview() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_overview() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_recipient_gate_overview() TO service_role;

-- ============================================================================
-- PART C — ANONYMISED QA SAMPLE (service-role only, safe fields only).
--   Adds SAFE booleans deliveryAutomationMapped / deliveryAutomationEnabled /
--   deliveryRouteReady. NEVER exposes delivery_automation_id, automation id/key,
--   template id, or internal config.
-- ============================================================================
CREATE FUNCTION public.get_admin_marketing_recipient_gate_sample(
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
      g.delivery_automation_mapped    AS "deliveryAutomationMapped",
      g.delivery_automation_enabled   AS "deliveryAutomationEnabled",
      g.delivery_route_ready          AS "deliveryRouteReady",
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
  'Stage 3D2A service-role anonymised QA sample of the deterministic recipient gate (limit clamped 1..100, default 25). Read-only. Exposes only safe diagnostic booleans (including deliveryAutomationMapped/deliveryAutomationEnabled/deliveryRouteReady) plus a 12-char customerHash; never delivery_automation_id/automation id/automation key/template id or raw config.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_recipient_gate_sample(integer) TO service_role;

-- ============================================================================
-- POST-INSTALL VERIFICATION — READ-ONLY; ANY failure rolls back everything.
-- ============================================================================
DO $postcheck$
DECLARE
  v_def_total     bigint;
  v_def_enabled   bigint;
  v_def_mapped    bigint;
  v_def_unmapped  bigint;
  v_bad_mapping   bigint;
  v_other_mapped  bigint;

  v_fk_deltype    "char";
  v_fk_valid      boolean;
  v_fk_target     text;
  v_fk_refcol     text;
  v_col_type      text;
  v_col_notnull   boolean;
  v_col_default   text;
  v_chk_valid     boolean;
  v_is_unique     bigint;

  v_overview      jsonb;
  v_gate_eligible bigint;
  v_sendable_now  bigint;

  v_recip_now     bigint;
  v_runs_now      bigint;
  v_opp_now       bigint;
  v_recip_before  bigint;
  v_runs_before   bigint;
  v_opp_before    bigint;
  v_chk_before    text;
  v_chk_now       text;

  v_sending       boolean;
  v_discovery     boolean;
  v_rollout       integer;
BEGIN
  -- 1. Column shape: uuid, nullable, no default.
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_get_expr(ad.adbin, ad.adrelid)
    INTO v_col_type, v_col_notnull, v_col_default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = 'public.marketing_opportunity_definitions'::regclass
     AND a.attname = 'delivery_automation_id'
     AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: delivery_automation_id column missing.';
  END IF;
  IF v_col_type IS DISTINCT FROM 'uuid' OR v_col_notnull IS DISTINCT FROM false OR v_col_default IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: delivery_automation_id must be uuid nullable no-default (type=%, notnull=%, default=%).',
      v_col_type, v_col_notnull, v_col_default;
  END IF;

  -- 2. FK: validated, -> marketing_automations(id), ON DELETE RESTRICT.
  SELECT c.confdeltype, c.convalidated, c.confrelid::regclass::text,
         (SELECT att.attname FROM pg_attribute att WHERE att.attrelid = c.confrelid AND att.attnum = c.confkey[1])
    INTO v_fk_deltype, v_fk_valid, v_fk_target, v_fk_refcol
    FROM pg_constraint c
   WHERE c.conname = 'marketing_opportunity_definitions_delivery_automation_fk'
     AND c.conrelid = 'public.marketing_opportunity_definitions'::regclass
     AND c.contype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: delivery-automation FK missing.';
  END IF;
  IF v_fk_target IS DISTINCT FROM 'marketing_automations' OR v_fk_refcol IS DISTINCT FROM 'id'
     OR v_fk_deltype <> 'r' OR v_fk_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: FK not as expected (target %.%, ondelete %, validated %).',
      v_fk_target, v_fk_refcol, v_fk_deltype, v_fk_valid;
  END IF;

  -- 3. enabled-requires-route CHECK exists and is validated.
  SELECT c.convalidated INTO v_chk_valid
    FROM pg_constraint c
   WHERE c.conname = 'marketing_opportunity_definitions_enabled_requires_route_chk'
     AND c.conrelid = 'public.marketing_opportunity_definitions'::regclass
     AND c.contype = 'c';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: enabled-requires-route CHECK missing.';
  END IF;
  IF v_chk_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: enabled-requires-route CHECK not validated.';
  END IF;

  -- 4. delivery_automation_id must NOT be UNIQUE (no unique index/constraint on it alone).
  SELECT count(*) INTO v_is_unique
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = 'public.marketing_opportunity_definitions'::regclass
     AND i.indisunique
     AND i.indnatts = 1
     AND a.attname = 'delivery_automation_id';
  IF v_is_unique <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: delivery_automation_id must NOT be UNIQUE.';
  END IF;

  -- 5. Definitions: 28 total, 0 enabled, 6 mapped, 22 unmapped.
  SELECT count(*), count(*) FILTER (WHERE enabled),
         count(*) FILTER (WHERE delivery_automation_id IS NOT NULL),
         count(*) FILTER (WHERE delivery_automation_id IS NULL)
    INTO v_def_total, v_def_enabled, v_def_mapped, v_def_unmapped
    FROM public.marketing_opportunity_definitions;
  IF v_def_total <> 28 OR v_def_enabled <> 0 OR v_def_mapped <> 6 OR v_def_unmapped <> 22 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: definitions total=%, enabled=%, mapped=%, unmapped=% (want 28/0/6/22).',
      v_def_total, v_def_enabled, v_def_mapped, v_def_unmapped;
  END IF;

  -- 6. Every mapped definition resolves to the genuine automation with the SAME key.
  SELECT count(*) INTO v_bad_mapping
    FROM public.marketing_opportunity_definitions d
    JOIN public.marketing_automations a ON a.id = d.delivery_automation_id
   WHERE d.delivery_automation_id IS NOT NULL
     AND d.opportunity_key <> a.automation_key;
  IF v_bad_mapping <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: % mapped definition(s) resolve to a non-matching automation key.', v_bad_mapping;
  END IF;

  -- 7. Only the six legacy keys are mapped; no other definition is mapped.
  SELECT count(*) INTO v_other_mapped
    FROM public.marketing_opportunity_definitions
   WHERE delivery_automation_id IS NOT NULL
     AND opportunity_key NOT IN (
       'vip_early_access', 'abandoned_checkout', 'wtf_credit_waiting',
       'regular_buyer_campaign_alert', 'new_account_no_purchase', 'lapsed_14_days'
     );
  IF v_other_mapped <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: % non-legacy definition(s) unexpectedly mapped.', v_other_mapped;
  END IF;

  -- 8. Gate overview: gateEligible = 0, sendableNow = 0 (definitions disabled / sending off).
  v_overview := public.get_admin_marketing_recipient_gate_overview();
  v_gate_eligible := (v_overview #>> '{final,gateEligible}')::bigint;
  v_sendable_now  := (v_overview #>> '{final,sendableNow}')::bigint;
  IF v_gate_eligible <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: gateEligible=% but MUST be 0 while all definitions are disabled.', v_gate_eligible;
  END IF;
  IF v_sendable_now <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: sendableNow=% but MUST be 0 while sending is disabled.', v_sendable_now;
  END IF;

  -- 9. deliveryRouting aggregate present and sane (2 opportunities mapped: 1 abandoned_checkout + 1 new_account_no_purchase).
  IF (v_overview #>> '{deliveryRouting,mapped}')::bigint <> 2 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: deliveryRouting.mapped=% but expected 2 opportunities routed.',
      (v_overview #>> '{deliveryRouting,mapped}');
  END IF;
  IF (v_overview #>> '{deliveryRouting,unmapped}')::bigint <> 4 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: deliveryRouting.unmapped=% but expected 4 opportunities unrouted.',
      (v_overview #>> '{deliveryRouting,unmapped}');
  END IF;
  -- Mapped automations are all disabled, so no route is READY yet.
  IF (v_overview #>> '{deliveryRouting,ready}')::bigint <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: deliveryRouting.ready=% but expected 0 (mapped automations are disabled).',
      (v_overview #>> '{deliveryRouting,ready}');
  END IF;
  -- Per-type: abandoned_checkout and new_account_no_purchase mapped; the two lifecycle/winner types not.
  IF (v_overview #>> '{byOpportunityType,abandoned_checkout,deliveryAutomationMapped}')::bigint <> 1
     OR (v_overview #>> '{byOpportunityType,new_account_no_purchase,deliveryAutomationMapped}')::bigint <> 1
     OR (v_overview #>> '{byOpportunityType,high_value_customer_at_risk,deliveryAutomationMapped}')::bigint <> 0
     OR (v_overview #>> '{byOpportunityType,recent_winner_credit_available,deliveryAutomationMapped}')::bigint <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: per-type deliveryAutomationMapped distribution unexpected.';
  END IF;

  -- 10. No data materialised; ledger + controls unchanged; opportunity checksum identical.
  SELECT recipients_before, runs_before, opportunities_before, opportunities_checksum
    INTO v_recip_before, v_runs_before, v_opp_before, v_chk_before
    FROM tmp_marketing_3d2a_baseline;

  SELECT count(*) INTO v_recip_now FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_now  FROM public.marketing_automation_runs;
  SELECT count(*) INTO v_opp_now   FROM public.marketing_opportunities;

  IF v_recip_now <> 0 OR v_recip_now <> v_recip_before THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: recipient count changed (% -> %); expected 0.', v_recip_before, v_recip_now;
  END IF;
  IF v_runs_now <> 0 OR v_runs_now <> v_runs_before THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: run count changed (% -> %); expected 0.', v_runs_before, v_runs_now;
  END IF;
  IF v_opp_now <> 6 OR v_opp_now <> v_opp_before THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: opportunity count is % (before %); expected 6 unchanged.', v_opp_now, v_opp_before;
  END IF;

  -- Recompute the opportunity checksum over the SAME stable columns and compare.
  SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), ''))
    INTO v_chk_now
    FROM (
      SELECT md5(
        coalesce(o.id::text, '')                  || '~' ||
        coalesce(o.user_id::text, '')             || '~' ||
        coalesce(o.external_contact_id::text, '') || '~' ||
        coalesce(o.opportunity_type, '')          || '~' ||
        coalesce(o.campaign_id::text, '')         || '~' ||
        coalesce(o.state, '')                     || '~' ||
        coalesce(o.base_priority::text, '')       || '~' ||
        coalesce(o.score::text, '')               || '~' ||
        coalesce(o.automation_id::text, '')       || '~' ||
        coalesce(o.detected_at::text, '')         || '~' ||
        coalesce(o.expires_at::text, '')
      ) AS row_sig
        FROM public.marketing_opportunities o
    ) s;
  IF v_chk_now IS DISTINCT FROM v_chk_before THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: opportunity checksum changed; opportunities (incl. automation_id provenance) were modified.';
  END IF;

  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: control state changed (sending=%, discovery=%, rollout=%).',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- 11. Privilege verification: PRIVATE gate direct EXECUTE denied to every role.
  IF has_function_privilege('anon', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: PRIVATE gate EXECUTE is granted to an application role.';
  END IF;

  -- Admin overview + sample: service_role only.
  IF NOT has_function_privilege('service_role', 'public.get_admin_marketing_recipient_gate_overview()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_admin_marketing_recipient_gate_overview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_admin_marketing_recipient_gate_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: admin overview privileges are not service-role-only.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_admin_marketing_recipient_gate_sample(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_admin_marketing_recipient_gate_sample(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_admin_marketing_recipient_gate_sample(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: admin sample privileges are not service-role-only.';
  END IF;

  -- 12. Private gate return contract MUST expose delivery_automation_id (uuid)
  --     for Stage 020 materialisation. Verify via the function's declared OUT
  --     parameters (pg_proc.proargnames / proallargtypes).
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc pr
      CROSS JOIN LATERAL unnest(pr.proallargtypes, pr.proargmodes, pr.proargnames)
                    AS t(argtype, argmode, argname)
     WHERE pr.oid = 'public.wtf_marketing_recipient_gate_preview()'::regprocedure
       AND t.argmode = 't'                    -- TABLE (OUT) column
       AND t.argname = 'delivery_automation_id'
       AND t.argtype = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: private gate does not return delivery_automation_id uuid.';
  END IF;

  -- 13. delivery_automation_id MUST NOT leak through either admin RPC. The JSON
  --     produced by the overview must contain no such key anywhere in its text.
  IF v_overview::text ILIKE '%delivery_automation_id%'
     OR v_overview::text ILIKE '%deliveryAutomationId%' THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: overview output leaks delivery_automation_id.';
  END IF;
  IF public.get_admin_marketing_recipient_gate_sample(100)::text ILIKE '%delivery_automation_id%'
     OR public.get_admin_marketing_recipient_gate_sample(100)::text ILIKE '%deliveryAutomationId%' THEN
    RAISE EXCEPTION 'Stage 3D2A (019) verify aborted: sample output leaks delivery_automation_id.';
  END IF;
END
$postcheck$;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * marketing_opportunity_definitions.delivery_automation_id added (uuid,
--     nullable, no default); FK -> marketing_automations(id) ON DELETE RESTRICT
--     validated; enabled-requires-route CHECK validated; NOT unique.
--   * Exactly six legacy definitions routed by exact-key equality; 22 unmapped.
--     No automation rows created; no other definition mapped.
--   * Stage 018 gate functions replaced as a superset: pre_nba_gate_eligible now
--     also requires delivery_route_ready (mapped + automation exists + enabled).
--   * READ-ONLY w.r.t. data: no recipients/runs/opportunities created, no
--     opportunity (incl. automation_id provenance) changed, no automation/
--     definition enabled, no control/frequency change, no sends, no cron, no AI.
--   * With all definitions disabled, gateEligible = 0; with sending disabled,
--     sendableNow = 0. Mapped automations are disabled, so deliveryRouting.ready = 0.
-- ============================================================================
