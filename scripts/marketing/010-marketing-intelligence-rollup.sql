-- ============================================================================
-- WTF Marketing Hub — Stage 3C2C: Customer Intelligence Rollup Engine
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Install a SEPARATE, resumable, bounded rollup engine that DERIVES real
--   behavioural intelligence from existing operational tables into the two
--   Stage 3C2B containers (installed empty by migration 009):
--
--       existing operational tables
--             -> bounded, set-based, advisory-locked rollup
--             -> public.customer_marketing_intelligence   (one row per profile)
--             -> public.customer_campaign_affinity         (derived current state)
--
--   This is INTELLIGENCE/ANALYTICS ONLY. It does NOT detect opportunities, does
--   NOT score, does NOT select, does NOT send, and does NOT enable anything. The
--   flow is deliberately  operational -> intelligence , NOT  operational ->
--   opportunities . Opportunity detection is a LATER stage.
--
-- WHAT THIS MIGRATION INSTALLS (structures + functions ONLY)
--   1. public.customer_marketing_intelligence_refresh_state — a NEW singleton
--      state table (separate from customer_marketing_profile_refresh_state),
--      driving bounded backfill + safe incremental refresh.
--   2. public.refresh_customer_marketing_intelligence_batch(uuid[]) — a private,
--      SET-BASED helper that recomputes intelligence + rebuilds affinity for a
--      bounded candidate batch in ONE transaction. No per-user loop.
--   3. public.refresh_customer_marketing_intelligence(p_limit int DEFAULT 500) —
--      the advisory-locked orchestrator: one bounded backfill batch per call
--      (universe = customer_marketing_profiles) until complete, then safe
--      incremental changed-user refresh with a watermark + overlap.
--   4. public.get_admin_marketing_intelligence_overview() — a compact,
--      service-role-only, STABLE read RPC returning aggregates ONLY.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * It does NOT run any refresh. Installation performs ZERO behavioural
--     backfill. customer_marketing_intelligence and customer_campaign_affinity
--     row counts are unchanged by installation (currently 0). Backfill begins
--     ONLY when an operator manually calls the refresh RPC after review.
--   * NO DML against operational source tables (checkout_intents,
--     instant_win_awards, wallet_transactions, wallet_accounts, campaigns,
--     entries, ticket_allocations, marketing_automations). They are READ ONLY.
--   * Does NOT ALTER customer_marketing_profiles (the stable Stage 1 system) or
--     its refresh-state table. Does NOT modify migrations 001-009, nor the
--     unexecuted, superseded migration 008.
--   * NO opportunities, NO recipients, NO automation runs, NO email, NO Resend,
--     NO AI, NO cron. Does NOT enable any opportunity definition, does NOT
--     change sending_enabled / discovery_enabled / rollout_limit (it only READS
--     control state to assert Marketing is paused before installing).
--   * Does NOT touch checkout, payment, ticket allocation, wallet, signup,
--     public pages or transactional email behaviour.
--
-- WINNER-MARKETING BOUNDARY (enforced here)
--   Winning is stored ONLY as positive engagement history (last win, win_count,
--   wins_30d, last win value/type/campaign). This engine computes NO losing
--   streak, NO losses, NO near miss, NO "due to win", NO win probability, and
--   nothing implying past results affect future odds. No such column exists in
--   the 009 containers and none is derived here.
--
-- SOURCE SEMANTICS (verified against the repository before coding)
--   * Canonical confirmed-order predicate (reused EXACTLY from migration 003):
--       state = 'confirmed'
--       AND provider IS DISTINCT FROM 'debug'
--       AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
--       AND confirmed_at IS NOT NULL
--   * Canonical external-cash per order (reused EXACTLY from migration 003):
--       CASE WHEN external_payment_pence IS NOT NULL THEN external_payment_pence
--            ELSE COALESCE(total_pence, 0) - COALESCE(wallet_credit_pence, 0) END
--     Stored aggregates are additionally clamped with GREATEST(x, 0) purely as a
--     non-negativity guard for the 009 CHECK constraints; the per-order formula
--     is byte-for-byte the Stage 1 definition (no competing revenue definition).
--   * Award -> user resolves through instant_win_awards.checkout_intent_id ->
--     checkout_intents.id -> checkout_intents.user_id, and ONLY awards tied to a
--     canonical confirmed real checkout are counted (join onto the candidate
--     confirmed-order CTE). Win value uses the canonical stored
--     instant_win_awards.prize_value_pence (NEVER prize_value_text); NULL is
--     preserved when absent (no invented fallback). last_win_fulfilment_type is
--     whitelisted to ('cash','wallet_credit','manual') to match both the live
--     award data and the 009 CHECK.
--   * Wallet ledger uses wallet_transactions (NOT wallet_reservations) and is
--     classified by the ACTUAL transaction_type, NOT by amount sign alone:
--       CREDIT RECEIVED = transaction_type IN
--         ('instant_win_credit','admin_credit','refund_credit') AND
--         amount_pence > 0.  ('reversal' is EXCLUDED from credit-received.)
--       PURCHASE SPEND  = transaction_type = 'order_spend' AND amount_pence < 0
--         AND source_checkout_intent_id IS NOT NULL.  ('admin_debit' and
--         'reversal' are EXCLUDED from purchase spend.)
--     Wallet reservations are not in this table and are never counted.
--   * Abandonment: a non-confirmed, non-debug, non-SIM checkout_intent older
--     than the configured abandoned_checkout first_delay_minutes (read from
--     marketing_automations; falls back to 45 only if unset), EXCLUDING any
--     intent for which the same customer later made a canonical confirmed
--     purchase for the SAME campaign (set-based NOT EXISTS anti-join).
--
-- SCOPE / SAFETY
--   * ATOMIC. Whole migration in one BEGIN/COMMIT.
--   * FAIL FAST. lock_timeout + statement_timeout set LOCAL.
--   * ADDITIVE / idempotent. CREATE ... IF NOT EXISTS, CREATE OR REPLACE, seed
--     singleton with ON CONFLICT DO NOTHING => re-run is a practical no-op.
--   * New table: RLS ENABLED + FORCED, NO policies, all access revoked from
--     public/anon/authenticated, and service_role explicitly stripped of ALL
--     privileges before being granted ONLY SELECT/INSERT/UPDATE (NO DELETE).
--   * Functions: SECURITY DEFINER, fixed search_path, EXECUTE revoked from
--     public/anon/authenticated; only the top-level + overview RPCs are granted
--     EXECUTE to service_role. The batch helper is owner-only.
--   * Affinity is DERIVED current-state: the SECURITY DEFINER helper removes and
--     rebuilds ONLY the candidate batch's affinity rows within one transaction
--     (so a failed rebuild rolls back rather than leaving a half-rebuilt user).
--     This DELETE runs with the definer owner's privileges; service_role itself
--     is NEVER granted DELETE on customer_campaign_affinity.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually ONCE in the Supabase
--   SQL editor (or psql), AFTER migration 009, while Marketing is paused. THEN,
--   separately and only after review, drive the backfill by repeatedly calling:
--       SELECT public.refresh_customer_marketing_intelligence(500);
-- ============================================================================

