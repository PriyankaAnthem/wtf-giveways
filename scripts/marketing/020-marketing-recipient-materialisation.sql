-- ============================================================================
-- WTF Marketing Hub — Stage 3D2B: DETERMINISTIC RECIPIENT MATERIALISATION
-- ----------------------------------------------------------------------------
-- MIGRATION 020
--
-- PURPOSE
--   Install ONE service-role-only VOLATILE SECURITY DEFINER RPC:
--
--       public.materialize_marketing_recipients(p_limit integer DEFAULT 100)
--
--   that deterministically converts each gate_eligible opportunity (as decided
--   by the canonical Stage 019 private gate) into exactly ONE durable recipient
--   linked to that opportunity, inside an appropriate PREPARING automation run.
--
--   ARCHITECTURAL CONTRACT (unchanged, enforced here):
--     DISCOVERY != RECIPIENT MATERIALISATION != CONTENT/STRATEGY != DELIVERY
--
--   This RPC:
--     * SENDS NOTHING. No provider call, no email, no Resend.
--     * Never marks anything sent (sent_at / provider_email_id stay NULL).
--     * Never makes a recipient delivery-ready (runs stay 'preparing';
--       recipient uses the schema-default 'queued' status ONLY — see the
--       content-readiness note below).
--     * Never touches content: template_snapshot / context_snapshot are OMITTED
--       from the INSERT so their schema defaults ('{}') apply. No fabrication.
--     * Uses gate_eligible, NOT sendable_now — recipients may be STAGED while
--       global sending remains paused. This is deliberate.
--     * Reads eligibility ONLY from public.wtf_marketing_recipient_gate_preview().
--       It does NOT reimplement any permission/campaign/frequency gate.
--     * Takes delivery_automation_id ONLY from the private gate (never from
--       marketing_opportunities.automation_id, which is optional provenance).
--     * Reads promotion_id (run-grouping metadata only) from the authoritative
--       marketing_opportunities row joined by opportunity_id. It NEVER re-derives
--       eligibility from marketing_opportunities.
--
--   CONTENT-READINESS / EXISTING-WORKER RACE (audited before writing this):
--     There is NO current delivery worker or queue consumer for
--     marketing_recipients / marketing_automation_runs anywhere in the repo.
--     The only application code that reads these tables is
--     lib/admin/marketing/hub-queries.ts, which performs identity-free HEAD
--     COUNTS ONLY (never selects rows, never sends, never enqueues). The generic
--     cron worker app/api/jobs/run/route.ts processes ONLY the unrelated `jobs`
--     table (type REFRESH_SNAPSHOTS -> giveaway_snapshots) and never references
--     marketing_recipients or marketing_automation_runs. Therefore a newly
--     materialised recipient with status='queued' beneath a run with
--     status='preparing' CANNOT be picked up and sent by any current code path.
--     Using the schema-default 'queued' status is SAFE. The future delivery
--     worker will perform a fresh deterministic delivery-safety check (and gate
--     on run status) immediately before any provider call.
--
--   IDEMPOTENCY (canonical Stage 020 contract, documented here):
--     idempotency_key = 'marketing-opportunity:' || opportunity_id
--     This namespaced, opportunity-derived key is now the CANONICAL
--     opportunity-materialisation idempotency format. It is deterministic (never
--     random), never the raw email, and never opportunity.dedupe_key. It satisfies
--     the global UNIQUE(idempotency_key) index (length 45 <= 200). Together with
--     the Stage 017 UNIQUE(opportunity_id) WHERE opportunity_id IS NOT NULL index
--     this provides TWO independent deterministic duplicate protections.
--
--   RUN GROUPING + LIFECYCLE (exact contract, verified):
--     marketing_automation_runs_active_uidx is UNIQUE on
--       (automation_id, COALESCE(promotion_id, '000...'::uuid))
--       WHERE status IN ('preparing','queued','processing').  [index NOT changed]
--     Canonical grouping is (delivery_automation_id, promotion_id). The MATERIALISER
--     may attach recipients ONLY to a run whose status = 'preparing':
--       * If a compatible PREPARING run exists  -> REUSE it.
--       * If NO active run exists               -> CREATE a new 'preparing' run.
--       * If an active run exists but its status is 'queued' or 'processing' -> that
--         group is BLOCKED. The run has advanced beyond the content-staging boundary
--         and a future delivery worker may legitimately consume it, so a content-
--         unprepared recipient must NEVER be appended to it. The whole invocation
--         performs ZERO writes and returns status='active_run_not_preparing' with a
--         safe aggregate blockedRunGroups count (fail-whole-batch, never partial).
--     Stage 020 NEVER creates 'queued'/'processing' runs and NEVER falls back to a
--     non-preparing run. Runs are created ONLY for groups that yield >= 1 recipient,
--     and the atomic invariant below guarantees no empty/orphan run can commit.
--
--     FUTURE LIFECYCLE CONTRACT (documented for the later workers):
--       MATERIALISER (this RPC): may add recipients ONLY to PREPARING runs.
--       CONTENT/PREPARATION WORKER: later finishes recipient content and advances
--         the run OUT of 'preparing' (to 'queued'/'processing').
--       Once a run is 'queued' or 'processing', Stage 020 can NEVER append another
--         recipient to it — those states belong to the delivery pipeline.
--
--   ATOMIC ALL-OR-NOTHING INVARIANT:
--     The gate is evaluated EXACTLY ONCE into a frozen ON COMMIT DROP temp relation
--     (tmp_materialise_candidates); the blocked-run check, grouping, run reuse/
--     creation, recipient insert and opportunity transition all read that SAME set.
--     On the 'ok' path the RPC REQUIRES
--       finalCandidateCount == insertedRecipients == opportunitiesSelected.
--     Any divergence (idempotency/opportunity-unique race, unresolved concurrent
--     run, or an opportunity no longer 'open') RAISEs, rolling back the ENTIRE
--     invocation — runs, recipients and opportunity transitions together. Repeat
--     NORMAL invocations stay duplicate-safe because already-linked opportunities
--     are filtered out by the canonical gate before they can become candidates.
--
--   INSTALLATION IS INERT: creating the function performs 0 recipient/run inserts
--   and 0 opportunity updates. Post-install invokes the RPC ONCE while
--   rollout_limit=0 and asserts it returns status='rollout_disabled' with zero
--   writes (proving the kill switch), then re-verifies the ledger + opportunity
--   checksum are unchanged and the Stage 019 gate still reports 0/0.
--
--   Migrations 001-019 are NOT modified. No schema/RLS/policy change. No cron.
--   No AI. No external-contact materialisation. Stage 019 routing/gate untouched.
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

  -- Stage 017 linkage.
  v_col_type     text;
  v_col_notnull  boolean;
  v_fk_deltype   "char";
  v_fk_valid     boolean;
  v_idx_unique   boolean;
  v_idx_def      text;
  v_trg_enabled  "char";

  -- Stage 019 routing.
  v_route_type   text;
  v_route_notnull boolean;
  v_route_fk_valid boolean;
  v_route_fk_deltype "char";
  v_enabled_chk_valid boolean;
  v_defs_total   bigint;
  v_defs_mapped  bigint;
  v_defs_enabled bigint;

  -- Private gate return contract.
  v_has_route_out boolean;

  -- Controlled live state.
  v_recip_count  bigint;
  v_runs_count   bigint;
  v_opp_count    bigint;
  v_sending      boolean;
  v_discovery    boolean;
  v_rollout      integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3d2b_recipient_materialisation')) THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 1. Required tables.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_recipients',
    'public.marketing_automation_runs',
    'public.marketing_automations',
    'public.marketing_opportunities',
    'public.marketing_opportunity_definitions',
    'public.marketing_control_state'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: required table % is missing.', array_to_string(v_missing, ', ');
  END IF;

  -- 2. Canonical private gate must exist.
  IF to_regprocedure('public.wtf_marketing_recipient_gate_preview()') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: canonical private gate is missing.';
  END IF;

  -- 3. Private gate MUST be inaccessible to service_role (defence in depth: the
  --    materialiser is SECURITY DEFINER and runs as owner, so it can call the
  --    gate, but service_role itself must never invoke it directly).
  IF has_function_privilege('service_role', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wtf_marketing_recipient_gate_preview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: private gate EXECUTE is granted to an application role.';
  END IF;

  -- 4. Private gate return contract includes delivery_automation_id uuid.
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc pr
      CROSS JOIN LATERAL unnest(pr.proallargtypes, pr.proargmodes, pr.proargnames)
                    AS t(argtype, argmode, argname)
     WHERE pr.oid = 'public.wtf_marketing_recipient_gate_preview()'::regprocedure
       AND t.argmode = 't'
       AND t.argname = 'delivery_automation_id'
       AND t.argtype = 'uuid'::regtype
  ) INTO v_has_route_out;
  IF NOT v_has_route_out THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: private gate does not return delivery_automation_id uuid (Stage 019 not installed).';
  END IF;

  -- 5. Stage 017 linkage: opportunity_id uuid nullable.
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
    INTO v_col_type, v_col_notnull
    FROM pg_attribute a
   WHERE a.attrelid = 'public.marketing_recipients'::regclass
     AND a.attname = 'opportunity_id' AND NOT a.attisdropped;
  IF NOT FOUND OR v_col_type IS DISTINCT FROM 'uuid' OR v_col_notnull IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 017 opportunity_id column not present as uuid nullable.';
  END IF;

  -- 6. Stage 017 FK validated, ON DELETE RESTRICT.
  SELECT c.confdeltype, c.convalidated
    INTO v_fk_deltype, v_fk_valid
    FROM pg_constraint c
   WHERE c.conname = 'marketing_recipients_opportunity_fk'
     AND c.conrelid = 'public.marketing_recipients'::regclass AND c.contype = 'f';
  IF NOT FOUND OR v_fk_deltype <> 'r' OR v_fk_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 017 opportunity FK missing/not validated/not RESTRICT.';
  END IF;

  -- 7. Stage 017 unique partial index present.
  SELECT i.indisunique, pg_get_indexdef(i.indexrelid)
    INTO v_idx_unique, v_idx_def
    FROM pg_index i JOIN pg_class cl ON cl.oid = i.indexrelid
   WHERE cl.relname = 'marketing_recipients_opportunity_unique_idx';
  IF NOT FOUND OR v_idx_unique IS DISTINCT FROM true OR position('opportunity_id IS NOT NULL' IN v_idx_def) = 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 017 unique partial opportunity index missing/incorrect.';
  END IF;

  -- 8. Stage 017 immutability trigger enabled.
  SELECT t.tgenabled INTO v_trg_enabled
    FROM pg_trigger t
   WHERE t.tgname = 'marketing_recipients_opportunity_link_immutable_trg'
     AND t.tgrelid = 'public.marketing_recipients'::regclass AND NOT t.tgisinternal;
  IF NOT FOUND OR v_trg_enabled = 'D' THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 017 immutability trigger missing/disabled.';
  END IF;

  -- 9. Stage 019 delivery routing: column + validated FK + enabled-requires-route CHECK.
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
    INTO v_route_type, v_route_notnull
    FROM pg_attribute a
   WHERE a.attrelid = 'public.marketing_opportunity_definitions'::regclass
     AND a.attname = 'delivery_automation_id' AND NOT a.attisdropped;
  IF NOT FOUND OR v_route_type IS DISTINCT FROM 'uuid' OR v_route_notnull IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 019 delivery_automation_id column not present as uuid nullable.';
  END IF;

  SELECT c.convalidated, c.confdeltype
    INTO v_route_fk_valid, v_route_fk_deltype
    FROM pg_constraint c
   WHERE c.conrelid = 'public.marketing_opportunity_definitions'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'public.marketing_automations'::regclass
     AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'delivery_automation_id';
  IF NOT FOUND OR v_route_fk_valid IS DISTINCT FROM true OR v_route_fk_deltype <> 'r' THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 019 delivery route FK missing/not validated/not RESTRICT.';
  END IF;

  SELECT c.convalidated INTO v_enabled_chk_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.marketing_opportunity_definitions'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%delivery_automation_id%';
  IF NOT FOUND OR v_enabled_chk_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: Stage 019 enabled-requires-route CHECK missing/not validated.';
  END IF;

  -- 10. Definitions: 28 total / 6 mapped / 0 enabled.
  SELECT count(*), count(*) FILTER (WHERE delivery_automation_id IS NOT NULL), count(*) FILTER (WHERE enabled = true)
    INTO v_defs_total, v_defs_mapped, v_defs_enabled
    FROM public.marketing_opportunity_definitions;
  IF v_defs_total <> 28 OR v_defs_mapped <> 6 OR v_defs_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: definitions expected 28/mapped6/enabled0, got %/%/%.', v_defs_total, v_defs_mapped, v_defs_enabled;
  END IF;

  -- 11. Controlled live state: recipients 0, runs 0, opportunities 6, paused, rollout 0.
  SELECT count(*) INTO v_recip_count FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_count  FROM public.marketing_automation_runs;
  SELECT count(*) INTO v_opp_count   FROM public.marketing_opportunities;
  IF v_recip_count <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: marketing_recipients holds % row(s); expected 0.', v_recip_count;
  END IF;
  IF v_runs_count <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: marketing_automation_runs holds % row(s); expected 0.', v_runs_count;
  END IF;
  IF v_opp_count <> 6 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: marketing_opportunities holds % row(s); expected 6.', v_opp_count;
  END IF;

  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: marketing_control_state singleton not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) aborted: not paused (sending=%, discovery=%, rollout=%).', v_sending, v_discovery, v_rollout;
  END IF;
  -- NOTE: consent counts are deliberately NOT asserted.
