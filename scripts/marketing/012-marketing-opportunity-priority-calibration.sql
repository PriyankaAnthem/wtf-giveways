-- ============================================================================
-- Migration 012 — Marketing Opportunity Priority Calibration (Stage 3C2E)
-- ----------------------------------------------------------------------------
-- FIRST evidence-based priority calibration.
--
-- Applies ONLY three evidence-backed default_priority changes to existing rows
-- in public.marketing_opportunity_definitions, based on live read-only
-- counterfactual testing against migration 011:
--
--     opportunity_key                   before -> after
--     ------------------------------    ------    -----
--     high_value_customer_at_risk         2   ->    1
--     vip_relevant_campaign               1   ->    4
--     reactivated_customer_follow_up      4   ->    3
--
-- vip_reactivation is deliberately LEFT at priority 1 (unchanged). No other
-- definition is touched.
--
-- SAFETY: This migration is a metadata-only recalibration.
--   * It does NOT change detection logic, scoring, families, scores,
--     campaign_specific, display_name, description, or enabled.
--   * It does NOT enable any definition (all three remain enabled = false).
--   * It writes NO opportunities, recipients, or automation runs.
--   * It does NOT mutate marketing_control_state (reads it ONLY to assert
--     Marketing remains globally paused).
--   * It touches NO checkout / payment / ticket / wallet / customer-facing
--     data and adds NO AI / email / cron.
--   * It refuses to run unless the CURRENT priorities are exactly the values
--     the evidence was collected against, so it can never silently overwrite an
--     unexpected production configuration.
--
-- This file has NOT been executed. It is committed as a reviewable artifact.
-- Do NOT modify migrations 001-011.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- Preflight: READ-ONLY assertions. Abort loudly instead of overwriting an
-- unexpected configuration.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing      text[] := ARRAY[]::text[];
  v_dep          text;
  v_sending      boolean;
  v_discovery    boolean;
  v_rollout      integer;
  v_prio_hvar    integer;
  v_prio_vrc     integer;
  v_prio_rcfu    integer;
  v_enabled_bad  integer;