BEGIN;

-- Fail fast rather than block on a busy production database, and never let the
-- install run away. LOCAL = scoped to this transaction only; nothing global.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- Preflight (read-only): dependency check + single-execution advisory lock +
-- global-pause assertion. Any failure RAISES and rolls the whole migration back
-- BEFORE a single structure is created. Reads control state ONLY (no writes).
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text[] := ARRAY[]::text[];
  v_dep       text;
  v_sending   boolean;
  v_discovery boolean;
  v_rollout   integer;
BEGIN
  -- 1) Every required dependency must already exist. to_regclass() is a pure
  --    lookup (NULL when absent); we create/alter NONE of these dependencies.
  FOREACH v_dep IN ARRAY ARRAY[
    'public.customer_marketing_profiles',
    'public.customer_marketing_intelligence',
    'public.customer_campaign_affinity',
    'public.checkout_intents',
    'public.instant_win_awards',
    'public.wallet_transactions',
    'public.campaigns',
    'public.marketing_automations',
    'public.marketing_control_state'
  ] LOOP
    IF to_regclass(v_dep) IS NULL THEN
      v_missing := array_append(v_missing, v_dep);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage 3C2C migration aborted: required dependency % is missing. Run migrations up to 009 first.',
      array_to_string(v_missing, ', ');
  END IF;

  -- 2) Refuse to overlap with a concurrent execution of THIS migration.
  IF NOT pg_try_advisory_xact_lock(hashtext('wtf_marketing_stage_3c2c_intelligence_rollup')) THEN
    RAISE EXCEPTION
      'Stage 3C2C migration aborted: another execution is already in progress (advisory lock held).';
  END IF;

  -- 3) The Marketing Hub must be GLOBALLY PAUSED. This engine is analytics-only
  --    and MAY run while paused, but installation still asserts the controlled
  --    build state and NEVER mutates it.
  SELECT sending_enabled, discovery_enabled, rollout_limit
    INTO v_sending, v_discovery, v_rollout
    FROM public.marketing_control_state
   WHERE key = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stage 3C2C migration aborted: marketing_control_state singleton (key=''default'') not found; cannot confirm Marketing is paused.';
  END IF;

  IF v_sending IS DISTINCT FROM false
     OR v_discovery IS DISTINCT FROM false
     OR v_rollout   IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Stage 3C2C migration aborted: Marketing is not globally paused (sending_enabled=%, discovery_enabled=%, rollout_limit=%). Refusing to install.',
      v_sending, v_discovery, v_rollout;
  END IF;
END
$preflight$;

-- ============================================================================
-- 1. REFRESH STATE (NEW, dedicated singleton — NOT the profile refresh state)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_marketing_intelligence_refresh_state (
  key                  text        PRIMARY KEY DEFAULT 'default',
  backfill_started_at  timestamptz,
  backfill_cursor      uuid,
  backfill_complete    boolean     NOT NULL DEFAULT false,
  last_incremental_at  timestamptz,
  -- FROZEN INCREMENTAL WINDOW + UUID CURSOR (resumable, bounded incremental).
  -- While an incremental window is being paged, from/to are frozen and the
  -- cursor advances through user_ids. last_incremental_at is advanced to
  -- incremental_window_to ONLY when the frozen window is fully exhausted, so a
  -- source event committed after window_to belongs to the NEXT window and can
  -- never be skipped.
  incremental_window_from timestamptz,
  incremental_window_to   timestamptz,
  incremental_cursor      uuid,
  last_success_at      timestamptz,
  last_attempt_at      timestamptz,
  last_mode            text,
  last_processed_users integer     NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Singleton: exactly one row, key = 'default'.
  CONSTRAINT cmi_refresh_state_singleton_chk CHECK (key = 'default'),
  -- Bounded, whitelisted mode label only (no free-form error stacks / identities).
  CONSTRAINT cmi_refresh_state_mode_chk CHECK (
    last_mode IS NULL OR last_mode IN ('backfill', 'incremental', 'skipped')
  ),
  CONSTRAINT cmi_refresh_state_processed_nonneg_chk CHECK (last_processed_users >= 0),
  -- Window fields are all-or-nothing: from and to must be set together or both
  -- NULL, so a half-open window state can never be persisted.
  CONSTRAINT cmi_refresh_state_window_pair_chk CHECK (
    (incremental_window_from IS NULL) = (incremental_window_to IS NULL)
  ),
  -- When a window is active it must be ordered (from <= to).
  CONSTRAINT cmi_refresh_state_window_order_chk CHECK (
    incremental_window_from IS NULL
    OR incremental_window_to IS NULL
    OR incremental_window_from <= incremental_window_to
  ),
  -- A cursor is only meaningful inside an active window; it can never dangle
  -- without a frozen window to page through.
  CONSTRAINT cmi_refresh_state_cursor_requires_window_chk CHECK (
    incremental_cursor IS NULL OR incremental_window_to IS NOT NULL
  )
);

COMMENT ON TABLE public.customer_marketing_intelligence_refresh_state IS
  'Stage 3C2C singleton (key=default) driving bounded backfill + incremental refresh of customer_marketing_intelligence and customer_campaign_affinity. Separate from customer_marketing_profile_refresh_state. Stores no identities, emails or error stacks.';

INSERT INTO public.customer_marketing_intelligence_refresh_state (key)
VALUES ('default')
ON CONFLICT (key) DO NOTHING;

-- Security: RLS ENABLED + FORCED, no policies, service_role only, NO DELETE.
ALTER TABLE public.customer_marketing_intelligence_refresh_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_intelligence_refresh_state FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_marketing_intelligence_refresh_state FROM public, anon, authenticated;
-- Hardening: strip ALL from service_role first so it cannot inherit DELETE via
-- existing/default grants, then grant back exactly the verbs the singleton needs.
REVOKE ALL ON public.customer_marketing_intelligence_refresh_state FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.customer_marketing_intelligence_refresh_state TO service_role;

-- Time-driven maintenance support: an index on OUR OWN rollup table so the
-- incremental pass can cheaply find intelligence rows that have gone stale
-- (refreshed_at older than 24h) and recompute their rolling-window metrics even
-- when the customer generated no new source event. This indexes ONLY the
-- 3C2B-owned customer_marketing_intelligence table; NO operational
-- checkout/payment/wallet table is indexed by this migration.
CREATE INDEX IF NOT EXISTS idx_customer_marketing_intelligence_refreshed_at
  ON public.customer_marketing_intelligence (refreshed_at);

