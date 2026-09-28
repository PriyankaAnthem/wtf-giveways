-- ============================================================================
-- WTF Marketing Hub — Stage 3C1: CENTRAL Marketing Opportunity Engine (schema)
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Create the DATABASE CONTAINER for the future central Marketing Opportunity
--   Engine: one table, public.marketing_opportunities, plus one read-only
--   aggregate admin RPC. This is the arbitration layer that will let the six
--   existing automations behave as OPPORTUNITY SOURCES feeding a single central
--   selector — they must NEVER become six independent sending systems.
--
--   Future flow (NOT built here):
--     customer behaviour
--       -> detector creates opportunities
--       -> central selector compares all opportunities for a contact
--       -> ONE best action selected
--       -> eligibility / frequency / suppression gates
--       -> recipient created later
--       -> sender later
--
--   IMPORTANT ARCHITECTURE:
--     Being a marketing OPPORTUNITY is NOT the same as being SENDABLE.
--     Consent / suppression / frequency remain a SEPARATE deterministic gate
--     applied later, before any recipient is ever created. This table records
--     opportunities across the full customer-intelligence base; it grants no
--     permission to contact anyone.
--
-- WHAT THIS MIGRATION DOES
--   * Creates exactly ONE new table: public.marketing_opportunities.
--   * Creates exactly ONE new function: get_admin_marketing_opportunity_overview.
--   * Leaves the table COMPLETELY EMPTY (no detection, no backfill, no import).
--
-- WHAT THIS MIGRATION DOES NOT DO (explicit non-goals for Stage 3C1)
--   * NO detection, NO arbitration/selection, NO AI, NO cron routes.
--   * NO recipients created, NO automation runs created, NO email sent.
--   * Does NOT enable discovery, does NOT enable sending, does NOT change
--     rollout_limit (it only READS them to assert Marketing is paused).
--   * Does NOT modify migrations 001-006, does NOT ALTER any existing table,
--     does NOT CREATE EXTENSION, adds NO trigger.
--   * Does NOT touch checkout, payment, ticket allocation, wallet, signup,
--     public pages or transactional email.
--
-- SCOPE / SAFETY
--   * ATOMIC. Whole migration in one BEGIN/COMMIT: any failure rolls it all
--     back, so it can never be left half-installed on the live database.
--   * FAIL FAST. lock_timeout + statement_timeout are set LOCAL so the install
--     aborts quickly instead of blocking a busy production database.
--   * ADDITIVE ONLY. CREATE ... IF NOT EXISTS / CREATE OR REPLACE make a re-run
--     a practical no-op.
--   * gen_random_uuid() is already used across this database (pgcrypto present),
--     so this migration does NOT run CREATE EXTENSION.
--   * New table: RLS ENABLED + FORCED, NO policies, all access revoked from
--     anon/authenticated, minimal grants to service_role only, NO DELETE grant
--     (this is an audit/history table — future logic expires/supersedes rows
--     rather than deleting them).
--
-- REFERENCES TO EXISTING OBJECTS (created by earlier migrations):
--     public.marketing_automations(id)          -- the six opportunity sources.
--     public.marketing_external_contacts(id)    -- consented non-Auth contacts.
--     public.marketing_campaign_promotions(id)  -- admin campaign promotions.
--     public.campaigns(id)                       -- competitions.
--   All FKs use ON DELETE RESTRICT so an opportunity can never dangle.
--   user_id is a plain uuid with NO FK (immutable audit ledger, exactly like
--   marketing_recipients): deleting an Auth user must never rewrite history or
--   break the exactly-one-identity invariant.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migrations 001-006, while Marketing is paused.
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database, and never let the
-- install run away. LOCAL = scoped to this transaction only; nothing global.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Preflight (read-only): dependency check + single-execution advisory lock +
-- global-pause assertion. Any failure RAISES and rolls the whole migration back
-- BEFORE the table is created.
--   * to_regclass() is a pure lookup (NULL when absent). We create/alter NONE
--     of the dependency objects.
--   * pg_try_advisory_xact_lock() is transaction-scoped, released at
--     COMMIT/ROLLBACK. We RAISE rather than wait.
--   * The Marketing Hub must still be GLOBALLY PAUSED.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text[] := ARRAY[]::text[];
  v_dep       text;
  v_sending   boolean;
  v_discovery boolean;
  v_rollout   integer;