BEGIN
  -- 1 & 2. Required tables must exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_opportunity_definitions',
    'public.marketing_control_state'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C2E migration aborted: required dependency % is missing. Run migrations 001-011 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- Migration-specific advisory key (fixed for THIS migration only).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2e_priority_calibration')) THEN
    RAISE EXCEPTION
      'Stage 3C2E migration aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 3. Marketing must remain GLOBALLY PAUSED (read only; never mutated here).
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C2E migration aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C2E migration aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to recalibrate.',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- 4. All three target definitions must exist, and 5. their CURRENT
  --    priorities must be EXACTLY the values the evidence was collected
  --    against. If any differs, abort rather than overwrite silently.
  SELECT default_priority INTO v_prio_hvar
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'high_value_customer_at_risk';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2E migration aborted: definition high_value_customer_at_risk not found.';
  END IF;

  SELECT default_priority INTO v_prio_vrc
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'vip_relevant_campaign';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2E migration aborted: definition vip_relevant_campaign not found.';
  END IF;

  SELECT default_priority INTO v_prio_rcfu
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'reactivated_customer_follow_up';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3C2E migration aborted: definition reactivated_customer_follow_up not found.';
  END IF;

  IF v_prio_hvar IS DISTINCT FROM 2
     OR v_prio_vrc  IS DISTINCT FROM 1
     OR v_prio_rcfu IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION
      'Stage 3C2E migration aborted: unexpected current priorities (high_value_customer_at_risk=% expected 2, vip_relevant_campaign=% expected 1, reactivated_customer_follow_up=% expected 4). Refusing to overwrite.',
      v_prio_hvar, v_prio_vrc, v_prio_rcfu;
  END IF;

  -- 6. All three target definitions must remain DISABLED (enabled = false).
  SELECT count(*) INTO v_enabled_bad
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key IN (
           'high_value_customer_at_risk',
           'vip_relevant_campaign',
           'reactivated_customer_follow_up'
         )
     AND enabled IS DISTINCT FROM false;
  IF v_enabled_bad <> 0 THEN
    RAISE EXCEPTION
      'Stage 3C2E migration aborted: a target definition is unexpectedly enabled. Refusing to touch enabled definitions.';
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- Recalibration: UPDATE ONLY the three target rows, performed inside PL/pgSQL
-- so we can assert the affected-row count with GET DIAGNOSTICS and RAISE
-- EXCEPTION on any mismatch. There is NO deliberate division-by-zero (or any
-- other synthetic runtime-error) abort mechanism. default_priority is the ONLY
-- column changed (plus the table's conventional updated_at stamp). The WHERE
-- clause is doubly scoped: the exact three keys AND their exact expected
-- current priorities, so a concurrent change cannot be clobbered. enabled is
-- NOT touched. The resulting-priority and enabled invariants are re-asserted in
-- the post-update verification block below.
-- ----------------------------------------------------------------------------
DO $calibrate$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.marketing_opportunity_definitions AS d
     SET default_priority = CASE d.opportunity_key
                              WHEN 'high_value_customer_at_risk'    THEN 1
                              WHEN 'vip_relevant_campaign'          THEN 4
                              WHEN 'reactivated_customer_follow_up' THEN 3
                            END,
         updated_at = now()
   WHERE (d.opportunity_key = 'high_value_customer_at_risk'    AND d.default_priority = 2)
      OR (d.opportunity_key = 'vip_relevant_campaign'          AND d.default_priority = 1)
      OR (d.opportunity_key = 'reactivated_customer_follow_up' AND d.default_priority = 4);

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 3 THEN
    RAISE EXCEPTION
      'Stage 3C2E calibration failed: expected 3 updated rows, got %.',
      v_rows;
  END IF;
END
$calibrate$;

-- ----------------------------------------------------------------------------
-- Post-update verification: assert the FINAL state of the three rows and that
-- NO other definition drifted from its known priority is beyond this file's
-- remit — we assert only the three intended rows and their enabled flags.
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_prio_hvar    integer;
  v_prio_vrc     integer;
  v_prio_rcfu    integer;
  v_prio_vipr    integer;
  v_enabled_bad  integer;
BEGIN
  SELECT default_priority INTO v_prio_hvar
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'high_value_customer_at_risk';
  SELECT default_priority INTO v_prio_vrc
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'vip_relevant_campaign';
  SELECT default_priority INTO v_prio_rcfu
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'reactivated_customer_follow_up';
  -- vip_reactivation must be UNTOUCHED at priority 1.
  SELECT default_priority INTO v_prio_vipr
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = 'vip_reactivation';

  IF v_prio_hvar IS DISTINCT FROM 1
     OR v_prio_vrc  IS DISTINCT FROM 4
     OR v_prio_rcfu IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'Stage 3C2E verification failed: post-update priorities incorrect (high_value_customer_at_risk=% expected 1, vip_relevant_campaign=% expected 4, reactivated_customer_follow_up=% expected 3).',
      v_prio_hvar, v_prio_vrc, v_prio_rcfu;
  END IF;

  IF v_prio_vipr IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Stage 3C2E verification failed: vip_reactivation must remain priority 1 but is %.', v_prio_vipr;
  END IF;

  SELECT count(*) INTO v_enabled_bad
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key IN (
           'high_value_customer_at_risk',
           'vip_relevant_campaign',
           'reactivated_customer_follow_up'
         )
     AND enabled IS DISTINCT FROM false;
  IF v_enabled_bad <> 0 THEN
    RAISE EXCEPTION
      'Stage 3C2E verification failed: a recalibrated definition is unexpectedly enabled.';
  END IF;
END
$verify$;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * Exactly 3 rows recalibrated:
--       high_value_customer_at_risk    priority 2 -> 1
--       vip_relevant_campaign          priority 1 -> 4
--       reactivated_customer_follow_up priority 4 -> 3
--   * vip_reactivation unchanged (priority 1).
--   * All three recalibrated definitions remain enabled = false.
--   * No opportunities / recipients / runs written.
--   * marketing_control_state untouched (Marketing remains fully paused).
--   * No detection / scoring / schema changes.
-- ============================================================================
