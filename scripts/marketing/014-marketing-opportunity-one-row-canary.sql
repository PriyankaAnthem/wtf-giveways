-- ============================================================================
-- WTF Marketing Hub — Stage 3C2G: ONE-ROW OPPORTUNITY PERSISTENCE CANARY
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Perform the FIRST REAL persistence test of the Stage 3C2F discovery engine
--   (public.discover_marketing_opportunities) against LIVE data, persisting AT
--   MOST ONE opportunity and sending NOTHING.
--
--   This is a MANUAL, one-shot canary — NOT part of the automatic migration
--   chain and NEVER executed by the application. Run it ONCE by hand (Supabase
--   SQL editor / psql) AFTER migrations 001-013, while Marketing is paused.
--   This file is committed as a reviewable artifact and has NOT been executed.
--
-- WHAT IT DOES (inside ONE atomic transaction)
--   1. Asserts the hub is paused and the ledger/definitions are in the expected
--      pristine state, and that the canary definition (new_account_no_purchase)
--      exists, is DISABLED, and is NOT campaign_specific.
--   2. Asserts the authoritative detector already yields >= 1 rn=1 winner for
--      new_account_no_purchase; if ZERO it ABORTS before touching anything.
--   3. TEMPORARILY enables ONLY new_account_no_purchase, sets discovery_enabled
--      = true and rollout_limit = 1 (sending_enabled and maximum_batch_size are
--      left UNTOUCHED).
--   4. Calls public.discover_marketing_opportunities(1) EXACTLY ONCE and requires
--      status='ok', effectiveLimit=1, inserted=1. Any deviation RAISES.
--   5. Verifies the single persisted row (identity XOR, type, campaign, state,
--      timing, priority, score bounds, email present, JSON shapes, dedupe key).
--   6. RESTORES discovery_enabled=false, rollout_limit=0, and disables the
--      definition again, then RE-VERIFIES the fully-paused end state.
--   7. Returns ONE compact, PII-free JSON summary.
--
-- FAILURE ATOMICITY (critical)
--   The whole script is a single BEGIN/COMMIT. There is NO exception handler:
--   ANY RAISE EXCEPTION (including a failed restoration check) aborts and rolls
--   back EVERYTHING — the temporary enablement can NEVER be committed. The ONLY
--   state intentionally left behind on success is the single persisted
--   opportunity row (for post-hoc inspection); all control/definition state is
--   restored to fully paused BEFORE COMMIT.
--
-- ABSOLUTELY DOES NOT
--   Enable sending; send email; call Resend; create recipients, automation runs,
--   or more than one opportunity; enable any other definition; alter the
--   discovery function, marketing_opportunities schema, dedupe logic, scoring, or
--   detector logic; add cron/AI; touch checkout/payments/tickets/wallet/signup/
--   customer-facing code; or modify migrations 001-013.
-- ============================================================================

BEGIN;

-- Fail fast rather than block a busy production database.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $canary$
DECLARE
  v_fn               regprocedure;
  v_sending          boolean;
  v_discovery        boolean;
  v_rollout          integer;
  v_max_batch        integer;
  v_max_batch_before integer;
  v_enabled_defs     bigint;
  v_opp_before       bigint;
  v_opp_after        bigint;
  v_winner_count     bigint;

  -- Canary definition snapshot (read BEFORE any mutation).
  v_def_enabled      boolean;
  v_def_campaign     boolean;
  v_def_priority     integer;
  v_def_expiry       integer;

  -- RPC result.
  v_rpc              jsonb;
  v_rpc_status       text;
  v_rpc_inserted     bigint;
  v_rpc_effective    integer;

  -- Persisted-row snapshot (read for verification; NEVER returned as identity).
  r_user_id          uuid;
  r_external         uuid;
  r_type             text;
  r_campaign         uuid;
  r_state            text;
  r_detected         timestamptz;
  r_expires          timestamptz;
  r_base_priority    integer;
  r_score            numeric;
  r_email            text;
  r_reason           jsonb;
  r_context          jsonb;
  r_dedupe           text;
