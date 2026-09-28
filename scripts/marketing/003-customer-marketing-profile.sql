-- ============================================================================
-- WTF Marketing Hub — Stage 1: lightweight customer marketing profile
-- ----------------------------------------------------------------------------
-- Adds a compact, SERVICE-ROLE-ONLY analytics profile per customer plus a
-- singleton refresh-state row and a bounded, advisory-locked refresh RPC that
-- backfills in batches and then refreshes only changed users incrementally.
--
-- This migration is BACKEND INFRASTRUCTURE ONLY. It sends no email, adds no UI,
-- and never writes to any table other than the two new profile tables. It reads
-- checkout_intents / wallet_accounts / auth.users / the Stage 0 marketing tables
-- read-only.
--
-- SAFETY
--   * ADDITIVE and safe to re-run: CREATE TABLE/INDEX IF NOT EXISTS, the
--     singleton uses ON CONFLICT DO NOTHING, and functions use CREATE OR
--     REPLACE. Re-running never drops data or resets refresh state.
--   * Does NOT modify or rerun migrations 001 or 002.
--   * Does NOT rename or replace any Stage 0 table/function.
--   * Adds NO index to checkout_intents (existing indexes are sufficient:
--     checkout_intents_user_created_idx, idx_checkout_intents_confirmed_at_confirmed,
--     idx_checkout_intents_created_at).
--
-- HOW TO RUN
--   The application NEVER executes this. Run it once manually in the Supabase
--   SQL editor (or psql) against the project database, AFTER 001 and 002.
--
-- CANONICAL DEFINITIONS (identical to the deployed reporting refresh; do NOT
-- diverge):
--   Eligible confirmed order:
--       state = 'confirmed'
--       AND provider IS DISTINCT FROM 'debug'
--       AND (ref IS NULL OR ref NOT LIKE 'SIM-%')
--   External revenue per order:
--       CASE WHEN external_payment_pence IS NOT NULL THEN external_payment_pence
--            ELSE total_pence - COALESCE(wallet_credit_pence, 0) END
--   Purchase timing: confirmed_at
--   Wallet available: GREATEST(COALESCE(balance_pence,0) - COALESCE(reserved_pence,0), 0)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Profile table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_marketing_profiles (
  user_id                     uuid PRIMARY KEY
                                REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Lowercased + trimmed email. SERVICE-ROLE ONLY: never returned to a browser
  -- in Stage 1. No full names, no checkout rows, no campaign-history arrays,
  -- no raw suppression reasons, no free-form JSON are stored here by design.
  email_lc                    text        NOT NULL,
  email_confirmed             boolean     NOT NULL DEFAULT false,
  account_active              boolean     NOT NULL DEFAULT true,
  account_created_at          timestamptz,

  first_confirmed_at          timestamptz,
  last_confirmed_at           timestamptz,
  confirmed_order_count       bigint      NOT NULL DEFAULT 0,
  lifetime_external_pence     bigint      NOT NULL DEFAULT 0,
  last_campaign_id            uuid,

  wallet_available_pence      bigint      NOT NULL DEFAULT 0,

  marketing_enabled           boolean     NOT NULL DEFAULT false,
  has_active_suppression      boolean     NOT NULL DEFAULT false,
  -- Cached eligibility for FAST future audience COUNTS only. This is NOT
  -- authoritative for sending: future send workers MUST re-check
  -- public.is_marketing_email_eligible immediately before sending.
  marketing_eligible_snapshot boolean     NOT NULL DEFAULT false,

  source_updated_at           timestamptz,
  refreshed_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customer_marketing_profiles IS
  'Stage 1 compact per-customer marketing analytics profile. Service-role only (RLS forced, no policies). marketing_eligible_snapshot is a cached count-helper, NOT authoritative for sending — send workers must re-check is_marketing_email_eligible.';

-- Bounded, non-speculative indexes only.
CREATE INDEX IF NOT EXISTS idx_cmp_last_confirmed_at
  ON public.customer_marketing_profiles (last_confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmp_confirmed_order_count
  ON public.customer_marketing_profiles (confirmed_order_count);
CREATE INDEX IF NOT EXISTS idx_cmp_lifetime_external_pence
  ON public.customer_marketing_profiles (lifetime_external_pence);
CREATE INDEX IF NOT EXISTS idx_cmp_wallet_available_pence
  ON public.customer_marketing_profiles (wallet_available_pence)
  WHERE wallet_available_pence > 0;
CREATE INDEX IF NOT EXISTS idx_cmp_eligible_last_confirmed
  ON public.customer_marketing_profiles (marketing_eligible_snapshot, last_confirmed_at DESC);

-- ----------------------------------------------------------------------------
-- 2) Refresh-state (singleton)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_marketing_profile_refresh_state (
  key                  text PRIMARY KEY,
  backfill_started_at  timestamptz,
  backfill_cursor      uuid,
  backfill_complete    boolean     NOT NULL DEFAULT false,
  last_incremental_at  timestamptz,
  last_success_at      timestamptz,
  last_processed_users integer     NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customer_marketing_profile_refresh_state IS
  'Singleton (key=default) driving bounded backfill + incremental refresh of customer_marketing_profiles. Stores no identities, emails or error stacks.';

INSERT INTO public.customer_marketing_profile_refresh_state (key)
VALUES ('default')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3) RLS + permissions (both tables): forced RLS, no policies, service-role only
--    (service_role bypasses RLS in Supabase; forcing RLS with zero policies
--    blocks anon/authenticated entirely).
-- ----------------------------------------------------------------------------
ALTER TABLE public.customer_marketing_profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_profiles                FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_profile_refresh_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_profile_refresh_state   FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_marketing_profiles              FROM public, anon, authenticated;
REVOKE ALL ON public.customer_marketing_profile_refresh_state FROM public, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_marketing_profiles              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_marketing_profile_refresh_state TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Private batch upsert helper
--    Recomputes a set of users from authoritative tables and upserts them in ONE
--    set-based statement. Same computation for backfill and incremental, so the
--    profile is identical no matter which path wrote it. Returns rows written.
--    Not granted to anyone: it is only ever called by the definer RPC below,
--    which runs as the function owner.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_customer_marketing_profiles_batch(
  p_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written integer := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH targets AS (
    SELECT
      u.id,
      btrim(lower(coalesce(u.email, ''))) AS email_lc,
      (u.email_confirmed_at IS NOT NULL)  AS email_confirmed,
      u.deleted_at,
      u.created_at,
      u.updated_at
    FROM auth.users u
    WHERE u.id = ANY (p_ids)
      -- email_lc is NOT NULL; a user with no usable email cannot be profiled.
      AND btrim(lower(coalesce(u.email, ''))) <> ''
  ),
  orders AS (
    SELECT
      ci.user_id,
      MIN(ci.confirmed_at) AS first_confirmed_at,
      MAX(ci.confirmed_at) AS last_confirmed_at,
      COUNT(*)::bigint     AS confirmed_order_count,
      SUM(
        CASE
          WHEN ci.external_payment_pence IS NOT NULL THEN ci.external_payment_pence
          ELSE COALESCE(ci.total_pence, 0) - COALESCE(ci.wallet_credit_pence, 0)
        END
      )::bigint            AS lifetime_external_pence
    FROM public.checkout_intents ci
    JOIN targets t ON t.id = ci.user_id
    WHERE ci.state = 'confirmed'
      AND ci.provider IS DISTINCT FROM 'debug'
      AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
      AND ci.confirmed_at IS NOT NULL
    GROUP BY ci.user_id
  ),
  last_campaign AS (
    -- Deterministic: newest confirmed_at, tie-broken by id DESC.
    SELECT DISTINCT ON (ci.user_id)
      ci.user_id,
      ci.campaign_id
    FROM public.checkout_intents ci
    JOIN targets t ON t.id = ci.user_id
    WHERE ci.state = 'confirmed'
      AND ci.provider IS DISTINCT FROM 'debug'
      AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
      AND ci.confirmed_at IS NOT NULL
      AND ci.campaign_id IS NOT NULL
    ORDER BY ci.user_id, ci.confirmed_at DESC, ci.id DESC
  ),
  wallet AS (
    SELECT
      w.user_id,
      GREATEST(COALESCE(w.balance_pence, 0) - COALESCE(w.reserved_pence, 0), 0) AS wallet_available_pence,
      w.updated_at
    FROM public.wallet_accounts w
    JOIN targets t ON t.id = w.user_id
  ),
  pref AS (
    SELECT mp.user_id, mp.email_marketing_enabled, mp.updated_at
    FROM public.marketing_preferences mp
    JOIN targets t ON t.id = mp.user_id
  ),
  supp AS (
    -- Active (non-revoked) suppression matched by user id OR normalised email.
    SELECT DISTINCT t.id AS user_id
    FROM targets t
    JOIN public.marketing_suppressions s
      ON s.revoked_at IS NULL
     AND (s.user_id = t.id OR s.email_lc = t.email_lc)
  ),
  computed AS (
    SELECT
      t.id                                                     AS user_id,
      t.email_lc,
      t.email_confirmed,
      (t.deleted_at IS NULL)                                   AS account_active,
      t.created_at                                             AS account_created_at,
      o.first_confirmed_at,
      o.last_confirmed_at,
      COALESCE(o.confirmed_order_count, 0)                     AS confirmed_order_count,
      COALESCE(o.lifetime_external_pence, 0)                   AS lifetime_external_pence,
      lc.campaign_id                                           AS last_campaign_id,
      COALESCE(w.wallet_available_pence, 0)                    AS wallet_available_pence,
      COALESCE(p.email_marketing_enabled, false)              AS marketing_enabled,
      (s.user_id IS NOT NULL)                                  AS has_active_suppression,
      (
        (t.deleted_at IS NULL)
        AND t.email_confirmed
        AND COALESCE(p.email_marketing_enabled, false)
        AND (s.user_id IS NULL)
      )                                                        AS marketing_eligible_snapshot,
      GREATEST(
        t.updated_at,
        o.last_confirmed_at,
        w.updated_at,
        p.updated_at
      )                                                        AS source_updated_at
    FROM targets t
    LEFT JOIN orders        o  ON o.user_id  = t.id
    LEFT JOIN last_campaign lc ON lc.user_id = t.id
    LEFT JOIN wallet        w  ON w.user_id  = t.id
    LEFT JOIN pref          p  ON p.user_id  = t.id
    LEFT JOIN supp          s  ON s.user_id  = t.id
  ),
  upsert AS (
    INSERT INTO public.customer_marketing_profiles AS cmp (
      user_id, email_lc, email_confirmed, account_active, account_created_at,
      first_confirmed_at, last_confirmed_at, confirmed_order_count,
      lifetime_external_pence, last_campaign_id, wallet_available_pence,
      marketing_enabled, has_active_suppression, marketing_eligible_snapshot,
      source_updated_at, refreshed_at
    )
    SELECT
      c.user_id, c.email_lc, c.email_confirmed, c.account_active, c.account_created_at,
      c.first_confirmed_at, c.last_confirmed_at, c.confirmed_order_count,
      c.lifetime_external_pence, c.last_campaign_id, c.wallet_available_pence,
      c.marketing_enabled, c.has_active_suppression, c.marketing_eligible_snapshot,
      c.source_updated_at, now()
    FROM computed c
    ON CONFLICT (user_id) DO UPDATE SET
      email_lc                    = EXCLUDED.email_lc,
      email_confirmed             = EXCLUDED.email_confirmed,
      account_active              = EXCLUDED.account_active,
      account_created_at          = EXCLUDED.account_created_at,
      first_confirmed_at          = EXCLUDED.first_confirmed_at,
      last_confirmed_at           = EXCLUDED.last_confirmed_at,
      confirmed_order_count       = EXCLUDED.confirmed_order_count,
      lifetime_external_pence     = EXCLUDED.lifetime_external_pence,
      last_campaign_id            = EXCLUDED.last_campaign_id,
      wallet_available_pence      = EXCLUDED.wallet_available_pence,
      marketing_enabled           = EXCLUDED.marketing_enabled,
      has_active_suppression      = EXCLUDED.has_active_suppression,
      marketing_eligible_snapshot = EXCLUDED.marketing_eligible_snapshot,
      source_updated_at           = EXCLUDED.source_updated_at,
      refreshed_at                = EXCLUDED.refreshed_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_written FROM upsert;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_customer_marketing_profiles_batch(uuid[]) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) Public refresh RPC (service-role only): one bounded step per call.
--    Backfills existing users in batches, then switches to incremental
--    changed-user refresh. Advisory-locked so overlapping cron ticks skip
--    rather than stack. Returns compact stats with NO identities/emails.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_customer_marketing_profiles(
  p_backfill_batch_size integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key      bigint := hashtext('wtf_customer_marketing_profile_refresh');
  v_batch         integer;
  v_started       timestamptz := clock_timestamp();
  v_now           timestamptz := now();
  v_overlap       interval := interval '15 minutes';
  v_state         public.customer_marketing_profile_refresh_state%ROWTYPE;
  v_ids           uuid[];
  v_count         integer := 0;
  v_processed     integer := 0;
  v_mode          text;
  v_since         timestamptz;
  v_complete      boolean;
BEGIN
  -- Transaction-local safety limits, set before the lock and any work.
  PERFORM set_config('statement_timeout', '55s', true);
  PERFORM set_config('lock_timeout', '5s', true);

  -- Validate + clamp batch size: default 500, min 1, hard max 1000.
  v_batch := COALESCE(p_backfill_batch_size, 500);
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
    FROM public.customer_marketing_profile_refresh_state
   WHERE key = 'default'
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.customer_marketing_profile_refresh_state (key)
    VALUES ('default')
    ON CONFLICT (key) DO NOTHING;
    SELECT * INTO v_state
      FROM public.customer_marketing_profile_refresh_state
     WHERE key = 'default'
     FOR UPDATE;
  END IF;

  -- ==========================================================================
  -- BACKFILL MODE
  -- ==========================================================================
  IF NOT v_state.backfill_complete THEN
    v_mode := 'backfill';

    -- Stamp backfill start once (used later as the first incremental floor).
    IF v_state.backfill_started_at IS NULL THEN
      v_state.backfill_started_at := v_now;
    END IF;

    -- Next bounded batch of auth users after the stored cursor, ordered by id.
    SELECT array_agg(id ORDER BY id)
      INTO v_ids
      FROM (
        SELECT u.id
          FROM auth.users u
         WHERE (v_state.backfill_cursor IS NULL OR u.id > v_state.backfill_cursor)
         ORDER BY u.id
         LIMIT v_batch
      ) b;

    v_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_count > 0 THEN
      -- One set-based upsert for the whole batch.
      v_processed := public.refresh_customer_marketing_profiles_batch(v_ids);
      -- Advance cursor to the last id of the ordered batch (only after success).
      v_state.backfill_cursor := v_ids[v_count];
    END IF;

    -- Fewer rows than requested => we reached the end of auth.users.
    IF v_count < v_batch THEN
      v_complete := true;
      v_state.backfill_complete := true;
      -- First incremental must cover everything since backfill began.
      v_state.last_incremental_at := v_state.backfill_started_at;
    ELSE
      v_complete := false;
    END IF;

    UPDATE public.customer_marketing_profile_refresh_state
       SET backfill_started_at  = v_state.backfill_started_at,
           backfill_cursor      = v_state.backfill_cursor,
           backfill_complete    = v_state.backfill_complete,
           last_incremental_at  = v_state.last_incremental_at,
           last_success_at      = v_now,
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
  -- INCREMENTAL MODE
  -- ==========================================================================
  v_mode := 'incremental';

  -- Watermark floor with overlap so equal timestamps / delayed commits are not
  -- skipped. After backfill, last_incremental_at was seeded to backfill_started_at.
  v_since := COALESCE(v_state.last_incremental_at, v_state.backfill_started_at, v_now) - v_overlap;

  SELECT array_agg(DISTINCT uid)
    INTO v_ids
    FROM (
      SELECT u.id AS uid
        FROM auth.users u
       WHERE u.updated_at >= v_since
      UNION
      -- Candidate DETECTION is intentionally broad: any changed checkout row for
      -- a user (by confirmed_at OR updated_at) makes that user a candidate, so a
      -- confirmed order that later leaves 'confirmed' (e.g. refunded/voided) still
      -- forces a recompute. We only exclude purely-simulated rows so they never
      -- cause churn. The strict eligible scope (state='confirmed', not debug, not
      -- SIM) is RE-APPLIED in refresh_customer_marketing_profiles_batch when the
      -- aggregates are computed, so widening detection here cannot corrupt totals.
      SELECT ci.user_id
        FROM public.checkout_intents ci
       WHERE ci.user_id IS NOT NULL
         AND ci.provider IS DISTINCT FROM 'debug'
         AND (ci.ref IS NULL OR ci.ref NOT LIKE 'SIM-%')
         AND (ci.confirmed_at >= v_since OR ci.updated_at >= v_since)
      UNION
      SELECT w.user_id
        FROM public.wallet_accounts w
       WHERE w.updated_at >= v_since
      UNION
      SELECT mp.user_id
        FROM public.marketing_preferences mp
       WHERE mp.updated_at >= v_since
      UNION
      SELECT s.user_id
        FROM public.marketing_suppressions s
       WHERE s.created_at >= v_since
          OR s.revoked_at >= v_since
    ) c
   WHERE uid IS NOT NULL;

  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count > 0 THEN
    v_processed := public.refresh_customer_marketing_profiles_batch(v_ids);
  END IF;

  -- Advance the watermark ONLY on success. v_now was captured at the start, so
  -- rows committed during this run are re-covered by the next run's overlap.
  UPDATE public.customer_marketing_profile_refresh_state
     SET last_incremental_at  = v_now,
         last_success_at      = v_now,
         last_processed_users = v_processed,
         updated_at           = v_now
   WHERE key = 'default';

  RETURN jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'skippedBecauseLocked', false,
    'processedUsers', v_processed,
    'backfillComplete', true,
    'lastSuccessAt', v_now,
    'durationMs', (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::bigint
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_customer_marketing_profiles(integer) IS
  'Service-role-only, advisory-locked bounded refresh of customer_marketing_profiles. One batch of backfill per call until complete, then incremental changed-user refresh. Returns compact stats with no identities or emails.';

-- Execution grants: only the service_role (protected cron / admin) may call.
REVOKE ALL ON FUNCTION public.refresh_customer_marketing_profiles(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_marketing_profiles(integer) TO service_role;

-- ============================================================================
-- End of migration 003. No table/function was renamed or dropped; no data was
-- changed outside the two new profile tables; no email is sent and no sending
-- capability is added.
-- ============================================================================