END
$preflight$;

-- Baseline counts + deterministic opportunity checksum (stable columns only).
-- Verified unchanged post-install. ON COMMIT DROP.
CREATE TEMP TABLE tmp_marketing_3d2b_baseline ON COMMIT DROP AS
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
          coalesce(o.promotion_id::text, '')        || '~' ||
          coalesce(o.state, '')                     || '~' ||
          coalesce(o.selected_at::text, '')         || '~' ||
          coalesce(o.actioned_at::text, '')         || '~' ||
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
-- THE MATERIALISATION RPC.
--   VOLATILE SECURITY DEFINER; set-based; small PL/pgSQL control-flow wrapper for
--   controls + advisory lock + result assembly only (NO row-by-row recipient loop).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.materialize_marketing_recipients(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $materialise$
DECLARE
  v_requested       integer;
  v_effective       integer;
  v_sending         boolean;
  v_discovery       boolean;
  v_rollout         integer;
  v_batch           integer;
  v_candidate_count bigint := 0;   -- frozen candidate set size (== finalCandidateCount)
  v_inserted        bigint := 0;
  v_runs_created    bigint := 0;
  v_runs_reused     bigint := 0;
  v_group_count     bigint := 0;
  v_opps_selected   bigint := 0;
  v_blocked_groups  bigint := 0;   -- selected groups blocked by a non-preparing active run
BEGIN
  -- (A) Requested clamp 1..500 (deterministic; NULL -> default 100 -> clamped).
  v_requested := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  -- (B) Concurrency: transaction-scoped advisory lock. If held, return busy with
  --     zero writes rather than blocking.
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_materialize_recipients')) THEN
    RETURN jsonb_build_object(
      'status', 'busy', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'candidateCount', 0, 'finalCandidateCount', 0, 'insertedRecipients', 0,
      'opportunitiesSelected', 0, 'runsCreated', 0, 'runsReused', 0,
      'groupCount', 0, 'blockedRunGroups', 0
    );
  END IF;

  -- (C) Controls. Missing singleton or invalid batch -> FAIL CLOSED, zero writes.
  SELECT sending_enabled, discovery_enabled, rollout_limit, maximum_batch_size
    INTO v_sending, v_discovery, v_rollout, v_batch
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'control_missing', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'candidateCount', 0, 'finalCandidateCount', 0, 'insertedRecipients', 0,
      'opportunitiesSelected', 0, 'runsCreated', 0, 'runsReused', 0,
      'groupCount', 0, 'blockedRunGroups', 0
    );
  END IF;

  IF v_batch IS NULL OR v_batch <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'invalid_control', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'candidateCount', 0, 'finalCandidateCount', 0, 'insertedRecipients', 0,
      'opportunitiesSelected', 0, 'runsCreated', 0, 'runsReused', 0,
      'groupCount', 0, 'blockedRunGroups', 0
    );
  END IF;

  -- (D) Rollout kill switch. rollout_limit <= 0 -> rollout_disabled, zero writes.
  --     Note: sending_enabled / discovery_enabled are intentionally NOT required.
  IF v_rollout IS NULL OR v_rollout <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'rollout_disabled', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'candidateCount', 0, 'finalCandidateCount', 0, 'insertedRecipients', 0,
      'opportunitiesSelected', 0, 'runsCreated', 0, 'runsReused', 0,
      'groupCount', 0, 'blockedRunGroups', 0
    );
  END IF;

  -- (E) Effective limit = MIN(requested, maximum_batch_size, rollout_limit).
  v_effective := LEAST(v_requested, v_batch, v_rollout);
  IF v_effective <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'rollout_disabled', 'requestedLimit', v_requested, 'effectiveLimit', 0,
      'candidateCount', 0, 'finalCandidateCount', 0, 'insertedRecipients', 0,
      'opportunitiesSelected', 0, 'runsCreated', 0, 'runsReused', 0,
      'groupCount', 0, 'blockedRunGroups', 0
    );
  END IF;

  -- (F) FREEZE THE CANDIDATE SET.
  --     The canonical Stage 019 gate is evaluated EXACTLY ONCE and its ordered,
  --     limited result is captured into a session-local ON COMMIT DROP temp table.
  --     EVERY subsequent step (blocked-run check, grouping, run reuse/creation,
  --     recipient insert, opportunity transition) reads ONLY from this frozen
  --     relation, so they can never observe a different gate result. The temp
  --     table is truncated first so a re-invocation in the SAME transaction (the
  --     lock is transaction-scoped, so this is the only way it can be reused)
  --     starts clean. It is bounded by v_effective and holds no data after COMMIT.
  CREATE TEMP TABLE IF NOT EXISTS tmp_materialise_candidates (
    opportunity_id         uuid PRIMARY KEY,
    user_id                uuid    NOT NULL,
    email_lc               text    NOT NULL,
    delivery_automation_id uuid    NOT NULL,
    promotion_id           uuid,
    base_priority          integer,
    score                  numeric,
    detected_at            timestamptz
  ) ON COMMIT DROP;
  TRUNCATE tmp_materialise_candidates;

  INSERT INTO tmp_materialise_candidates
  SELECT
    g.opportunity_id,
    g.user_id,
    g.email_lc,
    g.delivery_automation_id,
    o.promotion_id,
    g.base_priority,
    g.score,
    g.detected_at
  FROM public.wtf_marketing_recipient_gate_preview() g
  JOIN public.marketing_opportunities o ON o.id = g.opportunity_id
  WHERE g.gate_eligible = true
    AND g.delivery_route_ready = true
    AND g.delivery_automation_id IS NOT NULL
    AND g.user_id IS NOT NULL
  ORDER BY g.base_priority ASC,
           g.score DESC NULLS LAST,
           g.detected_at DESC,
           g.opportunity_id ASC
  LIMIT v_effective;

  GET DIAGNOSTICS v_candidate_count = ROW_COUNT;
  v_group_count := (SELECT count(DISTINCT (delivery_automation_id, promotion_id)) FROM tmp_materialise_candidates);

  -- (G) No candidates -> no_eligible_candidates, zero writes.
  IF v_candidate_count = 0 THEN
    RETURN jsonb_build_object(
      'status', 'no_eligible_candidates', 'requestedLimit', v_requested, 'effectiveLimit', v_effective,
      'candidateCount', 0, 'finalCandidateCount', 0, 'insertedRecipients', 0,
      'opportunitiesSelected', 0, 'runsCreated', 0, 'runsReused', 0,
      'groupCount', 0, 'blockedRunGroups', 0
    );
  END IF;

  -- (H) RUN-LIFECYCLE SAFETY GATE (fail-whole-batch).
  --     A recipient may only ever be attached to a PREPARING run. If ANY selected
  --     candidate group is currently occupied by an active run that has advanced
  --     to 'queued' or 'processing', the whole invocation performs ZERO writes and
  --     returns active_run_not_preparing. We must never (a) append a content-
  --     unprepared recipient to a run a future delivery worker may consume, nor
  --     (b) try to create a second preparing run for that group (the active-run
  --     unique index would reject it anyway). The frozen candidate set is used.
  SELECT count(*) INTO v_blocked_groups
    FROM (SELECT DISTINCT delivery_automation_id, promotion_id FROM tmp_materialise_candidates) gr
   WHERE EXISTS (
     SELECT 1
       FROM public.marketing_automation_runs ar
      WHERE ar.automation_id = gr.delivery_automation_id
        AND COALESCE(ar.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(gr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND ar.status IN ('queued', 'processing')
   );

  IF v_blocked_groups > 0 THEN
    RETURN jsonb_build_object(
      'status', 'active_run_not_preparing', 'requestedLimit', v_requested, 'effectiveLimit', v_effective,
      'candidateCount', v_candidate_count, 'finalCandidateCount', v_candidate_count,
      'insertedRecipients', 0, 'opportunitiesSelected', 0,
      'runsCreated', 0, 'runsReused', 0,
      'groupCount', v_group_count, 'blockedRunGroups', v_blocked_groups
    );
  END IF;

  -- (I) SET-BASED WRITES over the FROZEN candidate set. All CTEs read only from
  --     tmp_materialise_candidates.
  WITH
  groups AS (
    SELECT DISTINCT delivery_automation_id, promotion_id
      FROM tmp_materialise_candidates
  ),
  -- Reuse an existing PREPARING run only (queued/processing were already excluded
  -- by the (H) gate, but we restrict to 'preparing' here too as the authoritative
  -- attachment rule). Deterministic pick: newest started_at.
  reused AS (
    SELECT gr.delivery_automation_id, gr.promotion_id, r.id AS run_id
      FROM groups gr
      JOIN LATERAL (
        SELECT ar.id
          FROM public.marketing_automation_runs ar
         WHERE ar.automation_id = gr.delivery_automation_id
           AND COALESCE(ar.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(gr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
           AND ar.status = 'preparing'
         ORDER BY ar.started_at DESC, ar.id ASC
         LIMIT 1
      ) r ON true
  ),
  -- Create a new PREPARING run for each group WITHOUT a reusable preparing run.
  -- ON CONFLICT on the active-run unique index makes concurrent creators converge;
  -- the conflicting row is recovered (as 'preparing' ONLY) in run_map below.
  created AS (
    INSERT INTO public.marketing_automation_runs (automation_id, promotion_id, status, rollout_limit_snapshot)
    SELECT gr.delivery_automation_id, gr.promotion_id, 'preparing', v_effective
      FROM groups gr
      LEFT JOIN reused ru
        ON ru.delivery_automation_id = gr.delivery_automation_id
       AND COALESCE(ru.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(gr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
     WHERE ru.run_id IS NULL
    ON CONFLICT (automation_id, COALESCE(promotion_id, '00000000-0000-0000-0000-000000000000'::uuid))
      WHERE status IN ('preparing', 'queued', 'processing')
      DO NOTHING
    RETURNING id AS run_id, automation_id AS delivery_automation_id, promotion_id
  ),
  -- Final authoritative run per group: prefer a freshly created run, else the
  -- reused preparing run, else (if ON CONFLICT skipped our insert due to a
  -- concurrent creator) look up the active run AS 'preparing' ONLY. If that
  -- lookup finds nothing (the concurrent run advanced past preparing), run_id is
  -- NULL, its candidates cannot attach, and the (J) atomic invariant will force a
  -- rollback rather than partial materialisation.
  run_map AS (
    SELECT
      gr.delivery_automation_id,
      gr.promotion_id,
      COALESCE(
        cr.run_id,
        ru.run_id,
        (
          SELECT ar.id
            FROM public.marketing_automation_runs ar
           WHERE ar.automation_id = gr.delivery_automation_id
             AND COALESCE(ar.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = COALESCE(gr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND ar.status = 'preparing'
           ORDER BY ar.started_at DESC, ar.id ASC
           LIMIT 1
        )
      ) AS run_id,
      (cr.run_id IS NOT NULL) AS was_created
    FROM groups gr
    LEFT JOIN created cr
      ON cr.delivery_automation_id = gr.delivery_automation_id
     AND COALESCE(cr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(gr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LEFT JOIN reused ru
      ON ru.delivery_automation_id = gr.delivery_automation_id
     AND COALESCE(ru.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(gr.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  -- Recipient INSERT over the FROZEN set. Snapshots OMITTED (schema defaults '{}'),
  -- status OMITTED (schema default 'queued'), sent_at/provider_email_id/locks/
  -- attempts left at NULL/zero. Idempotency key opportunity-derived. Rows whose
  -- run_id is NULL (unresolved concurrent race) are excluded here and thus cannot
  -- insert -> the (J) invariant then rolls the whole invocation back.
  -- ON CONFLICT DO NOTHING is a race BACKSTOP only; a genuine conflict lowers the
  -- inserted count and (J) converts that into a rollback (no partial batch).
  inserted AS (
    INSERT INTO public.marketing_recipients (
      run_id, user_id, external_contact_id, email_lc, opportunity_id, idempotency_key
    )
    SELECT
      rm.run_id,
      c.user_id,
      NULL::uuid,
      c.email_lc,
      c.opportunity_id,
      'marketing-opportunity:' || c.opportunity_id::text
    FROM tmp_materialise_candidates c
    JOIN run_map rm
      ON rm.delivery_automation_id = c.delivery_automation_id
     AND COALESCE(rm.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(c.promotion_id, '00000000-0000-0000-0000-000000000000'::uuid)
    WHERE rm.run_id IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING id AS recipient_id, run_id, opportunity_id
  ),
  -- ATOMIC opportunity transition: ONLY opportunities whose recipient actually
  -- INSERTED move open -> selected with selected_at=now(). actioned_at untouched.
  -- Guard on state='open' so any non-open row (selected/deferred/expired/
  -- suppressed/superseded/actioned) is never rewritten; such a row simply fails
  -- to transition, lowering opportunitiesSelected, which (J) turns into a rollback.
  selected AS (
    UPDATE public.marketing_opportunities o
       SET state = 'selected', selected_at = now(), updated_at = now()
      FROM inserted i
     WHERE o.id = i.opportunity_id
       AND o.state = 'open'
    RETURNING o.id
  )
  SELECT
    (SELECT count(*) FROM inserted),
    (SELECT count(*) FROM selected),
    (SELECT count(*) FROM run_map WHERE was_created),
    (SELECT count(*) FROM run_map WHERE NOT was_created)
  INTO v_inserted, v_opps_selected, v_runs_created, v_runs_reused;

  -- (J) ATOMIC ALL-OR-NOTHING INVARIANT.
  --     The exact frozen candidate set MUST have produced one recipient AND one
  --     open->selected transition each. If any of the three counts diverge, a
  --     concurrent race (idempotency/opportunity-uniqueness conflict, unresolved
  --     run, or a state change out of 'open') has occurred: RAISE so the ENTIRE
  --     invocation rolls back — newly-created runs, recipient inserts and
  --     opportunity transitions ALL revert. This guarantees no partial batch and
  --     no empty/orphan preparing run can ever commit.
  IF v_inserted <> v_candidate_count OR v_opps_selected <> v_inserted THEN
    RAISE EXCEPTION 'Stage 3D2B materialisation atomicity violation: finalCandidates=%, inserted=%, selected=%; rolling back entire invocation.',
      v_candidate_count, v_inserted, v_opps_selected
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- (K) Success. finalCandidateCount == insertedRecipients == opportunitiesSelected.
  RETURN jsonb_build_object(
    'status', 'ok',
    'requestedLimit', v_requested,
    'effectiveLimit', v_effective,
    'candidateCount', v_candidate_count,
    'finalCandidateCount', v_candidate_count,
    'insertedRecipients', v_inserted,
    'opportunitiesSelected', v_opps_selected,
    'runsCreated', v_runs_created,
    'runsReused', v_runs_reused,
    'groupCount', v_group_count,
    'blockedRunGroups', 0
  );
END
$materialise$;

COMMENT ON FUNCTION public.materialize_marketing_recipients(integer) IS
  'Stage 3D2B service-role-only deterministic recipient materialiser. Converts each gate_eligible opportunity (canonical Stage 019 private gate) into one durable recipient linked to that opportunity inside a PREPARING run grouped by (delivery_automation_id, promotion_id). Uses gate_eligible NOT sendable_now. Sends nothing; snapshots/status use schema defaults; sent_at/provider_email_id stay NULL. Idempotency key = marketing-opportunity:<opportunity_id> (canonical). Fails closed on missing/invalid control or rollout_limit<=0; advisory-locked; race-safe via ON CONFLICT + Stage 017 unique opportunity link.';

REVOKE ALL ON FUNCTION public.materialize_marketing_recipients(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_marketing_recipients(integer) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_marketing_recipients(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_marketing_recipients(integer) TO service_role;

-- ============================================================================
-- POST-INSTALL VERIFICATION — READ-ONLY except the kill-switch proof call, which
--   must itself write nothing. ANY failure rolls back the ENTIRE migration.
-- ============================================================================
DO $postcheck$
DECLARE
  v_result        jsonb;
  v_recip_now     bigint;
  v_runs_now      bigint;
  v_opp_now       bigint;
  v_recip_before  bigint;
  v_runs_before   bigint;
  v_opp_before    bigint;
  v_cksum_before  text;
  v_cksum_now     text;
  v_defs_total    bigint;
  v_defs_mapped   bigint;
  v_defs_enabled  bigint;
  v_auto_enabled  bigint;
  v_sending       boolean;
  v_discovery     boolean;
  v_rollout       integer;
  v_sent_rows     bigint;
  v_overview      jsonb;
  v_gate_eligible bigint;
  v_sendable_now  bigint;
BEGIN
  -- 1. Function exists.
  IF to_regprocedure('public.materialize_marketing_recipients(integer)') IS NULL THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: materialisation function was not installed.';
  END IF;

  -- 2. Privileges: service_role only.
  IF NOT has_function_privilege('service_role', 'public.materialize_marketing_recipients(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.materialize_marketing_recipients(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.materialize_marketing_recipients(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: materialisation privileges are not service-role-only.';
  END IF;

  -- 3. Kill-switch proof: rollout_limit is 0 (asserted in preflight), so the RPC
  --    MUST return rollout_disabled with strictly zero writes.
  v_result := public.materialize_marketing_recipients(100);
  IF (v_result ->> 'status') <> 'rollout_disabled' THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: expected status rollout_disabled, got %.', (v_result ->> 'status');
  END IF;
  IF (v_result ->> 'insertedRecipients')::bigint <> 0
     OR (v_result ->> 'opportunitiesSelected')::bigint <> 0
     OR (v_result ->> 'runsCreated')::bigint <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: rollout_disabled call reported non-zero writes.';
  END IF;

  -- 4. Ledger + opportunity count unchanged vs baseline.
  SELECT recipients_before, runs_before, opportunities_before, opportunities_checksum
    INTO v_recip_before, v_runs_before, v_opp_before, v_cksum_before
    FROM tmp_marketing_3d2b_baseline;

  SELECT count(*) INTO v_recip_now FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_now  FROM public.marketing_automation_runs;
  SELECT count(*) INTO v_opp_now   FROM public.marketing_opportunities;

  IF v_recip_now <> 0 OR v_recip_now <> v_recip_before THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: recipient count changed (% -> %); expected 0.', v_recip_before, v_recip_now;
  END IF;
  IF v_runs_now <> 0 OR v_runs_now <> v_runs_before THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: run count changed (% -> %); expected 0.', v_runs_before, v_runs_now;
  END IF;
  IF v_opp_now <> 6 OR v_opp_now <> v_opp_before THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: opportunity count is % (before %); expected 6 unchanged.', v_opp_now, v_opp_before;
  END IF;

  -- 5. Opportunity checksum unchanged (proves no state/selected_at mutation).
  SELECT md5(coalesce(string_agg(row_sig, '|' ORDER BY row_sig), ''))
    INTO v_cksum_now
    FROM (
      SELECT md5(
        coalesce(o.id::text, '')                  || '~' ||
        coalesce(o.user_id::text, '')             || '~' ||
        coalesce(o.external_contact_id::text, '') || '~' ||
        coalesce(o.opportunity_type, '')          || '~' ||
        coalesce(o.campaign_id::text, '')         || '~' ||
        coalesce(o.promotion_id::text, '')        || '~' ||
        coalesce(o.state, '')                     || '~' ||
        coalesce(o.selected_at::text, '')         || '~' ||
        coalesce(o.actioned_at::text, '')         || '~' ||
        coalesce(o.base_priority::text, '')       || '~' ||
        coalesce(o.score::text, '')               || '~' ||
        coalesce(o.automation_id::text, '')       || '~' ||
        coalesce(o.detected_at::text, '')         || '~' ||
        coalesce(o.expires_at::text, '')
      ) AS row_sig
        FROM public.marketing_opportunities o
    ) s;
  IF v_cksum_now IS DISTINCT FROM v_cksum_before THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: opportunity checksum changed; opportunities were modified.';
  END IF;

  -- 6. Definitions + automations unchanged.
  SELECT count(*), count(*) FILTER (WHERE delivery_automation_id IS NOT NULL), count(*) FILTER (WHERE enabled = true)
    INTO v_defs_total, v_defs_mapped, v_defs_enabled
    FROM public.marketing_opportunity_definitions;
  IF v_defs_total <> 28 OR v_defs_mapped <> 6 OR v_defs_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: definitions changed (%/%/%).', v_defs_total, v_defs_mapped, v_defs_enabled;
  END IF;
  SELECT count(*) FILTER (WHERE enabled = true) INTO v_auto_enabled FROM public.marketing_automations;
  IF v_auto_enabled <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: % automation(s) became enabled; expected 0.', v_auto_enabled;
  END IF;

  -- 7. Controls unchanged (still paused, rollout 0).
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false OR v_discovery IS DISTINCT FROM false OR v_rollout <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: control state changed (sending=%, discovery=%, rollout=%).', v_sending, v_discovery, v_rollout;
  END IF;

  -- 8. No send state anywhere (defensive: table is empty, but assert regardless).
  SELECT count(*) INTO v_sent_rows
    FROM public.marketing_recipients
   WHERE sent_at IS NOT NULL OR provider_email_id IS NOT NULL;
  IF v_sent_rows <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: % recipient(s) have sent_at/provider_email_id set.', v_sent_rows;
  END IF;

  -- 9. Stage 019 gate still reports gateEligible=0 and sendableNow=0.
  v_overview := public.get_admin_marketing_recipient_gate_overview();
  v_gate_eligible := (v_overview #>> '{final,gateEligible}')::bigint;
  v_sendable_now  := (v_overview #>> '{final,sendableNow}')::bigint;
  IF v_gate_eligible <> 0 OR v_sendable_now <> 0 THEN
    RAISE EXCEPTION 'Stage 3D2B (020) verify aborted: gate reports gateEligible=% sendableNow=%; expected 0/0.', v_gate_eligible, v_sendable_now;
  END IF;
END
$postcheck$;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * One RPC installed: public.materialize_marketing_recipients(integer),
--     VOLATILE SECURITY DEFINER, service_role-only.
--   * READ-ONLY install: 0 recipients, 0 runs, 0 opportunity updates; the single
--     post-install call returned rollout_disabled with zero writes.
--   * Opportunity checksum, definitions, automations and controls all unchanged;
--     Stage 019 gate still reports gateEligible=0 / sendableNow=0.
--   * Canonical idempotency: marketing-opportunity:<opportunity_id>.
--   * Runs grouped by (delivery_automation_id, promotion_id); recipients attach
--     ONLY to 'preparing' runs; a group whose active run is 'queued'/'processing'
--     blocks the WHOLE batch (active_run_not_preparing, zero writes); new runs are
--     always 'preparing'; the atomic invariant guarantees no empty/orphan runs.
--   * Frozen candidate set: gate evaluated once into an ON COMMIT DROP temp table;
--     ok path enforces finalCandidateCount==insertedRecipients==opportunitiesSelected
--     via RAISE-on-mismatch (whole-invocation rollback), never a partial batch.
-- ============================================================================
