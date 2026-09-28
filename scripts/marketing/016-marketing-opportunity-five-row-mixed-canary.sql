-- ============================================================================
-- WTF Marketing Hub — Stage 3C2I: FIVE-ROW MIXED OPPORTUNITY PERSISTENCE CANARY
-- ----------------------------------------------------------------------------
-- PURPOSE
--   The SECOND real persistence canary for the Stage 3C2F discovery engine
--   (public.discover_marketing_opportunities). It persists EXACTLY FIVE new
--   marketing opportunities across THREE families/priorities and sends NOTHING:
--       2 x recent_winner_credit_available  (winner,    priority 1, campaign)
--       2 x high_value_customer_at_risk      (lifecycle, priority 1, no campaign)
--       1 x abandoned_checkout               (checkout,  priority 2, campaign)
--   The existing Stage 3C2G new_account_no_purchase canary is left UNTOUCHED.
--   Starting ledger count = 1; successful final ledger count = 6.
--
--   This is a MANUAL, one-shot canary — NOT part of the automatic migration
--   chain and NEVER executed by the application. Run it ONCE by hand (Supabase
--   SQL editor / psql) AFTER migrations 001-015, while Marketing is paused.
--   This file is committed as a reviewable artifact and has NOT been executed.
--
-- WHY THREE SEPARATE, SINGLE-DEFINITION INVOCATIONS (NOT ONE)
--   discover_marketing_opportunities correctly persists winners in
--   priority-then-score order. Enabling all three definitions at once and calling
--   discovery a single time would NOT guarantee the desired 2/2/1 mixed sample,
--   because higher-priority families would crowd out the lower-priority one. So
--   we run THREE tightly-controlled invocations INSIDE ONE atomic transaction,
--   each with EXACTLY ONE definition enabled and rollout_limit set to the exact
--   number of rows that invocation must persist.
--
-- FAILURE ATOMICITY (critical)
--   The whole script is a single BEGIN/COMMIT with NO exception handler. ANY
--   RAISE EXCEPTION (including a failed restoration/verification check) aborts
--   and rolls back EVERYTHING: none of the five new rows commit, no definition
--   enablement commits, discovery never commits enabled, and rollout_limit never
--   commits above 0. The ONLY state intentionally left behind on success is the
--   five new opportunity rows (plus the pre-existing canary); all control and
--   definition state is restored to fully paused BEFORE COMMIT.
--
-- SAFETY
--   sending_enabled MUST remain false for the entire transaction. discovery_
--   enabled and rollout_limit are temporarily raised and then restored. maximum_
--   batch_size is NEVER changed. No recipients, automation runs, emails, cron or
--   AI. No schema/scoring/detector/dedupe/priority/expiry changes. Migrations
--   001-015 are untouched. Lifecycle maintenance is NEVER called.
--
-- PRIVACY
--   The single returned JSON payload is PII-free: no user_id, email_lc,
--   external_contact_id, campaign_id, dedupe_key, raw reason/context, or customer
--   hashes. Identity columns are used ONLY inside boolean NULL predicates.
-- ============================================================================

BEGIN;

-- Fail fast rather than block a busy production database. The statement timeout
-- is generous because THREE detector-backed discovery calls run in this txn.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $canary$
DECLARE
  -- Expected live-planning definition values (assert, never invent).
  c_rw_priority      constant integer := 1;
  c_rw_expiry        constant integer := 168;
  c_hv_priority      constant integer := 1;
  c_hv_expiry        constant integer := 336;
  c_ac_priority      constant integer := 2;
  c_ac_expiry        constant integer := 24;

  v_fn               regprocedure;
  v_missing          text[] := ARRAY[]::text[];
  v_dep              text;

  v_sending          boolean;
  v_discovery        boolean;
  v_rollout          integer;
  v_max_batch        integer;
  v_max_batch_before integer;
  v_enabled_defs     bigint;
  v_opp_count        bigint;

  -- Recipients / automation-run guard counts.
  v_recipients_before   bigint;
  v_runs_before         bigint;
  v_recipients_after    bigint;
  v_runs_after          bigint;

  -- Definition snapshots.
  v_rw_enabled       boolean;
  v_rw_campaign      boolean;
  v_rw_priority      integer;
  v_rw_expiry        integer;
  v_hv_enabled       boolean;
  v_hv_campaign      boolean;
  v_hv_priority      integer;
  v_hv_expiry        integer;
  v_ac_enabled       boolean;
  v_ac_campaign      boolean;
  v_ac_priority      integer;
  v_ac_expiry        integer;

  -- Detector pool counts.
  v_pool_rw          bigint;
  v_pool_hv          bigint;
  v_pool_ac          bigint;
  v_bad_campaign     bigint;

  -- Existing canary snapshot (non-PII scalar fields for unchanged proof).
  v_canary_state     text;
  v_canary_detected  timestamptz;
  v_canary_expires   timestamptz;
  v_canary_priority  integer;
  v_canary_score     numeric;

  -- Per-execution RPC results.
  v_rpc              jsonb;
  v_rpc_a            jsonb;
  v_rpc_b            jsonb;
  v_rpc_c            jsonb;

  -- Verification helpers.
  v_bad_rows         bigint;
  v_count_by_type    bigint;
  v_total_types      bigint;