BEGIN
  FOREACH v_dep IN ARRAY ARRAY[
    'public.marketing_automations',
    'public.marketing_external_contacts',
    'public.marketing_campaign_promotions',
    'public.campaigns',
    'public.marketing_control_state'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C1 migration aborted: required dependency % is missing. Run migrations 001-006 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- Migration-specific advisory key (fixed for THIS migration only).
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c1_opportunity_foundation')) THEN
    RAISE EXCEPTION
      'Stage 3C1 migration aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- The Marketing Hub must be GLOBALLY PAUSED before we add the opportunity
  -- container. Refuse otherwise.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C1 migration aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C1 migration aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to install.',
      v_sending, v_discovery, v_rollout;
  END IF;
END
$preflight$;

-- ============================================================================
-- marketing_opportunities
--   The CENTRAL arbitration layer. A detector writes an opportunity here; a
--   later central selector compares all of a contact's open opportunities and
--   promotes at most one into a run/recipient (subject to the SEPARATE
--   eligibility gate). This table is durable HISTORY: rows are expired /
--   superseded, never deleted.
--
--   Exactly one of user_id / external_contact_id is present. user_id has NO FK
--   (immutable ledger). external_contact_id FKs marketing_external_contacts
--   with ON DELETE RESTRICT so a contact with opportunity history cannot vanish.
--
--   reason / context_snapshot are BOUNDED structured JSON OBJECTS only — never
--   arbitrary prompts, AI responses, full checkout payloads or provider
--   payloads. decision_mode stays NULL until a later selection stage and may
--   only ever become 'deterministic' or 'ai'; deterministic arbitration must
--   always work when AI is unavailable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketing_opportunities (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (exactly one of the two).
  user_id             uuid,
  external_contact_id uuid        REFERENCES public.marketing_external_contacts(id) ON DELETE RESTRICT,
  email_lc            text        NOT NULL,

  -- Opportunity source.
  automation_id       uuid        NOT NULL REFERENCES public.marketing_automations(id) ON DELETE RESTRICT,
  opportunity_type    text        NOT NULL,

  -- Campaign context (optional).
  campaign_id         uuid        REFERENCES public.campaigns(id)                    ON DELETE RESTRICT,
  promotion_id        uuid        REFERENCES public.marketing_campaign_promotions(id) ON DELETE RESTRICT,

  -- Timing.
  detected_at         timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  deferred_until      timestamptz,
  selected_at         timestamptz,
  actioned_at         timestamptz,

  -- Ranking. score is deliberately bounded to a fixed 0-1000 range (see the
  -- score CHECK below) so future deterministic/AI selectors share one clear
  -- scale; it is NEVER an unbounded numeric.
  base_priority       integer        NOT NULL,
  score               numeric(10,4),
  decision_mode       text,

  -- Lifecycle state.
  state               text        NOT NULL DEFAULT 'open',

  -- Bounded structured explanation / context (JSON OBJECTS only).
  reason              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context_snapshot    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Idempotency spine.
  dedupe_key          text        NOT NULL,

  -- Standard.
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- 1) Exactly one identity: an opportunity is either an Auth user OR an
  --    external contact, never both and never neither.
  CONSTRAINT marketing_opportunities_identity_chk CHECK (
    (user_id IS NOT NULL) <> (external_contact_id IS NOT NULL)
  ),

  -- 2) Email always stored trimmed + lowercased, non-empty, max 320 chars.
  CONSTRAINT marketing_opportunities_email_lc_chk CHECK (
    email_lc = lower(email_lc) AND email_lc = btrim(email_lc) AND length(email_lc) > 0
  ),
  CONSTRAINT marketing_opportunities_email_len_chk CHECK (
    char_length(email_lc) <= 320
  ),

  -- 3) opportunity_type restricted to EXACTLY the six existing automation keys.
  CONSTRAINT marketing_opportunities_type_chk CHECK (
    opportunity_type IN (
      'vip_early_access',
      'abandoned_checkout',
      'wtf_credit_waiting',
      'regular_buyer_campaign_alert',
      'new_account_no_purchase',
      'lapsed_14_days'
    )
  ),

  -- 4) state restricted to the seven allowed lifecycle values.
  CONSTRAINT marketing_opportunities_state_chk CHECK (
    state IN (
      'open',
      'selected',
      'suppressed',
      'deferred',
      'expired',
      'superseded',
      'actioned'
    )
  ),

  -- 5) decision_mode is NULL (until a later selection stage) or exactly one of
  --    the two permitted modes. Deterministic must always be possible.
  CONSTRAINT marketing_opportunities_decision_mode_chk CHECK (
    decision_mode IS NULL OR decision_mode IN ('deterministic', 'ai')
  ),

  -- 6) base_priority is a real 1-based rank.
  CONSTRAINT marketing_opportunities_base_priority_chk CHECK (
    base_priority >= 1
  ),

  -- 6b) score is NULL (until a later selection stage) or a bounded value on a
  --     fixed 0-1000 scale. This hard range keeps deterministic/AI ranking
  --     comparable and prevents runaway/garbage scores. Schema only — grants
  --     AI no permission or functionality.
  CONSTRAINT marketing_opportunities_score_range_chk CHECK (
    score IS NULL OR (score >= 0 AND score <= 1000)
  ),

  -- 7) An opportunity must expire strictly after it was detected.
  CONSTRAINT marketing_opportunities_expiry_chk CHECK (
    expires_at > detected_at
  ),

  -- 8) A selection can never predate detection.
  CONSTRAINT marketing_opportunities_selected_after_detected_chk CHECK (
    selected_at IS NULL OR selected_at >= detected_at
  ),

  -- 9) An action can never predate detection.
  CONSTRAINT marketing_opportunities_actioned_after_detected_chk CHECK (
    actioned_at IS NULL OR actioned_at >= detected_at
  ),

  -- 10) Bounded idempotency key.
  CONSTRAINT marketing_opportunities_dedupe_len_chk CHECK (
    char_length(dedupe_key) > 0 AND char_length(dedupe_key) <= 300
  ),

  -- 11) reason / context_snapshot must be JSON OBJECTS (never arrays/scalars),
  --     so only bounded structured data is ever stored.
  CONSTRAINT marketing_opportunities_reason_object_chk CHECK (
    jsonb_typeof(reason) = 'object'
  ),
  CONSTRAINT marketing_opportunities_context_object_chk CHECK (
    jsonb_typeof(context_snapshot) = 'object'
  ),

  -- 12) Hard SIZE limits on the JSON payloads. These are enforced (not just
  --     documented) so this table can NEVER become a store for full AI prompts,
  --     full AI responses, checkout payloads, provider payloads, or arbitrary
  --     large JSON. reason <= 4096 bytes; context_snapshot <= 8192 bytes.
  CONSTRAINT marketing_opportunities_reason_size_chk CHECK (
    octet_length(reason::text) <= 4096
  ),
  CONSTRAINT marketing_opportunities_context_size_chk CHECK (
    octet_length(context_snapshot::text) <= 8192
  )
);

