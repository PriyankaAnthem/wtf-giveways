-- ============================================================================
-- WTF Marketing Hub — Stage 3D2C: ONE-RECIPIENT MATERIALISATION CANARY
-- ----------------------------------------------------------------------------
-- MIGRATION 021 (MANUAL, ONE-TIME CANARY — NOT part of the automatic chain)
--
-- PURPOSE
--   Prove the ENTIRE Stage 019/020 recipient chain end-to-end, ONCE, without
--   sending anything, for the CAMPAIGN-SPECIFIC opportunity type
--   abandoned_checkout (the only type with isolated safe canary candidates in
--   the current live universe):
--
--       canonical-detector rn=1 abandoned_checkout winner (NON-NULL campaign)
--         + independent permission authority (profile + is_marketing_email_eligible)
--         + isolation from any pre-existing active opportunity/recipient
--         -> valid abandoned_checkout opportunity (direct insert in the EXACT
--            canonical Stage 013 (3C2F) persisted shape: campaign_id = frozen
--            detector campaign, base_priority = detector.default_priority,
--            score = detector.final_score, canonical reason/context_snapshot,
--            discv1 expiry-window dedupe key CONTAINING the real campaign UUID)
--         -> authoritative Stage 019 delivery route
--         -> canonical Stage 019 private recipient gate (gate_eligible = true,
--            campaign_context_valid = true)
--         -> preparing Stage 020 automation run
--         -> exactly ONE queued recipient
--         -> opportunity open -> selected
--
--   The canary INTENTIONALLY leaves behind, as durable proof of materialisation:
--       + 1 additional marketing_opportunity   (state = selected)
--       + 1 marketing_recipient                (status = queued, unsent)
--       + 1 marketing_automation_run           (status = preparing)
--
--   The recipient MUST remain UNSENT.
--
-- ABSOLUTE SAFETY RULE
--   GLOBAL SENDING (marketing_control_state.sending_enabled) MUST REMAIN false
--   FOR THE ENTIRE TRANSACTION. This canary:
--     * NEVER enables sending, NEVER enables discovery.
--     * NEVER calls a provider / Resend / any delivery path.
--     * NEVER advances the run beyond 'preparing'.
--     * NEVER populates sent_at / provider_email_id / delivered_at / clicked_at
--       / bounced_at / complained_at.
--     * NEVER fabricates content (template_snapshot / context_snapshot /
--       discount_code_snapshot are left at schema defaults by the materialiser).
--     * Uses gate_eligible (staging), NOT sendable_now (which stays false).
--     * NEVER modifies consent, campaigns, checkout, payment, tickets or wallet.
--
-- ATOMICITY
--   Single BEGIN/COMMIT, NO exception handler. ANY RAISE rolls back EVERYTHING —
--   temporary definition/automation/rollout enablement, the inserted opportunity,
--   the run, the recipient and the opportunity transition — together. The ONLY
--   state intentionally left behind on success is the three canary rows; ALL
--   control/definition/automation kill switches are restored to fully paused
--   BEFORE COMMIT.
--
-- OWNER / PERMISSIONS
--   The canonical gate public.wtf_marketing_recipient_gate_preview() is PRIVATE
--   (EXECUTE revoked from service_role/anon/authenticated). This canary calls it
--   DIRECTLY, so it MUST be run by the database OWNER / a superuser in the
--   Supabase SQL editor (or psql as the owner) — exactly like migrations 001-020.
--   It is NOT an application function, NOT cron, NOT a delivery worker.
--
-- SCOPE
--   Migrations 001-020 are NOT modified. NO schema/RLS/policy/trigger change.
--   NO AI, NO cron, NO external contacts, NO consent/frequency-cap change, NO
--   campaign change, NO checkout/payment/ticket/wallet/customer-facing change.
--
-- PRIVACY
--   The single returned JSON payload is PII-free: no user_id, email_lc,
--   campaign_id, opportunity_id, recipient_id, run_id or automation_id. Identity
--   columns are used ONLY inside boolean NULL predicates and internal joins.
-- ============================================================================

BEGIN;

