-- ============================================================================
-- WTF Marketing Hub — Stage 3D0: RECIPIENT <-> OPPORTUNITY LINKAGE FOUNDATION
-- ----------------------------------------------------------------------------
-- MIGRATION 017
--
-- PURPOSE
--   Install the durable, database-enforced relationship
--
--       public.marketing_recipients.opportunity_id  ->  public.marketing_opportunities.id
--
--   so that a LATER, separately-audited stage (Stage 3D1, migration 018) can
--   truthfully answer "has this opportunity already produced a recipient?" and
--   enforce one-recipient-per-opportunity at the database level.
--
--   The earlier accidental Stage 3D1 recipient-gate draft correctly STOPPED on a
--   hard schema blocker: neither table carried a durable link. THIS migration is
--   ONLY the prerequisite linkage foundation. It does NOT implement the recipient
--   safety gate, and it materialises NOTHING.
--
-- WHAT THIS MIGRATION DOES (schema only, zero data materialisation)
--   1. ADD COLUMN marketing_recipients.opportunity_id uuid NULL  (no default, no
--      backfill, no table rewrite).
--   2. ADD a FK opportunity_id -> marketing_opportunities(id) ON DELETE RESTRICT,
--      installed NOT VALID then VALIDATE'd (safe production lock profile).
--   3. CREATE a UNIQUE PARTIAL INDEX on (opportunity_id) WHERE opportunity_id IS
--      NOT NULL — the final race-condition defence: one recipient per opportunity.
--   4. INSTALL a tiny BEFORE UPDATE trigger making a NON-NULL opportunity_id
--      immutable (set-once): once linked, a recipient can never be re-pointed or
--      unlinked.
--
-- WHAT THIS MIGRATION MUST NOT DO
--   No INSERT/UPDATE/DELETE of recipients or opportunities. No backfill of
--   opportunity_id. No runs. No discovery / lifecycle / materialisation calls. No
--   sending, cron, or AI. No change to control state, definitions, frequency
--   caps, consent, scores, priorities, expiries, dedupe, RLS, or grants. No new
--   RPC. No identity/campaign validation logic (that belongs to the later
--   audited materialisation stage). Migrations 001-016 remain untouched.
--
-- PRODUCTION SAFETY
--   Single transaction; SET LOCAL lock_timeout so the migration FAILS rather than
--   blocking a busy production table; nullable ADD COLUMN with NO DEFAULT avoids a
--   rewrite; FK NOT VALID + VALIDATE avoids a long ACCESS EXCLUSIVE validation
--   scan. Read-only preflight + post-DDL verification bracket the DDL; ANY failed
--   assertion RAISEs and rolls back the ENTIRE migration.
-- ============================================================================

BEGIN;

-- Fail fast instead of blocking production; generous statement timeout for the
-- (trivial, all-NULL) constraint validation and index build.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- PREFLIGHT — advisory lock + ALL read-only assertions BEFORE any DDL.
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
  v_bad_types    bigint;
  v_c_new        bigint;
  v_c_winner     bigint;
  v_c_highvalue  bigint;
  v_c_checkout   bigint;