-- ----------------------------------------------------------------------------
-- Indexes.
-- ----------------------------------------------------------------------------

-- Global detection idempotency: a detector retry must never create the same
-- logical opportunity twice. This is the durable idempotency mechanism — we do
-- NOT add a naive UNIQUE(user_id, opportunity_type), because the same customer
-- may legitimately gain a NEW lapsed / credit / campaign opportunity in a later
-- detection window.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_opportunities_dedupe_key_uidx
  ON public.marketing_opportunities (dedupe_key);

-- Working-set index: the future central selector scans OPEN opportunities by
-- expiry / priority / score. Partial on the hot state keeps it small.
CREATE INDEX IF NOT EXISTS marketing_opportunities_open_workingset_idx
  ON public.marketing_opportunities (expires_at, base_priority, score)
  WHERE state = 'open';

-- Per-contact arbitration: gather a single contact's opportunities by state and
-- expiry, cheaply, for each identity shape and for the raw email.
CREATE INDEX IF NOT EXISTS marketing_opportunities_user_state_idx
  ON public.marketing_opportunities (user_id, state, expires_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_opportunities_external_state_idx
  ON public.marketing_opportunities (external_contact_id, state, expires_at)
  WHERE external_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_opportunities_email_state_idx
  ON public.marketing_opportunities (email_lc, state, expires_at);

-- Campaign / promotion partial indexes (only when the context is present).
CREATE INDEX IF NOT EXISTS marketing_opportunities_campaign_idx
  ON public.marketing_opportunities (campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_opportunities_promotion_idx
  ON public.marketing_opportunities (promotion_id)
  WHERE promotion_id IS NOT NULL;

-- Opportunity-type + state for future aggregate dashboards / detectors.
CREATE INDEX IF NOT EXISTS marketing_opportunities_type_state_idx
  ON public.marketing_opportunities (opportunity_type, state);

COMMENT ON TABLE public.marketing_opportunities IS
  'Stage 3C1 central marketing-opportunity arbitration ledger. Empty on install. An opportunity is NOT permission to send: consent/suppression/frequency remain a separate later gate. Rows are expired/superseded, never deleted. Only bounded structured JSON in reason/context_snapshot. Service-role only.';

-- ============================================================================
-- Security: RLS ENABLED + FORCED, NO policies, no anon/authenticated access.
-- Only service_role (which bypasses RLS) may touch the table; NO DELETE grant.
-- ============================================================================
ALTER TABLE public.marketing_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_opportunities FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_opportunities FROM anon, authenticated;

-- No DELETE: this is an audit/history table; future logic expires/supersedes.
GRANT SELECT, INSERT, UPDATE ON public.marketing_opportunities TO service_role;

-- ============================================================================
-- Read-only admin aggregate RPC.
--   SECURITY DEFINER + fixed search_path + service_role-only EXECUTE. Returns
--   AGGREGATE information ONLY: totals and counts by state / type / decision
--   mode. NO identities, NO emails, NO customer rows, NO checkout scan. With
--   zero rows every count is zero. Foundation for a future hidden admin
--   dashboard; NOT wired into the UI in this stage.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_opportunity_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE
  v_now         timestamptz := now();
  v_counts      jsonb;
  v_by_state    jsonb;
  v_by_type     jsonb;
BEGIN
  -- The 10s statement-timeout ceiling is enforced declaratively via the
  -- function's SET statement_timeout clause (keeps this STABLE function fully
  -- read-only; no set_config / no runtime GUC writes).

  -- Single-pass conditional aggregation over the (initially empty) table.
  SELECT jsonb_build_object(
           'total',                 count(*),
           'open',                  count(*) FILTER (WHERE state = 'open'),
           'selected',              count(*) FILTER (WHERE state = 'selected'),
           'suppressed',            count(*) FILTER (WHERE state = 'suppressed'),
           'deferred',              count(*) FILTER (WHERE state = 'deferred'),
           'expired',               count(*) FILTER (WHERE state = 'expired'),
           'superseded',            count(*) FILTER (WHERE state = 'superseded'),
           'actioned',              count(*) FILTER (WHERE state = 'actioned'),
           -- CURRENTLY-selected decision counts only: a row counts here only
           -- while it is in the 'selected' state, not merely because it once
           -- carried that decision_mode.
           'deterministicSelected', count(*) FILTER (WHERE decision_mode = 'deterministic' AND state = 'selected'),
           'aiSelected',            count(*) FILTER (WHERE decision_mode = 'ai' AND state = 'selected')
         )
    INTO v_counts
    FROM public.marketing_opportunities;

  -- Count by state (every allowed state present, zero when absent).
  SELECT jsonb_object_agg(s.state, COALESCE(c.cnt, 0))
    INTO v_by_state
    FROM (VALUES
            ('open'), ('selected'), ('suppressed'), ('deferred'),
            ('expired'), ('superseded'), ('actioned')
         ) AS s(state)
    LEFT JOIN (
      SELECT state, count(*)::bigint AS cnt
        FROM public.marketing_opportunities
       GROUP BY state
    ) c ON c.state = s.state;

  -- Count by opportunity type (every allowed type present, zero when absent).
  SELECT jsonb_object_agg(t.type, COALESCE(c.cnt, 0))
    INTO v_by_type
    FROM (VALUES
            ('vip_early_access'), ('abandoned_checkout'), ('wtf_credit_waiting'),
            ('regular_buyer_campaign_alert'), ('new_account_no_purchase'),
            ('lapsed_14_days')
         ) AS t(type)
    LEFT JOIN (
      SELECT opportunity_type, count(*)::bigint AS cnt
        FROM public.marketing_opportunities
       GROUP BY opportunity_type
    ) c ON c.opportunity_type = t.type;

  RETURN jsonb_build_object(
    'generatedAt',            v_now,
    'total',                  (v_counts ->> 'total')::bigint,
    'open',                   (v_counts ->> 'open')::bigint,
    'selected',               (v_counts ->> 'selected')::bigint,
    'suppressed',             (v_counts ->> 'suppressed')::bigint,
    'deferred',               (v_counts ->> 'deferred')::bigint,
    'expired',                (v_counts ->> 'expired')::bigint,
    'actioned',               (v_counts ->> 'actioned')::bigint,
    'deterministicSelected',  (v_counts ->> 'deterministicSelected')::bigint,
    'aiSelected',             (v_counts ->> 'aiSelected')::bigint,
    'countByState',           v_by_state,
    'countByType',            v_by_type
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_opportunity_overview() IS
  'Stage 3C1 read-only admin opportunity overview. Reads ONLY marketing_opportunities. Returns aggregate counts by state / type / decision mode as one jsonb payload. No identities, no emails, no rows, no writes, no checkout scan, no sending. Service-role only.';

-- Service-role-only execution.
REVOKE ALL ON FUNCTION public.get_admin_marketing_opportunity_overview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_opportunity_overview() TO service_role;

COMMIT;

-- ============================================================================
-- End of Stage 3C1 migration.
--   * Wrapped in a single atomic BEGIN/COMMIT with fail-fast lock/statement
--     timeouts, a dependency + advisory-lock preflight, and a global-pause
--     assertion (sending_enabled/discovery_enabled/rollout_limit read only).
--   * 1 new table (marketing_opportunities), RLS enabled + forced,
--     service-role only, NO DELETE grant. Table is EMPTY.
--   * 1 new read-only aggregate RPC (get_admin_marketing_opportunity_overview).
--   * NO detection, NO arbitration, NO AI, NO cron, NO recipients, NO runs,
--     NO email, NO discovery/sending enabled, NO rollout change.
--   * NO CREATE EXTENSION, NO ALTER of any existing table, NO trigger.
--   * Migrations 001-006 untouched. Checkout/payment/ticket/wallet/signup/
--     public pages / transactional email unchanged.
-- ============================================================================