-- Fail fast rather than block a busy production database; never run away.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $canary$
DECLARE
  -- CAMPAIGN-SPECIFIC canary type. abandoned_checkout is the only opportunity
  -- type with isolated safe canary candidates in the current live universe.
  c_opp_type          constant text    := 'abandoned_checkout';

  v_dep               text;
  v_missing           text[] := ARRAY[]::text[];

  -- Control state.
  v_sending           boolean;
  v_discovery         boolean;
  v_rollout           integer;
  v_max_batch         integer;
  v_daily_cap         integer;
  v_weekly_cap        integer;
  v_max_batch_before  integer;
  v_daily_cap_before  integer;
  v_weekly_cap_before integer;

  -- Ledger baselines.
  v_opp_before        bigint;
  v_recip_before      bigint;
  v_runs_before       bigint;
  v_enabled_defs      bigint;
  v_enabled_autos     bigint;
  v_enabled_autos_before bigint;

  -- abandoned_checkout definition snapshot. default_priority / default_score /
  -- default_expiry_hours are READ from the LIVE definition and used only where
  -- the canonical detector / Stage 013 contract requires them (NEVER invented).
  v_def_enabled       boolean;
  v_def_campaign      boolean;   -- campaign_specific (MUST be true)
  v_def_priority      integer;   -- default_priority (live)
  v_def_score         numeric;   -- default_score (live, audited only)
  v_def_expiry        integer;   -- default_expiry_hours (live)
  v_def_route_id      uuid;      -- delivery_automation_id (MUST be non-null)

  -- Routed delivery automation snapshot.
  v_auto_enabled      boolean;

  -- Chosen canary user.
  v_user_id           uuid;
  v_email_lc          text;
  v_snapshot_diag     boolean;

  -- FROZEN canonical detector outputs for the selected rn=1 winner. Captured
  -- ONCE at selection and persisted verbatim in the Stage 013 canonical shape.
  -- Detector scoring is NEVER re-evaluated after selection.
  v_det_family        text;
  v_det_def_priority  integer;   -- detector.default_priority (== definition.default_priority)
  v_det_def_score     integer;   -- detector.default_score (catalogue default, audited only)
  v_det_campaign_id   uuid;      -- detector.campaign_id (MUST be non-null; the real campaign)
  v_det_final_score   integer;   -- detector.final_score (PERSISTED score, 0..1000)
  v_det_score_comp    jsonb;     -- detector.score_components
  v_det_is_closing    boolean;   -- detector.is_closing
  v_detected_at       timestamptz;  -- ONE frozen timestamp for detected_at/expires_at/dedupe

  -- Canonical-detector re-confirmation (drift guard before writes). The user is
  -- SELECTED from the detector and must STILL be a rn=1 abandoned_checkout winner
  -- with the EXACT SAME campaign_id immediately before we materialise.
  v_det_key           text;
  v_det_rn            integer;
  v_det_campaign      uuid;
  v_det_found         boolean;

  -- Defence-in-depth campaign validity (Stage 019 gate remains authoritative).
  v_camp_found        boolean;
  v_camp_status       text;
  v_camp_end_at       timestamptz;

  -- Inserted canary opportunity.
  v_opp_id            uuid;
  v_dedupe_key        text;
  v_expires_at        timestamptz;

  -- Gate row (the canary opportunity only).
  v_g_profile_matched boolean;
  v_g_account_active  boolean;
  v_g_email_confirmed boolean;
  v_g_marketing_enabled boolean;
  v_g_has_suppression boolean;
  v_g_auth_eligible   boolean;
  v_g_def_enabled     boolean;
  v_g_campaign_valid  boolean;
  v_g_route_mapped    boolean;
  v_g_route_enabled   boolean;
  v_g_route_ready     boolean;
  v_g_existing_recip  boolean;
  v_g_freq_eligible   boolean;
  v_g_pre_nba         boolean;
  v_g_next_best_rank  bigint;
  v_g_gate_eligible   boolean;
  v_g_sendable_now    boolean;
  v_g_found           boolean;

  -- Materialiser result + post assertions.
  v_rpc               jsonb;
  v_opp_after         bigint;
  v_recip_after       bigint;
  v_runs_after        bigint;

  v_r_user_id         uuid;
  v_r_external        uuid;
  v_r_email_lc        text;
  v_r_run_id          uuid;
  v_r_status          text;
  v_r_idem            text;
  v_r_tmpl            jsonb;
  v_r_ctx             jsonb;
  v_r_discount        jsonb;
  v_r_sent_at         timestamptz;
  v_r_provider        text;
  v_r_delivered       timestamptz;
  v_r_clicked         timestamptz;
  v_r_bounced         timestamptz;
  v_r_complained      timestamptz;
  v_r_attempts        integer;
  v_r_locked_at       timestamptz;
  v_r_locked_until    timestamptz;

  v_run_auto_id       uuid;
  v_run_promo_id      uuid;
  v_run_status        text;

  v_opp_state         text;
  v_opp_selected_at   timestamptz;
  v_opp_actioned_at   timestamptz;
  v_opp_auto_prov     uuid;
  v_opp_campaign_final uuid;
  v_other_changed     bigint;

  -- Final gate re-check.
  v_gate_eligible_after bigint;
  v_sendable_now_after  bigint;