BEGIN
  -- Single-execution guard: migration-specific advisory key (transaction-scoped).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3d0_recipient_opportunity_linkage')) THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 1-4. Required tables must exist.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_recipients',
    'public.marketing_opportunities',
    'public.marketing_control_state',
    'public.marketing_opportunity_definitions'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: required dependency % is missing.', array_to_string(v_missing, ', ');
  END IF;

  -- 5. marketing_opportunities.id must be uuid (the FK target type).
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_id_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.marketing_opportunities'::regclass
     AND a.attname = 'id'
     AND NOT a.attisdropped;
  IF v_id_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: marketing_opportunities.id type is %, expected uuid.', COALESCE(v_id_type, '(missing)');
  END IF;

  -- 6. marketing_recipients must NOT already have an opportunity_id column.
  --    If it does, the repository schema is in an unexpected state -> STOP.
  PERFORM 1
     FROM pg_attribute
    WHERE attrelid = 'public.marketing_recipients'::regclass
      AND attname = 'opportunity_id'
      AND NOT attisdropped;
  IF FOUND THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: marketing_recipients.opportunity_id already exists; unexpected schema conflict.';
  END IF;

  -- 7. Marketing must be fully paused.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: marketing_control_state singleton (key=''default'') not found.';
  END IF;
  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: Marketing is not paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%).',
      v_sending, v_discovery, v_rollout;
  END IF;

  -- 8. No definition may be enabled.
  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: % definition(s) enabled; expected 0.', v_enabled_defs;
  END IF;

  -- 9. Opportunity ledger must hold EXACTLY six rows.
  SELECT count(*) INTO v_opp_count FROM public.marketing_opportunities;
  IF v_opp_count <> 6 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: marketing_opportunities holds % row(s); expected exactly 6.', v_opp_count;
  END IF;

  -- 10-11. Exact four-type distribution, and NO other types.
  SELECT count(*) FILTER (WHERE opportunity_type = 'new_account_no_purchase'),
         count(*) FILTER (WHERE opportunity_type = 'recent_winner_credit_available'),
         count(*) FILTER (WHERE opportunity_type = 'high_value_customer_at_risk'),
         count(*) FILTER (WHERE opportunity_type = 'abandoned_checkout'),
         count(*) FILTER (WHERE opportunity_type NOT IN (
           'new_account_no_purchase', 'recent_winner_credit_available',
           'high_value_customer_at_risk', 'abandoned_checkout'))
    INTO v_c_new, v_c_winner, v_c_highvalue, v_c_checkout, v_bad_types
    FROM public.marketing_opportunities;
  IF v_c_new <> 1 OR v_c_winner <> 2 OR v_c_highvalue <> 2 OR v_c_checkout <> 1 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: unexpected distribution (new=%, winner=%, highValue=%, checkout=%; expected 1/2/2/1).',
      v_c_new, v_c_winner, v_c_highvalue, v_c_checkout;
  END IF;
  IF v_bad_types <> 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) aborted: % opportunity row(s) of an unexpected type exist.', v_bad_types;
  END IF;
END
$preflight$;

-- 12. Capture baseline counts (must be identical after installation). The temp
--     table is dropped automatically at COMMIT.
CREATE TEMP TABLE tmp_marketing_3d0_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.marketing_recipients)      AS recipients_before,
  (SELECT count(*) FROM public.marketing_automation_runs) AS runs_before,
  (SELECT count(*) FROM public.marketing_opportunities)   AS opportunities_before;

-- ============================================================================
-- SCHEMA CHANGE 1 — NULLABLE OPPORTUNITY LINK (no default, no backfill).
-- ============================================================================
ALTER TABLE public.marketing_recipients
  ADD COLUMN opportunity_id uuid;

COMMENT ON COLUMN public.marketing_recipients.opportunity_id IS
  'Durable source-opportunity linkage -> marketing_opportunities.id. NULL means the recipient predates opportunity-driven materialisation or was created without an opportunity source. Migration 017 performs NO backfill. Future opportunity-driven recipient creation MUST populate this field; once set it is immutable (set-once) and unique per opportunity.';