BEGIN
  -- Single-execution guard specific to THIS canary (distinct from the discovery
  -- RPC's own run lock, so the RPC can still take its lock when called below).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2g_one_row_canary')) THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- ---- ASSERT 1: discovery RPC exists -------------------------------------
  v_fn := to_regprocedure('public.discover_marketing_opportunities(integer)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: public.discover_marketing_opportunities(integer) is missing. Run migration 013 first.';
  END IF;

  -- ---- ASSERT 2-4: required tables exist ----------------------------------
  IF to_regclass('public.marketing_opportunities') IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: public.marketing_opportunities is missing.';
  END IF;
  IF to_regclass('public.marketing_opportunity_definitions') IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: public.marketing_opportunity_definitions is missing.';
  END IF;
  IF to_regclass('public.marketing_control_state') IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: public.marketing_control_state is missing.';
  END IF;

  -- ---- ASSERT 5: control state is exactly paused --------------------------
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_max_batch_before
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: Marketing is not paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%).',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- ---- ASSERT 6: no enabled definitions -----------------------------------
  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: % definition(s) already enabled; expected 0.', v_enabled_defs;
  END IF;

  -- ---- ASSERT 7: ledger empty ---------------------------------------------
  SELECT count(*) INTO v_opp_before FROM public.marketing_opportunities;
  IF v_opp_before <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: marketing_opportunities already contains % row(s); expected 0.', v_opp_before;
  END IF;

  -- ---- ASSERT 8-10: canary definition exists / disabled / non-campaign ----
  SELECT enabled, campaign_specific, default_priority, default_expiry_hours
    INTO v_def_enabled, v_def_campaign, v_def_priority, v_def_expiry
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'new_account_no_purchase';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: definition new_account_no_purchase does not exist.';
  END IF;
  IF v_def_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: new_account_no_purchase is already enabled.';
  END IF;
  IF v_def_campaign IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: new_account_no_purchase is campaign_specific; canary requires a non-campaign definition.';
  END IF;

  -- ---- ASSERT 11: detector already yields >= 1 rn=1 winner ----------------
  -- Read-only. If ZERO, ABORT BEFORE any mutation happens.
  SELECT count(*) INTO v_winner_count
    FROM public.wtf_marketing_opportunity_candidates_preview() c
   WHERE c.rn = 1
     AND c.opportunity_key = 'new_account_no_purchase';
  IF v_winner_count < 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: detector yields 0 rn=1 winners for new_account_no_purchase; nothing changed.';
  END IF;

  -- ========================================================================
  -- TEMPORARY CANARY CONFIGURATION (this transaction only)
  -- ========================================================================
  -- Enable ONLY the canary definition.
  UPDATE public.marketing_opportunity_definitions
     SET enabled = true, updated_at = now()
   WHERE opportunity_key = 'new_account_no_purchase';

  -- Guard: exactly ONE definition may be enabled, and it must be the canary.
  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: expected exactly 1 enabled definition after enablement, found %.', v_enabled_defs;
  END IF;
  PERFORM 1
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true
     AND opportunity_key <> 'new_account_no_purchase';
  IF FOUND THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: a definition other than new_account_no_purchase is enabled.';
  END IF;

  -- Enable discovery and cap rollout at ONE. sending_enabled is NOT touched.
  UPDATE public.marketing_control_state
     SET discovery_enabled = true, rollout_limit = 1, updated_at = now()
   WHERE key = 'default';

  -- Guard: sending must still be false, and maximum_batch_size unchanged.
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_max_batch
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: sending_enabled changed to % during setup; refusing to proceed.', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM true OR v_rollout IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: canary control setup incorrect (discovery=%, rollout=%).', v_discovery, v_rollout;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: maximum_batch_size changed (% -> %); it must remain unchanged.', v_max_batch_before, v_max_batch;
  END IF;

  -- ========================================================================
  -- CANARY EXECUTION — call the discovery engine EXACTLY ONCE, limit 1.
  -- ========================================================================
  SELECT public.discover_marketing_opportunities(1) INTO v_rpc;

  v_rpc_status    := v_rpc->>'status';
  v_rpc_inserted  := (v_rpc->>'inserted')::bigint;
  v_rpc_effective := (v_rpc->>'effectiveLimit')::integer;

  IF v_rpc_status IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: RPC status was %, expected ok.', v_rpc_status;
  END IF;
  IF v_rpc_effective IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: RPC effectiveLimit was %, expected 1.', v_rpc_effective;
  END IF;
  IF v_rpc_inserted IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: RPC inserted % rows, expected EXACTLY 1.', v_rpc_inserted;
  END IF;

  -- Ledger must now hold exactly one row.
  SELECT count(*) INTO v_opp_after FROM public.marketing_opportunities;
  IF v_opp_after <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: marketing_opportunities holds % row(s) after canary, expected 1.', v_opp_after;
  END IF;

  -- Read the single persisted row for verification (identity used ONLY for
  -- boolean checks here; never returned).
  SELECT user_id, external_contact_id, opportunity_type, campaign_id, state,
         detected_at, expires_at, base_priority, score, email_lc, reason, context_snapshot, dedupe_key
    INTO r_user_id, r_external, r_type, r_campaign, r_state,
         r_detected, r_expires, r_base_priority, r_score, r_email, r_reason, r_context, r_dedupe
    FROM public.marketing_opportunities;

  IF r_user_id IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted row has NULL user_id.';
  END IF;
  IF r_external IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted row has a non-null external_contact_id.';
  END IF;
  IF r_type IS DISTINCT FROM 'new_account_no_purchase' THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted opportunity_type is %, expected new_account_no_purchase.', r_type;
  END IF;
  IF r_campaign IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted row has a non-null campaign_id.';
  END IF;
  IF r_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted state is %, expected open.', r_state;
  END IF;
  IF r_detected IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted detected_at is NULL.';
  END IF;
  IF r_expires <= r_detected THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted expires_at is not after detected_at.';
  END IF;
  IF r_base_priority IS DISTINCT FROM v_def_priority THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: base_priority % does not match the definition/detector snapshot %.', r_base_priority, v_def_priority;
  END IF;
  IF r_score IS NULL OR r_score < 0 OR r_score > 1000 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: score % is out of the [0,1000] range.', r_score;
  END IF;
  IF r_email IS NULL OR length(r_email) = 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: persisted email_lc is empty.';
  END IF;
  IF r_reason IS NULL OR jsonb_typeof(r_reason) <> 'object' THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: reason is not a JSON object.';
  END IF;
  IF r_context IS NULL OR jsonb_typeof(r_context) <> 'object' THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: context_snapshot is not a JSON object.';
  END IF;
  IF r_dedupe IS NULL OR length(r_dedupe) = 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: dedupe_key is empty.';
  END IF;

  -- ========================================================================
  -- RESTORE ALL CONTROLS (before COMMIT). Any failure below rolls back the
  -- WHOLE transaction, including the temporary enablement above.
  -- ========================================================================
  UPDATE public.marketing_control_state
     SET discovery_enabled = false, rollout_limit = 0, updated_at = now()
   WHERE key = 'default';

  UPDATE public.marketing_opportunity_definitions
     SET enabled = false, updated_at = now()
   WHERE opportunity_key = 'new_account_no_purchase';

  -- RE-VERIFY fully-paused end state.
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_max_batch
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: sending_enabled is % at restore; MUST be false.', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: discovery_enabled not restored to false (is %).', v_discovery;
  END IF;
  IF v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: rollout_limit not restored to 0 (is %).', v_rollout;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: maximum_batch_size changed (% -> %); it must remain unchanged.', v_max_batch_before, v_max_batch;
  END IF;

  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: % definition(s) still enabled at restore; MUST be 0.', v_enabled_defs;
  END IF;

  SELECT count(*) INTO v_opp_after FROM public.marketing_opportunities;
  IF v_opp_after <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2G canary aborted: marketing_opportunities holds % row(s) at restore, expected exactly 1.', v_opp_after;
  END IF;

  -- Stash the SAFE, PII-free summary for the final result SELECT (below).
  DROP TABLE IF EXISTS pg_temp.tmp_canary_result;
  CREATE TEMP TABLE tmp_canary_result ON COMMIT DROP AS
  SELECT
    v_rpc_status                                              AS rpc_status,
    v_rpc_inserted                                           AS rpc_inserted,
    v_opp_after                                              AS opportunity_count,
    r_type                                                   AS opportunity_type,
    r_state                                                  AS opportunity_state,
    v_def_campaign                                           AS campaign_specific,
    (r_user_id IS NOT NULL)                                  AS has_user_identity,
    (r_external IS NOT NULL)                                 AS has_external_identity,
    r_score                                                  AS score,
    r_base_priority                                          AS base_priority,
    round(extract(epoch FROM (r_expires - r_detected)) / 3600)::integer AS expiry_hours_approx,
    v_sending                                                AS sending_enabled,
    v_discovery                                              AS discovery_enabled,
    v_rollout                                                AS rollout_limit,
    v_enabled_defs                                           AS enabled_definitions;