BEGIN
  -- ========================================================================
  -- SINGLE-EXECUTION GUARD — canary-specific advisory key, distinct from the
  -- 013 discovery run lock and the 015 lifecycle maintenance lock.
  -- ========================================================================
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2i_five_row_mixed_canary')) THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- ========================================================================
  -- PREFLIGHT — ALL ASSERTIONS BEFORE ANY MUTATION
  -- ========================================================================
  -- 1. Discovery RPC must exist.
  v_fn := to_regprocedure('public.discover_marketing_opportunities(integer)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: public.discover_marketing_opportunities(integer) is missing. Run migration 013 first.';
  END IF;

  -- 2. Required tables must exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_opportunities',
    'public.marketing_opportunity_definitions',
    'public.marketing_control_state',
    'public.marketing_recipients',
    'public.marketing_automation_runs'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: required dependency % is missing.', array_to_string(v_missing, ', ');
  END IF;

  -- 3-4. Control state exactly paused; capture and require maximum_batch_size >= 2.
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_max_batch_before
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: Marketing is not paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%).',
      v_sending, v_discovery, v_rollout;
  END IF;
  IF COALESCE(v_max_batch_before, 0) < 2 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: maximum_batch_size=% is < 2; cannot persist 2-row batches.', v_max_batch_before;
  END IF;

  -- 5. No definition enabled yet.
  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: % definition(s) already enabled; expected 0.', v_enabled_defs;
  END IF;

  -- 6. Ledger must contain EXACTLY one row.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: marketing_opportunities holds % row(s); expected exactly 1 (Stage 3C2G canary).', v_opp_count;
  END IF;

  -- 7-8. Assert & snapshot the existing Stage 3C2G canary (non-PII fields).
  SELECT state, detected_at, expires_at, base_priority, score
    INTO v_canary_state, v_canary_detected, v_canary_expires, v_canary_priority, v_canary_score
    FROM public.marketing_opportunities
   WHERE opportunity_type = 'new_account_no_purchase'
     AND campaign_id IS NULL
     AND user_id IS NOT NULL
     AND external_contact_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: the single ledger row is not the expected Stage 3C2G canary (type=new_account_no_purchase, no campaign, user identity only).';
  END IF;
  IF v_canary_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: existing canary state is %, expected open.', v_canary_state;
  END IF;

  -- 9-11. All THREE new canary definitions exist, are disabled, with EXACT
  --       campaign_specific / priority / expiry live-planning values.
  SELECT enabled, campaign_specific, default_priority, default_expiry_hours
    INTO v_rw_enabled, v_rw_campaign, v_rw_priority, v_rw_expiry
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'recent_winner_credit_available';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: definition recent_winner_credit_available does not exist.';
  END IF;

  SELECT enabled, campaign_specific, default_priority, default_expiry_hours
    INTO v_hv_enabled, v_hv_campaign, v_hv_priority, v_hv_expiry
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'high_value_customer_at_risk';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: definition high_value_customer_at_risk does not exist.';
  END IF;

  SELECT enabled, campaign_specific, default_priority, default_expiry_hours
    INTO v_ac_enabled, v_ac_campaign, v_ac_priority, v_ac_expiry
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'abandoned_checkout';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: definition abandoned_checkout does not exist.';
  END IF;

  IF v_rw_enabled OR v_hv_enabled OR v_ac_enabled THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: one of the three canary definitions is already enabled (rw=%, hv=%, ac=%).',
      v_rw_enabled, v_hv_enabled, v_ac_enabled;
  END IF;

  -- Exact campaign_specific invariants.
  IF v_rw_campaign IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: recent_winner_credit_available.campaign_specific=% (expected true).', v_rw_campaign;
  END IF;
  IF v_hv_campaign IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: high_value_customer_at_risk.campaign_specific=% (expected false).', v_hv_campaign;
  END IF;
  IF v_ac_campaign IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: abandoned_checkout.campaign_specific=% (expected true).', v_ac_campaign;
  END IF;

  -- Exact priority / expiry live-planning values (read, then asserted).
  IF v_rw_priority IS DISTINCT FROM c_rw_priority OR v_rw_expiry IS DISTINCT FROM c_rw_expiry THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: recent_winner_credit_available priority/expiry = %/% (expected %/%).',
      v_rw_priority, v_rw_expiry, c_rw_priority, c_rw_expiry;
  END IF;
  IF v_hv_priority IS DISTINCT FROM c_hv_priority OR v_hv_expiry IS DISTINCT FROM c_hv_expiry THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: high_value_customer_at_risk priority/expiry = %/% (expected %/%).',
      v_hv_priority, v_hv_expiry, c_hv_priority, c_hv_expiry;
  END IF;
  IF v_ac_priority IS DISTINCT FROM c_ac_priority OR v_ac_expiry IS DISTINCT FROM c_ac_expiry THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: abandoned_checkout priority/expiry = %/% (expected %/%).',
      v_ac_priority, v_ac_expiry, c_ac_priority, c_ac_expiry;
  END IF;

  -- 12. Authoritative detector pools must be deep enough for 2 / 2 / 1.
  SELECT count(*) INTO v_pool_rw
    FROM public.wtf_marketing_opportunity_candidates_preview() c
   WHERE c.rn = 1 AND c.opportunity_key = 'recent_winner_credit_available';
  IF v_pool_rw < 2 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: recent_winner_credit_available has % rn=1 winners; need >= 2.', v_pool_rw;
  END IF;

  SELECT count(*) INTO v_pool_hv
    FROM public.wtf_marketing_opportunity_candidates_preview() c
   WHERE c.rn = 1 AND c.opportunity_key = 'high_value_customer_at_risk';
  IF v_pool_hv < 2 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: high_value_customer_at_risk has % rn=1 winners; need >= 2.', v_pool_hv;
  END IF;

  SELECT count(*) INTO v_pool_ac
    FROM public.wtf_marketing_opportunity_candidates_preview() c
   WHERE c.rn = 1 AND c.opportunity_key = 'abandoned_checkout';
  IF v_pool_ac < 1 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: abandoned_checkout has % rn=1 winners; need >= 1.', v_pool_ac;
  END IF;

  -- Campaign-specific types: EVERY qualifying rn=1 candidate must carry a campaign.
  SELECT count(*) INTO v_bad_campaign
    FROM public.wtf_marketing_opportunity_candidates_preview() c
   WHERE c.rn = 1
     AND c.opportunity_key IN ('recent_winner_credit_available', 'abandoned_checkout')
     AND c.campaign_id IS NULL;
  IF v_bad_campaign <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I canary aborted: % campaign-specific rn=1 candidate(s) have NULL campaign_id.', v_bad_campaign;
  END IF;

  -- 13-14. Record recipient / automation-run counts (must not change).
  SELECT count(*) INTO v_recipients_before FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_before FROM public.marketing_automation_runs;

  -- ========================================================================
  -- EXECUTION A — recent_winner_credit_available (campaign, priority 1) -> 2
  -- ========================================================================
  UPDATE public.marketing_opportunity_definitions
     SET enabled = true, updated_at = now()
   WHERE opportunity_key = 'recent_winner_credit_available';

  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: expected exactly 1 enabled definition, found %.', v_enabled_defs;
  END IF;
  PERFORM 1 FROM public.marketing_opportunity_definitions
   WHERE enabled = true AND opportunity_key <> 'recent_winner_credit_available';
  IF FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: a definition other than recent_winner_credit_available is enabled.';
  END IF;

  UPDATE public.marketing_control_state
     SET discovery_enabled = true, rollout_limit = 2, updated_at = now()
   WHERE key = 'default';

  -- Guard: sending untouched, batch size untouched.
  SELECT sending_enabled, maximum_batch_size INTO v_sending, v_max_batch
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: sending_enabled changed to %.', v_sending;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: maximum_batch_size changed (% -> %).', v_max_batch_before, v_max_batch;
  END IF;

  SELECT public.discover_marketing_opportunities(2) INTO v_rpc;
  v_rpc_a := v_rpc;
  IF (v_rpc->>'status') IS DISTINCT FROM 'ok'
     OR (v_rpc->>'requestedLimit')::int IS DISTINCT FROM 2
     OR (v_rpc->>'effectiveLimit')::int IS DISTINCT FROM 2
     OR (v_rpc->>'rolloutLimit')::int   IS DISTINCT FROM 2
     OR (v_rpc->>'inserted')::bigint     IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: unexpected RPC result %.', v_rpc;
  END IF;

  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 3 THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: ledger count is % after A, expected 3.', v_opp_count;
  END IF;

  UPDATE public.marketing_opportunity_definitions
     SET enabled = false, updated_at = now()
   WHERE opportunity_key = 'recent_winner_credit_available';
  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I/A aborted: enabled-definition count is % after disable, expected 0.', v_enabled_defs;
  END IF;

  -- ========================================================================
  -- EXECUTION B — high_value_customer_at_risk (no campaign, priority 1) -> 2
  -- ========================================================================
  UPDATE public.marketing_opportunity_definitions
     SET enabled = true, updated_at = now()
   WHERE opportunity_key = 'high_value_customer_at_risk';

  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: expected exactly 1 enabled definition, found %.', v_enabled_defs;
  END IF;
  PERFORM 1 FROM public.marketing_opportunity_definitions
   WHERE enabled = true AND opportunity_key <> 'high_value_customer_at_risk';
  IF FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: a definition other than high_value_customer_at_risk is enabled.';
  END IF;

  -- discovery_enabled stays true; set rollout to 2.
  UPDATE public.marketing_control_state
     SET rollout_limit = 2, updated_at = now()
   WHERE key = 'default';

  SELECT sending_enabled, discovery_enabled, maximum_batch_size
    INTO v_sending, v_discovery, v_max_batch
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: sending_enabled changed to %.', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: discovery_enabled is %, expected true.', v_discovery;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: maximum_batch_size changed (% -> %).', v_max_batch_before, v_max_batch;
  END IF;

  SELECT public.discover_marketing_opportunities(2) INTO v_rpc;
  v_rpc_b := v_rpc;
  IF (v_rpc->>'status') IS DISTINCT FROM 'ok'
     OR (v_rpc->>'requestedLimit')::int IS DISTINCT FROM 2
     OR (v_rpc->>'effectiveLimit')::int IS DISTINCT FROM 2
     OR (v_rpc->>'rolloutLimit')::int   IS DISTINCT FROM 2
     OR (v_rpc->>'inserted')::bigint     IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: unexpected RPC result %.', v_rpc;
  END IF;

  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 5 THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: ledger count is % after B, expected 5.', v_opp_count;
  END IF;

  UPDATE public.marketing_opportunity_definitions
     SET enabled = false, updated_at = now()
   WHERE opportunity_key = 'high_value_customer_at_risk';
  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I/B aborted: enabled-definition count is % after disable, expected 0.', v_enabled_defs;
  END IF;

  -- ========================================================================
  -- EXECUTION C — abandoned_checkout (campaign, priority 2) -> 1
  -- ========================================================================
  UPDATE public.marketing_opportunity_definitions
     SET enabled = true, updated_at = now()
   WHERE opportunity_key = 'abandoned_checkout';

  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: expected exactly 1 enabled definition, found %.', v_enabled_defs;
  END IF;
  PERFORM 1 FROM public.marketing_opportunity_definitions
   WHERE enabled = true AND opportunity_key <> 'abandoned_checkout';
  IF FOUND THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: a definition other than abandoned_checkout is enabled.';
  END IF;

  UPDATE public.marketing_control_state
     SET rollout_limit = 1, updated_at = now()
   WHERE key = 'default';

  SELECT sending_enabled, discovery_enabled, maximum_batch_size
    INTO v_sending, v_discovery, v_max_batch
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: sending_enabled changed to %.', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: discovery_enabled is %, expected true.', v_discovery;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: maximum_batch_size changed (% -> %).', v_max_batch_before, v_max_batch;
  END IF;

  SELECT public.discover_marketing_opportunities(1) INTO v_rpc;
  v_rpc_c := v_rpc;
  IF (v_rpc->>'status') IS DISTINCT FROM 'ok'
     OR (v_rpc->>'requestedLimit')::int IS DISTINCT FROM 1
     OR (v_rpc->>'effectiveLimit')::int IS DISTINCT FROM 1
     OR (v_rpc->>'rolloutLimit')::int   IS DISTINCT FROM 1
     OR (v_rpc->>'inserted')::bigint     IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: unexpected RPC result %.', v_rpc;
  END IF;

  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 6 THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: ledger count is % after C, expected 6.', v_opp_count;
  END IF;

  UPDATE public.marketing_opportunity_definitions
     SET enabled = false, updated_at = now()
   WHERE opportunity_key = 'abandoned_checkout';
  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I/C aborted: enabled-definition count is % after disable, expected 0.', v_enabled_defs;
  END IF;

  -- ========================================================================
  -- VERIFY EXACT FIVE-ROW DISTRIBUTION (+ existing canary = 6 total)
  -- ========================================================================
  SELECT count(DISTINCT opportunity_type) INTO v_total_types FROM public.marketing_opportunities;
  IF v_total_types <> 4 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: ledger has % distinct opportunity types, expected 4.', v_total_types;
  END IF;

  -- No unexpected type may exist.
  SELECT count(*) INTO v_bad_rows
    FROM public.marketing_opportunities
   WHERE opportunity_type NOT IN (
     'new_account_no_purchase', 'recent_winner_credit_available',
     'high_value_customer_at_risk', 'abandoned_checkout'
   );
  IF v_bad_rows <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: % row(s) of an unexpected opportunity type exist.', v_bad_rows;
  END IF;

  -- Per-type exact counts.
  SELECT count(*) INTO v_count_by_type FROM public.marketing_opportunities WHERE opportunity_type = 'new_account_no_purchase';
  IF v_count_by_type <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: new_account_no_purchase count is %, expected 1.', v_count_by_type;
  END IF;
  SELECT count(*) INTO v_count_by_type FROM public.marketing_opportunities WHERE opportunity_type = 'recent_winner_credit_available';
  IF v_count_by_type <> 2 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: recent_winner_credit_available count is %, expected 2.', v_count_by_type;
  END IF;
  SELECT count(*) INTO v_count_by_type FROM public.marketing_opportunities WHERE opportunity_type = 'high_value_customer_at_risk';
  IF v_count_by_type <> 2 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: high_value_customer_at_risk count is %, expected 2.', v_count_by_type;
  END IF;
  SELECT count(*) INTO v_count_by_type FROM public.marketing_opportunities WHERE opportunity_type = 'abandoned_checkout';
  IF v_count_by_type <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: abandoned_checkout count is %, expected 1.', v_count_by_type;
  END IF;

  -- BOTH recent_winner_credit_available rows: campaign, user identity, priority 1,
  -- 168h expiry, valid score/JSON, selectedAsNextBestAction=true, rn=1, dedupe.
  SELECT count(*) INTO v_bad_rows
    FROM public.marketing_opportunities
   WHERE opportunity_type = 'recent_winner_credit_available'
     -- NULL-SAFE (fail-closed): a valid row makes the conjunction TRUE and is
     -- NOT counted; any FALSE or unexpected NULL predicate makes it NOT TRUE and
     -- IS counted as bad. Never use "AND NOT (...)" here — NOT(NULL) is NULL and
     -- would let a malformed row slip through.
     AND (
       user_id IS NOT NULL
       AND external_contact_id IS NULL
       AND campaign_id IS NOT NULL
       AND state = 'open'
       AND base_priority = c_rw_priority
       AND score >= 0 AND score <= 1000
       AND expires_at > detected_at
       AND round(extract(epoch FROM (expires_at - detected_at)) / 3600)::int = c_rw_expiry
       AND jsonb_typeof(reason) = 'object'
       AND jsonb_typeof(context_snapshot) = 'object'
       AND (context_snapshot ->> 'selectedAsNextBestAction')::boolean = true
       AND (context_snapshot ->> 'rn')::int = 1
       AND dedupe_key IS NOT NULL AND length(dedupe_key) > 0
     ) IS NOT TRUE;
  IF v_bad_rows <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: % recent_winner_credit_available row(s) fail the invariant checks.', v_bad_rows;
  END IF;

  -- BOTH high_value_customer_at_risk rows: NO campaign, user identity, priority 1,
  -- 336h expiry, valid score/JSON, selectedAsNextBestAction=true, rn=1, dedupe.
  SELECT count(*) INTO v_bad_rows
    FROM public.marketing_opportunities
   WHERE opportunity_type = 'high_value_customer_at_risk'
     -- NULL-SAFE (fail-closed): see the recent_winner_credit_available block.
     -- TRUE => valid (not counted); FALSE or NULL => bad (counted).
     AND (
       user_id IS NOT NULL
       AND external_contact_id IS NULL
       AND campaign_id IS NULL
       AND state = 'open'
       AND base_priority = c_hv_priority
       AND score >= 0 AND score <= 1000
       AND expires_at > detected_at
       AND round(extract(epoch FROM (expires_at - detected_at)) / 3600)::int = c_hv_expiry
       AND jsonb_typeof(reason) = 'object'
       AND jsonb_typeof(context_snapshot) = 'object'
       AND (context_snapshot ->> 'selectedAsNextBestAction')::boolean = true
       AND (context_snapshot ->> 'rn')::int = 1
       AND dedupe_key IS NOT NULL AND length(dedupe_key) > 0
     ) IS NOT TRUE;
  IF v_bad_rows <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: % high_value_customer_at_risk row(s) fail the invariant checks.', v_bad_rows;
  END IF;

  -- abandoned_checkout row: campaign, user identity, priority 2, 24h expiry,
  -- valid score/JSON, selectedAsNextBestAction=true, rn=1, dedupe.
  SELECT count(*) INTO v_bad_rows
    FROM public.marketing_opportunities
   WHERE opportunity_type = 'abandoned_checkout'
     -- NULL-SAFE (fail-closed): see the recent_winner_credit_available block.
     -- TRUE => valid (not counted); FALSE or NULL => bad (counted).
     AND (
       user_id IS NOT NULL
       AND external_contact_id IS NULL
       AND campaign_id IS NOT NULL
       AND state = 'open'
       AND base_priority = c_ac_priority
       AND score >= 0 AND score <= 1000
       AND expires_at > detected_at
       AND round(extract(epoch FROM (expires_at - detected_at)) / 3600)::int = c_ac_expiry
       AND jsonb_typeof(reason) = 'object'
       AND jsonb_typeof(context_snapshot) = 'object'
       AND (context_snapshot ->> 'selectedAsNextBestAction')::boolean = true
       AND (context_snapshot ->> 'rn')::int = 1
       AND dedupe_key IS NOT NULL AND length(dedupe_key) > 0
     ) IS NOT TRUE;
  IF v_bad_rows <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: % abandoned_checkout row(s) fail the invariant checks.', v_bad_rows;
  END IF;

  -- ========================================================================
  -- VERIFY EXISTING CANARY UNTOUCHED (compare against preflight snapshot)
  -- ========================================================================
  SELECT count(*) INTO v_bad_rows
    FROM public.marketing_opportunities
   WHERE opportunity_type = 'new_account_no_purchase'
     AND state = v_canary_state
     AND detected_at = v_canary_detected
     AND expires_at = v_canary_expires
     AND base_priority = v_canary_priority
     AND score IS NOT DISTINCT FROM v_canary_score;
  IF v_bad_rows <> 1 THEN
    RAISE EXCEPTION 'Stage 3C2I verify aborted: existing new_account_no_purchase canary changed (matched % row(s), expected 1).', v_bad_rows;
  END IF;

  -- ========================================================================
  -- RESTORE ALL CONTROLS BEFORE COMMIT (any failure rolls back everything)
  -- ========================================================================
  UPDATE public.marketing_control_state
     SET discovery_enabled = false, rollout_limit = 0, updated_at = now()
   WHERE key = 'default';

  UPDATE public.marketing_opportunity_definitions
     SET enabled = false, updated_at = now()
   WHERE opportunity_key IN (
     'recent_winner_credit_available', 'high_value_customer_at_risk', 'abandoned_checkout'
   )
     AND enabled = true;

  -- Re-verify fully-paused end state.
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_max_batch
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: sending_enabled is % (MUST be false).', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: discovery_enabled not restored to false (is %).', v_discovery;
  END IF;
  IF v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: rollout_limit not restored to 0 (is %).', v_rollout;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: maximum_batch_size changed (% -> %).', v_max_batch_before, v_max_batch;
  END IF;

  SELECT count(*) INTO v_enabled_defs FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: % definition(s) still enabled (MUST be 0).', v_enabled_defs;
  END IF;

  -- Final ledger count.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 6 THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: final ledger count is %, expected 6.', v_opp_count;
  END IF;

  -- Recipients / automation runs must be UNCHANGED.
  SELECT count(*) INTO v_recipients_after FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_after FROM public.marketing_automation_runs;
  IF v_recipients_after <> v_recipients_before THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: marketing_recipients count changed (% -> %).', v_recipients_before, v_recipients_after;
  END IF;
  IF v_runs_after <> v_runs_before THEN
    RAISE EXCEPTION 'Stage 3C2I restore aborted: marketing_automation_runs count changed (% -> %).', v_runs_before, v_runs_after;
  END IF;

  -- ========================================================================
  -- SAFE, PII-FREE RESULT (stashed for the final SELECT below).
  -- ========================================================================
  DROP TABLE IF EXISTS pg_temp.tmp_mixed_canary_result;
  CREATE TEMP TABLE tmp_mixed_canary_result ON COMMIT DROP AS
  SELECT jsonb_build_object(
    'ok', true,
    'status', 'mixed_canary_complete',
    'startingOpportunityCount', 1,
    'insertedThisCanary', 5,
    'finalOpportunityCount', v_opp_count,
    'insertedByType', jsonb_build_object(
      'recent_winner_credit_available', 2,
      'high_value_customer_at_risk', 2,
      'abandoned_checkout', 1
    ),
    'campaignSpecificInserted', 3,
    'nonCampaignInserted', 2,
    'familiesTested', jsonb_build_array('winner', 'lifecycle', 'checkout'),
    'prioritiesTested', jsonb_build_array(1, 2),
    'rpcResults', jsonb_build_object(
      'A', jsonb_build_object('status', v_rpc_a->>'status', 'inserted', (v_rpc_a->>'inserted')::bigint, 'effectiveLimit', (v_rpc_a->>'effectiveLimit')::int),
      'B', jsonb_build_object('status', v_rpc_b->>'status', 'inserted', (v_rpc_b->>'inserted')::bigint, 'effectiveLimit', (v_rpc_b->>'effectiveLimit')::int),
      'C', jsonb_build_object('status', v_rpc_c->>'status', 'inserted', (v_rpc_c->>'inserted')::bigint, 'effectiveLimit', (v_rpc_c->>'effectiveLimit')::int)
    ),
    'controlState', jsonb_build_object(
      'sendingEnabled', v_sending,
      'discoveryEnabled', v_discovery,
      'rolloutLimit', v_rollout,
      'maximumBatchSize', v_max_batch
    ),
    'enabledDefinitions', v_enabled_defs,
    'recipientCountChanged', (v_recipients_after <> v_recipients_before),
    'automationRunCountChanged', (v_runs_after <> v_runs_before),
    'existingCanaryUnchanged', true,
    'generatedAt', now()
  ) AS mixed_canary_result;
END
$canary$;

-- ============================================================================
-- ONE SAFE RESULT (no user_id / email / external_contact_id / campaign_id /
-- dedupe_key / raw reason / context / customer hashes).
-- ============================================================================
SELECT mixed_canary_result FROM tmp_mixed_canary_result;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * On SUCCESS: marketing_opportunities holds EXACTLY 6 rows
--     (1 new_account_no_purchase + 2 recent_winner_credit_available +
--      2 high_value_customer_at_risk + 1 abandoned_checkout). Control state is
--     fully paused again (sending=false, discovery=false, rollout=0), 0
--     definitions enabled, maximum_batch_size unchanged. Nothing was sent.
--   * The original Stage 3C2G canary is byte-for-byte unchanged.
--   * marketing_recipients and marketing_automation_runs counts are unchanged.
--   * On ANY failure: the ENTIRE transaction rolls back — no new rows, no
--     temporary enablement, no discovery/rollout change persist.
--   * No recipients / runs / email / cron / AI. No schema/scoring/detector/
--     dedupe/priority/expiry change. No lifecycle-maintenance call. Migrations
--     001-015 untouched.
-- ============================================================================