BEGIN
  -- ========================================================================
  -- SINGLE-EXECUTION GUARD — canary-specific advisory key, distinct from all
  -- prior migration/canary/RPC keys.
  -- ========================================================================
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3d2c_one_recipient_canary')) THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- ========================================================================
  -- PREFLIGHT — ALL read-only assertions BEFORE any write.
  -- ========================================================================
  -- 1. Required tables + private gate + materialiser RPC exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.customer_marketing_profiles',
    'public.marketing_opportunities',
    'public.marketing_opportunity_definitions',
    'public.marketing_automations',
    'public.marketing_recipients',
    'public.marketing_automation_runs',
    'public.marketing_control_state',
    'public.campaigns'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: required dependency % is missing.', array_to_string(v_missing, ', ');
  END IF;

  IF to_regprocedure('public.is_marketing_email_eligible(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: is_marketing_email_eligible(uuid,text) is missing.';
  END IF;
  -- The canonical Stage 011/013 detector/arbitrator is the SOLE source of truth
  -- for which users have a genuine abandoned_checkout opportunity (including the
  -- campaign-specific live-campaign universe + rn=1 arbitration).
  IF to_regprocedure('public.wtf_marketing_opportunity_candidates_preview()') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: canonical detector wtf_marketing_opportunity_candidates_preview() is missing (Stage 011).';
  END IF;
  IF to_regprocedure('public.wtf_marketing_recipient_gate_preview()') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: private gate wtf_marketing_recipient_gate_preview() is missing (Stage 019).';
  END IF;
  IF to_regprocedure('public.materialize_marketing_recipients(integer)') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: materialize_marketing_recipients(integer) is missing (Stage 020).';
  END IF;

  -- 2. Control state EXACTLY paused; capture frequency caps + batch (never changed).
  SELECT sending_enabled, discovery_enabled, rollout_limit,
         maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact
    INTO v_sending, v_discovery, v_rollout,
         v_max_batch_before, v_daily_cap_before, v_weekly_cap_before
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: Marketing is not paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%).',
      v_sending, v_discovery, v_rollout;
  END IF;
  IF COALESCE(v_max_batch_before, 0) < 1 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: maximum_batch_size=% is < 1; cannot materialise one recipient.', v_max_batch_before;
  END IF;

  -- 3. Baselines: opportunities 6, recipients 0, runs 0.
  SELECT count(*) INTO v_opp_before   FROM public.marketing_opportunities;
  SELECT count(*) INTO v_recip_before FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_before  FROM public.marketing_automation_runs;
  IF v_opp_before <> 6 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: marketing_opportunities holds % row(s); expected exactly 6.', v_opp_before;
  END IF;
  IF v_recip_before <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: marketing_recipients holds % row(s); expected 0.', v_recip_before;
  END IF;
  IF v_runs_before <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: marketing_automation_runs holds % row(s); expected 0.', v_runs_before;
  END IF;

  -- 4. No definition enabled, no automation enabled at preflight.
  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: % definition(s) already enabled; expected 0.', v_enabled_defs;
  END IF;
  SELECT count(*) INTO v_enabled_autos_before
    FROM public.marketing_automations WHERE enabled = true;
  IF v_enabled_autos_before <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: % automation(s) already enabled; expected 0.', v_enabled_autos_before;
  END IF;

  -- 5. abandoned_checkout definition exists, disabled, campaign-specific, mapped
  --    to a route. default_priority/default_score/default_expiry_hours are READ
  --    from the LIVE definition (NEVER invented / no hardcoded constants). The
  --    only asserted real invariants are: enabled=false, campaign_specific=true,
  --    delivery_automation_id IS NOT NULL.
  SELECT enabled, campaign_specific, default_priority, default_score,
         default_expiry_hours, delivery_automation_id
    INTO v_def_enabled, v_def_campaign, v_def_priority, v_def_score,
         v_def_expiry, v_def_route_id
    FROM public.marketing_opportunity_definitions
   WHERE opportunity_key = c_opp_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: definition % does not exist.', c_opp_type;
  END IF;
  IF v_def_enabled THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: definition % is already enabled.', c_opp_type;
  END IF;
  IF v_def_campaign IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: %.campaign_specific=% (expected true — abandoned_checkout is campaign-specific).', c_opp_type, v_def_campaign;
  END IF;
  IF v_def_priority IS NULL OR v_def_score IS NULL OR v_def_expiry IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: % definition defaults are NULL (priority=%, score=%, expiry=%).', c_opp_type, v_def_priority, v_def_score, v_def_expiry;
  END IF;
  IF v_def_expiry <= 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: %.default_expiry_hours=% is not positive.', c_opp_type, v_def_expiry;
  END IF;
  IF v_def_route_id IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: %.delivery_automation_id is NULL (no authoritative Stage 019 route).', c_opp_type;
  END IF;

  -- 6. Routed delivery automation exists and is DISABLED at preflight.
  SELECT enabled INTO v_auto_enabled
    FROM public.marketing_automations WHERE id = v_def_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: routed delivery automation for % does not exist.', c_opp_type;
  END IF;
  IF v_auto_enabled THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: routed delivery automation for % is already enabled.', c_opp_type;
  END IF;

  -- 7. No active (preparing/queued/processing) run for the routed automation +
  --    NULL promotion (the Stage 020 run group for this canary).
  PERFORM 1
     FROM public.marketing_automation_runs
    WHERE automation_id = v_def_route_id
      AND promotion_id IS NULL
      AND status IN ('preparing', 'queued', 'processing');
  IF FOUND THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: an active run already exists for the routed automation + NULL promotion.';
  END IF;

  -- ========================================================================
  -- CANARY USER SELECTION — SOURCED FROM THE CANONICAL DETECTOR.
  --   COMMERCIAL DETECTION and CONTACT PERMISSION are kept STRICTLY separate:
  --
  --   (1) DETECTION AUTHORITY — public.wtf_marketing_opportunity_candidates_preview():
  --       The detector alone decides who has a genuine abandoned_checkout
  --       opportunity. We require detector.opportunity_key = the canary type,
  --       detector.rn = 1 (the arbitrated winner) and detector.campaign_id
  --       IS NOT NULL (abandoned_checkout is campaign-specific). This inherits —
  --       WITHOUT re-deriving — the detector's campaign-specific + live-campaign
  --       semantics. We deliberately do NOT re-express those predicates here.
  --       Detector permission-snapshot fields (perm_backed / sendable_now / ...)
  --       are NEVER used as contact authority.
  --
  --   (2) PERMISSION AUTHORITY — the profile flags + is_marketing_email_eligible():
  --       Independently of detection, the chosen user MUST be a live, confirmed,
  --       marketing-enabled, unsuppressed profile AND pass the authoritative
  --       runtime consent function. marketing_eligible_snapshot is captured ONLY
  --       as a diagnostic and is NOT the authority.
  --
  --   (3) ISOLATION — the user must be free of any pre-existing ACTIVE (working)
  --       opportunity so it cannot interfere with NBA/materialisation, and free
  --       of any existing recipient.
  -- ========================================================================
  SELECT p.user_id, p.email_lc, p.marketing_eligible_snapshot,
         -- FREEZE the exact detector outputs needed to persist the canonical
         -- Stage 013 opportunity shape. No re-scoring happens after this.
         detector.family, detector.default_priority, detector.default_score,
         detector.campaign_id, detector.final_score, detector.score_components,
         detector.is_closing
    INTO v_user_id, v_email_lc, v_snapshot_diag,
         v_det_family, v_det_def_priority, v_det_def_score,
         v_det_campaign_id, v_det_final_score, v_det_score_comp,
         v_det_is_closing
    -- DETECTION comes first and is authoritative for the opportunity itself.
    FROM public.wtf_marketing_opportunity_candidates_preview() detector
    JOIN public.customer_marketing_profiles p
      ON p.user_id = detector.user_id
   WHERE detector.opportunity_key = c_opp_type   -- abandoned_checkout
     AND detector.rn = 1                          -- arbitrated winner ONLY
     AND detector.campaign_id IS NOT NULL         -- campaign-specific opportunity
     -- PERMISSION AUTHORITY (kept separate from detection).
     AND p.user_id IS NOT NULL
     AND p.email_lc IS NOT NULL
     AND length(btrim(p.email_lc)) > 0
     AND p.account_active = true
     AND p.email_confirmed = true
     AND p.marketing_enabled = true
     AND p.has_active_suppression = false
     -- AUTHORITATIVE consent re-check (NOT the detector/profile snapshot).
     AND public.is_marketing_email_eligible(p.user_id, p.email_lc) IS TRUE
     -- ISOLATION 1: no existing recipient for that user (any run).
     AND NOT EXISTS (
       SELECT 1 FROM public.marketing_recipients r WHERE r.user_id = p.user_id
     )
     -- ISOLATION 2: no pre-existing ACTIVE (working) opportunity of ANY type.
     -- The opportunity state CHECK is: open, selected, suppressed, deferred,
     -- expired, superseded, actioned. The still-active/working states that could
     -- interfere with NBA/materialisation are open, selected and deferred; we
     -- exclude any non-expired row in those states, of ANY opportunity_type.
     AND NOT EXISTS (
       SELECT 1 FROM public.marketing_opportunities o
        WHERE o.user_id = p.user_id
          AND o.state IN ('open', 'selected', 'deferred')
          AND o.expires_at > now()
     )
   ORDER BY p.account_created_at ASC NULLS LAST, p.user_id ASC
   LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Do NOT relax detection, permission or isolation to manufacture a candidate.
    RAISE EXCEPTION 'no_safe_canary_user';
  END IF;

  -- The frozen detector campaign MUST be a real campaign (non-null) — the
  -- selection already required it, but assert the frozen value explicitly.
  IF v_det_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: frozen detector campaign_id is NULL (abandoned_checkout MUST carry a real campaign).';
  END IF;

  -- DETECTOR CONSISTENCY RE-CONFIRMATION (drift guard).
  --   Prove — BEFORE any write — that the chosen user is STILL present in the
  --   canonical detector as an rn=1 abandoned_checkout winner carrying the EXACT
  --   SAME campaign_id (not merely "some" non-null campaign). Robust against
  --   detector/campaign drift between selection and materialisation.
  SELECT true, detector.opportunity_key, detector.rn, detector.campaign_id
    INTO v_det_found, v_det_key, v_det_rn, v_det_campaign
    FROM public.wtf_marketing_opportunity_candidates_preview() detector
   WHERE detector.user_id = v_user_id
     AND detector.opportunity_key = c_opp_type
     AND detector.rn = 1
     AND detector.campaign_id = v_det_campaign_id;   -- EXACT campaign equality
  IF v_det_found IS DISTINCT FROM true
     OR v_det_key IS DISTINCT FROM c_opp_type
     OR v_det_rn  IS DISTINCT FROM 1
     OR v_det_campaign IS DISTINCT FROM v_det_campaign_id THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: canonical detector no longer confirms the chosen user as an rn=1 % winner with the frozen campaign (key=%, rn=%, campaign matches=%).',
      c_opp_type, v_det_key, v_det_rn, (v_det_campaign IS NOT DISTINCT FROM v_det_campaign_id);
  END IF;

  -- CAMPAIGN VALIDITY RE-CHECK (defence in depth only — the Stage 019 private
  -- gate remains the final authoritative campaign-context check). Independently
  -- verify the frozen detector campaign exists in public.campaigns and satisfies
  -- the SAME live/open semantics the gate uses:
  --     status = 'live' AND (end_at IS NULL OR end_at > now())
  -- We do NOT update the campaign.
  SELECT true, c.status, c.end_at
    INTO v_camp_found, v_camp_status, v_camp_end_at
    FROM public.campaigns c
   WHERE c.id = v_det_campaign_id;
  IF v_camp_found IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: frozen detector campaign does not exist in public.campaigns.';
  END IF;
  IF NOT (v_camp_status = 'live' AND (v_camp_end_at IS NULL OR v_camp_end_at > now())) THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: frozen detector campaign is not live/open (status=%, end_at in future=%).',
      v_camp_status, (v_camp_end_at IS NULL OR v_camp_end_at > now());
  END IF;

  -- FROZEN-VALUE INVARIANTS.
  --   (a) The detector's default_priority is catalogue-authoritative and MUST
  --       equal the definition's configured default_priority (a contract of the
  --       current detector — see 011: def.default_priority feeds the candidate).
  --       base_priority is persisted from the DETECTOR value below.
  IF v_det_def_priority IS DISTINCT FROM v_def_priority THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: detector.default_priority (%) <> definition.default_priority (%).',
      v_det_def_priority, v_def_priority;
  END IF;
  --   (b) final_score is the DYNAMIC persisted score. It may differ from the
  --       definition default (dynamic components), but MUST be within the
  --       opportunity score bounds [0,1000] enforced by the detector/schema.
  IF v_det_final_score IS NULL
     OR v_det_final_score < 0
     OR v_det_final_score > 1000 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: detector.final_score % is outside the allowed [0,1000] opportunity score bounds.',
      v_det_final_score;
  END IF;

  -- ========================================================================
  -- TEMPORARY ENABLEMENT — ONLY these three switches, inside this txn.
  --   Sending / discovery / batch / daily cap / weekly cap are NEVER changed.
  -- ========================================================================
  -- 1) routed delivery automation false -> true
  UPDATE public.marketing_automations
     SET enabled = true, updated_at = now()
   WHERE id = v_def_route_id;

  -- 2) abandoned_checkout definition false -> true
  UPDATE public.marketing_opportunity_definitions
     SET enabled = true, updated_at = now()
   WHERE opportunity_key = c_opp_type;

  -- 3) rollout_limit 0 -> 1  (and nothing else)
  UPDATE public.marketing_control_state
     SET rollout_limit = 1, updated_at = now()
   WHERE key = 'default';

  -- Guard: sending/discovery/caps/batch untouched by the enablement.
  SELECT sending_enabled, discovery_enabled, rollout_limit,
         maximum_batch_size, maximum_daily_per_contact, maximum_weekly_per_contact
    INTO v_sending, v_discovery, v_rollout, v_max_batch, v_daily_cap, v_weekly_cap
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: sending_enabled changed to % during enablement.', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: discovery_enabled changed to % during enablement.', v_discovery;
  END IF;
  IF v_rollout IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: rollout_limit=% after enablement (expected 1).', v_rollout;
  END IF;
  IF v_max_batch IS DISTINCT FROM v_max_batch_before
     OR v_daily_cap IS DISTINCT FROM v_daily_cap_before
     OR v_weekly_cap IS DISTINCT FROM v_weekly_cap_before THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: batch/frequency caps changed during enablement.';
  END IF;

  -- Exactly one definition and one automation enabled now.
  SELECT count(*) INTO v_enabled_defs  FROM public.marketing_opportunity_definitions WHERE enabled = true;
  SELECT count(*) INTO v_enabled_autos FROM public.marketing_automations WHERE enabled = true;
  IF v_enabled_defs <> 1 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: expected exactly 1 enabled definition, found %.', v_enabled_defs;
  END IF;
  IF v_enabled_autos <> 1 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: expected exactly 1 enabled automation, found %.', v_enabled_autos;
  END IF;

  -- ========================================================================
  -- CANARY OPPORTUNITY CREATION — exactly ONE, directly inserted, in the
  -- EXACT CANONICAL Stage 013 (3C2F) persisted shape. This row is intentionally
  -- left permanently in the production ledger, so it MUST be indistinguishable
  -- from a genuine discovery-persisted opportunity — no synthetic canary format.
  --
  --   Reproduces public.discover_marketing_opportunities()'s persistence
  --   verbatim for an rn=1 campaign-specific winner (see migration 013):
  --     * automation_id NULL, external_contact_id NULL, promotion_id NULL
  --     * campaign_id = frozen detector.campaign_id (a REAL campaign)
  --     * base_priority = detector.default_priority (frozen)
  --     * score        = detector.final_score      (frozen, NOT the definition)
  --     * detected_at  = v_detected_at (ONE frozen timestamp)
  --     * expires_at   = detected_at + definition.default_expiry_hours
  --     * canonical reason / context_snapshot JSON (stage/detector = 3C2F)
  --     * canonical discv1 expiry-window dedupe key CONTAINING the real campaign
  --   This is STILL a DIRECT insert — discovery is NEVER enabled or invoked.
  -- ========================================================================
  -- ONE frozen timestamp for detected_at, expires_at AND the dedupe window.
  v_detected_at := now();
  v_expires_at  := v_detected_at + make_interval(hours => v_def_expiry);

  -- CANONICAL Stage 013 expiry-window-bucketed dedupe key (discv1). Because
  -- abandoned_checkout is campaign-specific, campaign_id is the REAL frozen
  -- detector campaign UUID (NEVER '-'). Bucket is
  -- floor(detected_at_epoch / (GREATEST(default_expiry_hours,1) * 3600)).
  v_dedupe_key :=
    'discv1:' || v_user_id::text
    || ':' || c_opp_type
    || ':' || v_det_campaign_id::text     -- REAL campaign UUID (never '-')
    || ':w' || floor(
         extract(epoch FROM v_detected_at)
         / (GREATEST(v_def_expiry, 1) * 3600)
       )::bigint::text;

  -- Canonical dedupe MUST be collision-free. Do NOT invent an alternate key.
  IF EXISTS (
    SELECT 1 FROM public.marketing_opportunities o WHERE o.dedupe_key = v_dedupe_key
  ) THEN
    RAISE EXCEPTION 'canary_canonical_dedupe_conflict';
  END IF;

  INSERT INTO public.marketing_opportunities (
    user_id,
    external_contact_id,
    email_lc,
    automation_id,          -- NULL provenance (Stage 019 routing is authoritative)
    opportunity_type,       -- detector.opportunity_key -> definitions FK
    campaign_id,            -- frozen detector.campaign_id (REAL campaign)
    promotion_id,           -- NULL (no promotion context from candidates)
    detected_at,            -- frozen invocation timestamp
    expires_at,             -- detected_at + definition default_expiry_hours
    base_priority,          -- detector.default_priority (frozen)
    score,                  -- detector.final_score (frozen, NOT definition default)
    state,                  -- open
    reason,                 -- CANONICAL Stage 013 reason
    context_snapshot,       -- CANONICAL Stage 013 context
    dedupe_key              -- CANONICAL discv1 expiry-window key (with campaign)
  )
  VALUES (
    v_user_id,
    NULL,
    v_email_lc,
    NULL,
    c_opp_type,
    v_det_campaign_id,
    NULL,
    v_detected_at,
    v_expires_at,
    v_det_def_priority,
    v_det_final_score,
    'open',
    jsonb_build_object(
      'definitionKey', c_opp_type,
      'family',        v_det_family,
      'detector',      'wtf_marketing_opportunity_candidates_preview',
      'stage',         '3C2F',
      'basePriority',  v_det_def_priority,
      'finalScore',    v_det_final_score,
      'isClosing',     v_det_is_closing
    ),
    jsonb_build_object(
      'scoreComponents',          v_det_score_comp,
      'campaignId',               v_det_campaign_id,
      'detectorStage',            '3C2F',
      'selectedAsNextBestAction', true,
      'rn',                       1
    ),
    v_dedupe_key
  )
  RETURNING id INTO v_opp_id;

  -- Ledger must now be exactly 7.
  SELECT count(*) INTO v_opp_after FROM public.marketing_opportunities;
  IF v_opp_after <> 7 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: ledger is % after insert (expected 7).', v_opp_after;
  END IF;

  -- ========================================================================
  -- CANONICAL PERSISTED-SHAPE ASSERTIONS — the durable opportunity MUST match
  -- the exact Stage 013 discovery shape, BEFORE we touch the gate.
  -- ========================================================================
  DECLARE
    v_o_user      uuid;
    v_o_external  uuid;
    v_o_email     text;
    v_o_auto      uuid;
    v_o_type      text;
    v_o_campaign  uuid;
    v_o_promo     uuid;
    v_o_detected  timestamptz;
    v_o_expires   timestamptz;
    v_o_priority  integer;
    v_o_score     integer;
    v_o_state     text;
    v_o_reason    jsonb;
    v_o_ctx       jsonb;
    v_o_dedupe    text;
  BEGIN
    SELECT o.user_id, o.external_contact_id, o.email_lc, o.automation_id,
           o.opportunity_type, o.campaign_id, o.promotion_id,
           o.detected_at, o.expires_at, o.base_priority, o.score, o.state,
           o.reason, o.context_snapshot, o.dedupe_key
      INTO v_o_user, v_o_external, v_o_email, v_o_auto,
           v_o_type, v_o_campaign, v_o_promo,
           v_o_detected, v_o_expires, v_o_priority, v_o_score, v_o_state,
           v_o_reason, v_o_ctx, v_o_dedupe
      FROM public.marketing_opportunities o
     WHERE o.id = v_opp_id;

    IF v_o_user     IS DISTINCT FROM v_user_id
       OR v_o_external IS NOT NULL
       OR v_o_email    IS DISTINCT FROM v_email_lc
       OR v_o_auto     IS NOT NULL
       OR v_o_type     IS DISTINCT FROM c_opp_type
       -- campaign_id is the frozen REAL detector campaign (NOT NULL).
       OR v_o_campaign IS DISTINCT FROM v_det_campaign_id
       OR v_o_campaign IS NULL
       OR v_o_promo    IS NOT NULL
       OR v_o_detected IS DISTINCT FROM v_detected_at
       OR v_o_expires  IS DISTINCT FROM v_expires_at
       -- expiry difference equals the definition's configured default_expiry_hours.
       OR v_o_expires  IS DISTINCT FROM (v_o_detected + make_interval(hours => v_def_expiry))
       OR v_o_priority IS DISTINCT FROM v_det_def_priority
       OR v_o_score    IS DISTINCT FROM v_det_final_score
       OR v_o_state    IS DISTINCT FROM 'open'
       OR v_o_dedupe   IS DISTINCT FROM v_dedupe_key THEN
      RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: persisted opportunity is not the canonical Stage 013 shape (type=%, auto set=%, campaign matches=%, promo set=%, priority=%, score=%, state=%).',
        v_o_type, (v_o_auto IS NOT NULL), (v_o_campaign IS NOT DISTINCT FROM v_det_campaign_id),
        (v_o_promo IS NOT NULL), v_o_priority, v_o_score, v_o_state;
    END IF;

    -- Canonical reason structure (Stage 013 / 3C2F).
    IF v_o_reason->>'definitionKey' IS DISTINCT FROM c_opp_type
       OR v_o_reason->>'family'     IS DISTINCT FROM v_det_family
       OR v_o_reason->>'detector'   IS DISTINCT FROM 'wtf_marketing_opportunity_candidates_preview'
       OR v_o_reason->>'stage'      IS DISTINCT FROM '3C2F'
       OR (v_o_reason->>'basePriority')::int IS DISTINCT FROM v_det_def_priority
       OR (v_o_reason->>'finalScore')::int   IS DISTINCT FROM v_det_final_score
       OR (v_o_reason->>'isClosing')::boolean IS DISTINCT FROM v_det_is_closing THEN
      RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: persisted reason is not the canonical Stage 013 structure (%).', v_o_reason;
    END IF;

    -- Canonical context_snapshot structure (Stage 013 / 3C2F). Unlike the old
    -- new-account version, campaignId MUST be the REAL detector campaign UUID —
    -- NEVER JSON null.
    IF v_o_ctx->'scoreComponents' IS DISTINCT FROM v_det_score_comp
       OR (v_o_ctx->>'detectorStage') IS DISTINCT FROM '3C2F'
       OR (v_o_ctx->>'selectedAsNextBestAction')::boolean IS DISTINCT FROM true
       OR (v_o_ctx->>'rn')::int IS DISTINCT FROM 1
       OR (v_o_ctx ? 'campaignId') IS DISTINCT FROM true
       OR jsonb_typeof(v_o_ctx->'campaignId') IS DISTINCT FROM 'string'
       OR (v_o_ctx->>'campaignId')::uuid IS DISTINCT FROM v_det_campaign_id THEN
      RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: persisted context_snapshot is not the canonical Stage 013 structure or campaignId is not the frozen detector campaign (%).', v_o_ctx;
    END IF;

    -- NO canary-only markers may leak into the durable production payload.
    IF (v_o_reason ? 'canary') OR (v_o_ctx ? 'canary')
       OR (v_o_reason ? 'source') THEN
      RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: canary-only markers leaked into the canonical opportunity payload.';
    END IF;
  END;

  -- ========================================================================
  -- VERIFY THE GATE BEFORE MATERIALISING — call the PRIVATE canonical gate
  -- directly (as owner). Require gate_eligible = true, campaign_context_valid =
  -- true, sendable_now = FALSE.
  -- ========================================================================
  SELECT true,
         g.profile_matched, g.account_active, g.email_confirmed,
         g.marketing_enabled, g.has_active_suppression,
         g.authoritative_marketing_eligible, g.definition_enabled,
         g.campaign_context_valid, g.delivery_automation_mapped,
         g.delivery_automation_enabled, g.delivery_route_ready,
         g.existing_recipient, g.frequency_eligible, g.pre_nba_gate_eligible,
         g.next_best_rank, g.gate_eligible, g.sendable_now
    INTO v_g_found,
         v_g_profile_matched, v_g_account_active, v_g_email_confirmed,
         v_g_marketing_enabled, v_g_has_suppression,
         v_g_auth_eligible, v_g_def_enabled,
         v_g_campaign_valid, v_g_route_mapped,
         v_g_route_enabled, v_g_route_ready,
         v_g_existing_recip, v_g_freq_eligible, v_g_pre_nba,
         v_g_next_best_rank, v_g_gate_eligible, v_g_sendable_now
    FROM public.wtf_marketing_recipient_gate_preview() g
   WHERE g.opportunity_id = v_opp_id;

  IF v_g_found IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: canary opportunity not present in the private gate output.';
  END IF;

  IF v_g_profile_matched   IS DISTINCT FROM true
     OR v_g_account_active IS DISTINCT FROM true
     OR v_g_email_confirmed IS DISTINCT FROM true
     OR v_g_marketing_enabled IS DISTINCT FROM true
     OR v_g_has_suppression IS DISTINCT FROM false
     OR v_g_auth_eligible  IS DISTINCT FROM true
     OR v_g_def_enabled    IS DISTINCT FROM true
     OR v_g_campaign_valid IS DISTINCT FROM true
     OR v_g_route_mapped   IS DISTINCT FROM true
     OR v_g_route_enabled  IS DISTINCT FROM true
     OR v_g_route_ready    IS DISTINCT FROM true
     OR v_g_existing_recip IS DISTINCT FROM false
     OR v_g_freq_eligible  IS DISTINCT FROM true
     OR v_g_pre_nba        IS DISTINCT FROM true
     OR v_g_next_best_rank IS DISTINCT FROM 1
     OR v_g_gate_eligible  IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: gate for canary opportunity is not fully eligible (profile=%, active=%, confirmed=%, mktg=%, suppression=%, authEligible=%, defEnabled=%, campaignValid=%, routeMapped=%, routeEnabled=%, routeReady=%, existingRecip=%, freq=%, preNba=%, rank=%, gateEligible=%).',
      v_g_profile_matched, v_g_account_active, v_g_email_confirmed,
      v_g_marketing_enabled, v_g_has_suppression, v_g_auth_eligible,
      v_g_def_enabled, v_g_campaign_valid, v_g_route_mapped,
      v_g_route_enabled, v_g_route_ready, v_g_existing_recip,
      v_g_freq_eligible, v_g_pre_nba, v_g_next_best_rank, v_g_gate_eligible;
  END IF;

  -- CRITICAL: sending is still globally false, so sendable_now MUST be false.
  IF v_g_sendable_now IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: sendable_now is % for the canary (MUST be false — global sending is paused).', v_g_sendable_now;
  END IF;

  -- ========================================================================
  -- MATERIALISE EXACTLY ONE.
  -- ========================================================================
  SELECT public.materialize_marketing_recipients(1) INTO v_rpc;

  IF (v_rpc->>'status') IS DISTINCT FROM 'ok'
     OR (v_rpc->>'effectiveLimit')::int      IS DISTINCT FROM 1
     OR (v_rpc->>'finalCandidateCount')::bigint IS DISTINCT FROM 1
     OR (v_rpc->>'insertedRecipients')::bigint  IS DISTINCT FROM 1
     OR (v_rpc->>'opportunitiesSelected')::bigint IS DISTINCT FROM 1
     OR (v_rpc->>'runsCreated')::bigint       IS DISTINCT FROM 1
     OR (v_rpc->>'runsReused')::bigint        IS DISTINCT FROM 0
     OR (v_rpc->>'groupCount')::bigint        IS DISTINCT FROM 1
     OR (v_rpc->>'blockedRunGroups')::bigint  IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: unexpected materialiser result %.', v_rpc;
  END IF;

  -- ========================================================================
  -- POST-MATERIALISATION LEDGER — 7 / 1 / 1.
  -- ========================================================================
  SELECT count(*) INTO v_opp_after   FROM public.marketing_opportunities;
  SELECT count(*) INTO v_recip_after FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_after  FROM public.marketing_automation_runs;
  IF v_opp_after <> 7 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: opportunities is % after materialise (expected 7).', v_opp_after;
  END IF;
  IF v_recip_after <> 1 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: recipients is % after materialise (expected 1).', v_recip_after;
  END IF;
  IF v_runs_after <> 1 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: runs is % after materialise (expected 1).', v_runs_after;
  END IF;

  -- ========================================================================
  -- RECIPIENT ASSERTIONS — exactly ONE, linked to the canary opportunity,
  -- queued and totally unsent, snapshots at schema defaults.
  -- ========================================================================
  SELECT r.user_id, r.external_contact_id, r.email_lc, r.run_id, r.status,
         r.idempotency_key, r.template_snapshot, r.context_snapshot,
         r.discount_code_snapshot, r.sent_at, r.provider_email_id,
         r.delivered_at, r.clicked_at, r.bounced_at, r.complained_at, r.attempts,
         r.locked_at, r.locked_until
    INTO v_r_user_id, v_r_external, v_r_email_lc, v_r_run_id, v_r_status,
         v_r_idem, v_r_tmpl, v_r_ctx,
         v_r_discount, v_r_sent_at, v_r_provider,
         v_r_delivered, v_r_clicked, v_r_bounced, v_r_complained, v_r_attempts,
         v_r_locked_at, v_r_locked_until
    FROM public.marketing_recipients r
   WHERE r.opportunity_id = v_opp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: no recipient linked to the canary opportunity.';
  END IF;

  IF v_r_user_id   IS DISTINCT FROM v_user_id
     OR v_r_external IS NOT NULL
     OR v_r_email_lc IS DISTINCT FROM v_email_lc
     OR v_r_run_id   IS NULL
     OR v_r_status   IS DISTINCT FROM 'queued'
     OR v_r_idem     IS DISTINCT FROM ('marketing-opportunity:' || v_opp_id::text)
     OR v_r_tmpl     IS DISTINCT FROM '{}'::jsonb
     OR v_r_ctx      IS DISTINCT FROM '{}'::jsonb
     OR v_r_discount IS NOT NULL
     OR v_r_sent_at   IS NOT NULL
     OR v_r_provider  IS NOT NULL
     OR v_r_delivered IS NOT NULL
     OR v_r_clicked   IS NOT NULL
     OR v_r_bounced   IS NOT NULL
     OR v_r_complained IS NOT NULL
     OR v_r_attempts  IS DISTINCT FROM 0
     -- Materialisation NEVER acquires a processing/delivery lock: both lock
     -- columns MUST be NULL on a freshly staged recipient.
     OR v_r_locked_at    IS NOT NULL
     OR v_r_locked_until IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: recipient contract violated (status=%, sent_at set=%, provider set=%, attempts=%, locked_at set=%, locked_until set=%, tmpl=%, ctx=%).',
      v_r_status, (v_r_sent_at IS NOT NULL), (v_r_provider IS NOT NULL),
      v_r_attempts, (v_r_locked_at IS NOT NULL), (v_r_locked_until IS NOT NULL),
      v_r_tmpl, v_r_ctx;
  END IF;

  -- No stray recipient exists beyond the one linked to the canary opportunity.
  IF (SELECT count(*) FROM public.marketing_recipients WHERE opportunity_id IS DISTINCT FROM v_opp_id) <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: a recipient exists that is not linked to the canary opportunity.';
  END IF;

  -- ========================================================================
  -- RUN ASSERTIONS — exactly ONE, preparing, routed automation, NULL promotion.
  -- ========================================================================
  SELECT ar.automation_id, ar.promotion_id, ar.status
    INTO v_run_auto_id, v_run_promo_id, v_run_status
    FROM public.marketing_automation_runs ar
   WHERE ar.id = v_r_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: recipient run_id does not resolve to a run.';
  END IF;
  IF v_run_auto_id IS DISTINCT FROM v_def_route_id THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: run automation_id is not the authoritative delivery route.';
  END IF;
  IF v_run_promo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: run promotion_id is not NULL.';
  END IF;
  IF v_run_status IS DISTINCT FROM 'preparing' THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: run status is % (MUST be preparing; never queued/processing/completed).', v_run_status;
  END IF;

  -- ========================================================================
  -- OPPORTUNITY ASSERTIONS — canary selected; provenance NULL; campaign frozen;
  -- the original six unchanged.
  -- ========================================================================
  SELECT o.state, o.selected_at, o.actioned_at, o.automation_id, o.campaign_id
    INTO v_opp_state, v_opp_selected_at, v_opp_actioned_at, v_opp_auto_prov, v_opp_campaign_final
    FROM public.marketing_opportunities o
   WHERE o.id = v_opp_id;
  IF v_opp_state IS DISTINCT FROM 'selected'
     OR v_opp_selected_at IS NULL
     OR v_opp_actioned_at IS NOT NULL
     OR v_opp_auto_prov IS NOT NULL
     -- campaign_id remains the frozen detector campaign after materialisation.
     OR v_opp_campaign_final IS DISTINCT FROM v_det_campaign_id THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: canary opportunity lifecycle wrong (state=%, selected_at set=%, actioned_at set=%, automation_id set=%, campaign matches=%).',
      v_opp_state, (v_opp_selected_at IS NOT NULL), (v_opp_actioned_at IS NOT NULL),
      (v_opp_auto_prov IS NOT NULL), (v_opp_campaign_final IS NOT DISTINCT FROM v_det_campaign_id);
  END IF;

  -- The original six must remain open and unselected/unactioned.
  SELECT count(*) INTO v_other_changed
    FROM public.marketing_opportunities o
   WHERE o.id <> v_opp_id
     AND (o.state IS DISTINCT FROM 'open'
          OR o.selected_at IS NOT NULL
          OR o.actioned_at IS NOT NULL);
  IF v_other_changed <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: % pre-existing opportunity(ies) changed state.', v_other_changed;
  END IF;

  -- ========================================================================
  -- RESTORE KILL SWITCHES BEFORE COMMIT.
  --   rollout_limit -> 0; definition -> disabled; automation -> disabled.
  --   The three canary rows are DELIBERATELY left behind.
  -- ========================================================================
  UPDATE public.marketing_control_state
     SET rollout_limit = 0, updated_at = now()
   WHERE key = 'default';

  UPDATE public.marketing_opportunity_definitions
     SET enabled = false, updated_at = now()
   WHERE opportunity_key = c_opp_type;

  UPDATE public.marketing_automations
     SET enabled = false, updated_at = now()
   WHERE id = v_def_route_id;

  -- Assert fully-paused end state BEFORE COMMIT.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: sending_enabled is % (MUST be false).', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: discovery_enabled is % (MUST be false).', v_discovery;
  END IF;
  IF v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: rollout_limit not restored to 0 (is %).', v_rollout;
  END IF;

  SELECT count(*) INTO v_enabled_defs  FROM public.marketing_opportunity_definitions WHERE enabled = true;
  SELECT count(*) INTO v_enabled_autos FROM public.marketing_automations WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: % definition(s) still enabled (MUST be 0).', v_enabled_defs;
  END IF;
  IF v_enabled_autos <> v_enabled_autos_before THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: enabled automations not restored (is %, expected %).', v_enabled_autos, v_enabled_autos_before;
  END IF;

  -- ========================================================================
  -- FINAL GATE EXPECTATION — with definition + automation disabled again, the
  -- selected canary is no longer gate-eligible, and the whole system is 0/0.
  -- ========================================================================
  SELECT count(*) FILTER (WHERE g.gate_eligible),
         count(*) FILTER (WHERE g.sendable_now)
    INTO v_gate_eligible_after, v_sendable_now_after
    FROM public.wtf_marketing_recipient_gate_preview() g;
  IF v_gate_eligible_after <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: gateEligible after restore is % (MUST be 0).', v_gate_eligible_after;
  END IF;
  IF v_sendable_now_after <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2C (021) canary aborted: sendableNow after restore is % (MUST be 0).', v_sendable_now_after;
  END IF;

  -- ========================================================================
  -- ANONYMIZED RESULT — PII-free proof payload (via a temp table so the tests
  -- can assert its contents contain no identifiers). NO campaign_id/user_id/
  -- email/recipient_id/opportunity_id/run_id/automation_id are exposed.
  -- ========================================================================
  CREATE TEMP TABLE tmp_one_recipient_canary_result ON COMMIT DROP AS
  SELECT jsonb_build_object(
    'status',                'canary_complete',
    'opportunityType',       c_opp_type,
    'campaignSpecific',      true,
    'opportunitiesBefore',   v_opp_before,
    'opportunitiesAfter',    v_opp_after,
    'recipientsBefore',      v_recip_before,
    'recipientsAfter',       v_recip_after,
    'runsBefore',            v_runs_before,
    'runsAfter',             v_runs_after,
    'materializerStatus',    (v_rpc->>'status'),
    'insertedRecipients',    (v_rpc->>'insertedRecipients')::bigint,
    'opportunitiesSelected', (v_rpc->>'opportunitiesSelected')::bigint,
    'runsCreated',           (v_rpc->>'runsCreated')::bigint,
    'canaryOpportunityState', v_opp_state,
    'canaryRecipientStatus', v_r_status,
    'canaryRunStatus',       v_run_status,
    'sentRecipients',        (SELECT count(*) FROM public.marketing_recipients WHERE sent_at IS NOT NULL),
    'sendingEnabled',        v_sending,
    'discoveryEnabled',      v_discovery,
    'rolloutLimit',          v_rollout,
    'enabledDefinitions',    v_enabled_defs,
    'enabledAutomations',    v_enabled_autos,
    'gateEligibleAfter',     v_gate_eligible_after,
    'sendableNowAfter',      v_sendable_now_after,
    'generatedAt',           now()
  ) AS one_recipient_canary_result;
END
$canary$;

-- Surface the single anonymised result row for the operator.
SELECT one_recipient_canary_result FROM tmp_one_recipient_canary_result;

COMMIT;

-- ============================================================================
-- END Stage 3D2C (021). On success exactly THREE rows are added (1 campaign-
-- specific abandoned_checkout opportunity selected, 1 recipient queued/unsent,
-- 1 run preparing); global sending was never enabled; all kill switches were
-- restored to fully paused before COMMIT.
-- ============================================================================