-- ============================================================================
-- 2. PRIVATE SET-BASED BATCH HELPER
--    Recomputes intelligence + rebuilds affinity for a bounded candidate batch
--    in ONE transaction, entirely set-based (no per-user loop, no query-per-user
--    correlated subqueries). Every candidate that has a marketing profile gets
--    an intelligence row even when all behavioural counts are zero. Returns the
--    number of intelligence rows written.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refresh_customer_marketing_intelligence_batch(
  p_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written        integer := 0;
  v_now            timestamptz := now();      -- single captured "now" per batch
  v_abandon_delay  interval;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Enforce the helper's OWN contract, independent of any caller. Deduplicate
  -- first (drop NULLs + repeats) so a caller passing duplicate UUIDs cannot
  -- inflate cardinality past the bound, then hard-refuse any batch over 1000.
  -- The helper must NEVER be capable of processing an unbounded array.
  SELECT array_agg(DISTINCT u ORDER BY u)
    INTO p_ids
    FROM unnest(p_ids) AS u
   WHERE u IS NOT NULL;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION
      'refresh_customer_marketing_intelligence_batch: batch size % exceeds the hard limit of 1000',
      cardinality(p_ids);
  END IF;

  -- Abandoned-checkout first delay from admin config (falls back to 45 minutes
  -- only if the row/column is unset). Read once; reused set-based below.
  SELECT make_interval(mins => COALESCE(ma.first_delay_minutes, 45))
    INTO v_abandon_delay
    FROM public.marketing_automations ma
   WHERE ma.automation_key = 'abandoned_checkout';
  IF v_abandon_delay IS NULL THEN
    v_abandon_delay := interval '45 minutes';
  END IF;

  -- --------------------------------------------------------------------------
  -- (A) INTELLIGENCE UPSERT — one set-based statement for the whole batch.
  -- --------------------------------------------------------------------------
  WITH targets AS (
    -- Universe is the STABLE profile system, never auth.users directly. A
    -- candidate id with no marketing profile is silently skipped (external
    -- contacts are never behaviour-scored here).
    SELECT p.user_id AS id,
           p.refreshed_at,
           p.source_updated_at
    FROM public.customer_marketing_profiles p
    WHERE p.user_id = ANY (p_ids)
  ),
  -- Canonical confirmed real orders for the candidate batch (predicate + cash
  -- formula reused EXACTLY from migration 003). ext_pence is the RAW canonical
  -- per-order external cash — NOT clamped here, so it is byte-for-byte the Stage
  -- 1 revenue definition. Non-negativity for the 009 CHECKs is applied ONLY to
  -- the final aggregates/outputs below, never to the individual order.
  co AS (
    SELECT
      ci.user_id,
      ci.id,
      ci.confirmed_at,
      ci.campaign_id,
      (CASE
        WHEN ci.external_payment_pence IS NOT NULL THEN ci.external_payment_pence
        ELSE COALESCE(ci.total_pence, 0) - COALESCE(ci.wallet_credit_pence, 0)
      END)::bigint AS ext_pence
    FROM public.checkout_intents ci
    JOIN targets t ON t.id = ci.user_id
    WHERE ci.state = 'confirmed'
      AND ci.provider IS DISTINCT FROM 'debug'
      AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
      AND ci.confirmed_at IS NOT NULL
  ),
  -- Purchase windows + spend windows + value stats, all from one captured v_now
  -- so counts are internally consistent and naturally nested (7<=14<=30<=60<=90,
  -- 30<=90) as the 009 monotonic CHECKs require. GREATEST(...,0) here guards the
  -- non-negative derived CONTAINERS only (the per-order ext_pence stays raw).
  -- latest_confirmed_at is carried out of this already-grouped aggregate so
  -- source_updated_at needs NO correlated per-customer MAX subquery.
  purchase AS (
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE confirmed_at >= v_now - interval '7 days')::integer  AS orders_7d,
      COUNT(*) FILTER (WHERE confirmed_at >= v_now - interval '14 days')::integer AS orders_14d,
      COUNT(*) FILTER (WHERE confirmed_at >= v_now - interval '30 days')::integer AS orders_30d,
      COUNT(*) FILTER (WHERE confirmed_at >= v_now - interval '60 days')::integer AS orders_60d,
      COUNT(*) FILTER (WHERE confirmed_at >= v_now - interval '90 days')::integer AS orders_90d,
      -- Defensive normalisation of the DERIVED intelligence fields ONLY (the raw
      -- per-order ext_pence formula above is untouched). Normal valid purchase
      -- data naturally satisfies 30d <= 90d, but a single anomalous historical
      -- negative order OUTSIDE the last 30 days could otherwise make the clamped
      -- 90d sum fall below the 30d sum and violate 009's live
      -- cmi_spend_window_monotonic_chk (external_spend_30d_pence <=
      -- external_spend_90d_pence), aborting the whole refresh. Forcing the 90d
      -- output to be at least the 30d output makes the invariant always
      -- satisfiable without changing revenue semantics for valid data.
      GREATEST(COALESCE(SUM(ext_pence) FILTER (WHERE confirmed_at >= v_now - interval '30 days'), 0), 0)::bigint AS external_spend_30d_pence,
      GREATEST(
        COALESCE(SUM(ext_pence) FILTER (WHERE confirmed_at >= v_now - interval '90 days'), 0),
        COALESCE(SUM(ext_pence) FILTER (WHERE confirmed_at >= v_now - interval '30 days'), 0),
        0
      )::bigint AS external_spend_90d_pence,
      GREATEST(ROUND(AVG(ext_pence)), 0)::bigint AS average_external_order_value_pence,
      GREATEST(MAX(ext_pence), 0)::bigint        AS highest_external_order_value_pence,
      MAX(confirmed_at)                          AS latest_confirmed_at
    FROM co
    GROUP BY user_id
  ),
  -- Set-based cadence via window functions (NO per-user LAG query). prev_asc
  -- feeds the average gap; rn_desc = 2 yields the second-most-recent purchase.
  ord AS (
    SELECT
      user_id,
      confirmed_at,
      LAG(confirmed_at) OVER (PARTITION BY user_id ORDER BY confirmed_at ASC, id ASC) AS prev_asc,
      ROW_NUMBER()      OVER (PARTITION BY user_id ORDER BY confirmed_at DESC, id DESC) AS rn_desc
    FROM co
  ),
  cadence AS (
    SELECT
      user_id,
      GREATEST(
        ROUND(AVG(EXTRACT(EPOCH FROM (confirmed_at - prev_asc)) / 3600.0)::numeric, 4),
        0
      ) AS average_purchase_gap_hours
    FROM ord
    WHERE prev_asc IS NOT NULL           -- only customers with >= 2 orders
    GROUP BY user_id
  ),
  prev AS (
    SELECT user_id, confirmed_at AS previous_confirmed_at
    FROM ord
    WHERE rn_desc = 2                     -- second-most-recent; NULL when < 2 orders
  ),
  -- Positive win history ONLY. Awards resolve to the customer through the
  -- candidate confirmed-order CTE (award.checkout_intent_id = co.id), which also
  -- enforces "tied to a canonical confirmed real checkout" and candidate scope.
  aw AS (
    SELECT
      co.user_id,
      a.id AS award_id,
      a.awarded_at,
      a.campaign_id,
      a.prize_value_pence,
      a.fulfilment_type,
      ROW_NUMBER() OVER (PARTITION BY co.user_id ORDER BY a.awarded_at DESC, a.id DESC) AS rn
    FROM public.instant_win_awards a
    JOIN co ON co.id = a.checkout_intent_id
  ),
  win_agg AS (
    SELECT
      user_id,
      COUNT(*)::integer AS win_count,
      COUNT(*) FILTER (WHERE awarded_at >= v_now - interval '30 days')::integer AS wins_30d,
      MAX(awarded_at) AS last_win_at
    FROM aw
    GROUP BY user_id
  ),
  last_win AS (
    SELECT
      user_id,
      campaign_id AS last_win_campaign_id,
      -- Canonical stored prize value (NEVER parsed from display text). NULL is
      -- preserved when absent; negatives dropped; clamped to int range.
      CASE
        WHEN prize_value_pence IS NULL THEN NULL
        WHEN prize_value_pence < 0     THEN NULL
        ELSE LEAST(prize_value_pence, 2147483647)::integer
      END AS last_win_value_pence,
      CASE
        WHEN fulfilment_type IN ('cash', 'wallet_credit', 'manual') THEN fulfilment_type
        ELSE NULL
      END AS last_win_fulfilment_type
    FROM aw
    WHERE rn = 1
  ),
  -- Wallet ledger (wallet_transactions ONLY; never wallet_reservations),
  -- classified by the ACTUAL transaction_type — NOT by amount sign alone.
  --   CREDIT RECEIVED = transaction_type IN
  --     ('instant_win_credit','admin_credit','refund_credit') AND amount_pence > 0.
  --     'reversal' is EXPLICITLY EXCLUDED from credit-received metrics.
  --   WALLET SPEND (genuine customer purchase) = transaction_type = 'order_spend'
  --     AND amount_pence < 0 AND source_checkout_intent_id IS NOT NULL.
  --     'admin_debit' and 'reversal' are NEVER counted as customer purchase spend,
  --     and wallet reservations are not in this table at all.
  wtx AS (
    SELECT
      wt.user_id,
      wt.transaction_type,
      wt.amount_pence,
      wt.created_at,
      wt.source_checkout_intent_id
    FROM public.wallet_transactions wt
    JOIN targets t ON t.id = wt.user_id
  ),
  wallet_agg AS (
    SELECT
      user_id,
      MAX(created_at) FILTER (
        WHERE transaction_type IN ('instant_win_credit', 'admin_credit', 'refund_credit')
          AND amount_pence > 0
      ) AS last_wallet_credit_at,
      MAX(created_at) FILTER (
        WHERE transaction_type = 'order_spend'
          AND amount_pence < 0
          AND source_checkout_intent_id IS NOT NULL
      ) AS last_wallet_debit_at,
      GREATEST(COALESCE(SUM(amount_pence) FILTER (
        WHERE transaction_type IN ('instant_win_credit', 'admin_credit', 'refund_credit')
          AND amount_pence > 0
          AND created_at >= v_now - interval '30 days'), 0), 0)::bigint AS wallet_credit_received_30d_pence,
      GREATEST(COALESCE(SUM(-amount_pence) FILTER (
        WHERE transaction_type = 'order_spend'
          AND amount_pence < 0
          AND source_checkout_intent_id IS NOT NULL
          AND created_at >= v_now - interval '30 days'), 0), 0)::bigint AS wallet_spent_30d_pence,
      -- Greatest ledger timestamp for this candidate; feeds source_updated_at
      -- (aggregate only — replaces a correlated per-customer MAX subquery).
      MAX(created_at) AS wallet_source_updated_at
    FROM wtx
    GROUP BY user_id
  ),
  -- Abandonment: non-confirmed, non-debug, non-SIM intents older than the
  -- configured delay, EXCLUDING any intent for which the same customer later
  -- made a canonical confirmed purchase for the SAME campaign (set-based
  -- NOT EXISTS against the candidate confirmed-order CTE).
  ab AS (
    SELECT
      ci.user_id,
      ci.id,
      ci.campaign_id,
      ci.created_at
    FROM public.checkout_intents ci
    JOIN targets t ON t.id = ci.user_id
    WHERE ci.state IS DISTINCT FROM 'confirmed'
      AND ci.provider IS DISTINCT FROM 'debug'
      AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
      AND ci.created_at IS NOT NULL
      AND ci.created_at <= v_now - v_abandon_delay
      AND NOT EXISTS (
        SELECT 1
        FROM co
        WHERE co.user_id = ci.user_id
          AND co.campaign_id = ci.campaign_id
          AND co.confirmed_at > ci.created_at
      )
  ),
  ab_ord AS (
    SELECT
      user_id,
      campaign_id,
      created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM ab
  ),
  ab_agg AS (
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE created_at >= v_now - interval '7 days')::integer  AS abandoned_7d_count,
      COUNT(*) FILTER (WHERE created_at >= v_now - interval '30 days')::integer AS abandoned_30d_count,
      MAX(created_at) AS last_abandoned_at
    FROM ab
    GROUP BY user_id
  ),
  ab_last AS (
    SELECT user_id, campaign_id AS last_abandoned_campaign_id
    FROM ab_ord
    WHERE rn = 1
  ),
  computed AS (
    SELECT
      t.id AS user_id,
      COALESCE(pu.orders_7d, 0)  AS orders_7d,
      COALESCE(pu.orders_14d, 0) AS orders_14d,
      COALESCE(pu.orders_30d, 0) AS orders_30d,
      COALESCE(pu.orders_60d, 0) AS orders_60d,
      COALESCE(pu.orders_90d, 0) AS orders_90d,
      COALESCE(pu.external_spend_30d_pence, 0) AS external_spend_30d_pence,
      COALESCE(pu.external_spend_90d_pence, 0) AS external_spend_90d_pence,
      pu.average_external_order_value_pence,
      pu.highest_external_order_value_pence,
      pv.previous_confirmed_at,
      cad.average_purchase_gap_hours,
      wa.last_win_at,
      COALESCE(wa.win_count, 0) AS win_count,
      COALESCE(wa.wins_30d, 0)  AS wins_30d,
      lw.last_win_value_pence,
      lw.last_win_fulfilment_type,
      lw.last_win_campaign_id,
      wl.last_wallet_credit_at,
      wl.last_wallet_debit_at,
      COALESCE(wl.wallet_credit_received_30d_pence, 0) AS wallet_credit_received_30d_pence,
      COALESCE(wl.wallet_spent_30d_pence, 0)           AS wallet_spent_30d_pence,
      ag.last_abandoned_at,
      COALESCE(ag.abandoned_7d_count, 0)  AS abandoned_7d_count,
      COALESCE(ag.abandoned_30d_count, 0) AS abandoned_30d_count,
      al.last_abandoned_campaign_id,
      -- Greatest known input-change timestamp across the customer's sources,
      -- built ENTIRELY from already-joined aggregate fields. NO correlated
      -- per-customer MAX subquery: latest_confirmed_at comes from `purchase` and
      -- wallet_source_updated_at from `wallet_agg`.
      GREATEST(
        t.refreshed_at,
        t.source_updated_at,
        pu.latest_confirmed_at,
        wa.last_win_at,
        wl.wallet_source_updated_at,
        ag.last_abandoned_at
      ) AS source_updated_at
    FROM targets t
    LEFT JOIN purchase pu ON pu.user_id = t.id
    LEFT JOIN prev     pv ON pv.user_id = t.id
    LEFT JOIN cadence  cad ON cad.user_id = t.id
    LEFT JOIN win_agg  wa ON wa.user_id = t.id
    LEFT JOIN last_win lw ON lw.user_id = t.id
    LEFT JOIN wallet_agg wl ON wl.user_id = t.id
    LEFT JOIN ab_agg   ag ON ag.user_id = t.id
    LEFT JOIN ab_last  al ON al.user_id = t.id
  ),
  upsert AS (
    INSERT INTO public.customer_marketing_intelligence AS cmi (
      user_id,
      orders_7d, orders_14d, orders_30d, orders_60d, orders_90d,
      external_spend_30d_pence, external_spend_90d_pence,
      average_external_order_value_pence, highest_external_order_value_pence,
      previous_confirmed_at, average_purchase_gap_hours,
      last_win_at, win_count, wins_30d,
      last_win_value_pence, last_win_fulfilment_type, last_win_campaign_id,
      last_wallet_credit_at, last_wallet_debit_at,
      wallet_credit_received_30d_pence, wallet_spent_30d_pence,
      last_abandoned_at, abandoned_7d_count, abandoned_30d_count, last_abandoned_campaign_id,
      source_updated_at, refreshed_at
    )
    SELECT
      c.user_id,
      c.orders_7d, c.orders_14d, c.orders_30d, c.orders_60d, c.orders_90d,
      c.external_spend_30d_pence, c.external_spend_90d_pence,
      c.average_external_order_value_pence, c.highest_external_order_value_pence,
      c.previous_confirmed_at, c.average_purchase_gap_hours,
      c.last_win_at, c.win_count, c.wins_30d,
      c.last_win_value_pence, c.last_win_fulfilment_type, c.last_win_campaign_id,
      c.last_wallet_credit_at, c.last_wallet_debit_at,
      c.wallet_credit_received_30d_pence, c.wallet_spent_30d_pence,
      c.last_abandoned_at, c.abandoned_7d_count, c.abandoned_30d_count, c.last_abandoned_campaign_id,
      c.source_updated_at, v_now
    FROM computed c
    ON CONFLICT (user_id) DO UPDATE SET
      orders_7d                          = EXCLUDED.orders_7d,
      orders_14d                         = EXCLUDED.orders_14d,
      orders_30d                         = EXCLUDED.orders_30d,
      orders_60d                         = EXCLUDED.orders_60d,
      orders_90d                         = EXCLUDED.orders_90d,
      external_spend_30d_pence           = EXCLUDED.external_spend_30d_pence,
      external_spend_90d_pence           = EXCLUDED.external_spend_90d_pence,
      average_external_order_value_pence = EXCLUDED.average_external_order_value_pence,
      highest_external_order_value_pence = EXCLUDED.highest_external_order_value_pence,
      previous_confirmed_at              = EXCLUDED.previous_confirmed_at,
      average_purchase_gap_hours         = EXCLUDED.average_purchase_gap_hours,
      last_win_at                        = EXCLUDED.last_win_at,
      win_count                          = EXCLUDED.win_count,
      wins_30d                           = EXCLUDED.wins_30d,
      last_win_value_pence               = EXCLUDED.last_win_value_pence,
      last_win_fulfilment_type           = EXCLUDED.last_win_fulfilment_type,
      last_win_campaign_id               = EXCLUDED.last_win_campaign_id,
      last_wallet_credit_at              = EXCLUDED.last_wallet_credit_at,
      last_wallet_debit_at               = EXCLUDED.last_wallet_debit_at,
      wallet_credit_received_30d_pence   = EXCLUDED.wallet_credit_received_30d_pence,
      wallet_spent_30d_pence             = EXCLUDED.wallet_spent_30d_pence,
      last_abandoned_at                  = EXCLUDED.last_abandoned_at,
      abandoned_7d_count                 = EXCLUDED.abandoned_7d_count,
      abandoned_30d_count                = EXCLUDED.abandoned_30d_count,
      last_abandoned_campaign_id         = EXCLUDED.last_abandoned_campaign_id,
      source_updated_at                  = EXCLUDED.source_updated_at,
      refreshed_at                       = EXCLUDED.refreshed_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_written FROM upsert;

  -- --------------------------------------------------------------------------
  -- (B) AFFINITY REBUILD — derived current-state, candidate batch ONLY.
  --     Remove then rebuild ONLY these candidate users' affinity rows, inside
  --     this same transaction. The DELETE executes with the definer owner's
  --     privileges; service_role is NEVER granted DELETE on this table. Rows for
  --     users outside the batch are never touched. A failure anywhere in the
  --     function rolls the whole call back (no half-rebuilt candidate).
  -- --------------------------------------------------------------------------
  DELETE FROM public.customer_campaign_affinity
  WHERE user_id = ANY (p_ids);

  -- Rebuild all supported affinity types SET-BASED from canonical confirmed
  -- purchases for the candidate batch. Recompute co here (batch-scoped) so this
  -- statement is independent of the upsert CTE above.
  WITH targets AS (
    SELECT p.user_id AS id
    FROM public.customer_marketing_profiles p
    WHERE p.user_id = ANY (p_ids)
  ),
  co AS (
    SELECT
      ci.user_id,
      ci.id,
      ci.confirmed_at,
      ci.campaign_id,
      -- RAW canonical per-order external cash (identical to Stage 1); NOT
      -- clamped here. Non-negativity is applied only to the affinity aggregates.
      (CASE
        WHEN ci.external_payment_pence IS NOT NULL THEN ci.external_payment_pence
        ELSE COALESCE(ci.total_pence, 0) - COALESCE(ci.wallet_credit_pence, 0)
      END)::bigint AS ext_pence
    FROM public.checkout_intents ci
    JOIN targets t ON t.id = ci.user_id
    WHERE ci.state = 'confirmed'
      AND ci.provider IS DISTINCT FROM 'debug'
      AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
      AND ci.confirmed_at IS NOT NULL
  ),
  -- campaign affinity: key = campaign UUID (lower-case; hyphens allowed by the
  -- 009 affinity_key CHECK). Only rows with a campaign.
  campaign_aff AS (
    SELECT
      user_id,
      'campaign'::text            AS affinity_type,
      lower(campaign_id::text)    AS affinity_key,
      COUNT(*)::integer           AS confirmed_order_count,
      GREATEST(COALESCE(SUM(ext_pence), 0), 0)::bigint AS external_spend_pence,
      MAX(confirmed_at)           AS last_confirmed_at
    FROM co
    WHERE campaign_id IS NOT NULL
    GROUP BY user_id, campaign_id
  ),
  -- reveal_type affinity: from the STRUCTURED campaigns.reveal_type ONLY,
  -- normalised by lower(btrim(...)). NEVER inferred from title/slug. Included
  -- only when the normalised key satisfies the 009 affinity_key token CHECK.
  reveal_aff AS (
    SELECT
      co.user_id,
      'reveal_type'::text                 AS affinity_type,
      lower(btrim(c.reveal_type))         AS affinity_key,
      COUNT(*)::integer                   AS confirmed_order_count,
      GREATEST(COALESCE(SUM(co.ext_pence), 0), 0)::bigint AS external_spend_pence,
      MAX(co.confirmed_at)                AS last_confirmed_at
    FROM co
    JOIN public.campaigns c ON c.id = co.campaign_id
    WHERE c.reveal_type IS NOT NULL
      AND lower(btrim(c.reveal_type)) ~ '^[a-z0-9_-]+$'
      AND char_length(lower(btrim(c.reveal_type))) BETWEEN 1 AND 100
    GROUP BY co.user_id, lower(btrim(c.reveal_type))
  ),
  -- presentation_type affinity: same rules as reveal_type, structured field only.
  presentation_aff AS (
    SELECT
      co.user_id,
      'presentation_type'::text              AS affinity_type,
      lower(btrim(c.presentation_type))      AS affinity_key,
      COUNT(*)::integer                      AS confirmed_order_count,
      GREATEST(COALESCE(SUM(co.ext_pence), 0), 0)::bigint AS external_spend_pence,
      MAX(co.confirmed_at)                   AS last_confirmed_at
    FROM co
    JOIN public.campaigns c ON c.id = co.campaign_id
    WHERE c.presentation_type IS NOT NULL
      AND lower(btrim(c.presentation_type)) ~ '^[a-z0-9_-]+$'
      AND char_length(lower(btrim(c.presentation_type))) BETWEEN 1 AND 100
    GROUP BY co.user_id, lower(btrim(c.presentation_type))
  ),
  all_aff AS (
    SELECT * FROM campaign_aff
    UNION ALL
    SELECT * FROM reveal_aff
    UNION ALL
    SELECT * FROM presentation_aff
  )
  INSERT INTO public.customer_campaign_affinity (
    user_id, affinity_type, affinity_key,
    confirmed_order_count, external_spend_pence, last_confirmed_at,
    created_at, updated_at
  )
  SELECT
    user_id, affinity_type, affinity_key,
    confirmed_order_count, external_spend_pence, last_confirmed_at,
    v_now, v_now
  FROM all_aff;

  RETURN v_written;
END;
$$;

COMMENT ON FUNCTION public.refresh_customer_marketing_intelligence_batch(uuid[]) IS
  'Stage 3C2C private set-based helper: recomputes customer_marketing_intelligence and rebuilds customer_campaign_affinity for a bounded candidate batch in one transaction. Reads operational tables only; writes only the two rollup tables. Owner-only (no anon/authenticated/service_role EXECUTE).';

-- Batch helper is internal to the orchestrator (same definer owner). Expose it
-- to NOBODY else. service_role is ALSO explicitly stripped: the helper is
-- reached only through the top-level SECURITY DEFINER orchestrator's owner
-- context, never called directly by service_role. EXECUTE is deliberately NOT
-- granted back to service_role.
REVOKE ALL ON FUNCTION public.refresh_customer_marketing_intelligence_batch(uuid[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_customer_marketing_intelligence_batch(uuid[]) FROM service_role;

-- ============================================================================
-- 3. TOP-LEVEL ORCHESTRATOR (service-role only): one bounded step per call.
--    Backfills over customer_marketing_profiles in batches, then switches to
--    safe incremental changed-user refresh. Advisory-locked (non-blocking) so
--    overlapping ticks skip. Mirrors the proven Stage 1 cursor/watermark design.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refresh_customer_marketing_intelligence(
  p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key   bigint := hashtext('wtf_customer_marketing_intelligence_refresh');
  v_batch      integer;
  v_started    timestamptz := clock_timestamp();
  v_now        timestamptz := now();
  v_overlap    interval := interval '15 minutes';
  v_state      public.customer_marketing_intelligence_refresh_state%ROWTYPE;
  v_ids        uuid[];
  v_count      integer := 0;
  v_processed  integer := 0;
  v_mode       text;
  v_complete   boolean;
  -- Frozen incremental window + cursor state.
  v_win_from      timestamptz;
  v_win_to        timestamptz;
  v_cursor        uuid;
  v_abandon_delay interval;
BEGIN
  -- Transaction-local safety limits, set before the lock and any work. Same
  -- fail-fast envelope as the proven Stage 1 refresh.
  PERFORM set_config('statement_timeout', '55s', true);
  PERFORM set_config('lock_timeout', '5s', true);

  -- Validate + clamp batch size: default 500, min 1, hard max 1000.
  v_batch := COALESCE(p_limit, 500);
  IF v_batch < 1 THEN
    v_batch := 500;
  END IF;
  IF v_batch > 1000 THEN
    v_batch := 1000;
  END IF;

  -- Non-blocking: if another refresh holds the lock, skip this tick entirely.
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'skipped',
      'skippedBecauseLocked', true,
      'processedUsers', 0,
      'backfillComplete', NULL,
      'lastSuccessAt', NULL,
      'durationMs', (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::bigint
    );
  END IF;

  -- Load (and lock) the singleton state row; create it if somehow absent.
  SELECT * INTO v_state
  FROM public.customer_marketing_intelligence_refresh_state
  WHERE key = 'default'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.customer_marketing_intelligence_refresh_state (key)
    VALUES ('default')
    ON CONFLICT (key) DO NOTHING;
    SELECT * INTO v_state
    FROM public.customer_marketing_intelligence_refresh_state
    WHERE key = 'default'
    FOR UPDATE;
  END IF;

  -- Record the attempt up-front (bounded metadata only).
  UPDATE public.customer_marketing_intelligence_refresh_state
     SET last_attempt_at = v_now,
         updated_at      = v_now
   WHERE key = 'default';

  -- ==========================================================================
  -- BACKFILL MODE — universe = customer_marketing_profiles (NOT auth.users).
  -- ==========================================================================
  IF NOT v_state.backfill_complete THEN
    v_mode := 'backfill';

    -- Stamp backfill start once (used later as the first incremental floor).
    IF v_state.backfill_started_at IS NULL THEN
      v_state.backfill_started_at := v_now;
    END IF;

    -- Next bounded batch of profile user_ids after the stored cursor, ordered
    -- by user_id (uses the customer_marketing_profiles PK for a range scan).
    SELECT array_agg(user_id ORDER BY user_id)
    INTO v_ids
    FROM (
      SELECT p.user_id
      FROM public.customer_marketing_profiles p
      WHERE (v_state.backfill_cursor IS NULL OR p.user_id > v_state.backfill_cursor)
      ORDER BY p.user_id
      LIMIT v_batch
    ) b;

    v_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_count > 0 THEN
      -- One set-based recompute + affinity rebuild for the whole batch.
      v_processed := public.refresh_customer_marketing_intelligence_batch(v_ids);
      -- Advance cursor to the last id of the ordered batch (only after success).
      v_state.backfill_cursor := v_ids[v_count];
    END IF;

    -- Fewer rows than requested => we reached the end of the profile universe.
    IF v_count < v_batch THEN
      v_complete := true;
      v_state.backfill_complete := true;
      -- First incremental must cover everything since backfill began.
      v_state.last_incremental_at := v_state.backfill_started_at;
    ELSE
      v_complete := false;
    END IF;

    UPDATE public.customer_marketing_intelligence_refresh_state
       SET backfill_started_at  = v_state.backfill_started_at,
           backfill_cursor      = v_state.backfill_cursor,
           backfill_complete    = v_state.backfill_complete,
           last_incremental_at  = v_state.last_incremental_at,
           last_success_at      = v_now,
           last_mode            = v_mode,
           last_processed_users = v_processed,
           updated_at           = v_now
     WHERE key = 'default';

    RETURN jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'skippedBecauseLocked', false,
      'processedUsers', v_processed,
      'backfillComplete', v_complete,
      'lastSuccessAt', v_now,
      'durationMs', (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::bigint
    );
  END IF;

  -- ==========================================================================
  -- INCREMENTAL MODE — RESUMABLE, BOUNDED, FROZEN WINDOW + UUID CURSOR.
  --
  -- A frozen window [window_from, window_to] is opened once, then paged in
  -- user_id order in bounded batches. last_incremental_at advances to window_to
  -- ONLY when the window is fully exhausted; the cursor advances after each
  -- successful batch. A timeout/failure rolls the whole call back (single
  -- transaction), so neither the cursor nor the watermark advances past
  -- unprocessed users, and a source event committed after window_to is picked up
  -- by the NEXT window. The batch handed to the helper is ALWAYS <= v_batch.
  -- ==========================================================================
  v_mode := 'incremental';

  -- Abandoned-checkout delay (drives abandonment-maturity candidate discovery).
  SELECT make_interval(mins => COALESCE(ma.first_delay_minutes, 45))
    INTO v_abandon_delay
    FROM public.marketing_automations ma
   WHERE ma.automation_key = 'abandoned_checkout';
  IF v_abandon_delay IS NULL THEN
    v_abandon_delay := interval '45 minutes';
  END IF;

  -- (A) Establish or resume the frozen window.
  IF v_state.incremental_window_to IS NULL THEN
    -- No active window: open a new one, frozen for its whole paging lifetime.
    v_win_from := COALESCE(v_state.last_incremental_at, v_state.backfill_started_at, v_now) - v_overlap;
    v_win_to   := v_now;
    v_cursor   := NULL;

    UPDATE public.customer_marketing_intelligence_refresh_state
       SET incremental_window_from = v_win_from,
           incremental_window_to   = v_win_to,
           incremental_cursor      = NULL,
           updated_at              = v_now
     WHERE key = 'default';
  ELSE
    -- Resume the existing frozen window from the stored cursor.
    v_win_from := v_state.incremental_window_from;
    v_win_to   := v_state.incremental_window_to;
    v_cursor   := v_state.incremental_cursor;
  END IF;

  -- (B..F) Build the DISTINCT candidate universe for the FROZEN window, restrict
  -- to user_id > cursor, order by user_id, and LIMIT to the bounded batch. Every
  -- source uses an index-friendly bounded range within the frozen window; there
  -- is NO broad checkout_intents.updated_at OR-scan and NO global
  -- wallet_transactions.created_at scan (wallet changes reach us via the Stage 1
  -- profile refreshed_at / source_updated_at bridge, source A).
  SELECT array_agg(uid ORDER BY uid)
  INTO v_ids
  FROM (
    SELECT DISTINCT uid
    FROM (
      -- A. Profiles changed/refreshed inside the frozen window. This is also the
      --    bridge for arbitrary checkout UPDATEs and ALL wallet activity, since
      --    Stage 1 already watches those and bumps the profile's refreshed_at /
      --    source_updated_at.
      SELECT p.user_id AS uid
      FROM public.customer_marketing_profiles p
      WHERE (p.refreshed_at     > v_win_from AND p.refreshed_at     <= v_win_to)
         OR (p.source_updated_at > v_win_from AND p.source_updated_at <= v_win_to)

      UNION ALL
      -- B. Real (non-debug, non-SIM) checkouts CREATED in the frozen window.
      SELECT ci.user_id
      FROM public.checkout_intents ci
      WHERE ci.user_id IS NOT NULL
        AND ci.provider IS DISTINCT FROM 'debug'
        AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
        AND ci.created_at > v_win_from AND ci.created_at <= v_win_to

      UNION ALL
      -- C. Canonical confirmed rows whose confirmed_at is in the frozen window.
      --    state = 'confirmed' is REQUIRED so this matches the exact canonical
      --    confirmed-order predicate (and lets the confirmed_at partial index
      --    apply); the batch helper re-applies the same scope authoritatively.
      SELECT ci.user_id
      FROM public.checkout_intents ci
      WHERE ci.user_id IS NOT NULL
        AND ci.state = 'confirmed'
        AND ci.provider IS DISTINCT FROM 'debug'
        AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
        AND ci.confirmed_at > v_win_from AND ci.confirmed_at <= v_win_to

      UNION ALL
      -- D. Awards with awarded_at in the frozen window (indexed awarded_at),
      --    resolved to the user through their checkout.
      SELECT ci.user_id
      FROM public.instant_win_awards a
      JOIN public.checkout_intents ci ON ci.id = a.checkout_intent_id
      WHERE a.awarded_at > v_win_from AND a.awarded_at <= v_win_to

      UNION ALL
      -- E. Abandonment MATURITY crossings: a pending (non-confirmed), real,
      --    non-SIM checkout whose created_at + delay lands inside the frozen
      --    window — i.e. it becomes an abandoned-checkout signal now, WITHOUT any
      --    source-row UPDATE. Bounded indexable created_at range; the
      --    authoritative same-campaign conversion exclusion stays in the batch
      --    helper (this query only ensures timely recomputation).
      SELECT ci.user_id
      FROM public.checkout_intents ci
      WHERE ci.user_id IS NOT NULL
        AND ci.state IS DISTINCT FROM 'confirmed'
        AND ci.provider IS DISTINCT FROM 'debug'
        AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
        AND ci.created_at >  v_win_from - v_abandon_delay
        AND ci.created_at <= v_win_to   - v_abandon_delay

      UNION ALL
      -- F. Time-driven maintenance: intelligence rows older than 24h relative to
      --    the frozen window_to, so rolling-window metrics (orders_*d, spend_*d,
      --    wins_30d, wallet_*_30d, abandoned_*_count) are recomputed at least
      --    daily even with no new source event. Uses the refreshed_at index.
      SELECT cmi.user_id
      FROM public.customer_marketing_intelligence cmi
      WHERE cmi.refreshed_at < v_win_to - interval '24 hours'
    ) u
    WHERE uid IS NOT NULL
      AND (v_cursor IS NULL OR uid > v_cursor)
    ORDER BY uid
    LIMIT v_batch
  ) picked;

  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count > 0 THEN
    -- Bounded batch (<= v_batch <= 1000); helper re-enforces its own hard bound.
    v_processed := public.refresh_customer_marketing_intelligence_batch(v_ids);
  END IF;

  -- The frozen window is exhausted when this page returned fewer than a full
  -- batch (nothing remains beyond the last user_id).
  v_complete := (v_count < v_batch);

  IF v_complete THEN
    -- Window done: advance the watermark to window_to and CLEAR the
    -- window/cursor so the next call opens a fresh window. last_incremental_at
    -- only advances here, once no candidates remain — never past unprocessed
    -- users.
    UPDATE public.customer_marketing_intelligence_refresh_state
       SET last_incremental_at     = v_win_to,
           incremental_window_from = NULL,
           incremental_window_to   = NULL,
           incremental_cursor      = NULL,
           last_success_at         = v_now,
           last_mode               = v_mode,
           last_processed_users    = v_processed,
           updated_at              = v_now
     WHERE key = 'default';
  ELSE
    -- Window continues: advance ONLY the cursor to the last processed user_id.
    -- last_incremental_at is deliberately left untouched so the window stays
    -- frozen until fully paged.
    UPDATE public.customer_marketing_intelligence_refresh_state
       SET incremental_cursor   = v_ids[v_count],
           last_success_at      = v_now,
           last_mode            = v_mode,
           last_processed_users = v_processed,
           updated_at           = v_now
     WHERE key = 'default';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'skippedBecauseLocked', false,
    'processedUsers', v_processed,
    'backfillComplete', true,
    'incrementalWindowComplete', v_complete,
    'lastSuccessAt', v_now,
    'durationMs', (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::bigint
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_customer_marketing_intelligence(integer) IS
  'Stage 3C2C service-role-only, advisory-locked bounded refresh of customer_marketing_intelligence + customer_campaign_affinity. One backfill batch per call (universe = customer_marketing_profiles) until complete, then incremental changed-user refresh with a watermark + 15m overlap. Reads operational tables only; NEVER alters marketing control state. Returns compact stats (no identities/emails).';

REVOKE ALL ON FUNCTION public.refresh_customer_marketing_intelligence(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_marketing_intelligence(integer) TO service_role;

-- ============================================================================
-- 4. COMPACT ADMIN OVERVIEW RPC (service-role only, aggregates ONLY).
--    Reads ONLY the two rollup tables + the refresh-state row. No scan of
--    checkout_intents, instant_win_awards or wallet_transactions. No identities.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_marketing_intelligence_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE
  v_refresh   jsonb;
  v_customers jsonb;
  v_totals    jsonb;
  v_affinity  jsonb;
BEGIN
  -- statement_timeout is set DECLARATIVELY on the function (SET clause above);
  -- a STABLE function must not call set_config() in its body.
  SELECT jsonb_build_object(
           'backfillComplete', COALESCE(s.backfill_complete, false),
           'lastSuccessAt',    s.last_success_at,
           'lastAttemptAt',    s.last_attempt_at
         )
    INTO v_refresh
    FROM public.customer_marketing_intelligence_refresh_state s
   WHERE s.key = 'default';

  IF v_refresh IS NULL THEN
    v_refresh := jsonb_build_object(
      'backfillComplete', false,
      'lastSuccessAt', NULL,
      'lastAttemptAt', NULL
    );
  END IF;

  SELECT jsonb_build_object(
           'intelligenceRows',                 COALESCE(COUNT(*), 0),
           'orders7dCustomers',                COALESCE(COUNT(*) FILTER (WHERE orders_7d > 0), 0),
           'orders30dCustomers',               COALESCE(COUNT(*) FILTER (WHERE orders_30d > 0), 0),
           'recentWinnerCustomers30d',         COALESCE(COUNT(*) FILTER (WHERE wins_30d > 0), 0),
           'walletCreditReceived30dCustomers', COALESCE(COUNT(*) FILTER (WHERE wallet_credit_received_30d_pence > 0), 0),
           'recentAbandoner30dCustomers',      COALESCE(COUNT(*) FILTER (WHERE abandoned_30d_count > 0), 0),
           'customersWithAverageCadence',      COALESCE(COUNT(*) FILTER (WHERE average_purchase_gap_hours IS NOT NULL), 0)
         ),
         jsonb_build_object(
           'orders7d',                    COALESCE(SUM(orders_7d), 0),
           'orders30d',                   COALESCE(SUM(orders_30d), 0),
           'externalSpend30dPence',       COALESCE(SUM(external_spend_30d_pence), 0),
           'wins30d',                     COALESCE(SUM(wins_30d), 0),
           'walletCreditReceived30dPence',COALESCE(SUM(wallet_credit_received_30d_pence), 0),
           'walletSpent30dPence',         COALESCE(SUM(wallet_spent_30d_pence), 0),
           'abandoned30d',                COALESCE(SUM(abandoned_30d_count), 0)
         )
    INTO v_customers, v_totals
    FROM public.customer_marketing_intelligence;

  SELECT jsonb_build_object(
           'rows',                  COALESCE(COUNT(*), 0),
           'customers',             COALESCE(COUNT(DISTINCT user_id), 0),
           'campaignRows',          COALESCE(COUNT(*) FILTER (WHERE affinity_type = 'campaign'), 0),
           'revealTypeRows',        COALESCE(COUNT(*) FILTER (WHERE affinity_type = 'reveal_type'), 0),
           'presentationTypeRows',  COALESCE(COUNT(*) FILTER (WHERE affinity_type = 'presentation_type'), 0)
         )
    INTO v_affinity
    FROM public.customer_campaign_affinity;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'refresh',   v_refresh,
    'customers', v_customers,
    'totals',    v_totals,
    'affinity',  v_affinity
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_marketing_intelligence_overview() IS
  'Stage 3C2C compact, service-role-only, STABLE overview. Reads ONLY customer_marketing_intelligence, customer_campaign_affinity and the intelligence refresh-state row. Returns aggregates only (no identities/emails); scans no operational source table.';

REVOKE ALL ON FUNCTION public.get_admin_marketing_intelligence_overview() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_intelligence_overview() TO service_role;

COMMIT;