END
$canary$;

-- ============================================================================
-- ONE SAFE RESULT (no user_id / email / dedupe_key / campaign_id / raw JSON).
-- ============================================================================
SELECT jsonb_build_object(
  'ok', true,
  'status', 'canary_complete',
  'rpcStatus', rpc_status,
  'rpcInserted', rpc_inserted,
  'opportunityCount', opportunity_count,
  'opportunityType', opportunity_type,
  'opportunityState', opportunity_state,
  'campaignSpecific', campaign_specific,
  'hasUserIdentity', has_user_identity,
  'hasExternalIdentity', has_external_identity,
  'score', score,
  'basePriority', base_priority,
  'expiryHoursApprox', expiry_hours_approx,
  'sendingEnabled', sending_enabled,
  'discoveryEnabled', discovery_enabled,
  'rolloutLimit', rollout_limit,
  'enabledDefinitions', enabled_definitions,
  'generatedAt', now()
) AS canary_result
FROM tmp_canary_result;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * On SUCCESS: marketing_opportunities holds EXACTLY 1 row
--     (new_account_no_purchase, state=open, user identity, no campaign); control
--     state is fully paused again (sending=false, discovery=false, rollout=0);
--     0 definitions enabled; maximum_batch_size unchanged. Nothing was sent.
--   * On ANY failure: the ENTIRE transaction rolls back — no opportunity row and
--     no temporary enablement persist.
--   * No recipients / runs / email / cron / AI. No schema/scoring/detector/dedupe
--     changes. Migrations 001-013 untouched.
-- ============================================================================