-- ============================================================================
-- SCHEMA CHANGE 2 — REFERENTIAL INTEGRITY (ON DELETE RESTRICT).
--   NOT VALID + VALIDATE = safest production lock profile: adding the constraint
--   NOT VALID takes a brief lock without scanning existing rows; VALIDATE then
--   runs under a weaker SHARE UPDATE EXCLUSIVE lock. All existing opportunity_id
--   values are NULL (column just added), so validation is trivial. RESTRICT (not
--   CASCADE): opportunities are a lifecycle ledger and must never silently delete
--   a recipient's source relationship.
-- ============================================================================
ALTER TABLE public.marketing_recipients
  ADD CONSTRAINT marketing_recipients_opportunity_fk
  FOREIGN KEY (opportunity_id)
  REFERENCES public.marketing_opportunities (id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.marketing_recipients
  VALIDATE CONSTRAINT marketing_recipients_opportunity_fk;

-- ============================================================================
-- SCHEMA CHANGE 3 — ONE RECIPIENT PER OPPORTUNITY (unique partial index).
--   This is the FINAL database-level race-condition defence behind the future
--   application recipient gate. It also serves opportunity_id lookups, so NO
--   redundant ordinary index is created.
-- ============================================================================
CREATE UNIQUE INDEX marketing_recipients_opportunity_unique_idx
  ON public.marketing_recipients (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

-- ============================================================================
-- SCHEMA CHANGE 4 — LINK IMMUTABILITY (set-once guard).
--   INSERT: any value allowed (subject to FK/unique). UPDATE: once opportunity_id
--   is non-NULL it may only stay the SAME value; changing it or clearing it to
--   NULL is rejected. No other recipient field is made immutable here; identity /
--   user / email / campaign consistency is deferred to the later audited stage.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.marketing_recipients_guard_opportunity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.opportunity_id IS NOT NULL
     AND NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
    RAISE EXCEPTION
      'marketing_recipients.opportunity_id is immutable once set (recipient %; existing opportunity %, attempted %).',
      OLD.id, OLD.opportunity_id, NEW.opportunity_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.marketing_recipients_guard_opportunity_link() IS
  'BEFORE UPDATE guard: once marketing_recipients.opportunity_id is non-NULL it is immutable (set-once). Rejects re-pointing to a different opportunity and clearing back to NULL. Does not constrain any other column.';

-- Minimal privilege: trigger functions are invoked internally regardless of
-- EXECUTE grants, so nothing needs (or should have) direct execute access.
REVOKE ALL ON FUNCTION public.marketing_recipients_guard_opportunity_link() FROM PUBLIC;

CREATE TRIGGER marketing_recipients_opportunity_link_immutable_trg
  BEFORE UPDATE ON public.marketing_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.marketing_recipients_guard_opportunity_link();

-- ============================================================================
-- POST-DDL VERIFICATION — all read-only; ANY failure rolls back everything.
-- ============================================================================
DO $postcheck$
DECLARE
  v_type          text;
  v_notnull       boolean;
  v_default       text;
  v_non_null_rows bigint;

  v_fk_deltype    "char";
  v_fk_validated  boolean;
  v_fk_target     text;
  v_fk_refcol     text;

  v_idx_unique    boolean;
  v_idx_def       text;
  v_extra_idx     bigint;

  v_trg_enabled   "char";

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

  v_c_new         bigint;
  v_c_winner      bigint;
  v_c_highvalue   bigint;
  v_c_checkout    bigint;
  v_bad_types     bigint;
BEGIN
  -- 1-4. Column exists, is uuid, nullable, no default.
  SELECT format_type(a.atttypid, a.atttypmod),
         a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_notnull, v_default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.marketing_recipients'::regclass
     AND a.attname = 'opportunity_id'
     AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity_id column was not created.';
  END IF;
  IF v_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity_id type is %, expected uuid.', v_type;
  END IF;
  IF v_notnull IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity_id is NOT NULL; expected nullable.';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity_id has a default (%); expected none.', v_default;
  END IF;

  -- 5. No backfill occurred: every existing recipient row is still NULL.
  SELECT count(*) INTO v_non_null_rows
    FROM public.marketing_recipients
   WHERE opportunity_id IS NOT NULL;
  IF v_non_null_rows <> 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: % recipient row(s) have a non-NULL opportunity_id; expected 0 (no backfill).', v_non_null_rows;
  END IF;

  -- 6-7. FK exists, validated, targets marketing_opportunities(id), RESTRICT.
  SELECT c.confdeltype,
         c.convalidated,
         c.confrelid::regclass::text,
         (SELECT a.attname
            FROM pg_attribute a
           WHERE a.attrelid = c.confrelid
             AND a.attnum = c.confkey[1])
    INTO v_fk_deltype, v_fk_validated, v_fk_target, v_fk_refcol
    FROM pg_constraint c
   WHERE c.conname = 'marketing_recipients_opportunity_fk'
     AND c.conrelid = 'public.marketing_recipients'::regclass
     AND c.contype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: FK marketing_recipients_opportunity_fk missing.';
  END IF;
  IF v_fk_target IS DISTINCT FROM 'marketing_opportunities' OR v_fk_refcol IS DISTINCT FROM 'id' THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: FK targets %.%, expected marketing_opportunities.id.', v_fk_target, v_fk_refcol;
  END IF;
  IF v_fk_deltype <> 'r' THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: FK ON DELETE action is %, expected RESTRICT (r).', v_fk_deltype;
  END IF;
  IF v_fk_validated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: FK is not validated.';
  END IF;

  -- 8. Unique partial index exists with predicate opportunity_id IS NOT NULL.
  SELECT i.indisunique, pg_get_indexdef(i.indexrelid)
    INTO v_idx_unique, v_idx_def
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'marketing_recipients_opportunity_unique_idx';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: unique index marketing_recipients_opportunity_unique_idx missing.';
  END IF;
  IF v_idx_unique IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity index is not UNIQUE.';
  END IF;
  IF position('opportunity_id IS NOT NULL' IN v_idx_def) = 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: unique index predicate is not "opportunity_id IS NOT NULL" (def: %).', v_idx_def;
  END IF;

  -- No redundant ordinary index on opportunity_id: exactly ONE index references
  -- the column (the unique partial one).
  SELECT count(*) INTO v_extra_idx
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.marketing_recipients'::regclass
     AND EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = 'public.marketing_recipients'::regclass
          AND a.attname = 'opportunity_id'
          AND a.attnum = ANY (i.indkey::smallint[])
     );
  IF v_extra_idx <> 1 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: % index(es) reference opportunity_id; expected exactly 1 (the unique partial index).', v_extra_idx;
  END IF;

  -- 9. Immutability trigger exists and is enabled.
  SELECT t.tgenabled
    INTO v_trg_enabled
    FROM pg_trigger t
   WHERE t.tgname = 'marketing_recipients_opportunity_link_immutable_trg'
     AND t.tgrelid = 'public.marketing_recipients'::regclass
     AND NOT t.tgisinternal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: immutability trigger missing.';
  END IF;
  IF v_trg_enabled = 'D' THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: immutability trigger is disabled.';
  END IF;

  -- 10-13. Counts unchanged; opportunity ledger still exactly 6 with same shape.
  SELECT recipients_before, runs_before, opportunities_before
    INTO v_recip_before, v_runs_before, v_opp_before
    FROM tmp_marketing_3d0_baseline;

  SELECT count(*) INTO v_recip_now FROM public.marketing_recipients;
  SELECT count(*) INTO v_runs_now  FROM public.marketing_automation_runs;
  SELECT count(*) INTO v_opp_now   FROM public.marketing_opportunities;

  IF v_recip_now <> v_recip_before THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: recipient count changed (% -> %).', v_recip_before, v_recip_now;
  END IF;
  IF v_runs_now <> v_runs_before THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: automation-run count changed (% -> %).', v_runs_before, v_runs_now;
  END IF;
  IF v_opp_now <> 6 OR v_opp_now <> v_opp_before THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity count is % (before %); expected 6 unchanged.', v_opp_now, v_opp_before;
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
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: opportunity distribution changed (new=%, winner=%, highValue=%, checkout=%, other=%).',
      v_c_new, v_c_winner, v_c_highvalue, v_c_checkout, v_bad_types;
  END IF;

  -- 14-17. Marketing still fully paused; still zero enabled definitions.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';
  IF v_sending IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: sending_enabled is % (MUST be false).', v_sending;
  END IF;
  IF v_discovery IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: discovery_enabled is % (MUST be false).', v_discovery;
  END IF;
  IF v_rollout IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: rollout_limit is % (MUST be 0).', v_rollout;
  END IF;

  SELECT count(*) INTO v_enabled_defs
    FROM public.marketing_opportunity_definitions
   WHERE enabled = true;
  IF v_enabled_defs <> 0 THEN
    RAISE EXCEPTION 'Stage 3D0 (017) verify aborted: % definition(s) enabled; expected 0.', v_enabled_defs;
  END IF;
END
$postcheck$;

COMMIT;

-- ============================================================================
-- POST-CONDITIONS (informational):
--   * marketing_recipients gains a nullable uuid opportunity_id (no default);
--     every pre-existing recipient row is NULL (no backfill).
--   * FK marketing_recipients_opportunity_fk -> marketing_opportunities(id),
--     ON DELETE RESTRICT, VALIDATED.
--   * UNIQUE partial index marketing_recipients_opportunity_unique_idx enforces
--     one recipient per opportunity (WHERE opportunity_id IS NOT NULL).
--   * BEFORE UPDATE trigger makes a set opportunity_id immutable (set-once).
--   * No recipient/opportunity/run rows changed; control state stays paused;
--     definitions stay disabled; no RLS/grant change; no RPC; no cron; no AI.
--   * The recipient SAFETY GATE is intentionally NOT implemented here — that is
--     Stage 3D1 / migration 018, built on top of this linkage.
-- ============================================================================
